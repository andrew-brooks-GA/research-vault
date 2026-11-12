// Issue 65 (spec 47 D1, D2): the cast scan and transcript, `teach cast`, the replay's lint codes, and a replay served,
// exported and mounted; on workspaces built here from a copy of test/fixtures/teach, each removed at the end.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cpSync, mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { once } from 'node:events';
import http from 'node:http';
import { createHash } from 'node:crypto';
import { fixtureVault } from './helpers.mjs';
import { scanCast, castTranscript, PLAYER_FILES } from '../bin/lib/cast.mjs';
import { createServer, exportWorkspace } from '../bin/lib/teach.mjs';
import { recordVerdict } from '../bin/lib/gate.mjs';
import { buildManifest } from '../bin/lib/manifest.mjs';
import { loadTeachSchema } from '../bin/lib/schema.mjs';
import { mountReplays } from '../skills/research-teach/assets/quiz.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const BIN = join(ROOT, 'bin', 'research-vault.mjs');
const FIX = join(ROOT, 'test', 'fixtures', 'teach');
const TOKEN = 'rvtest_FAKE0123456789abcdef'; // made up
const HEAD = '{"version":3,"term":{"cols":80,"rows":24},"timestamp":1}';
const cast = (...events) => [HEAD, ...events.map((e) => JSON.stringify(e))].join('\n') + '\n';
const CLEAN = cast([0.1, 'o', '$ fxctl run 7\r\n'], [0.05, 'o', '\u001b[32m42\u001b[0m\r\n'], [0, 'x', '0']);
const WHOLE = cast([0.1, 'o', `token ${TOKEN}\r\n`]);
const SPLIT = cast([0.1, 'o', 'token rvtest_FAKE01234'], [0.3, 'o', '56789abcdef\r\n']);
const COLOURED = cast([0.1, 'o', 'token rvtest_\u001b[31mFAKE0123456789abcdef\u001b[0m\r\n']);
const AWS = cast([0.1, 'o', 'ok\r\n'], [0.1, 'o', 'key AKIAIOSFODNN7EXAMPLE\r\n']); // AWS's documented example key

test('scanCast finds a needle whole, split across two events and coloured, at the event it starts in; a clean cast has none', () => {
  assert.deepEqual(scanCast(WHOLE, [TOKEN]), [{ kind: 'needle 1', at: 0 }]);
  assert.deepEqual(scanCast(SPLIT, [TOKEN]), [{ kind: 'needle 1', at: 0 }]);
  assert.deepEqual(scanCast(COLOURED, [TOKEN]), [{ kind: 'needle 1', at: 0 }]);
  assert.deepEqual(scanCast(CLEAN, [TOKEN]), []);
  assert.deepEqual(scanCast(AWS), [{ kind: 'aws-access-key', at: 1 }]);
  assert.deepEqual(scanCast(`{"version":2,"width":80,"height":24,"title":"${TOKEN}"}\n[0.1, "i", "x"]\n`, ['zz', TOKEN]), [{ kind: 'needle 2', at: 'header' }]);
  assert.throws(() => scanCast('not json\n'));
  assert.equal(castTranscript(CLEAN), '$ fxctl run 7\n42\n');
});

function tmp(prefix) { return mkdtempSync(join(tmpdir(), prefix)); }
const cli = (...a) => spawnSync(process.execPath, [BIN, 'teach', ...a], { encoding: 'utf8' });

test('teach cast check exits 0 when clean, 1 with a hit line per needle that never holds the token, 2 on no asciicast; transcript is escaped', () => {
  const dir = tmp('rv-cast-cli-');
  try {
    const f = (name, text) => { writeFileSync(join(dir, name), text); return join(dir, name); };
    const clean = cli('cast', 'check', f('clean.cast', CLEAN), '--needle', TOKEN);
    assert.deepEqual([clean.status, clean.stdout], [0, 'cast: clean\n']);
    for (const [name, text] of [['whole', WHOLE], ['split', SPLIT], ['coloured', COLOURED]]) {
      const r = cli('cast', 'check', f(`${name}.cast`, text), '--needle', 'absent', '--needle', TOKEN);
      assert.equal(r.status, 1, name);
      assert.equal(r.stdout, `secret ${join(dir, `${name}.cast`)}: needle 2 at event 0\n`);
      assert.ok(!r.stdout.includes('FAKE') && !r.stderr.includes('FAKE'));
    }
    const bad = cli('cast', 'check', f('bad.cast', `{"version":3, "x": "${TOKEN}"\n`));
    assert.equal(bad.status, 2);
    assert.ok(!bad.stderr.includes('FAKE'));
    assert.equal(cli('cast', 'check', join(dir, 'clean.cast'), '--needle').status, 2);
    const t = cli('cast', 'transcript', f('lt.cast', cast([0.1, 'o', 'a <b> & c\r\n'])));
    assert.deepEqual([t.status, t.stdout], [0, 'a &lt;b&gt; &amp; c\n']);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

// A bound repo (fixture vault at research/) holding a copy of the teach fixture at ws/, with lesson 0004's example
// replaying assets/fx.cast and followed by its transcript, and that lesson passed by the gate.
const REPLAY = `<div data-cast="../assets/fx.cast"></div>\n<pre>$ fxctl run 7\n42\n</pre>\n`;
function replayRepo({ castText = CLEAN, replay = REPLAY } = {}) {
  const repo = tmp('rv-cast-ws-');
  const vault = fixtureVault(join(repo, 'research'));
  writeFileSync(join(repo, '.research-vault.json'), JSON.stringify({ vault: 'research' }) + '\n');
  const ws = join(repo, 'ws');
  cpSync(FIX, ws, { recursive: true });
  mkdirSync(join(ws, 'assets'));
  if (castText !== null) writeFileSync(join(ws, 'assets', 'fx.cast'), castText);
  const p = join(ws, 'lessons', '0004-tool-fxctl.html');
  writeFileSync(p, readFileSync(p, 'utf8').replace('<p>The one line of output', `${replay}<p>The one line of output`));
  recordVerdict(repo, p, 'PASS');
  return { repo, vault, ws };
}
const castLines = (ws, vault) => cli('lint', ws, '--vault', vault).stdout.split('\n').filter((l) => l.includes('CAST'));

test('teach lint: LESSON_CAST_MISSING, _INVALID, _SECRET, _TRANSCRIPT_MISSING and _PLAYER_HASH; a clean replay and a pinned player add no line', () => {
  const cases = [
    [{}, []],
    [{ castText: null }, ['LESSON_CAST_MISSING  lessons/0004-tool-fxctl.html: replay 1: data-cast ../assets/fx.cast is no file under assets/ that teach serve returns']],
    [{ replay: REPLAY.replace('../assets/fx.cast', '../lessons/0001-good.html') }, ['LESSON_CAST_MISSING  lessons/0004-tool-fxctl.html: replay 1: data-cast ../lessons/0001-good.html is no file under assets/ that teach serve returns']],
    [{ castText: 'not a cast\n' }, ['LESSON_CAST_INVALID  lessons/0004-tool-fxctl.html: replay 1: assets/fx.cast is not an asciicast v2 or v3 file']],
    [{ castText: AWS }, ['LESSON_CAST_SECRET  lessons/0004-tool-fxctl.html: replay 1: assets/fx.cast matches aws-access-key at event 1; record it again with the value masked']],
    [{ replay: REPLAY.replace('<pre>', '<p>x</p><pre>') }, ['LESSON_CAST_TRANSCRIPT_MISSING  lessons/0004-tool-fxctl.html: replay 1: no <pre> transcript right after the element naming ../assets/fx.cast']],
  ];
  for (const [opts, want] of cases) {
    const { repo, vault, ws } = replayRepo(opts);
    try { assert.deepEqual(castLines(ws, vault), want, JSON.stringify(opts)); } finally { rmSync(repo, { recursive: true, force: true }); }
  }
  const { repo, vault, ws } = replayRepo();
  try {
    writeFileSync(join(ws, 'assets', 'asciinema-player.css'), 'not the release\n');
    assert.deepEqual(castLines(ws, vault), [`LESSON_CAST_PLAYER_HASH  assets/asciinema-player.css: sha256 ${createHash('sha256').update('not the release\n').digest('hex')} is not the pinned asciinema-player 3.18.0 value ${PLAYER_FILES['asciinema-player.css']}`]);
  } finally { rmSync(repo, { recursive: true, force: true }); }
});

function get(port, path) {
  return new Promise((resolve, reject) => {
    http.get({ host: '127.0.0.1', port, path, headers: { Host: `127.0.0.1:${port}` } }, (res) => {
      let body = '';
      res.on('data', (c) => { body += c; });
      res.on('end', () => resolve({ status: res.statusCode, body }));
    }).on('error', reject);
  });
}

test('teach serve returns a replay lesson with its element and transcript, and the cast from assets/', async () => {
  const { repo, ws } = replayRepo();
  const server = createServer(ws, { schema: loadTeachSchema(ROOT) });
  try {
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    const { port } = server.address();
    const page = await get(port, '/lessons/0004-tool-fxctl.html');
    assert.equal(page.status, 200);
    assert.ok(page.body.includes(REPLAY));
    assert.deepEqual(await get(port, '/assets/fx.cast'), { status: 200, body: CLEAN });
  } finally {
    server.close();
    rmSync(repo, { recursive: true, force: true });
  }
});

test('teach export copies the cast, inlines its text on the replay element, keeps the transcript and names no network URL there', () => {
  const { repo, vault, ws } = replayRepo();
  try {
    const r = exportWorkspace(ws, { vaultPath: vault, entries: buildManifest(vault).entries, skipUngated: true });
    assert.equal(r.code, 0);
    assert.equal(r.files.get('assets/fx.cast').toString('utf8'), CLEAN);
    const page = r.files.get('lessons/0004-tool-fxctl.html');
    const esc = CLEAN.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    assert.ok(page.includes(`<div data-cast="../assets/fx.cast" data-cast-text="${esc}"></div>\n<pre>$ fxctl run 7\n42\n</pre>`));
    assert.doesNotMatch(page, /\s(?:src|data-cast)\s*=\s*["']?(?:https?:)?\/\//i);
    // Every other page is exported as before: no data-cast-text on it.
    assert.deepEqual([...r.files].filter(([p, b]) => p.endsWith('.html') && String(b).includes('data-cast-text')).map(([p]) => p), ['lessons/0004-tool-fxctl.html']);
  } finally { rmSync(repo, { recursive: true, force: true }); }
});

test('mountReplays hands each data-cast element to the player, the inlined text when present, and does nothing without a player', () => {
  const els = [{ dataset: { cast: '../assets/a.cast' } }, { dataset: { cast: '../assets/b.cast', castText: 'TEXT' } }];
  const root = { querySelectorAll: (sel) => (sel === '[data-cast]' ? els : []) };
  const calls = [];
  mountReplays(root, { create: (src, el) => calls.push([src, el]) });
  assert.deepEqual(calls, [['../assets/a.cast', els[0]], [{ data: 'TEXT' }, els[1]]]);
  mountReplays(root, undefined);
  assert.equal(calls.length, 2);
});
