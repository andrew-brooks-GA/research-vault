// Plan 2026-11-18 browser terminal, commit 1: `teach serve --terminal`, one shell in a pseudo-terminal (a python3 pty
// helper) on three routes, with the lab address, the lab cookie and the lab POST checks. Skipped without python3 and
// its pty module. Every shell a test starts is stopped, and every connection closed, before the file ends.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { cpSync, mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync, realpathSync, rmSync } from 'node:fs';
import { spawn, spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { request } from 'node:http';
import { once } from 'node:events';
import { randomBytes, createHash } from 'node:crypto';
import { createServer } from '../bin/lib/teach.mjs';
import { HELPER, ptyAvailable } from '../bin/lib/terminal.mjs';
import { inputQueue, runText } from '../skills/research-teach/terminal/terminal.mjs';
import { loadTeachSchema } from '../bin/lib/schema.mjs';
import { fixtureVault, testEnv } from './helpers.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const BIN = join(ROOT, 'bin', 'research-vault.mjs');
const SCHEMA = loadTeachSchema(ROOT);
const SHELL = ['/bin/bash', '--noprofile', '--norc', '-i'];
const TERM_DIR = join(ROOT, 'skills', 'research-teach', 'terminal');
const skip = spawnSync('python3', ['-c', 'import pty'], { env: testEnv() }).status !== 0 && 'needs python3 with its pty module';
const newT = () => randomBytes(32).toString('hex');
const made = [];
const tempDir = (prefix) => { const d = realpathSync(mkdtempSync(join(tmpdir(), prefix))); made.push(d); return d; };
const workspace = () => { const ws = tempDir('rv-term-'); writeFileSync(join(ws, 'MISSION.md'), '# Mission\n'); return ws; };
const servers = [];

async function start(ws, opts = {}) {
  const server = createServer(ws, { schema: SCHEMA, shell: SHELL, env: testEnv(), ...opts });
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
  ({ port } = await start(ws, { terminal: true, t, env: testEnv({ CLAUDE_TERM_TEST: 'agent' }) }));
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

test('a shell no page has sized starts at 24 by 80', { skip }, async () => {
  const t = newT();
  const { port } = await start(workspace(), { terminal: true, t });
  const cookie = await openCookie(port, t);
  const s = await openStream(port, cookie);
  assert.equal((await post(port, 'input', { data: 'stty size\n' }, { cookie })).status, 200);
  await waitFor(s, /\n24 80\r?\n/);
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

test('a stream that is not read is cut once its unsent output passes 4 MiB: it aborts, with no clean end', { skip }, async () => {
  const t = newT();
  const { port } = await start(workspace(), { terminal: true, t });
  const cookie = await openCookie(port, t);
  const watch = await openStream(port, cookie);
  const events = [];
  const stalled = await new Promise((resolve) => {
    const r = request({ host: '127.0.0.1', port, path: '/term/stream', headers: { Host: `127.0.0.1:${port}`, Cookie: cookie }, setHost: false, agent: false }, (res) => {
      res.pause(); // read nothing until the shell is done
      for (const e of ['end', 'aborted', 'error', 'close']) res.on(e, () => events.push(e));
      resolve(res);
    });
    r.on('error', () => events.push('request error'));
    r.end();
  });
  // About 21 MiB, past the 4 MiB the server keeps unsent plus what the kernel's socket buffers hold.
  assert.equal((await post(port, 'input', { data: 'yes 0123456789012345678901234567890123456789012345678901234567890123456789 | head -n 300000; echo "big""-done"\n' }, { cookie })).status, 200);
  await until(() => watch.text.includes('\nbig-done'), 'the shell to print 21 MiB', 30000);
  stalled.resume();
  await until(() => events.some((e) => e !== 'end'), 'the stalled stream to be cut');
  assert.ok(!events.includes('end') && !stalled.complete, events.join(' '));
  assert.ok(!watch.ended, 'a stream that is read is not cut');
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
  const child = spawn('python3', ['-c', HELPER, ...SHELL], { env: testEnv(), cwd: tempDir('rv-term-helper-'), stdio: ['pipe', 'pipe', 'ignore', 'pipe'], detached: true });
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
    { env: testEnv({ PATH: tempDir('rv-term-path-'), RESEARCH_VAULT_PATH: fixtureVault() }), encoding: 'utf8', timeout: 10000 });
  assert.deepEqual([r.status, r.stdout, r.stderr], [2, '', 'teach serve: --terminal needs python3 with its pty module\n']);
});

test('teach serve --terminal prints the terminal: open line; with --labs too, only the labs: open line', { skip }, async () => {
  for (const [flags, word] of [[['--terminal'], 'terminal'], [['--labs', '--terminal'], 'labs']]) {
    const ws = tempDir('rv-term-cli-');
    cpSync(join(ROOT, 'test', 'fixtures', 'teach'), ws, { recursive: true });
    const child = spawn(process.execPath, [BIN, 'teach', 'serve', ...flags, ws], { env: testEnv({ RESEARCH_VAULT_PATH: fixtureVault() }), stdio: ['ignore', 'pipe', 'pipe'] });
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


// Commit 2: the terminal page (D4 to D6). These start no shell, so they run without python3.
test('the vendored xterm.js files and their licences are the npm files, pinned by SHA-256', () => {
  for (const [f, sha] of [['xterm.mjs', 'b336ec65a086c056d4804b3d4c2347da5663d3f23c3f25be866467bd8857ad59'],
    ['xterm.css', '854a7c0fb70e8b1a083c16797ab827299fb18744f5ad34f227b48337e33293c6'], ['addon-fit.mjs', '2d87e1bddc73be9111de8beee5370c3bb7aac9c94e18e6f245f02ca741ef1769'],
    ['LICENSE-xterm', 'b569f629d00f2626a8100df2a1798210535621e42164dfd426a6fe5aac7b0ccd'], ['LICENSE-addon-fit', 'e256f01188af527e4d06d21d06fbf785ae9c50d4b328bf03cbe0ba7f0aa4228f']]) {
    assert.equal(createHash('sha256').update(readFileSync(join(TERM_DIR, f))).digest('hex'), sha, f);
  }
});

test('/terminal/<file> sends each file of the terminal folder with its type, with no cookie, under --terminal only; any other name is 404', async () => {
  const js = 'text/javascript; charset=utf-8', css = 'text/css; charset=utf-8', txt = 'text/plain; charset=utf-8';
  const types = { 'terminal.mjs': js, 'xterm.mjs': js, 'addon-fit.mjs': js, 'terminal.css': css, 'xterm.css': css, 'LICENSE-xterm': txt, 'LICENSE-addon-fit': txt };
  assert.deepEqual(readdirSync(TERM_DIR).sort(), Object.keys(types).sort(), 'the folder holds these files');
  const t = newT();
  const on = await start(workspace(), { terminal: true, t });
  const off = await start(workspace(), { labs: true, t, env: {} });
  for (const [f, type] of Object.entries(types)) {
    const r = await req(on.port, { path: `/terminal/${f}` });
    assert.deepEqual([r.status, r.headers['content-type'], r.text === readFileSync(join(TERM_DIR, f), 'utf8')], [200, type, true], f);
    assert.equal((await req(off.port, { path: `/terminal/${f}` })).status, 404, `${f} without --terminal`);
  }
  for (const p of ['/terminal/', '/terminal/nope.mjs', '/terminal/../terminal.mjs', '/terminal/%2e%2e/assets/quiz.js', '/terminal/xterm.mjs/x', '/terminal/../../bin/lib/teach.mjs']) {
    assert.equal((await req(on.port, { path: p })).status, 404, p);
  }
});

test('/term/lessons/<lesson id>.html: with the cookie, the page framing /lessons/<lesson id>.html beside the terminal; 403 without; 404 for no lesson file', async () => {
  const ws = join(tempDir('rv-term-page-'), 'my <ws> & "x"');
  mkdirSync(join(ws, 'lessons'), { recursive: true });
  writeFileSync(join(ws, 'lessons', '0001-intro.html'), '<!doctype html><title>Intro</title>\n');
  const t = newT();
  const { port } = await start(ws, { terminal: true, t });
  const cookie = await openCookie(port, t);
  const r = await req(port, { path: '/term/lessons/0001-intro.html', headers: { Cookie: cookie } });
  assert.deepEqual([r.status, r.headers['content-type']], [200, 'text/html; charset=utf-8']);
  assert.match(r.text, /<iframe [^>]*src="\/lessons\/0001-intro\.html"/);
  assert.ok(r.text.includes('>my &lt;ws&gt; &amp; &quot;x&quot;<'), 'the folder name, escaped');
  assert.ok(!r.text.includes(dirname(ws)), 'the folder name only, not its path');
  for (const tag of ['<link rel="stylesheet" href="/terminal/xterm.css">', '<link rel="stylesheet" href="/terminal/terminal.css">',
    '<script type="module" src="/terminal/terminal.mjs"></script>']) assert.ok(r.text.includes(tag), tag);
  for (const c of [undefined, `rv-labs-${port}=${newT()}`]) {
    const no = await req(port, { path: '/term/lessons/0001-intro.html', headers: { Cookie: c } });
    assert.deepEqual([no.status, no.text], [403, 'no terminal cookie; open the address teach serve printed\n'], String(c));
  }
  for (const p of ['/term/lessons/0002-none.html', '/term/lessons/x.html', '/term/lessons/0001-intro', '/term/lessons/../MISSION.md', '/term/lessons/0001-intro.html/x']) {
    assert.equal((await req(port, { path: p, headers: { Cookie: cookie } })).status, 404, p);
  }
  const labs = await start(ws, { labs: true, t, env: {} });
  const labsCookie = await openCookie(labs.port, t);
  assert.equal((await req(labs.port, { path: '/term/lessons/0001-intro.html', headers: { Cookie: labsCookie } })).status, 404, 'without --terminal');
});

test('the input queue sends one request at a time, joins what is typed while one is out, and splits text into bodies of at most 65536 bytes', async () => {
  const sent = [];
  let reply;
  const typeIn = inputQueue((data) => { sent.push(data); return new Promise((r) => { reply = r; }); });
  typeIn('l');
  typeIn('s');
  typeIn('\r');
  assert.deepEqual(sent, ['l']);
  reply();
  await until(() => sent.length === 2, 'the second request');
  assert.deepEqual(sent, ['l', 's\r']);
  reply();
  await new Promise((r) => setImmediate(r));
  assert.equal(sent.length, 2, 'nothing left to send');
  const after = [];
  let throws = true;
  const typeAfter = inputQueue((data) => { after.push(data); if (throws) { throws = false; throw new Error('no network'); } });
  typeAfter('a');
  typeAfter('b');
  await until(() => after.length === 2, 'the request after a send that threw');
  assert.deepEqual(after, ['a', 'b']);
  const parts = [];
  const big = 'x'.repeat(70000) + '\u001b'.repeat(20000) + '\u20ac'.repeat(30000) + '\u{1F600}'.repeat(10000) + '"\\';
  const typeBig = inputQueue(async (data) => { parts.push(data); });
  typeBig(big);
  await until(() => parts.join('').length === big.length, 'every part');
  assert.equal(parts.join(''), big);
  const size = (data) => Buffer.byteLength(JSON.stringify({ data }));
  for (const [i, p] of parts.entries()) {
    assert.ok(size(p) <= 65536 && p.isWellFormed(), `part ${i}: ${size(p)} bytes`);
    if (i < parts.length - 1) assert.ok(size(p + [...parts[i + 1]][0]) > 65536, `part ${i} is as long as fits`);
  }
});

test('Run sends the <pre> text lines joined by carriage returns, with one carriage return at the end', () => {
  assert.equal(runText('evidence/0001/setup.sh'), 'evidence/0001/setup.sh\r');
  assert.equal(runText('evidence/0001/setup.sh\n./check 1\n'), 'evidence/0001/setup.sh\r./check 1\r');
});
