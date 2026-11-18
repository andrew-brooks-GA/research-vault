// Plan 2026-11-18 browser terminal, commit 1: `teach serve --terminal`, one shell in a pseudo-terminal (a python3 pty
// helper) on three routes, with the lab address, the lab cookie and the lab POST checks. Skipped without python3 and
// its pty module. Every shell a test starts is stopped, and every connection closed, before the file ends.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { cpSync, mkdtempSync, writeFileSync, realpathSync, rmSync } from 'node:fs';
import { spawn, spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { request } from 'node:http';
import { once } from 'node:events';
import { randomBytes } from 'node:crypto';
import { createServer } from '../bin/lib/teach.mjs';
import { HELPER, ptyAvailable } from '../bin/lib/terminal.mjs';
import { loadTeachSchema } from '../bin/lib/schema.mjs';
import { fixtureVault } from './helpers.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const BIN = join(ROOT, 'bin', 'research-vault.mjs');
const SCHEMA = loadTeachSchema(ROOT);
const SHELL = ['/bin/bash', '--noprofile', '--norc', '-i'];
const skip = spawnSync('python3', ['-c', 'import pty']).status !== 0 && 'needs python3 with its pty module';
const newT = () => randomBytes(32).toString('hex');
const made = [];
const tempDir = (prefix) => { const d = realpathSync(mkdtempSync(join(tmpdir(), prefix))); made.push(d); return d; };
const workspace = () => { const ws = tempDir('rv-term-'); writeFileSync(join(ws, 'MISSION.md'), '# Mission\n'); return ws; };
const servers = [];

async function start(ws, opts = {}) {
  const server = createServer(ws, { schema: SCHEMA, shell: SHELL, ...opts });
  servers.push(server);
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  return { server, port: server.address().port };
}

// node:http rather than fetch: fetch will not send a caller-chosen Host header.
function req(port, { method = 'GET', path = '/', headers = {}, body }) {
  return new Promise((resolve) => {
    const h = { Host: `127.0.0.1:${port}`, ...headers };
    for (const k of Object.keys(h)) if (h[k] === undefined) delete h[k];
    if (body !== undefined && !('Content-Length' in h)) h['Content-Length'] = Buffer.byteLength(body);
    const r = request({ host: '127.0.0.1', port, method, path, headers: h, setHost: false, agent: false }, (res) => {
      let text = '';
      res.setEncoding('utf8');
      res.on('data', (c) => { text += c; });
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, text }));
      res.on('error', () => resolve({ status: res.statusCode, headers: res.headers, text }));
    });
    r.on('error', (e) => resolve({ status: 0, error: e.code }));
    if (body !== undefined) r.write(body);
    r.end();
  });
}
const post = (port, route, body, { cookie, origin = `http://127.0.0.1:${port}`, headers = {} } = {}) => req(port, {
  method: 'POST', path: `/term/${route}`, body: typeof body === 'string' ? body : JSON.stringify(body),
  headers: { Origin: origin, 'Content-Type': 'application/json', Cookie: cookie, ...headers },
});
const openCookie = async (port, t) => (await req(port, { path: `/labs/open?t=${t}` })).headers['set-cookie']?.[0]?.split(';')[0];

// A streamed GET /term/stream: `s.text` grows as output comes; `s.ended` once the server ends it.
function openStream(port, cookie) {
  return new Promise((resolve) => {
    const s = { text: '', ended: false };
    const r = request({ host: '127.0.0.1', port, path: '/term/stream', headers: { Host: `127.0.0.1:${port}`, ...(cookie && { Cookie: cookie }) }, setHost: false, agent: false }, (res) => {
      Object.assign(s, { status: res.statusCode, headers: res.headers });
      res.setEncoding('utf8');
      res.on('data', (c) => { s.text += c; });
      res.on('end', () => { s.ended = true; });
      res.on('error', () => { s.ended = true; });
      resolve(s);
    });
    r.on('error', () => { s.ended = true; resolve(s); });
    s.close = () => r.destroy();
    r.end();
  });
}
async function until(cond, what, ms = 8000) {
  const t0 = Date.now();
  while (!cond()) {
    if (Date.now() - t0 > ms) throw new Error(`timed out waiting for ${what}`);
    await new Promise((r) => setTimeout(r, 20));
  }
}
const waitFor = (s, re) => until(() => re.test(s.text), `${re}\n--- stream tail:\n${JSON.stringify(s.text.slice(-600))}`);
const alive = (pid) => { try { process.kill(pid, 0); return true; } catch { return false; } };
const esc = (s) => s.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&');

after(() => {
  for (const s of servers.splice(0)) { s.killShell?.(); s.closeAllConnections(); s.close(); }
  for (const d of made.splice(0)) rmSync(d, { recursive: true, force: true });
});

test('without --terminal the three routes are 404, as at 15e6685', { skip }, async () => {
  for (const opts of [{}, { labs: true, t: newT(), env: {} }]) {
    const { port } = await start(workspace(), opts);
    const cookie = opts.t && await openCookie(port, opts.t);
    const got = [await req(port, { path: '/term/stream', headers: { Cookie: cookie } }),
      await post(port, 'input', { data: 'x' }, { cookie }), await post(port, 'resize', { rows: 2, cols: 2 }, { cookie })];
    assert.deepEqual(got.map((r) => [r.status, r.text]), Array(3).fill([404, 'not found\n']), JSON.stringify(opts));
  }
});

test('the framing headers: SAMEORIGIN and self with --terminal, with or without --labs; DENY and none with --labs alone', { skip }, async () => {
  const frame = (r) => [r.headers['x-frame-options'], r.headers['content-security-policy']];
  for (const [opts, want] of [[{ terminal: true }, ['SAMEORIGIN', "frame-ancestors 'self'"]], [{ terminal: true, labs: true }, ['SAMEORIGIN', "frame-ancestors 'self'"]],
    [{ labs: true }, ['DENY', "frame-ancestors 'none'"]]]) {
    const t = newT();
    const { port } = await start(workspace(), { ...opts, t, env: {} });
    for (const r of [await req(port, { path: '/' }), await req(port, { path: '/nope' }), await req(port, { path: '/', headers: { Host: 'localhost' } }),
      await req(port, { path: `/labs/open?t=${t}` }), await req(port, { path: '/term/stream' })]) {
      assert.deepEqual(frame(r), want, `${JSON.stringify(opts)} ${r.status}`);
    }
  }
});

test('--terminal alone makes the lab address work; next may be /term/lessons/<lesson id>.html only under --terminal', { skip }, async () => {
  const t = newT();
  const { port } = await start(workspace(), { terminal: true, t });
  const r = await req(port, { path: `/labs/open?t=${t}&next=/term/lessons/0001-intro.html` });
  assert.equal(r.status, 303);
  assert.equal(r.headers.location, '/term/lessons/0001-intro.html');
  assert.match(r.headers['set-cookie'][0], new RegExp(`^rv-labs-${port}=[0-9a-f]{64}; HttpOnly; SameSite=Strict; Path=/$`));
  assert.equal((await req(port, { path: `/labs/open?t=${t}&next=/lessons/0001-intro.html` })).headers.location, '/lessons/0001-intro.html');
  for (const next of ['/term/lessons/x.html', '/term/lessons/../MISSION.md', '/term/stream', '/term/lessons/0001-intro.html?x']) {
    assert.equal((await req(port, { path: `/labs/open?t=${t}&next=${encodeURIComponent(next)}` })).headers.location, '/', next);
  }
  assert.equal((await req(port, { path: `/labs/open?t=${newT()}` })).status, 403, 'a wrong t');
  const labsOnly = await start(workspace(), { labs: true, t, env: {} });
  assert.equal((await req(labsOnly.port, { path: `/labs/open?t=${t}&next=/term/lessons/0001-intro.html` })).headers.location, '/', '--labs alone');
  assert.throws(() => createServer(workspace(), { schema: SCHEMA, terminal: true }), /64 hex/);
});

// One server and one shell for the tests below, in order. `type` sends one input and expects 200 ok.
let port, cookie, ws, first;
const type = async (data) => {
  const r = await post(port, 'input', { data }, { cookie });
  assert.deepEqual([r.status, r.text], [200, 'ok\n'], data);
};
before(async () => {
  if (skip) return;
  const t = newT();
  ws = workspace();
  ({ port } = await start(ws, { terminal: true, t, env: { ...process.env, CLAUDE_TERM_TEST: 'agent' } }));
  cookie = await openCookie(port, t);
});

test('each route without the cookie is 403, and starts nothing', { skip }, async () => {
  const no = 'no terminal cookie; open the address teach serve printed\n';
  for (const c of [undefined, `rv-labs-${port}=${newT()}`]) {
    const s = await openStream(port, c);
    await until(() => s.ended, 'the 403 to end');
    assert.deepEqual([s.status, s.text], [403, no], `stream ${c}`);
    for (const [route, body] of [['input', { data: 'echo x\n' }], ['resize', { rows: 40, cols: 120 }]]) {
      const r = await post(port, route, body, { cookie: c });
      assert.deepEqual([r.status, r.text], [403, no], `${route} ${c}`);
    }
  }
  const r = await post(port, 'input', { data: 'echo x\n' }, { cookie });
  assert.deepEqual([r.status, r.text], [409, 'terminal not running\n'], 'no shell runs before the first stream');
});

test('a wrong Origin, a wrong Content-Type or a body over 65536 bytes is 403 before the body is read', { skip }, async () => {
  first = await openStream(port, cookie);
  assert.deepEqual([first.status, first.headers['content-type'], first.headers['cache-control']], [200, 'application/octet-stream', 'no-store']);
  const typed = { data: 'echo "refused""-input"\n' };
  for (const [label, opts] of [['another port as Origin', { origin: `http://127.0.0.1:${port + 1}` }], ['no Origin', { headers: { Origin: undefined } }],
    ['text/plain', { headers: { 'Content-Type': 'text/plain' } }], ['Content-Length 65537', { headers: { 'Content-Length': 65537 } }]]) {
    for (const route of ['input', 'resize']) {
      const r = await post(port, route, route === 'input' ? typed : { rows: 3, cols: 3 }, { cookie, ...opts });
      assert.deepEqual([r.status, r.text], [403, 'forbidden\n'], `${route} ${label}`);
    }
  }
  const big = await post(port, 'input', { data: 'x'.repeat(65537) }, { cookie });
  assert.equal(big.status, 403, 'a body over 65536 bytes');
  await type('echo "done""-checks"\n');
  await waitFor(first, /\ndone-checks/);
  assert.ok(!first.text.includes('refused-input'), 'no refused body reached the shell');
});

test('pwd, typed through /term/input, comes back on the stream as the workspace root; the shell gets TERM and no CLAUDE names', { skip }, async () => {
  const r = await post(port, 'input', { data: 'pwd\n' }, { cookie });
  assert.deepEqual([r.status, r.text], [200, 'ok\n']);
  await waitFor(first, new RegExp(`\\n${esc(ws)}\\r?\\n`));
  await type('echo "term=$TERM claude=${CLAUDE_TERM_TEST-unset}"\n');
  await waitFor(first, /\nterm=xterm-256color claude=unset\r?\n/);
  for (const body of ['{"data": 1}', '{"data": null}', '{}', '{"data": "x", "y": 1}', '[]', 'null', 'nope']) {
    const b = await post(port, 'input', body, { cookie });
    assert.deepEqual([b.status, b.text], [400, 'body must be {"data": "<text>"}\n'], body);
  }
});

test('after a resize to 40 by 120, stty size prints 40 120; any other resize body is 400', { skip }, async () => {
  const r = await post(port, 'resize', { rows: 40, cols: 120 }, { cookie });
  assert.deepEqual([r.status, r.text], [200, 'ok\n']);
  await type('stty size\n');
  await waitFor(first, /\n40 120\r?\n/);
  for (const body of [{ rows: 0, cols: 80 }, { rows: 501, cols: 80 }, { rows: 24, cols: 0 }, { rows: 24, cols: 1001 }, { rows: 24.5, cols: 80 },
    { rows: '24', cols: 80 }, { rows: 24 }, { rows: 24, cols: 80, x: 1 }, null]) {
    const b = await post(port, 'resize', body, { cookie });
    assert.deepEqual([b.status, b.text], [400, 'body must be {"rows": <1 to 500>, "cols": <1 to 1000>}\n'], JSON.stringify(body));
  }
  assert.equal((await post(port, 'resize', { rows: 500, cols: 1000 }, { cookie })).status, 200, 'the upper bounds');
});

test('a second stream starts with the kept output, and both get what comes next', { skip }, async () => {
  const second = await openStream(port, cookie);
  await waitFor(second, /\ndone-checks/);
  assert.match(second.text, new RegExp(`\\n${esc(ws)}\\r?\\n`));
  await type('echo "both""-streams"\n');
  await waitFor(first, /\nboth-streams/);
  await waitFor(second, /\nboth-streams/);
  second.close();
});

test('stopShell stops a background job of the shell, the streams end, and the next stream starts a new shell, whose replay holds none of the old output', { skip }, async (t) => {
  await type('sleep 300 &\necho "bg""-pid" $!\n');
  await waitFor(first, /\nbg-pid (\d+)/);
  const bg = Number(/\nbg-pid (\d+)/.exec(first.text)[1]);
  t.after(() => { try { process.kill(bg, 'SIGKILL'); } catch { /* gone */ } });
  assert.ok(alive(bg));
  servers.find((s) => s.address()?.port === port).stopShell();
  await until(() => !alive(bg), 'the background job to stop');
  await until(() => first.ended, 'the stream to end');
  const r = await post(port, 'input', { data: 'echo x\n' }, { cookie });
  assert.deepEqual([r.status, r.text], [409, 'terminal not running\n']);
  const again = await openStream(port, cookie);
  await type('echo "new""-shell"\n');
  await waitFor(again, /\nnew-shell/);
  assert.doesNotMatch(again.text, /bg-pid|both-streams|done-checks/, 'the old shell\'s output is not replayed');
});

test('a shell that exits while a background job holds the terminal open still ends the streams; input is then 409', { skip }, async (t) => {
  const s = await openStream(port, cookie);
  await type('sleep 30 &\necho "job""-pid" $!\n');
  await waitFor(s, /\njob-pid (\d+)/);
  const job = Number(/\njob-pid (\d+)/.exec(s.text)[1]);
  t.after(() => { try { process.kill(job, 'SIGKILL'); } catch { /* gone */ } });
  await type('exit\n');
  await until(() => s.ended, 'the stream to end', 5000);
  const r = await post(port, 'input', { data: 'echo x\n' }, { cookie });
  assert.deepEqual([r.status, r.text], [409, 'terminal not running\n']);
});

test('past 256 KiB of output, a new stream replays at most 262144 bytes, starting right after a newline', { skip }, async () => {
  const t = newT();
  const { port } = await start(workspace(), { terminal: true, t });
  const cookie = await openCookie(port, t);
  const s = await openStream(port, cookie);
  const r = await post(port, 'input', { data: 'seq 1 60000; echo "seq""-done"\n' }, { cookie });
  assert.equal(r.status, 200);
  await waitFor(s, /\nseq-done/);
  assert.ok(Buffer.byteLength(s.text) > 262144, 'the shell printed more than 256 KiB');
  const replay = await openStream(port, cookie);
  await waitFor(replay, /\nseq-done\r\n.*\$ $/);
  assert.ok(Buffer.byteLength(replay.text) <= 262144, String(Buffer.byteLength(replay.text)));
  const [one, two] = replay.text.split('\n');
  assert.match(one, /^\d+\r$/, 'the replay starts with a whole line');
  assert.equal(Number(two.trim()), Number(one.trim()) + 1);
  assert.ok(s.text.includes(`\n${one}\n${two}\n`), 'the replay\'s first line is a line of the output');
});

test('with --labs and --terminal, one GET /labs/open sets one cookie that both a lab POST and GET /term/stream accept', { skip }, async () => {
  const t = newT();
  const { port } = await start(workspace(), { labs: true, terminal: true, t });
  const open = await req(port, { path: `/labs/open?t=${t}` });
  assert.equal(open.headers['set-cookie'].length, 1);
  const cookie = open.headers['set-cookie'][0].split(';')[0];
  const lab = await req(port, { method: 'POST', path: '/lab/run', body: JSON.stringify({ lab: 'demo' }),
    headers: { Origin: `http://127.0.0.1:${port}`, 'Content-Type': 'application/json', Cookie: cookie } });
  assert.deepEqual([lab.status, lab.text], [404, 'no lab\n'], 'the runner answers: past the cookie check');
  const s = await openStream(port, cookie);
  assert.equal(s.status, 200);
  const r = await post(port, 'input', { data: 'echo "one""-cookie"\n' }, { cookie });
  assert.equal(r.status, 200);
  await waitFor(s, /\none-cookie/);
});

test("closing the helper's standard input ends the shell", { skip }, async () => {
  const child = spawn('python3', ['-c', HELPER, ...SHELL], { cwd: tempDir('rv-term-helper-'), stdio: ['pipe', 'pipe', 'ignore', 'pipe'], detached: true });
  let text = '';
  child.stdout.setEncoding('utf8');
  child.stdout.on('data', (c) => { text += c; });
  const closed = once(child, 'close');
  try {
    child.stdin.write('echo "shell""-pid $$"\n');
    await until(() => /\nshell-pid \d+/.test(text), `the shell pid\n${text}`);
    const pid = Number(/\nshell-pid (\d+)/.exec(text)[1]);
    child.stdin.end();
    await Promise.race([closed, new Promise((_, no) => setTimeout(() => no(new Error('the helper did not exit')), 8000).unref())]);
    assert.equal(alive(pid), false, 'the shell has ended');
  } finally { try { process.kill(-child.pid, 'SIGKILL'); } catch { /* gone */ } }
});

test('ptyAvailable is false for a missing program; teach serve --terminal without python3 prints the refusal and exits 2', { skip }, () => {
  assert.equal(ptyAvailable('rv-no-such-program'), false);
  assert.equal(ptyAvailable('python3'), true);
  const ws = tempDir('rv-term-cli-');
  cpSync(join(ROOT, 'test', 'fixtures', 'teach'), ws, { recursive: true });
  const r = spawnSync(process.execPath, [BIN, 'teach', 'serve', '--terminal', ws],
    { env: { ...process.env, PATH: tempDir('rv-term-path-'), RESEARCH_VAULT_PATH: fixtureVault() }, encoding: 'utf8', timeout: 10000 });
  assert.deepEqual([r.status, r.stdout, r.stderr], [2, '', 'teach serve: --terminal needs python3 with its pty module\n']);
});

test('teach serve --terminal prints the terminal: open line; with --labs too, only the labs: open line', { skip }, async () => {
  for (const [flags, word] of [[['--terminal'], 'terminal'], [['--labs', '--terminal'], 'labs']]) {
    const ws = tempDir('rv-term-cli-');
    cpSync(join(ROOT, 'test', 'fixtures', 'teach'), ws, { recursive: true });
    const child = spawn(process.execPath, [BIN, 'teach', 'serve', ...flags, ws], { env: { ...process.env, RESEARCH_VAULT_PATH: fixtureVault() }, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (c) => { stdout += c; });
    try {
      await until(() => stdout.split('\n').length > 2, `two lines from serve ${flags}`);
      const m = new RegExp(`^serving .+ at http://127\\.0\\.0\\.1:(\\d+)/\\n${word}: open http://127\\.0\\.0\\.1:\\1/labs/open\\?t=([0-9a-f]{64})\\n$`).exec(stdout);
      assert.ok(m, stdout);
      assert.equal((await req(Number(m[1]), { path: `/labs/open?t=${m[2]}` })).status, 303);
    } finally {
      child.kill('SIGTERM');
      await once(child, 'exit');
    }
  }
});
