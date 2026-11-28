import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { once } from 'node:events';
import fs, { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { request } from 'node:http';
import { syncBuiltinESMExports } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { testEnv } from './helpers.mjs';
import { readBrand } from '../bin/lib/brand.ts';
import { isInsideVault } from '../bin/lib/containment.ts';
import { hasVerdict, ledgerRoot, referencedImages, taskFile } from '../bin/lib/gate.mjs';
import { labPin, labRefusal, readLabs } from '../bin/lib/labs.mjs';
import { sha256Hex } from '../bin/lib/hash.ts';
import { imageTarget } from '../bin/lib/lesson.mjs';
import { resolveVault } from '../bin/lib/resolve.mjs';
import { loadTeachSchema } from '../bin/lib/schema.mjs';
import * as teach from '../bin/lib/teach.mjs';

const { createServer, serveFile } = teach;

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const BIN = join(ROOT, 'bin', 'research-vault.mjs');
const SCHEMA = loadTeachSchema(ROOT);
const MARKER = 'S-06 outside marker';
const REFUSAL = 'teach export: paths resolve outside their allowed locations or cannot be resolved; nothing written\n';
const TEACH_USAGE = 'usage: research-vault teach record add|supersede ... | attempt add ... | attempt import <file> [workspace] | cast check <file> [--needle <value>]... | cast transcript <file> | check [--dry-run] [--hints] <N> [workspace] | check --start <N>... [--minutes <M>] [--pass <P>] [--no-hints] [workspace] | check --certify [workspace] | check --cancel [workspace] | export [workspace] --out <dir> [--skip-ungated] | lint [--fix] [--prose] [workspace] | next [workspace] | path candidates [--topic a,b] [workspace] | path edges [workspace] | progress [workspace] | readme [workspace] | serve [--labs] [--terminal] [workspace]\n';

function fixture(t) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'rv-teach-containment-')));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const ws = join(root, 'workspace');
  const outside = join(root, 'outside');
  const vault = join(root, 'vault');
  for (const dir of [ws, outside, vault]) mkdirSync(dir);
  writeFileSync(join(ws, 'MISSION.md'), '# Mission\n');
  writeFileSync(join(outside, 'marker.txt'), MARKER);
  return { root, ws, outside, vault, out: join(root, 'export') };
}

function link(t, target, name, type = 'file') {
  try { symlinkSync(target, name, type); t.diagnostic(`${type} symlink`); } catch (e) {
    if (process.platform !== 'win32' || !['EPERM', 'EACCES'].includes(e.code)) throw e;
    if (type === 'dir') { symlinkSync(target, name, 'junction'); t.diagnostic(`directory junction (${e.code})`); }
    else { t.skip(`Windows file links are unavailable (${e.code})`); return false; }
  }
  return true;
}

async function listen(t, ws, options) {
  const server = createServer(ws, { schema: SCHEMA, ...options });
  t.after(() => new Promise((done) => server.close(done)));
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  return server.address().port;
}

function fetchPath(port, path, body) {
  return new Promise((resolve, reject) => {
    const headers = body === undefined ? undefined : {
      Origin: `http://127.0.0.1:${port}`, 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body),
    };
    const req = request({ host: '127.0.0.1', port, path, method: body === undefined ? 'GET' : 'POST', headers }, (res) => {
      let text = '';
      res.setEncoding('utf8').on('data', (chunk) => { text += chunk; });
      res.on('end', () => resolve({ status: res.statusCode, text }));
      res.on('error', reject);
    });
    req.on('error', reject);
    req.end(body);
  });
}

function teachCli({ root, ws }, verb, ...args) {
  const result = spawnSync(process.execPath, [BIN, 'teach', verb, ws, ...args], {
    cwd: root, env: testEnv(), encoding: 'utf8', timeout: 10000,
  });
  if (result.error) throw result.error;
  return result;
}

function exportCli(f) {
  const vaultArgs = f.vault ? ['--vault', f.vault] : [];
  return teachCli(f, 'export', ...vaultArgs, '--out', f.out);
}

function assertExportRefused(f, path) {
  const result = exportCli(f);
  assert.equal(result.status, 1, result.stderr);
  assert.equal(result.stdout, `unservable ${JSON.stringify(path)}\n`);
  assert.equal(result.stderr, REFUSAL);
  assert.equal(existsSync(f.out), false);
}

function assertExportedFile(f, path) {
  const r = exportCli(f);
  assert.equal(r.status, 0, r.stderr);
  assert.equal(r.stderr, '');
  assert.match(r.stdout, /^wrote \d+ files to /);
  assert.equal(readFileSync(join(f.out, path), 'utf8'), 'contained file\n');
  assertNoMarkerInExport(readdirSync(f.out, { recursive: true, withFileTypes: true }));
}

function assertNoMarkerInExport(entries, marker = MARKER) {
  for (const file of entries.filter((d) => d.isFile())) {
    assert.ok(!readFileSync(join(file.parentPath, file.name)).includes(marker), file.name);
  }
}

for (const folder of ['assets', 'lessons', 'reference', 'brand']) {
  test(`serve refuses an outside ${folder}/ folder`, async (t) => {
    const { ws, outside } = fixture(t);
    link(t, outside, join(ws, folder), 'dir');
    const path = `/${folder}/marker.txt`;
    assert.deepEqual(serveFile(ws, path), { status: 404 });
    assert.deepEqual(await fetchPath(await listen(t, ws), path), { status: 404, text: 'not found\n' });
  });

  test(`export refuses an outside ${folder}/ folder and writes nothing`, (t) => {
    const f = fixture(t);
    link(t, f.outside, join(f.ws, folder), 'dir');
    assertExportRefused(f, folder);
  });
}

test('serve and export refuse an outside file link in assets/', async (t) => {
  const f = fixture(t);
  const dir = join(f.ws, 'assets');
  const target = join(dir, 'marker.txt');
  mkdirSync(dir);
  if (!link(t, join(f.outside, 'marker.txt'), target)) return;
  assert.equal(isInsideVault(dir, target), false);
  assert.deepEqual(serveFile(f.ws, '/assets/marker.txt'), { status: 404 });
  assert.deepEqual(await fetchPath(await listen(t, f.ws), '/assets/marker.txt'), { status: 404, text: 'not found\n' });
  assertExportRefused(f, 'assets/marker.txt');
});

test('serve and export accept a file link within the same allowed folder', async (t) => {
  const f = fixture(t);
  const dir = join(f.ws, 'assets');
  mkdirSync(dir);
  writeFileSync(join(dir, 'local.txt'), 'contained file\n');
  if (!link(t, join(dir, 'local.txt'), join(dir, 'linked.txt'))) return;
  assert.deepEqual(await fetchPath(await listen(t, f.ws), '/assets/linked.txt'), { status: 200, text: 'contained file\n' });
  assertExportedFile(f, 'assets/linked.txt');
});

test('serve and export accept a workspace reached through a linked root', async (t) => {
  const f = fixture(t);
  mkdirSync(join(f.ws, 'assets'));
  writeFileSync(join(f.ws, 'assets', 'local.txt'), 'contained file\n');
  const alias = join(f.root, 'workspace-link');
  link(t, f.ws, alias, 'dir');
  assert.deepEqual(await fetchPath(await listen(t, alias), '/assets/local.txt'), { status: 200, text: 'contained file\n' });
  assertExportedFile({ ...f, ws: alias }, 'assets/local.txt');
});

for (const [folder, name] of [['media', 'local.txt'], ['attempts', 'a-20260101-120000-0001.md']]) {
  test(`serve and export refuse assets/ linked to the workspace's ${folder}/ folder`, async (t) => {
    const f = fixture(t);
    const storage = join(f.ws, folder);
    mkdirSync(storage);
    writeFileSync(join(storage, name), folder === 'attempts' ? `---\ntype: attempt\nlesson: 0001-example\n---\n${MARKER}\n` : MARKER);
    link(t, storage, join(f.ws, 'assets'), 'dir');
    const r = await fetchPath(await listen(t, f.ws), `/assets/${name}`);
    assert.equal(r.status, 404);
    assert.equal(r.text.includes(MARKER), false);
    assertExportRefused(f, 'assets');
  });
}

for (const folder of ['lessons', 'reference', 'brand']) {
  test(`serve and export refuse ${folder}/ linked to another workspace folder`, async (t) => {
    const f = fixture(t);
    const target = join(f.ws, 'media');
    mkdirSync(target);
    writeFileSync(join(target, 'marker.txt'), MARKER);
    link(t, target, join(f.ws, folder), 'dir');
    const path = `/${folder}/marker.txt`;
    assert.deepEqual(await fetchPath(await listen(t, f.ws), path), { status: 404, text: 'not found\n' });
    assertExportRefused(f, folder);
  });
}

test('serve and export check the stored spelling of the assets/ directory', async (t) => {
  const f = fixture(t);
  const stored = join(f.ws, 'Assets');
  const requested = join(f.ws, 'assets');
  mkdirSync(stored);
  writeFileSync(join(stored, 'local.txt'), 'contained file\n');
  const port = await listen(t, f.ws);
  if (existsSync(requested)) {
    t.diagnostic('case-insensitive fixture directory');
    assert.equal(realpathSync.native(requested), stored);
    assert.deepEqual(await fetchPath(port, '/assets/local.txt'), { status: 200, text: 'contained file\n' });
    assertExportedFile(f, 'assets/local.txt');
  } else {
    t.diagnostic('case-sensitive fixture directory');
    link(t, stored, requested, 'dir');
    assert.deepEqual(await fetchPath(port, '/assets/local.txt'), { status: 404, text: 'not found\n' });
    assertExportRefused(f, 'assets');
  }
});

test('serve and export refuse an allowed folder linked to the workspace root itself', async (t) => {
  const f = fixture(t);
  link(t, f.ws, join(f.ws, 'assets'), 'dir');
  assert.deepEqual(await fetchPath(await listen(t, f.ws), '/assets/MISSION.md'), { status: 404, text: 'not found\n' });
  assertExportRefused(f, 'assets');
});

test('serve and export refuse a file link to another allowed folder', async (t) => {
  const f = fixture(t);
  mkdirSync(join(f.ws, 'lessons'));
  mkdirSync(join(f.ws, 'assets'));
  const target = join(f.ws, 'lessons', 'local.txt');
  writeFileSync(target, 'contained file\n');
  if (!link(t, target, join(f.ws, 'assets', 'linked.txt'))) return;
  const port = await listen(t, f.ws);
  assert.deepEqual(await fetchPath(port, '/lessons/local.txt'), { status: 200, text: 'contained file\n' });
  assert.deepEqual(await fetchPath(port, '/assets/linked.txt'), { status: 404, text: 'not found\n' });
  assertExportRefused(f, 'assets/linked.txt');
});

test('export refuses a nested outside directory link without writing into an empty output folder', (t) => {
  const f = fixture(t);
  mkdirSync(join(f.ws, 'assets'));
  mkdirSync(f.out);
  link(t, f.outside, join(f.ws, 'assets', 'linked'), 'dir');
  const r = exportCli(f);
  assert.deepEqual({ status: r.status, stdout: r.stdout, stderr: r.stderr }, {
    status: 1, stdout: 'unservable "assets/linked"\n', stderr: REFUSAL,
  });
  assert.deepEqual(readdirSync(f.out), []);
});

test('export omits and serve refuses dot-prefixed entries under static folders', async (t) => {
  const f = fixture(t);
  for (const folder of ['lessons', 'assets']) mkdirSync(join(f.ws, folder));
  const names = ['lessons/.#0001-a.html', 'assets/.cache', 'assets/.hidden.txt'];
  const marker = 0xff;
  const bytes = Buffer.alloc(8, marker);
  writeFileSync(join(f.outside, 'marker.txt'), bytes);
  if (!link(t, join(f.outside, 'absent.html'), join(f.ws, names[0]))) return;
  link(t, f.outside, join(f.ws, names[1]), 'dir');
  writeFileSync(join(f.ws, names[2]), bytes);

  const port = await listen(t, f.ws);
  for (const name of names) {
    const path = '/' + name.split('/').map(encodeURIComponent).join('/');
    assert.deepEqual(await fetchPath(port, path), { status: 404, text: 'not found\n' });
  }
  assert.deepEqual(await fetchPath(port, '/assets/.cache/marker.txt'), { status: 404, text: 'not found\n' });

  const r = exportCli(f);
  assert.equal(r.status, 0, r.stdout + r.stderr);
  const entries = readdirSync(f.out, { recursive: true, withFileTypes: true });
  for (const name of names) assert.ok(!entries.some((d) => join(d.parentPath, d.name) === join(f.out, name)), name);
  assertNoMarkerInExport(entries, marker);
});

for (const name of ['PATH.md', 'README.md', 'GLOSSARY.md']) {
  test(`export refuses an outside ${name} link and writes nothing`, (t) => {
    const f = fixture(t);
    if (!link(t, join(f.outside, 'marker.txt'), join(f.ws, name))) return;
    const r = exportCli(f);
    assert.deepEqual({ status: r.status, stdout: r.stdout, stderr: r.stderr }, {
      status: 1, stdout: `unservable "${name}"\n`, stderr: REFUSAL,
    });
    assert.equal(existsSync(f.out), false);
  });
}

test('export reports unresolved fixed-name files together with static path refusals', (t) => {
  const f = fixture(t);
  const names = ['PATH.md', 'README.md', 'GLOSSARY.md'];
  for (const name of names) {
    if (!link(t, join(f.outside, 'absent.md'), join(f.ws, name))) return;
  }
  link(t, f.outside, join(f.ws, 'assets'), 'dir');
  mkdirSync(f.out);
  const r = exportCli(f);
  assert.deepEqual({ status: r.status, stdout: r.stdout, stderr: r.stderr }, {
    status: 1, stdout: ['assets', ...names].map((name) => `unservable "${name}"\n`).join(''), stderr: REFUSAL,
  });
  assert.deepEqual(readdirSync(f.out), []);
});

test('export leaves out contained README and GLOSSARY links and accepts a contained PATH link', (t) => {
  const f = fixture(t);
  const path = join(f.ws, 'local-path.md');
  const prose = join(f.ws, 'local-prose.md');
  writeFileSync(path, '1. First line\n');
  writeFileSync(prose, `# ${MARKER}\n`);
  for (const [name, source] of [['PATH.md', path], ['README.md', prose], ['GLOSSARY.md', prose]]) {
    if (!link(t, source, join(f.ws, name))) return;
  }
  assert.equal(teach.lessonIndex(f.ws).lines, 1);
  const r = exportCli(f);
  assert.equal(r.status, 0, r.stderr);
  assert.equal(existsSync(join(f.out, 'GLOSSARY.md')), false);
  assert.equal(readFileSync(join(f.out, 'index.html'), 'utf8').includes(MARKER), false);
});

test('export quotes refusal paths and escapes Unicode controls and format characters', () => {
  assert.equal(teach.unservableLine('assets/plain.txt'), 'unservable "assets/plain.txt"');
  const name = 'assets/"\\\n\u007f\u0085\u00ad\u202e\u2028\u2029\ud800\u{e0001}é.txt';
  assert.equal(teach.unservableLine(name), String.raw`unservable "assets/\"\\\n\u007f\u0085\u00ad\u202e\u2028\u2029\ud800\udb40\udc01é.txt"`);
});

test('the indexes, progress pages and quiz grading refuse outside lesson and reference links', async (t) => {
  const { ws, outside } = fixture(t);
  const quiz = '<section data-block="quiz"><script type="application/json" data-quiz>{"items":[{"options":["a","b"],"correct":0}]}</script></section>';
  const outsidePage = join(outside, 'outside.html');
  writeFileSync(outsidePage, `<title>${MARKER}</title><h1>${MARKER}</h1>${quiz}`);
  mkdirSync(join(ws, 'lessons'));
  mkdirSync(join(ws, 'reference'));
  if (!link(t, outsidePage, join(ws, 'lessons', '0001-refused-lesson.html'))) return;
  if (!link(t, outsidePage, join(ws, 'reference', 'refused-reference.html'))) return;
  const port = await listen(t, ws);
  for (const path of ['/', '/lessons.json', '/progress', '/progress.json']) {
    const r = await fetchPath(port, path);
    assert.equal(r.status, 200, path);
    for (const marker of [MARKER, '0001-refused-lesson', 'refused-reference']) assert.ok(!r.text.includes(marker), path);
  }
  assert.deepEqual(await fetchPath(port, '/attempt', '{"lesson":"0001-refused-lesson","answers":[0]}'), {
    status: 400, text: 'no lesson: 0001-refused-lesson\n',
  });
  assert.equal(existsSync(join(ws, 'attempts')), false);
});

test('progress, README and PATH readers ignore outside links', async (t) => {
  const { ws, outside } = fixture(t);
  const contents = {
    'README.md': `# ${MARKER}\n`,
    'PATH.md': '1. Refused line | after: floor\n',
    'attempts/a-20260101-120000-0001.md': '---\ntype: attempt\nlesson: 0001-refused-attempt\ntotal: 2\nwrong: []\ndate: 2026-01-01\n---\n',
  };
  mkdirSync(join(ws, 'attempts'));
  for (const [name, body] of Object.entries(contents)) {
    const source = join(outside, name.split('/').at(-1));
    writeFileSync(source, body);
    if (!link(t, source, join(ws, name))) return;
  }
  const port = await listen(t, ws);
  assert.ok(!(await fetchPath(port, '/')).text.includes(MARKER));
  assert.equal(JSON.parse((await fetchPath(port, '/lessons.json')).text).lines, null);
  const progress = JSON.parse((await fetchPath(port, '/progress.json')).text);
  assert.deepEqual([progress.attempts, progress.lessons], [0, []]);
});

test('progress ignores outside attempts and learning-records folders', async (t) => {
  const { ws, outside } = fixture(t);
  writeFileSync(join(outside, 'a-20260101-120000-0001.md'), '---\nlesson: 0001-refused-attempt\ntotal: 2\nwrong: []\ndate: 2026-01-01\n---\n');
  writeFileSync(join(outside, '0001-refused-record.md'), '---\nstatus: active\nkind: fact\ndate: 2026-01-01\n---\n');
  for (const folder of ['attempts', 'learning-records']) link(t, outside, join(ws, folder), 'dir');
  writeFileSync(join(ws, 'MISSION.md'), '# Mission\n\n## Constraints\n\n- Reminders: every 1 day\n');
  const progress = JSON.parse((await fetchPath(await listen(t, ws), '/progress.json')).text);
  assert.deepEqual([progress.attempts, progress.lessons, progress.records.active, progress.reviewDue], [0, [], 0, []]);
});

test('progress ignores and teach export and serve refuse an outside MISSION.md link', async (t) => {
  const f = fixture(t);
  const mission = join(f.ws, 'MISSION.md');
  const source = join(f.outside, 'MISSION.md');
  writeFileSync(source, `# Mission\n\n## Constraints\n\n- Reminders: every 1 day\n\n## Success looks like\n\n- ${MARKER}\n`);
  rmSync(mission);
  if (!link(t, source, mission)) return;

  const r = await fetchPath(await listen(t, f.ws), '/progress.json');
  assert.equal(r.status, 200);
  assert.equal(JSON.parse(r.text).reviewDue, null);
  assert.ok(!r.text.includes(MARKER));
  assert.deepEqual(teach.teachIndex(f.ws, { now: new Date() }).criteria, []);

  for (const [verb, result] of [['export', exportCli(f)], ['serve', teachCli(f, 'serve', '--vault', f.vault)]]) {
    assert.equal(result.status, 2, verb);
    assert.equal(result.stdout, '', verb);
    assert.equal(result.stderr, TEACH_USAGE, verb);
  }
  assert.equal(existsSync(f.out), false);
});

for (const name of ['brand.json', 'tokens.json']) {
  test(`serve treats an outside ${name} link as an unreadable brand`, async (t) => {
    const { root, ws, outside, vault } = fixture(t);
    const dir = join(ws, 'brand');
    mkdirSync(dir);
    const f = join(dir, name);
    const token = '#123456';
    const outsideBrand = join(outside, name);
    if (name === 'tokens.json') writeFileSync(join(dir, 'brand.json'), JSON.stringify({ name: 'Linked token brand', tokens: name, color: { light: { '--bg': '{bg}' } } }));
    const json = JSON.stringify(name === 'brand.json' ? { name: MARKER } : { bg: { $value: token } });
    writeFileSync(outsideBrand, json);
    writeFileSync(f, json);
    assert.ok(readBrand(ws).brand);
    rmSync(f);
    mkdirSync(f);
    const baseline = readBrand(ws);
    const plain = await fetchPath(await listen(t, ws), '/');
    assert.equal(baseline.brand, null);
    assert.equal(plain.status, 200);
    rmdirSync(f);
    if (!link(t, outsideBrand, f)) return;
    assert.deepEqual(readBrand(ws), baseline);
    const child = spawn(process.execPath, [BIN, 'teach', 'serve', ws, '--vault', vault], {
      cwd: root, env: testEnv(), stdio: ['ignore', 'pipe', 'pipe'],
    });
    const closed = once(child, 'close');
    t.after(async () => { child.kill(); await closed; });
    let stdout = '', stderr = '';
    child.stderr.setEncoding('utf8').on('data', (chunk) => { stderr += chunk; });
    const port = await Promise.race([new Promise((resolve) => {
      child.stdout.setEncoding('utf8').on('data', (chunk) => {
        stdout += chunk;
        const match = / at http:\/\/127\.0\.0\.1:(\d+)\/\r?\n/.exec(stdout);
        if (match) resolve(Number(match[1]));
      });
    }), closed.then(([code]) => { throw new Error(`teach serve exited ${code}: ${stderr}`); })]);
    const r = await fetchPath(port, '/');
    assert.deepEqual(r, plain);
    assert.ok(!r.text.includes(MARKER) && !r.text.includes(token));
    child.kill();
    await closed;
    assert.equal(stderr, 'brand: brand/brand.json is invalid; run teach lint\n');
  });
}

test('serve refuses decoded paths containing a backslash', async (t) => {
  const { ws } = fixture(t);
  mkdirSync(join(ws, 'assets'));
  mkdirSync(join(ws, 'lessons'));
  writeFileSync(join(ws, 'assets', 'local.txt'), 'contained file\n');
  const port = await listen(t, ws);
  for (const path of ['/lessons/..%5Csecret', '/assets%5C..%5Cx', '/assets%5Clocal.txt']) {
    assert.deepEqual(serveFile(ws, path), { status: 404 });
    assert.deepEqual(await fetchPath(port, path), { status: 404, text: 'not found\n' });
  }
});

test('image, cast and claims-gate lookups treat outside file links as absent', (t) => {
  const { ws, outside } = fixture(t);
  const lessons = join(ws, 'lessons');
  const assets = join(ws, 'assets');
  const evidence = join(ws, 'evidence', '0001');
  for (const dir of [lessons, assets, evidence]) mkdirSync(dir, { recursive: true });
  const file = join(outside, 'marker.txt');
  for (const path of [join(assets, 'linked.svg'), join(assets, 'linked.cast'), join(evidence, 'requirements.json')]) {
    if (!link(t, file, path)) return;
  }
  const page = join(lessons, '0001-lesson.html');
  writeFileSync(page, '<img src="../assets/linked.svg">');
  assert.equal(imageTarget(ws, lessons, '../assets/linked.svg', { bytes: false }).ok, false);
  assert.equal(imageTarget(ws, lessons, '../assets/linked.cast').ok, false);
  assert.deepEqual(referencedImages(page), []);
  assert.equal(taskFile(page), null);
});

test('the lab manifest reader refuses an outside labs folder', (t) => {
  const { ws, outside } = fixture(t);
  writeFileSync(join(outside, 'labs.json'), '{"version":1,"labs":{}}');
  link(t, outside, join(ws, 'labs'), 'dir');
  assert.throws(() => readLabs(ws), /labs\/labs\.json is not a regular file inside the workspace/);
});

test('the lab manifest reader refuses an outside labs folder with no labs.json', (t) => {
  const { ws, outside } = fixture(t);
  link(t, outside, join(ws, 'labs'), 'dir');
  assert.throws(() => readLabs(ws), /labs\/labs\.json is not a regular file inside the workspace/);
});

test('the lab pin check refuses lessons in a linked lessons directory', (t) => {
  const { ws, outside } = fixture(t);
  const id = 'demo';
  const script = 'labs/fixture.txt';
  const bytes = 'fixture bytes\n';
  const command = { script, sha256: sha256Hex(bytes) };
  const lab = { cost: 'Fixture only', timeout: 1, up: command, down: command };
  mkdirSync(join(ws, 'labs'));
  writeFileSync(join(ws, script), bytes);
  writeFileSync(join(ws, 'labs', 'labs.json'), JSON.stringify({ version: 1, labs: { [id]: lab } }));
  const page = `<section data-block="lab" data-lab="${id}"><data class="lab-pin" value="${labPin(id, lab)}"></data></section>`;
  const dir = join(ws, 'lessons');
  const name = '0001-fixture.html';
  writeFileSync(join(outside, name), page);
  mkdirSync(dir);
  writeFileSync(join(dir, name), page);
  assert.deepEqual(labRefusal(ws, 'run', id, testEnv()), [200, lab]);
  rmSync(join(dir, name));
  rmdirSync(dir);
  link(t, outside, dir, 'dir');
  assert.deepEqual(labRefusal(ws, 'run', id, testEnv()), [409, "no lesson stores this lab's current pin"]);
});

test('the terminal wrapper refuses lessons in a linked lessons directory', async (t) => {
  const { ws, outside } = fixture(t);
  const dir = join(ws, 'lessons');
  const name = '0001-fixture.html';
  mkdirSync(dir);
  writeFileSync(join(dir, name), '<title>Fixture</title>');
  writeFileSync(join(outside, name), '<title>Fixture</title>');
  const token = 'a'.repeat(64);
  const port = await listen(t, ws, { terminal: true, t: token });
  const base = `http://127.0.0.1:${port}`;
  const opened = await fetch(`${base}/labs/open?t=${token}`, { redirect: 'manual' });
  assert.equal(opened.status, 303);
  const headers = { Cookie: opened.headers.get('set-cookie').split(';')[0] };
  const url = `${base}/term/lessons/${name}`;
  const valid = await fetch(url, { headers });
  assert.equal(valid.status, 200);
  assert.match(await valid.text(), /<iframe src="\/lessons\/0001-fixture\.html"/);
  rmSync(join(dir, name));
  rmdirSync(dir);
  link(t, outside, dir, 'dir');
  const refused = await fetch(url, { headers });
  assert.equal(refused.status, 404);
  assert.equal(await refused.text(), 'not found\n');
});

test('the terminal lesson lookup refuses filesystem errors', (t) => {
  const { ws } = fixture(t);
  const id = '0001-fixture';
  const dir = join(ws, 'lessons');
  const file = join(dir, `${id}.html`);
  mkdirSync(dir);
  writeFileSync(file, 'Fixture');
  for (const method of ['statSync', 'openSync']) {
    const original = fs[method];
    const failing = t.mock.method(fs, method, (path, ...args) => {
      if (path === file) throw Object.assign(new Error('Fixture access denied'), { code: 'EACCES' });
      return original(path, ...args);
    });
    syncBuiltinESMExports();
    try {
      assert.equal(teach.terminalLessonPage(ws, id), null);
      assert.equal(failing.mock.callCount(), 1);
    } finally {
      failing.mock.restore();
      syncBuiltinESMExports();
    }
  }
});

test('vault resolution skips an outside workspace binding and uses the parent binding', (t) => {
  const { root, ws, outside, vault } = fixture(t);
  const config = '.research-vault.json';
  writeFileSync(join(root, config), JSON.stringify({ vault: 'vault' }));
  writeFileSync(join(outside, config), MARKER);
  if (!link(t, join(outside, config), join(ws, config))) return;
  assert.deepEqual(resolveVault({ cwd: ws, workspaceDir: ws, env: testEnv() }), { path: vault, source: 'project' });
});

test('hasVerdict skips an outside workspace binding and uses the parent ledger root', (t) => {
  const { root, ws, outside, vault } = fixture(t);
  const parent = join(root, '.research-vault.json');
  const binding = join(ws, '.research-vault.json');
  const source = join(outside, '.research-vault.json');
  writeFileSync(parent, JSON.stringify({ vault: 'vault' }));
  writeFileSync(source, MARKER);
  if (!link(t, source, binding)) return;
  const file = join(ws, 'draft.md');
  writeFileSync(file, '# Draft\n');
  assert.equal(ledgerRoot(file, vault, { workspaceDir: ws }), root);
  const read = fs.readFileSync;
  const seen = [];
  const tracer = t.mock.method(fs, 'readFileSync', (name, ...args) => {
    if ([binding, source, parent].includes(name)) seen.push(name);
    return read(name, ...args);
  });
  syncBuiltinESMExports();
  try {
    assert.equal(hasVerdict(file, vault, ws), false);
    assert.ok(seen.includes(parent));
    assert.ok(!seen.includes(binding) && !seen.includes(source));
  } finally {
    tracer.mock.restore();
    syncBuiltinESMExports();
  }
});

test('teach export skips an outside workspace binding on both output streams', (t) => {
  const { vault, ...f } = fixture(t);
  const source = join(f.outside, '.research-vault.json');
  writeFileSync(join(f.root, '.research-vault.json'), JSON.stringify({ vault: 'vault' }));
  const marker = 'S06-marker';
  writeFileSync(source, marker);
  if (!link(t, source, join(f.ws, '.research-vault.json'))) return;
  const r = exportCli(f);
  assert.equal(r.stdout.includes(marker), false);
  assert.equal(r.stderr.includes(marker), false);
  assert.equal(r.status, 0, r.stderr);
  assert.equal(r.stderr, '');
  assert.match(r.stdout, /^wrote \d+ files to /);
  assert.ok(existsSync(join(f.out, 'index.html')));
});

test('teach next ignores an outside workspace binding on both output streams', (t) => {
  const f = fixture(t);
  const config = '.research-vault.json';
  const source = join(f.outside, config);
  const outsideVault = join(f.outside, MARKER);
  mkdirSync(outsideVault);
  writeFileSync(source, JSON.stringify({ vault: outsideVault }));
  if (!link(t, source, join(f.ws, config))) return;
  writeFileSync(join(f.root, config), JSON.stringify({ vault: 'vault' }));
  writeFileSync(join(f.ws, 'MISSION.md'), '# Mission\n\n## Success looks like\n\n- Finish the lesson\n');
  writeFileSync(join(f.ws, 'PATH.md'), '1. First line | after: floor | lesson: 0001-a\n');
  writeFileSync(join(f.ws, 'README.md'), '# Readme\n');

  const r = teachCli(f, 'next');
  assert.equal(r.status, 0, r.stderr);
  assert.equal(r.stderr, '');
  assert.ok(!r.stdout.includes(MARKER));
  assert.match(r.stdout, /^fringe: complete\nreadme: ungated$/m);
});
