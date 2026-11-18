// Plan 2026-11-18 browser terminal D2: one shell for `teach serve --terminal`, in a pseudo-terminal. Node has no pty of
// its own, so a python3 helper (`pty.fork`) holds it: standard input goes to the terminal, the terminal's output to
// standard output, and lines of `<rows> <cols>` on fd 3 set the window size.
import { spawn, spawnSync } from 'node:child_process';

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
    os.execvp(sys.argv[1], sys.argv[1:])
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

// D2's start check: `<python> -c "import pty"` exits 0.
export const ptyAvailable = (python) => spawnSync(python, ['-c', 'import pty'], { stdio: 'ignore' }).status === 0;

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
  const startShell = () => {
    kept = Buffer.alloc(0); // the kept output is this shell's
    const shellEnv = { ...Object.fromEntries(Object.entries(env).filter(([k]) => !k.startsWith('CLAUDE'))), TERM: 'xterm-256color' };
    const c = spawn(python, ['-c', HELPER, ...shell], { cwd, env: shellEnv, stdio: ['pipe', 'pipe', 'ignore', 'pipe'], detached: true });
    child = c;
    c.on('error', () => {}); // a spawn failure: 'close' follows
    c.stdin.on('error', () => {});
    c.stdio[3].on('error', () => {});
    c.stdout.on('data', (d) => {
      kept = Buffer.concat([kept, d]);
      if (kept.length > KEPT_MAX) { const tail = kept.subarray(-KEPT_MAX); kept = tail.subarray(tail.indexOf(10) + 1); } // after a newline
      for (const res of streams) {
        res.write(d);
        if (res.writableLength > UNSENT_MAX) { streams.delete(res); res.end(); } // the page opens it again and gets the replay
      }
    });
    // 'close', not 'exit': the last output has been read.
    c.on('close', () => {
      if (child === c) child = null;
      for (const res of streams) res.end();
      streams.clear();
    });
    if (size) c.stdio[3].write(size);
  };
  const group = (sig) => { if (child?.pid) try { process.kill(-child.pid, sig); } catch { /* gone */ } };
  return {
    stream(res) {
      if (!child) startShell();
      res.writeHead(200, { 'Content-Type': 'application/octet-stream', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
      res.flushHeaders();
      if (kept.length) res.write(kept);
      streams.add(res);
      res.on('close', () => streams.delete(res));
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
