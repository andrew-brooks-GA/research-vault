import { test } from 'node:test';
import assert from 'node:assert/strict';
import childProcess, { spawnSync } from 'node:child_process';
import { syncBuiltinESMExports } from 'node:module';
import { dirname, parse } from 'node:path';
import { fileURLToPath } from 'node:url';
import { HELPER, ptyAvailable, shellTerminal } from '../bin/lib/terminal.mjs';
import { testEnv } from './helpers.mjs';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const PYTHON_CWD = parse(ROOT).root;
const skip = spawnSync('python3', ['-I', '-c', 'import pty'], { cwd: PYTHON_CWD, env: testEnv(), timeout: 10000 }).status !== 0 && 'needs python3 with its pty module';

test('both Python launches use the file-system root and isolated arguments', (t) => {
  const calls = [];
  const probe = t.mock.method(childProcess, 'spawnSync', (...args) => { calls.push(args); return { status: 0 }; });
  const launch = t.mock.method(childProcess, 'spawn', (...args) => { calls.push(args); throw new Error('recorded launch'); });
  syncBuiltinESMExports();
  try {
    assert.equal(ptyAvailable('chosen-python'), true);
    const terminal = shellTerminal(ROOT, { python: 'chosen-python', shell: ['/bin/sh', '-i'], env: testEnv({ PYTHONEXECUTABLE: '/chosen/python' }) });
    terminal.stream({ writeHead() {}, flushHeaders() {}, on() {}, end() {} });
    assert.equal(calls.length, 2);
    assert.deepEqual(calls.map(([python, , options]) => [python, options.cwd]), [['chosen-python', PYTHON_CWD], ['chosen-python', PYTHON_CWD]]);
    assert.deepEqual(calls[0][1], ['-I', '-c', 'import pty']);
    assert.deepEqual(calls[1][1], ['-I', '-c', HELPER, ROOT, 'PYTHONEXECUTABLE=/chosen/python', '--', '/bin/sh', '-i']);
  } finally {
    probe.mock.restore(); launch.mock.restore(); syncBuiltinESMExports();
  }
});

test('Python helper forks before closing fd 3 and changing directory, then execs only after a successful chdir', { skip }, () => {
  // Run the imported helper with OS calls recorded: no real fork, terminal or shell is needed.
  const script = `import sys, json, os, pty
from unittest.mock import patch
source = sys.stdin.read()
for fail in [False, True]:
    events = []
    def fork():
        events.append(['fork'])
        return (0, 9)
    def close(fd): events.append(['close', fd])
    def chdir(path):
        events.append(['chdir', path])
        if fail: raise OSError('refused')
    def run(file, args):
        events.append(['exec', file, args])
        raise SystemExit()
    def stop(code):
        events.append(['exit', code])
        raise SystemExit()
    with patch.object(pty, 'fork', fork), patch.object(os, 'close', close), patch.object(os, 'chdir', chdir), patch.object(os, 'execvp', run), patch.object(os, '_exit', stop), patch.object(sys, 'argv', ['helper', '/workspace', '--', '/bin/sh', '-i']):
        try: exec(source)
        except SystemExit: pass
    print(json.dumps(events))
`;
  const result = spawnSync('python3', ['-I', '-c', script], { env: testEnv(), input: HELPER, encoding: 'utf8', timeout: 10000 });
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(result.stdout.trim().split('\n').map((line) => JSON.parse(line)), [
    [['fork'], ['close', 3], ['chdir', '/workspace'], ['exec', '/bin/sh', ['/bin/sh', '-i']]],
    [['fork'], ['close', 3], ['chdir', '/workspace'], ['exit', 1]],
  ]);
});
