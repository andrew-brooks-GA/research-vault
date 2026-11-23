import { spawn } from 'node:child_process';
import { rmSync } from 'node:fs';
import { testEnv, testHome } from '../test/helpers.mjs';

// A test or a test file may run 10 minutes; this script bounds the whole run to 20 on
// Node 24 and later, including files with open handles or synchronous loops.
let runTimeout = 1200000;
const input = process.argv.slice(2);
const args = [];
for (let i = 0; i < input.length; i++) {
  const arg = input[i];
  if (arg !== '--run-timeout' && !arg.startsWith('--run-timeout=')) {
    args.push(arg);
    continue;
  }
  runTimeout = Number(arg === '--run-timeout' ? input[++i] : arg.slice('--run-timeout='.length));
  if (!Number.isSafeInteger(runTimeout) || runTimeout < 1 || runTimeout > 2147483647) {
    throw new Error('--run-timeout must be milliseconds from 1 to 2147483647');
  }
}
const timeout = args.some((arg) => arg === '--test-timeout' || arg.startsWith('--test-timeout='))
  ? [] : ['--test-timeout=600000'];
const colours = {};
for (const name of ['TERM', 'COLORTERM', 'FORCE_COLOR', 'NO_COLOR']) {
  if (process.env[name] !== undefined) colours[name] = process.env[name];
}
const windows = process.platform === 'win32';
const child = spawn(process.execPath, ['--test', ...timeout, ...args], {
  stdio: 'inherit', env: testEnv(colours), detached: !windows,
});
let ended = false;
let status;
let signal;
let stopping = false;
let grace;
let timedOut = false;
const handlers = new Map();
function send(sig) {
  if (!child.pid) return false;
  try {
    // Windows has no POSIX process groups: only the child itself is ended.
    if (windows) return sig === 0 ? !ended : child.kill(sig);
    process.kill(-child.pid, sig);
    return true;
  } catch (error) {
    if (error.code !== 'ESRCH') throw error;
    return false;
  }
}
function finish() {
  clearTimeout(deadline);
  rmSync(testHome, { recursive: true, force: true });
  for (const [sig, handler] of handlers) process.removeListener(sig, handler);
  if (signal) process.kill(process.pid, signal);
  else process.exitCode = timedOut ? 1 : status;
}
function stop(sig) {
  if (stopping) return;
  stopping = true;
  send(sig);
  const until = Date.now() + 1000;
  grace = setInterval(() => {
    if (send(0) && Date.now() < until) return;
    send('SIGKILL');
    clearInterval(grace);
    grace = undefined;
    if (ended) finish();
  }, 25);
}
const deadline = setTimeout(() => {
  timedOut = true;
  console.error('Test run did not end within ' + runTimeout + 'ms: a test or a test file did not end.');
  stop('SIGTERM');
}, runTimeout);
for (const sig of ['SIGINT', 'SIGTERM', 'SIGHUP']) {
  const handler = () => { signal = sig; stop(sig); };
  handlers.set(sig, handler);
  process.on(sig, handler);
}
child.on('error', (error) => {
  console.error(error);
  status = 1;
});
child.on('exit', (code, sig) => {
  ended = true;
  status ??= code;
  if (!timedOut) signal ??= sig;
  if (!grace) finish();
});
child.on('close', () => {
  // A failed spawn emits error and close, but no exit.
  if (!ended) { ended = true; finish(); }
});
