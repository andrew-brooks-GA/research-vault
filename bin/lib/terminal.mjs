// Plan 2026-11-18 browser terminal D2: one shell for `teach serve --terminal`, in a pseudo-terminal. Node has no pty of
// its own, so a python3 helper (`pty.fork`) holds it: standard input goes to the terminal, the terminal's output to
// standard output, and lines of `<rows> <cols>` on fd 3 set the window size.
import { spawn, spawnSync } from 'node:child_process';
import { parse, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const PYTHON_CWD = parse(fileURLToPath(import.meta.url)).root;

// Writes to the terminal wait in a queue until select says it is writable, so a shell that reads nothing cannot stop
// its output from being read. At the end of standard input it closes the terminal, which hangs the shell up, then
// waits for it; at the end of fd 3 it stops reading fd 3. Every 0.5 s at most it checks whether the shell has ended,
// since a background job can hold the terminal open after the shell exits; then it passes on the output left in the
// terminal and exits. The shell does not get fd 3, so such a job cannot hold the size pipe open either, which would keep
// Node's 'close' from firing.
export const HELPER = `
import os, pty, sys, select, fcntl, termios, struct
pid, fd = pty.fork()
if pid == 0:
    os.close(3)
    try: os.chdir(sys.argv[1])
    except OSError: os._exit(1)
    launcher_end = sys.argv.index('--', 2)
    if launcher_end > 2:
        os.environ['PYTHONEXECUTABLE'] = sys.argv[2].split('=', 1)[1]
    shell = sys.argv[launcher_end + 1:]
    os.execvp(shell[0], shell)
os.set_blocking(fd, False)
ins, queue, size, reaped = [fd, 0, 3], b'', b'', False
while not reaped:
    r, w, _ = select.select(ins, [fd] if queue else [], [], 0.5)
    if fd in r:
        try: data = os.read(fd, 65536)
        except BlockingIOError: data = None
        except OSError: break
        if data == b'': break
        if data: os.write(1, data)
    if fd in w:
        try: queue = queue[os.write(fd, queue[:65536]):]
        except BlockingIOError: pass
        except OSError: break
    if 0 in r:
        data = os.read(0, 65536)
        if not data: break
        queue += data
    if 3 in r:
        chunk = os.read(3, 64)
        if not chunk: ins.remove(3)
        size += chunk
        while b'\\n' in size:
            line, size = size.split(b'\\n', 1)
            rows, cols = map(int, line.split())
            fcntl.ioctl(fd, termios.TIOCSWINSZ, struct.pack('HHHH', rows, cols, 0, 0))
    reaped = os.waitpid(pid, os.WNOHANG)[0] == pid
if reaped:
    try:
        while True:
            data = os.read(fd, 65536)
            if not data: break
            os.write(1, data)
    except OSError: pass
os.close(fd)
if not reaped: os.waitpid(pid, 0)
`;

export const KEPT_MAX = 256 * 1024;
export const UNSENT_MAX = 4 * 1024 * 1024;

// CPython reads these during path initialization even in isolated mode.
function takeLauncherEnv(env) {
  const executable = env.PYTHONEXECUTABLE;
  delete env.PYTHONEXECUTABLE;
  delete env.__PYVENV_LAUNCHER__;
  return executable === undefined ? [] : [`PYTHONEXECUTABLE=${executable}`];
}

// Both Python processes start at the file-system root in isolated mode. Only the forked shell enters the workspace.
// D2's start check: `<python> -I -c "import pty"` exits 0.
export const ptyAvailable = (python) => {
  const pythonEnv = { ...process.env };
  takeLauncherEnv(pythonEnv);
  try {
    const result = spawnSync(python, ['-I', '-c', 'import pty'], { cwd: PYTHON_CWD, env: pythonEnv, stdio: 'ignore' });
    return !result.error && result.status === 0;
  } catch {
    return false;
  }
};

// The server's one shell. `stream(res)` starts it when none runs, replays the output this shell has made (the last
// 256 KiB) and sends what comes; when the shell exits every stream ends, and the next `stream` starts a new one, whose
// replay holds none of the old shell's output. `input` returns false when no shell runs; a
// size given then is used at the next start. `stopShell` sends SIGHUP to the helper's process group, `killShell`
// SIGKILL; either closes the terminal, which hangs the shell up. The environment is `env` without names that start with
// CLAUDE, with TERM=xterm-256color.
export function shellTerminal(cwd, { shell, python = 'python3', env = process.env }) {
  let child = null;
  let kept = Buffer.alloc(0);
  let size = null;
  const streams = new Set();
  const endStreams = () => {
    for (const res of streams) res.end();
    streams.clear();
  };
  const startShell = () => {
    kept = Buffer.alloc(0); // the kept output is this shell's
    const workspace = resolve(cwd);
    const pythonEnv = { ...Object.fromEntries(Object.entries(env).filter(([k]) => !k.startsWith('CLAUDE'))), TERM: 'xterm-256color' };
    const launcherArgs = takeLauncherEnv(pythonEnv);
    let c;
    try {
      c = spawn(python, ['-I', '-c', HELPER, workspace, ...launcherArgs, '--', ...shell], { cwd: PYTHON_CWD, env: pythonEnv, stdio: ['pipe', 'pipe', 'ignore', 'pipe'], detached: true });
    } catch {
      endStreams();
      return;
    }
    child = c;
    c.on('error', () => {}); // a spawn failure: 'close' follows
    c.stdin.on('error', () => {});
    c.stdio[3].on('error', () => {});
    c.stdout.on('data', (d) => {
      kept = Buffer.concat([kept, d]);
      if (kept.length > KEPT_MAX) { const tail = kept.subarray(-KEPT_MAX); kept = tail.subarray(tail.indexOf(10) + 1); } // after a newline
      for (const res of streams) {
        res.write(d);
        if (res.writableLength > UNSENT_MAX) { streams.delete(res); res.destroy(); } // cut, not ended: the page opens it again and gets the replay
      }
    });
    // 'close', not 'exit': the last output has been read.
    c.on('close', () => {
      if (child === c) child = null;
      endStreams();
    });
    c.stdio[3].write(size ?? '24 80\n'); // a shell no page has sized yet starts at 24 by 80, not 0 by 0
  };
  const group = (sig) => { if (child?.pid) try { process.kill(-child.pid, sig); } catch { /* gone */ } };
  return {
    stream(res) {
      res.writeHead(200, { 'Content-Type': 'application/octet-stream', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
      res.flushHeaders();
      streams.add(res);
      res.on('close', () => streams.delete(res));
      if (!child) startShell();
      if (kept.length) res.write(kept);
    },
    // ponytail: no back-pressure; a shell that stops reading grows the helper's queue without bound. Bound it if it matters.
    input(text) {
      if (!child) return false;
      child.stdin.write(text);
      return true;
    },
    resize(rows, cols) { size = `${rows} ${cols}\n`; child?.stdio[3].write(size); },
    stopShell: () => group('SIGHUP'),
    killShell: () => group('SIGKILL'),
  };
}
