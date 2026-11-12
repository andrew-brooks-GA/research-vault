// Spec 49 commit 1: the lab manifest, pins, lab address and every refusal of `teach serve --labs`; nothing runs.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, readFileSync, symlinkSync, rmSync, chmodSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { request } from 'node:http';
import { once } from 'node:events';
import { createHash, randomBytes } from 'node:crypto';
import { createServer, labStepsHtml, readmeDraft } from '../bin/lib/teach.mjs';
import { readLabs, labPin, lessonLab } from '../bin/lib/labs.mjs';
import { lintWorkspace } from '../bin/lib/lesson.mjs';
import { buildManifest } from '../bin/lib/manifest.mjs';
import { loadSchema, loadTeachSchema } from '../bin/lib/schema.mjs';
import { fixtureVault } from './helpers.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SCHEMA = loadTeachSchema(ROOT);
const sha = (b) => createHash('sha256').update(b).digest('hex');
const newT = () => randomBytes(32).toString('hex');

// A workspace with one lab, `demo`, whose up.sh would write up-ran; the lesson stores the pin, computed here
// as spec 49 D2 words it (SHA-256 of JSON.stringify([id, entry]), the entry's keys in D1's order).
function labWorkspace({ extra = {}, pin } = {}) {
  const ws = mkdtempSync(join(tmpdir(), 'rv-labs-'));
  writeFileSync(join(ws, 'MISSION.md'), '# Mission\n');
  mkdirSync(join(ws, 'lessons', 'files', '0001-lab'), { recursive: true });
  mkdirSync(join(ws, 'labs'));
  const script = (rel, body) => { writeFileSync(join(ws, rel), body, { mode: 0o755 }); return { script: rel, sha256: sha(body) }; };
  const up = script('lessons/files/0001-lab/up.sh', '#!/bin/sh\necho up > up-ran\n');
  const down = script('lessons/files/0001-lab/down.sh', '#!/bin/sh\nrm -f up-ran\n');
  const entry = { cost: 'About one second, no downloads', timeout: 60, ...extra, up, down };
  writeFileSync(join(ws, 'labs', 'labs.json'), JSON.stringify({ version: 1, labs: { demo: entry } }, null, 2) + '\n');
  writeLesson(ws, '0001-lab', 'demo', pin ?? sha(JSON.stringify(['demo', entry])));
  return { ws, entry, script };
}
function writeLesson(ws, id, lab, pin) {
  writeFileSync(join(ws, 'lessons', `${id}.html`), `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>Lab ${id}</title></head>
<body data-lesson="${id}">
<section data-block="lab" aria-label="lab" data-lab="${lab}"><data class="lab-pin" value="${pin}"></data><p>It writes one file.</p><pre>up</pre></section>
</body></html>
`);
}

async function start(ws, opts = {}) {
  const server = createServer(ws, { schema: SCHEMA, ...opts });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  return { server, port: server.address().port };
}

// node:http rather than fetch: fetch will not send a caller-chosen Host header.
function req(port, { method = 'GET', path = '/', headers = {}, body, chunked = false }) {
  return new Promise((resolve) => {
    const h = { Host: `127.0.0.1:${port}`, ...headers };
    for (const k of Object.keys(h)) if (h[k] === undefined) delete h[k];
    if (body !== undefined && !chunked && !('Content-Length' in h)) h['Content-Length'] = Buffer.byteLength(body);
    if (chunked) h['Transfer-Encoding'] = 'chunked';
    const r = request({ host: '127.0.0.1', port, method, path, headers: h, setHost: false }, (res) => {
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

// The cookie pair (`rv-labs-<port>=<value>`) the lab address sets, or undefined.
async function openLab(port, t) {
  const r = await req(port, { path: `/labs/open?t=${t}` });
  return { r, cookie: r.headers['set-cookie']?.[0]?.split(';')[0] };
}
const post = (port, action, body, { cookie, origin = `http://127.0.0.1:${port}`, headers = {} } = {}) => req(port, {
  method: 'POST', path: `/lab/${action}`, body: typeof body === 'string' ? body : JSON.stringify(body),
  headers: { Origin: origin, 'Content-Type': 'application/json', Cookie: cookie, ...headers },
});
const show = (label, r) => console.log(`${label} -> ${r.status} ${JSON.stringify(r.text)}`);

test('spec 49 test 3 (a): a lab id not in the manifest is 404 no lab, and nothing runs', async () => {
  const { ws } = labWorkspace();
  const t = newT();
  const { server, port } = await start(ws, { labs: true, t, env: {} });
  try {
    const { cookie } = await openLab(port, t);
    const r = await post(port, 'run', { lab: 'nope' }, { cookie });
    show('POST /lab/run {"lab":"nope"}', r);
    assert.equal(r.status, 404);
    assert.equal(r.text, 'no lab\n');
    assert.equal(existsSync(join(ws, 'up-ran')), false);
  } finally { server.close(); }
});

test('spec 49 test 3 (b): up.sh with one byte changed is 409 pin mismatch, and nothing runs', async () => {
  const { ws } = labWorkspace();
  writeFileSync(join(ws, 'lessons/files/0001-lab/up.sh'), '#!/bin/sh\necho Up > up-ran\n', { mode: 0o755 });
  const t = newT();
  const { server, port } = await start(ws, { labs: true, t, env: {} });
  try {
    const { cookie } = await openLab(port, t);
    const r = await post(port, 'run', { lab: 'demo' }, { cookie });
    show('POST /lab/run {"lab":"demo"} after one byte of up.sh changed', r);
    assert.equal(r.status, 409);
    assert.equal(r.text, 'pin mismatch: lessons/files/0001-lab/up.sh\n');
    assert.equal(existsSync(join(ws, 'up-ran')), false);
  } finally { server.close(); }
});

test('spec 49 test 3 (c): another port as Origin, with the lab cookie, is 403, and nothing runs', async () => {
  const { ws } = labWorkspace();
  const t = newT();
  const { server, port } = await start(ws, { labs: true, t, env: {} });
  try {
    const { cookie } = await openLab(port, t);
    const r = await post(port, 'run', { lab: 'demo' }, { cookie, origin: `http://127.0.0.1:${port + 1}` });
    show(`POST /lab/run Origin http://127.0.0.1:<port + 1> with cookie ${cookie ? 'set' : 'unset'}`, r);
    assert.ok(cookie, 'the lab address set a cookie');
    assert.equal(r.status, 403);
    assert.equal(r.text, 'forbidden\n');
    assert.equal(existsSync(join(ws, 'up-ran')), false);
  } finally { server.close(); }
});

test('the lab address: 303 with the exact cookie, reusable for the life of the server with one session value; a wrong t and next kept on the server', async () => {
  const { ws } = labWorkspace();
  const t = newT();
  const { server, port } = await start(ws, { labs: true, t, env: {} });
  try {
    const status = async (path) => (await req(port, { path })).status;
    assert.equal((await req(port, { method: 'HEAD', path: `/labs/open?t=${t}` })).status, 405, 'HEAD');
    for (const [label, q] of [['a wrong t', `t=${newT()}`], ['t twice', `t=${t}&t=${t}`], ['a short t', `t=${t.slice(0, 63)}`], ['an empty t', 't='],
      ['no t', ''], ['t upper-case', `t=${t.toUpperCase()}`], ['t[]', `t[]=${t}`]]) {
      const r = await req(port, { path: `/labs/open?${q}` });
      assert.deepEqual([r.status, r.headers['set-cookie']], [403, undefined], label);
    }
    const first = await req(port, { path: `/labs/open?t=${t}&next=/lessons/0001-lab.html` });
    console.log(`GET /labs/open?t=<t>&next=/lessons/0001-lab.html -> ${first.status} Location ${first.headers.location} Set-Cookie ${first.headers['set-cookie'][0].replace(/=[0-9a-f]{64}/, '=<64 hex>')}`);
    assert.equal(first.status, 303);
    assert.equal(first.headers.location, '/lessons/0001-lab.html');
    const [setCookie, ...more] = first.headers['set-cookie'];
    assert.equal(more.length, 0);
    const m = /^rv-labs-(\d+)=([0-9a-f]{64}); HttpOnly; SameSite=Strict; Path=\/$/.exec(setCookie);
    assert.ok(m, setCookie);
    assert.equal(Number(m[1]), port);
    assert.notEqual(m[2], t, 'the session value is not t');
    assert.equal(first.text, '');
    // A second open (a browser restart, a second browser) is 303 again with the same cookie, which passes check 4.
    const again = await req(port, { path: `/labs/open?t=${t}` });
    console.log(`GET /labs/open?t=<t> a second time -> ${again.status} same cookie: ${again.headers['set-cookie']?.[0] === setCookie}`);
    assert.deepEqual([again.status, again.headers.location, again.headers['set-cookie']], [303, '/', [setCookie]]);
    assert.equal((await post(port, 'run', { lab: 'demo' }, { cookie: `rv-labs-${port}=${m[2]}` })).status, 501);
    assert.equal((await post(port, 'run', { lab: 'demo' }, { cookie: `rv-labs-${port}=${t}` })).status, 403, 't as the cookie');
    for (const next of ['//evil.example/', 'https://evil.example/', '/lessons/../MISSION.md', '/lessons/0001-lab.html/x', '/lessons/x.html',
      '/lessons/0001-lab.html\r\nX: y', '/%2F%2Fevil.example', '/\\evil.example', '/lessons/0001-lab.html?x=1', '/lessons/0001-lab.html#x']) {
      const r = await req(port, { path: `/labs/open?t=${t}&next=${encodeURIComponent(next)}` });
      assert.deepEqual([r.status, r.headers.location], [303, '/'], next);
    }
    assert.equal(await status(`/labs/open?t=${t}`), 303, 't is still valid');
  } finally { server.close(); }
});

test('under --labs every response forbids framing; without --labs no response carries the two headers (spec 49 D4)', async () => {
  const { ws } = labWorkspace();
  const t = newT();
  const frame = (r) => [r.headers['x-frame-options'], r.headers['content-security-policy']];
  const probes = (port) => [req(port, { path: '/' }), req(port, { path: '/lessons/0001-lab.html' }), req(port, { path: '/nope' }),
    req(port, { path: '/', headers: { Host: 'localhost' } }), req(port, { path: `/labs/open?t=${t}` }), post(port, 'run', { lab: 'demo' })];
  for (const labs of [true, false]) {
    const { server, port } = await start(ws, labs ? { labs, t, env: {} } : {});
    try {
      for (const r of await Promise.all(probes(port))) {
        assert.deepEqual(frame(r), labs ? ['DENY', "frame-ancestors 'none'"] : [undefined, undefined], `${labs} ${r.status}`);
      }
    } finally { server.close(); }
  }
});

test('cookie, body and pin-reader edge cases (security review B8)', async () => {
  const { ws, entry } = labWorkspace();
  const t = newT();
  const { server, port } = await start(ws, { labs: true, t, env: {} });
  try {
    const { cookie } = await openLab(port, t);
    const session = cookie.split('=')[1];
    const name = `rv-labs-${port}`;
    for (const [c, status] of [[`${name}=${newT()}; ${name}=${session}`, 501], [`${name}="${session}"`, 403], [`x${name}=${session}`, 403],
      [`${name}x=${session}`, 403], [`${name}=${session}x`, 403], [`${name}=`, 403], [`${name}`, 403]]) {
      assert.equal((await post(port, 'run', { lab: 'demo' }, { cookie: c })).status, status, c);
    }
    for (const [body, status] of [['{"__proto__": {"lab": "demo"}}', 400], ['{"lab": "demo", "__proto__": {}}', 400], ['{"lab": "nope", "lab": "demo"}', 501], ['{"lab": "demo", "lab": "nope"}', 404]]) {
      assert.equal((await post(port, 'run', body, { cookie })).status, status, body);
    }
    // Check 9 reads lessons/<lesson id>.html regular files only.
    writeLesson(ws, '0001-lab', 'demo', 'a'.repeat(64));
    writeFileSync(join(ws, 'lessons', 'notes.html'), `<!-- <section data-block="lab" data-lab="demo"><data class="lab-pin" value="${sha(JSON.stringify(['demo', entry]))}"></data></section> -->\n`);
    const elsewhere = mkdtempSync(join(tmpdir(), 'rv-labs-lesson-'));
    mkdirSync(join(elsewhere, 'lessons'));
    writeLesson(elsewhere, '0002-real', 'demo', sha(JSON.stringify(['demo', entry])));
    symlinkSync(join(elsewhere, 'lessons', '0002-real.html'), join(ws, 'lessons', '0002-link.html'));
    assert.equal((await post(port, 'run', { lab: 'demo' }, { cookie })).text, "no lesson stores this lab's current pin\n");
  } finally { server.close(); }
  // The data-lab and lab-pin readers skip attribute values whole.
  const l = lessonLab(`<section data-block="lab" title=" data-lab='evil'" data-lab="x"><data title=" class='lab-pin' value='bad'" class="lab-pin" value="good"></data></section>`);
  assert.deepEqual([l.id, l.pin], ['x', 'good']);
});

test('without --labs every lab path is as before: POST 404 not found, /labs/open 404 with no cookie', async () => {
  const { ws } = labWorkspace();
  const { server, port } = await start(ws);
  try {
    for (const a of ['run', 'stop', 'reset', 'verify']) {
      const r = await post(port, a, { lab: 'demo' });
      assert.deepEqual([r.status, r.text], [404, 'not found\n'], a);
    }
    const o = await req(port, { path: `/labs/open?t=${newT()}` });
    console.log(`no --labs: GET /labs/open -> ${o.status} ${JSON.stringify(o.text)} Set-Cookie ${o.headers['set-cookie'] ?? 'none'}`);
    assert.deepEqual([o.status, o.text, o.headers['set-cookie']], [404, 'not found\n', undefined]);
    const page = await req(port, { path: '/lessons/0001-lab.html' });
    assert.ok(page.text.includes('<p>The author ran:</p>') && !page.text.includes('lab-open'));
  } finally { server.close(); }
  assert.throws(() => createServer(ws, { schema: SCHEMA, labs: true }), /64 hex/);
  assert.throws(() => createServer(ws, { schema: SCHEMA, labs: true, t: 'short' }), /64 hex/);
});

test('every refusal of checks 1 to 11 and 13, in order, with its status and body; nothing echoes the request', async () => {
  const { ws, script } = labWorkspace({ extra: { env: ['LAB_TOKEN'], checks: [] } });
  // A second lab with a verify and a check; a third lab no lesson stores the pin of.
  const check = script('labs/ready.sh', '#!/bin/sh\nexit 0\n');
  mkdirSync(join(ws, 'evidence', '0002'), { recursive: true });
  const verify = script('evidence/0002/check.sh', '#!/bin/sh\ntrue\n');
  const doc = JSON.parse(readFileSync(join(ws, 'labs', 'labs.json'), 'utf8'));
  doc.labs.full = { cost: 'Two seconds', timeout: 5, checks: [{ ...check, message: 'Not ready.' }], up: doc.labs.demo.up, down: doc.labs.demo.down, verify };
  doc.labs.orphan = { cost: 'None', timeout: 5, up: doc.labs.demo.up, down: doc.labs.demo.down };
  writeFileSync(join(ws, 'labs', 'labs.json'), JSON.stringify(doc));
  writeLesson(ws, '0002-full', 'full', sha(JSON.stringify(['full', doc.labs.full])));
  const env = { LAB_TOKEN: 'abc' };
  const logs = [];
  const t = newT();
  const { server, port } = await start(ws, { labs: true, t, env, log: (s) => logs.push(s) });
  try {
    const { cookie } = await openLab(port, t);
    const session = cookie.split('=')[1];
    const rows = [];
    const check1 = async (label, p, status, text) => {
      const r = await p;
      rows.push(`${label} -> ${r.status} ${JSON.stringify(r.text)}`);
      assert.deepEqual([r.status, r.text], [status, text], label);
      for (const s of [t, session, 'abc']) assert.ok(!r.text.includes(s), `${label} echoes nothing secret`);
    };
    const own = `http://127.0.0.1:${port}`;
    await check1('1 Host localhost', req(port, { method: 'POST', path: '/lab/run', body: '{"lab":"demo"}', headers: { Host: `localhost:${port}`, Origin: own, 'Content-Type': 'application/json', Cookie: cookie } }), 403, 'forbidden\n');
    await check1('2 POST /lab/start', req(port, { method: 'POST', path: '/lab/start', body: '{"lab":"demo"}', headers: { Origin: own, 'Content-Type': 'application/json', Cookie: cookie } }), 404, 'not found\n');
    await check1('2 POST /lab/run/', req(port, { method: 'POST', path: '/lab/run/', body: '{"lab":"demo"}', headers: { Origin: own, 'Content-Type': 'application/json', Cookie: cookie } }), 404, 'not found\n');
    await check1('3 no Origin', post(port, 'run', { lab: 'demo' }, { cookie, headers: { Origin: undefined } }), 403, 'forbidden\n');
    await check1('3 Origin null', post(port, 'run', { lab: 'demo' }, { cookie, origin: 'null' }), 403, 'forbidden\n');
    await check1('3 Content-Type text/plain', post(port, 'run', { lab: 'demo' }, { cookie, headers: { 'Content-Type': 'text/plain' } }), 403, 'forbidden\n');
    await check1('3 Content-Length 257', post(port, 'run', 'x'.repeat(257), { cookie }), 403, 'forbidden\n');
    await check1('3 chunked body over 256', req(port, { method: 'POST', path: '/lab/run', body: `{"lab":"${'a'.repeat(300)}"}`, chunked: true, headers: { Origin: own, 'Content-Type': 'application/json', Cookie: cookie } }), 403, 'forbidden\n');
    const noCookie = 'no lab cookie; open the lab address teach serve printed\n';
    await check1('4 no cookie', post(port, 'run', { lab: 'demo' }), 403, noCookie);
    await check1('4 t as the cookie', post(port, 'run', { lab: 'demo' }, { cookie: `rv-labs-${port}=${t}` }), 403, noCookie);
    await check1('4 a wrong cookie', post(port, 'run', { lab: 'demo' }, { cookie: `rv-labs-${port}=${newT()}` }), 403, noCookie);
    await check1('4 the session under another port\'s name', post(port, 'run', { lab: 'demo' }, { cookie: `rv-labs-${port + 1}=${session}` }), 403, noCookie);
    await check1('4 the session value with a byte added', post(port, 'run', { lab: 'demo' }, { cookie: `${cookie}0` }), 403, noCookie);
    await check1('4 before 5: no cookie and a bad body', post(port, 'run', 'not json'), 403, noCookie);
    const badBody = 'body must be {"lab": "<id>"}\n';
    for (const [label, body] of [['not JSON', '{"lab":'], ['an extra key', { lab: 'demo', x: 1 }], ['an array', ['demo']], ['an id that fails LAB_ID_RE', { lab: '../demo' }], ['an upper-case id', { lab: 'Demo' }], ['a number', { lab: 7 }], ['a lesson key', { lab: 'demo', lesson: '0001-lab' }]]) {
      await check1(`5 ${label}`, post(port, 'run', body, { cookie }), 400, badBody);
    }
    await check1('7 an id the manifest lacks', post(port, 'run', { lab: 'nope' }, { cookie }), 404, 'no lab\n');
    await check1('7 constructor', post(port, 'run', { lab: 'constructor' }, { cookie }), 404, 'no lab\n');
    await check1('8 verify on a lab with none', post(port, 'verify', { lab: 'demo' }, { cookie }), 404, 'no verify\n');
    await check1('9 no lesson stores the pin', post(port, 'run', { lab: 'orphan' }, { cookie }), 409, "no lesson stores this lab's current pin\n");
    await check1('11 env unset is named, not valued', post(port, 'reset', { lab: 'demo' }, { cookie }), 409, 'env LAB_TOKEN is unset, shorter than 8 characters or multi-line\n');
    env.LAB_TOKEN = 'abcdefg\nh';
    await check1('11 a multi-line value', post(port, 'run', { lab: 'demo' }, { cookie }), 409, 'env LAB_TOKEN is unset, shorter than 8 characters or multi-line\n');
    env.LAB_TOKEN = 'abcdefgh';
    await check1('13 stop with nothing running', post(port, 'stop', { lab: 'demo' }, { cookie }), 409, 'not running\n');
    for (const a of ['run', 'reset', 'verify']) await check1(`all checks pass: ${a}`, post(port, a, { lab: a === 'verify' ? 'full' : 'demo' }, { cookie }), 501, 'lab runs are not built yet\n');
    // 10: a check's script, then verify's, each hashed by the action that runs it.
    writeFileSync(join(ws, 'labs', 'ready.sh'), '#!/bin/sh\nexit 1\n', { mode: 0o755 });
    await check1('10 run hashes a check', post(port, 'run', { lab: 'full' }, { cookie }), 409, 'pin mismatch: labs/ready.sh\n');
    await check1('10 reset does not run the check', post(port, 'reset', { lab: 'full' }, { cookie }), 501, 'lab runs are not built yet\n');
    writeFileSync(join(ws, 'evidence', '0002', 'check.sh'), '#!/bin/sh\nexit 1\n', { mode: 0o755 });
    await check1('10 verify hashes verify', post(port, 'verify', { lab: 'full' }, { cookie }), 409, 'pin mismatch: evidence/0002/check.sh\n');
    await check1('10 stop hashes nothing', post(port, 'stop', { lab: 'full' }, { cookie }), 409, 'not running\n');
    writeFileSync(join(ws, 'labs', 'labs.json'), '{"version": 1, "labs": {"demo": {}}}');
    await check1('6 an invalid manifest', post(port, 'run', { lab: 'demo' }, { cookie }), 500, 'labs/labs.json is invalid; run teach lint\n');
    await check1('5 before 6: a bad body and an invalid manifest', post(port, 'run', { lab: 'demo', x: 1 }, { cookie }), 400, badBody);
    console.log(rows.join('\n'));
    console.log(logs.join('\n'));
    assert.ok(logs.length > 0 && logs.every((l) => /^lab [a-z][a-z0-9-]* (run|stop|reset|verify): \d{3} /.test(l)), 'one log line per request past check 5');
    for (const s of [t, session, 'abcdefgh']) assert.ok(!logs.join('\n').includes(s));
    assert.equal(existsSync(join(ws, 'up-ran')), false);
  } finally { server.close(); }
});

test('the lab section on a served lesson: the steps; under --labs the lab-open line without the cookie; never t or the session', async () => {
  const { ws, entry } = labWorkspace({ extra: { env: ['LAB_TOKEN'] } });
  const t = newT();
  const { server, port } = await start(ws, { labs: true, t, env: {} });
  try {
    const plain = await req(port, { path: '/lessons/0001-lab.html' });
    const steps = `<p class="lab-cost">${entry.cost}</p><p>The author ran:</p><pre>lessons/files/0001-lab/up.sh</pre><pre>lessons/files/0001-lab/down.sh</pre>`;
    const open = '<p class="lab-open">To run this lab from the page, open the lab address teach serve printed when it started.</p>';
    console.log(`plain address: ${/<section data-block="lab"[\s\S]*?<\/section>/.exec(plain.text)[0]}`);
    assert.ok(plain.text.includes(`data-lab="demo">${steps}${open}<data class="lab-pin"`), plain.text);
    assert.ok(!/<button|data-lab-live/.test(plain.text));
    const { cookie } = await openLab(port, t);
    const live = await req(port, { path: '/lessons/0001-lab.html', headers: { Cookie: cookie } });
    assert.ok(live.text.includes(`data-lab="demo">${steps}<data class="lab-pin"`) && !live.text.includes('lab-open'));
    for (const r of [plain, live]) for (const s of [t, cookie.split('=')[1]]) assert.ok(!r.text.includes(s));
    // An id the manifest lacks, and an invalid manifest, add nothing.
    writeLesson(ws, '0002-other', 'other', 'x');
    const other = await req(port, { path: '/lessons/0002-other.html' });
    assert.equal(other.text.includes('lab-cost') || other.text.includes('lab-open'), false);
    writeFileSync(join(ws, 'labs', 'labs.json'), '{');
    const broken = await req(port, { path: '/lessons/0001-lab.html' });
    assert.equal(broken.text.includes('lab-cost') || broken.text.includes('lab-open'), false);
  } finally { server.close(); }
  assert.equal(labStepsHtml({ cost: '<b>&"', up: { script: 'a' }, down: { script: 'b' }, verify: { script: 'c' } }),
    '<p class="lab-cost">&lt;b&gt;&amp;&quot;</p><p>The author ran:</p><pre>a</pre><pre>c</pre><pre>b</pre>');
});

test('readLabs: the shape D1 lists, the pin over the entry as returned, and every path rule (spec 49 D1, D2)', () => {
  const { ws, entry, script } = labWorkspace({ extra: { env: ['LAB_TOKEN', 'B_KEY'] } });
  const got = readLabs(ws);
  assert.deepEqual(Object.keys(got.labs.demo), ['cost', 'timeout', 'env', 'up', 'down']);
  assert.equal(labPin('demo', got.labs.demo), sha(JSON.stringify(['demo', entry])));
  assert.deepEqual(readLabs(mkdtempSync(join(tmpdir(), 'rv-labs-none-'))), { version: 1, labs: {} });
  const outside = mkdtempSync(join(tmpdir(), 'rv-labs-out-'));
  writeFileSync(join(outside, 'x.sh'), '#!/bin/sh\n', { mode: 0o755 });
  symlinkSync(join(outside, 'x.sh'), join(ws, 'labs', 'link.sh'));
  symlinkSync(join(ws, 'lessons/files/0001-lab/up.sh'), join(ws, 'lessons', 'files', 'up-link.sh'));
  mkdirSync(join(ws, 'evidence'));
  symlinkSync(outside, join(ws, 'evidence', '0009'));
  const ok = script('labs/ok.sh', '#!/bin/sh\n');
  const problems = (cmd) => {
    writeFileSync(join(ws, 'labs', 'labs.json'), JSON.stringify({ version: 1, labs: { demo: { ...entry, up: { ...ok, ...cmd } } } }));
    try { readLabs(ws); return []; } catch (e) { return e.problems; }
  };
  const cases = {
    'labs/link.sh': 'lab demo: up labs/link.sh resolves outside labs/',
    'lessons/files/up-link.sh': 'lab demo: up lessons/files/up-link.sh is a symlink',
    'evidence/0009/x.sh': 'lab demo: up evidence/0009/x.sh resolves outside evidence/',
    'labs/../MISSION.md': 'lab demo: up labs/../MISSION.md has an empty segment or one starting with .',
    '/etc/hosts': 'lab demo: up /etc/hosts has an empty segment or one starting with .',
    'labs/%2e%2e/x.sh': 'lab demo: up script does not match ^[A-Za-z0-9._/-]+$',
    'labs//ok.sh': 'lab demo: up labs//ok.sh has an empty segment or one starting with .',
    'MISSION.md': 'lab demo: up MISSION.md is not under labs/, evidence/, lessons/files/',
    'lessons/0001-lab.html': 'lab demo: up lessons/0001-lab.html is not under labs/, evidence/, lessons/files/',
    'labs/missing.sh': 'lab demo: up labs/missing.sh is not a regular file',
    'labs': 'lab demo: up labs is not under labs/, evidence/, lessons/files/',
  };
  for (const [path, line] of Object.entries(cases)) assert.deepEqual(problems({ script: path }), [line], path);
  assert.deepEqual(problems({ sha256: 'ABC' }), ['lab demo: up sha256 must be 64 lowercase hex characters']);
  assert.deepEqual(problems({ args: ['x'] }), ['lab demo: up must have exactly script, sha256']);
  // A symlinked root that leads outside the workspace.
  const ws2 = labWorkspace().ws;
  rmSync(join(ws2, 'labs'), { recursive: true });
  mkdirSync(join(outside, 'labs'));
  writeFileSync(join(outside, 'labs', 'up.sh'), '#!/bin/sh\n', { mode: 0o755 });
  writeFileSync(join(outside, 'labs', 'labs.json'), '{"version": 1, "labs": {}}');
  symlinkSync(join(outside, 'labs'), join(ws2, 'labs'));
  assert.throws(() => readLabs(ws2), /labs\/labs\.json is not a regular file inside the workspace/);
  // The evidence/ root a symlink that leads outside.
  rmSync(join(ws, 'evidence'), { recursive: true });
  symlinkSync(outside, join(ws, 'evidence'));
  assert.deepEqual(problems({ script: 'evidence/x.sh' }), ['lab demo: up evidence/x.sh has a root, evidence/, that resolves outside the workspace']);
  rmSync(join(ws2, 'labs'));
  mkdirSync(join(ws2, 'labs'));
  writeFileSync(join(ws2, 'labs', 'labs.json'), JSON.stringify({ version: 1, labs: { demo: { cost: 'c', timeout: 1, up: { script: 'lessons/files/up.sh', sha256: 'a'.repeat(64) }, down: { script: 'lessons/files/0001-lab/down.sh', sha256: 'a'.repeat(64) } } } }));
  symlinkSync(join(outside, 'labs'), join(ws2, 'lessons', 'files', 'x'));
  rmSync(join(ws2, 'lessons', 'files', '0001-lab'), { recursive: true });
  symlinkSync(outside, join(ws2, 'lessons', 'files', '0001-lab'));
  writeFileSync(join(outside, 'down.sh'), '#!/bin/sh\n');
  assert.throws(() => readLabs(ws2), (e) => assert.deepEqual(e.problems,
    ['lab demo: up lessons/files/up.sh is not a regular file', 'lab demo: down lessons/files/0001-lab/down.sh resolves outside lessons/files/']) ?? true);
  // Top level, ids and fields.
  const bad = (doc) => { writeFileSync(join(ws, 'labs', 'labs.json'), typeof doc === 'string' ? doc : JSON.stringify(doc)); try { readLabs(ws); return []; } catch (e) { return e.problems; } };
  assert.deepEqual(bad('{'), ['labs/labs.json is not JSON']);
  assert.deepEqual(bad({ version: 2, labs: {}, x: 1 }), ['the top level must have exactly version and labs', 'version must be 1']);
  assert.deepEqual(bad({ version: 1, labs: { Bad: {}, ['a'.repeat(41)]: {} } }), ['lab "Bad": the id does not match ^[a-z][a-z0-9-]{0,39}$', `lab "${'a'.repeat(41)}": the id does not match ^[a-z][a-z0-9-]{0,39}$`]);
  assert.deepEqual(bad({ version: 1, labs: { demo: { ...entry, cost: '', timeout: 7201, env: ['A', 'A', 'b'], checks: Array(11).fill({}), extra: 1 } } }), [
    'lab demo: must have cost, timeout, up and down, and may have env, checks and verify, and nothing else',
    'lab demo: cost must be 1 to 200 characters, with no control, line-separator or bidi character', 'lab demo: timeout must be whole seconds, 1 to 7200',
    'lab demo: env must be distinct names matching ^[A-Z_][A-Z0-9_]*$', 'lab demo: checks must be a list of at most 10']);
  assert.deepEqual(bad({ version: 1, labs: { demo: { ...entry, checks: [{ ...ok, message: '' }] } } }), ['lab demo: check 1 message must be 1 to 200 characters, with no control, line-separator or bidi character']);
  for (const cost of ["two\nlines", "tab\there", "rtl \u202e", "c1 \u0085", "ls \u2028", "iso \u2066"]) {
    assert.deepEqual(bad({ version: 1, labs: { demo: { ...entry, cost } } }), ['lab demo: cost must be 1 to 200 characters, with no control, line-separator or bidi character'], JSON.stringify(cost));
  }
  assert.deepEqual(bad({ version: 1, labs: { "x\u0085y": {} } }), ['lab "x\\u0085y": the id does not match ^[a-z][a-z0-9-]{0,39}$']);
  mkdirSync(join(ws, 'labs', 'dir.sh'));
  assert.deepEqual(problems({ script: 'labs/dir.sh' }), ['lab demo: up labs/dir.sh is not a regular file']);
});

test('teach lint: every LAB_* code, and lintLab reads labs/ (spec 49 D3)', () => {
  const { ws, entry, script } = labWorkspace();
  const vault = fixtureVault();
  const ctx = { entries: buildManifest(vault).entries, vaultPath: vault, schema: loadSchema(ROOT), teachSchema: SCHEMA, now: '2026-11-11' };
  const lab = (extra = {}) => lintWorkspace(ws, { ...ctx, ...extra }).filter((f) => f.code.startsWith('LAB_') || f.code === 'WARN_LAB_BYPASSED').map((f) => `${f.code}  ${f.file}: ${f.message}`);
  const pin = sha(JSON.stringify(['demo', entry]));
  const section = (inner, attrs = 'data-lab="demo"') => `<section data-block="lab" aria-label="lab" ${attrs}>${inner}</section>`;
  const page = (body, shape = '') => writeFileSync(join(ws, 'lessons', '0001-lab.html'), `<!doctype html><html><head><title>L</title></head><body data-lesson="0001-lab"${shape}>${body}</body></html>\n`);
  const good = `<data class="lab-pin" value="${pin}"></data><p>It writes one file <a data-cite="2026-01-01-fx-experiment">[1]</a>.</p><pre>up</pre>`;
  page(section(good));
  assert.deepEqual(lab(), []);
  page(section('<p>No output.</p>'));
  assert.deepEqual(lab(), [
    "LAB_OUTPUT_MISSING  lessons/0001-lab.html: lab section has no <pre> of the author's run",
    'LAB_OUTPUT_MISSING  lessons/0001-lab.html: lab section cites no experiment entry',
    `LAB_PIN_STALE  lessons/0001-lab.html: lab section has no lab-pin element; the lab's pin is ${pin}`]);
  page(section(good.replace(pin, 'a'.repeat(64))) + '<!-- ' + section(good) + ' -->');
  assert.deepEqual(lab(), [
    'LAB_PIN_STALE  lessons/0001-lab.html: the stored pin is ' + 'a'.repeat(64) + `; the lab's pin is ${pin}`,
    'LAB_SECTION_DUPLICATE  lessons/0001-lab.html: 2 opening tags whose data-block is lab; a lesson has one lab section',
    'LAB_SECTION_DUPLICATE  lessons/0001-lab.html: a lab section inside an HTML comment']);
  page(section(good, 'data-lab="nope"'));
  assert.deepEqual(lab(), ['LAB_UNKNOWN  lessons/0001-lab.html: data-lab nope is not in labs/labs.json']);
  page(section(good, ''));
  assert.deepEqual(lab(), ['LAB_UNKNOWN  lessons/0001-lab.html: lab section has no data-lab']);
  page(section(good), ' data-shape="project"');
  assert.deepEqual(lab(), ["LAB_VERIFY_MISSING  lessons/0001-lab.html: lab demo has no verify; a project lesson's lab needs one"]);
  page(section(good));
  // The manifest's scripts: one byte changed, no executable bit, no #!, unreadable.
  writeFileSync(join(ws, 'lessons/files/0001-lab/up.sh'), '#!/bin/sh\necho Up > up-ran\n');
  chmodSync(join(ws, 'lessons/files/0001-lab/up.sh'), 0o644);
  writeFileSync(join(ws, 'lessons/files/0001-lab/down.sh'), 'rm -f up-ran\n');
  assert.deepEqual(lab(), [
    `LAB_HASH_MISMATCH  labs/labs.json: lessons/files/0001-lab/up.sh changed: read the change, then copy sha256 ${sha('#!/bin/sh\necho Up > up-ran\n')} into labs.json`,
    `LAB_HASH_MISMATCH  labs/labs.json: lessons/files/0001-lab/down.sh changed: read the change, then copy sha256 ${sha('rm -f up-ran\n')} into labs.json`,
    'LAB_SCRIPT_NOT_RUNNABLE  labs/labs.json: lessons/files/0001-lab/up.sh has no owner executable bit',
    'LAB_SCRIPT_NOT_RUNNABLE  labs/labs.json: lessons/files/0001-lab/down.sh does not start with #!']);
  chmodSync(join(ws, 'lessons/files/0001-lab/up.sh'), 0o000);
  assert.ok(lab().includes('LAB_HASH_MISMATCH  labs/labs.json: lessons/files/0001-lab/up.sh cannot be read'));
  chmodSync(join(ws, 'lessons/files/0001-lab/up.sh'), 0o755);
  // An invalid manifest: its problems, and no lesson code that needs the manifest.
  writeFileSync(join(ws, 'labs', 'labs.json'), JSON.stringify({ version: 1, labs: { demo: { ...entry, up: { script: '/etc/hosts', sha256: entry.up.sha256 } } } }));
  assert.deepEqual(lab(), ['LAB_MANIFEST_INVALID  labs/labs.json: lab demo: up /etc/hosts has an empty segment or one starting with .']);
  // lintLab (the binding's lab block) reads .sh files under labs/ too.
  script('labs/wrap.sh', '#!/bin/sh\nkind create cluster\n');
  assert.ok(lab({ lab: { docs: ['LAB.txt'], uses: ['lab/lib.sh'], bypass: ['kind create cluster'] } }).includes("WARN_LAB_BYPASSED  labs/wrap.sh: line 2: kind create cluster; the binding's lab is LAB.txt"));
});

test('teach readme prints one Labs row per manifest lab after the lessons/files/ rows (spec 49 D9)', () => {
  const { ws } = labWorkspace({ extra: { env: ['LAB_TOKEN', 'B_KEY'] } });
  const doc = JSON.parse(readFileSync(join(ws, 'labs', 'labs.json'), 'utf8'));
  doc.labs.other = { cost: 'One | two', timeout: 1, up: doc.labs.demo.up, down: doc.labs.demo.down };
  writeFileSync(join(ws, 'labs', 'labs.json'), JSON.stringify(doc));
  const labs = readmeDraft(ws).split('## Labs')[1];
  console.log(labs.trim());
  assert.equal(labs, `\n\n| Lesson | Files | Needs on the learner's machine | Fallback |\n|---|---|---|---|\n| 0001-lab | lessons/files/0001-lab/ |  |  |\n| 0001-lab | labs/labs.json: demo | About one second, no downloads; env: LAB_TOKEN, B_KEY |  |\n|  | labs/labs.json: other | One \\| two; env: none |  |\n`);
  writeFileSync(join(ws, 'labs', 'labs.json'), '{');
  assert.ok(!readmeDraft(ws).includes('labs/labs.json'));
});

test('nothing in this version can start a process: no child_process in the lab code, and every lab route that passes ends in 501', () => {
  for (const f of ['bin/lib/labs.mjs', 'bin/lib/teach.mjs', 'bin/lib/lesson.mjs', 'bin/commands/teach.mjs', 'bin/lib/args.mjs']) {
    const src = readFileSync(join(ROOT, f), 'utf8');
    assert.ok(!/child_process|\bspawn\b|\bexecFile|\bexecSync\b|\bfork\(/.test(src), f);
  }
});
