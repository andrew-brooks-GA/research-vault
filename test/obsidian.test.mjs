import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { mkdirSync, readdirSync, realpathSync, rmSync, symlinkSync, mkdtempSync, cpSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, relative, join } from 'node:path';
import { obsidianView } from '../bin/commands/obsidian.mjs';
import { buildManifest } from '../bin/lib/manifest.mjs';
import { escapePathControls, VAULT_PATH_OUTSIDE } from '../bin/lib/containment.mjs';
import { tmpVault, put, codeRepo, testEnv } from './helpers.mjs';

const NOW = new Date('2026-06-01');

function freshVault() {
  const dir = join(mkdtempSync(join(tmpdir(), 'rv-')), 'v');
  cpSync(fileURLToPath(new URL('./fixtures/vault', import.meta.url)), dir, { recursive: true });
  return dir;
}

test('obsidian writes a derived stub note with a backlink wikilink', () => {
  const dir = freshVault();
  obsidianView(dir, '_obsidian', { now: NOW });
  const p = join(dir, '_obsidian', '2026-01-01-a.md');
  assert.ok(existsSync(p), 'expected _obsidian/2026-01-01-a.md to exist');
  const body = readFileSync(p, 'utf8');
  assert.ok(body.includes('[[2026-01-02-b]]'), 'note should include backlink wikilink');
  assert.ok(body.startsWith('---\ntags:\n'), 'stub starts with a tags frontmatter block');
  assert.ok(body.includes('  - type/source\n'));
  assert.ok(body.includes('  - freshness/fresh\n'), 'fixture source verified in-window is fresh');
  assert.ok(body.includes('Freshness as of 2026-06-01'));
});

test('obsidian never mutates the canonical entry (byte-identical)', () => {
  const dir = freshVault();
  const canon = join(dir, 'sources', '2026-01-01-a.md');
  const before = readFileSync(canon);
  obsidianView(dir);
  const after = readFileSync(canon);
  assert.equal(before.toString(), after.toString(), 'canonical entry must be byte-identical');
});

test('obsidian does not pollute the manifest and writes MOC.md', () => {
  const dir = freshVault();
  const before = buildManifest(dir).entries.length;
  obsidianView(dir);
  assert.equal(buildManifest(dir).entries.length, before, '_obsidian/ must not change manifest entry count');
  const moc = join(dir, '_obsidian', 'MOC.md');
  assert.ok(existsSync(moc), 'expected _obsidian/MOC.md to exist');
  assert.ok(readFileSync(moc, 'utf8').includes('[[2026-01-02-b]]'), 'MOC should list the synthesis entry');
});

test('obsidian groups forward Links by rel, one wikilink per rel', () => {
  const dir = freshVault();
  obsidianView(dir);
  const body = readFileSync(join(dir, '_obsidian', '2026-01-02-b.md'), 'utf8');
  const section = h => body.split(`### ${h}\n`)[1]?.split('###')[0] || '';
  for (const rel of ['related', 'contributing_ids']) {
    assert.equal(section(rel).split('[[2026-01-01-a]]').length - 1, 1, `source must appear exactly once under ### ${rel}`);
  }
});

test('obsidian snippet stub links its source under ### source_id', () => {
  const dir = tmpVault();
  put(dir, 'source', '2026-01-01-s', { source_type: 'article', source_url: 'https://e.com/s' });
  put(dir, 'snippet', '2026-01-02-p', { language: 'js', tested: false, source_id: '2026-01-01-s' });
  obsidianView(dir);
  const body = readFileSync(join(dir, '_obsidian', '2026-01-02-p.md'), 'utf8');
  assert.ok(body.includes('### source_id'));
  assert.ok(body.includes('[[2026-01-01-s]]'));
});

test('obsidian --out refuses canonical folders / escapes; default still works', () => {
  const dir = freshVault();
  const canon = join(dir, 'sources', '2026-01-01-a.md');
  const before = readFileSync(canon);
  assert.throws(() => obsidianView(dir, 'sources'), /refused/);
  assert.ok(readFileSync(canon).equals(before), 'canonical entry untouched after refused --out sources');
  assert.throws(() => obsidianView(dir, '..'), /refused/);
  assert.throws(() => obsidianView(dir, '.'), /refused/);
  assert.doesNotThrow(() => obsidianView(dir), 'default _obsidian still works');
});

const stub = (dir, id) => readFileSync(join(dir, '_obsidian', `${id}.md`), 'utf8');
const ver = date => [{ date, by_type: 'human', by_id: '', method: 'human-spot-check', result: 'confirmed', notes: '' }];

test('freshness tag: fast entry 200 days old is stale, volatile is stale, no volatility is unassessed', () => {
  const dir = tmpVault('rv-tags-');
  put(dir, 'source', '2026-01-01-old', { source_type: 'article', source_url: 'https://e.com/old', volatility: 'fast', verifications: ver('2026-01-01') });
  put(dir, 'source', '2026-01-02-vol', { source_type: 'article', source_url: 'https://e.com/vol', volatility: 'volatile', verifications: ver('2026-07-19') });
  put(dir, 'source', '2026-01-03-nov', { source_type: 'article', source_url: 'https://e.com/nov', volatility: undefined });
  obsidianView(dir, '_obsidian', { now: new Date('2026-07-20') });
  assert.ok(stub(dir, '2026-01-01-old').includes('  - freshness/stale\n'), 'string-vs-Date regression: 200 days past a 90-day window is stale');
  assert.ok(stub(dir, '2026-01-02-vol').includes('  - freshness/stale\n'));
  assert.ok(stub(dir, '2026-01-03-nov').includes('  - freshness/unassessed\n'));
});

test('topic tags are normalised to Obsidian-safe ASCII, deduplicated and sorted', () => {
  const dir = tmpVault('rv-tags-');
  put(dir, 'source', '2026-01-01-t', { source_type: 'article', source_url: 'https://e.com/t',
    topics: ['C++ Build Tools', 'a/b', 'snake_case-ok', 'Kubernetes', 'kubernetes!', '???', 'café'] });
  obsidianView(dir, '_obsidian', { now: NOW });
  const topics = stub(dir, '2026-01-01-t').split('---')[1].split('\n').filter(l => l.includes('topic/')).map(l => l.trim().slice(2));
  assert.deepEqual(topics, ['topic/a-b', 'topic/c-build-tools', 'topic/caf', 'topic/kubernetes', 'topic/snake_case-ok']);
});

test('obsidian writes one code note per linked file of the bound repo, wikilinks per symbol, pin as text', () => {
  const { vault } = codeRepo();
  const r = obsidianView(vault, '_obsidian', { now: NOW });
  assert.equal(r.code, 2);
  const a = readFileSync(join(vault, '_obsidian', 'code', 'src', 'a.lua.md'), 'utf8');
  assert.ok(a.includes('  - type/code\n'));
  assert.ok(a.includes('## f\n\n- [[2026-01-01-fx-doc]] (line 3)\n'));
  const b = readFileSync(join(vault, '_obsidian', 'code', 'src', 'b.lua.md'), 'utf8');
  assert.ok(b.includes('## ns.g\n\n- [[2026-01-01-fx-missing]] @dep=1.2.3 (line 1)\n'));
  assert.ok(readFileSync(join(vault, '_obsidian', 'MOC.md'), 'utf8').includes('## code (2)\n\n- [[code/src/a.lua]]\n- [[code/src/b.lua]]\n'));
  assert.equal(obsidianView(codeRepo({ code: false }).vault).code, 0, 'no code block, no code notes');
});

test('obsidian seeds .obsidian/graph.json once and never overwrites it', () => {
  const dir = freshVault();
  obsidianView(dir);
  const p = join(dir, '_obsidian', '.obsidian', 'graph.json');
  const g = JSON.parse(readFileSync(p, 'utf8'));
  assert.equal(g.search, '-file:MOC');
  assert.ok(g.colorGroups.some(c => c.query === 'tag:#type/code'));
  writeFileSync(p, '{"search":"mine"}');
  obsidianView(dir);
  assert.equal(readFileSync(p, 'utf8'), '{"search":"mine"}', 'a user-edited graph.json is kept');
});

function viewFixture(t, bound = false) {
  const repo = bound ? codeRepo() : null;
  const root = realpathSync(repo?.root ?? tmpVault('rv-view-links-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const vault = join(root, 'research');
  const id = bound ? '2026-01-01-fx-doc' : '2026-01-01-view';
  if (!bound) put(vault, 'source', id, { source_type: 'article', source_url: 'https://example.org/view' });
  const out = join(vault, '_obsidian');
  const outside = join(root, 'outside');
  mkdirSync(out);
  mkdirSync(outside);
  const sentinel = join(outside, 'sentinel');
  writeFileSync(sentinel, Buffer.from('unchanged\r\n\0fixture'));
  return { root, vault, out, outside, sentinel, id };
}

function viewLink(t, target, path, type = 'file') {
  try { symlinkSync(target, path, type); }
  catch (err) {
    if (process.platform !== 'win32' || !['EPERM', 'EACCES'].includes(err.code)) throw err;
    if (type === 'dir') symlinkSync(target, path, 'junction');
    else { t.skip(`File symlink unavailable (${err.code})`); return false; }
  }
  return true;
}

function unchanged(folder, file) {
  const names = readdirSync(folder).sort();
  const bytes = readFileSync(file);
  return () => {
    assert.deepEqual(readFileSync(file), bytes);
    assert.deepEqual(readdirSync(folder).sort(), names);
  };
}

const refusalMessage = (vault, path) => `${escapePathControls(relative(vault, path))}: path is outside the output directory or cannot be resolved`;
const viewRefused = (vault, path) => err => err.code === VAULT_PATH_OUTSIDE && err.message === refusalMessage(vault, path);

for (const layout of ['MOC', 'entry', 'settings directory', 'existing settings directory', 'dangling graph', 'existing graph', 'code directory', 'canonical entry']) {
  test(`obsidian destination refuses ${layout} resolving outside the output directory`, t => {
    const { vault, out, outside, sentinel, id } = viewFixture(t, layout === 'code directory');
    let target = sentinel;
    let path = join(out, layout === 'entry' || layout === 'canonical entry' ? `${id}.md` : 'MOC.md');
    let checked = path;
    let type = 'file';
    if (layout.includes('settings directory')) {
      target = outside;
      path = join(out, '.obsidian');
      checked = join(path, 'graph.json');
      type = 'dir';
      if (layout.startsWith('existing')) writeFileSync(join(outside, 'graph.json'), 'existing graph\r\n');
    } else if (layout.includes('graph')) {
      mkdirSync(join(out, '.obsidian'));
      path = checked = join(out, '.obsidian', 'graph.json');
      target = layout === 'dangling graph' ? join(outside, 'missing.json') : sentinel;
    } else if (layout === 'code directory') {
      target = outside;
      path = join(out, 'code');
      checked = join(path, 'src');
      type = 'dir';
    } else if (layout === 'canonical entry') {
      target = join(vault, 'sources', `${id}.md`);
    }
    if (!viewLink(t, target, path, type)) return;
    const checkOutside = unchanged(outside, sentinel);
    const checkTarget = layout === 'canonical entry' ? unchanged(dirname(target), target)
      : layout === 'existing settings directory' ? unchanged(outside, join(outside, 'graph.json')) : () => {};
    assert.throws(() => obsidianView(vault), viewRefused(vault, checked));
    checkOutside();
    checkTarget();
    if (layout === 'MOC') {
      assert.ok(existsSync(join(out, `${id}.md`)), 'earlier derived note remains');
      assert.equal(existsSync(join(out, '.obsidian')), false);
    }
  });
}

test('obsidian destination refuses a code note path leaving the output directory', t => {
  const { root, vault, outside, sentinel } = viewFixture(t, true);
  const nested = join(root, 'nested', 'repo');
  mkdirSync(nested, { recursive: true });
  const nestedVault = join(nested, 'research');
  cpSync(vault, nestedVault, { recursive: true });
  const code = join(outside, 'linked.lua');
  writeFileSync(code, '-- per 2026-01-01-fx-doc\nlocal function f()\nend\n');
  writeFileSync(join(nested, '.research-vault.json'), JSON.stringify({ vault: 'research', code: { globs: ['../../outside/*.lua'] } }));
  const checkOutside = unchanged(outside, sentinel);
  const checkVault = unchanged(nestedVault, join(nestedVault, 'sources', '2026-01-01-fx-doc.md'));
  // Two parent segments escape code/ and then the output directory.
  const destination = join(nestedVault, '_obsidian', 'code', '../../outside/linked.lua.md');
  assert.throws(() => obsidianView(nestedVault), viewRefused(nestedVault, dirname(destination)));
  checkOutside();
  checkVault();
  assert.equal(existsSync(destination), false);
  assert.deepEqual(readdirSync(join(nestedVault, '_obsidian')).sort(), buildManifest(nestedVault).entries.map(e => `${e.id}.md`).sort());
});

test('obsidian destination refuses an outside MOC through the CLI', t => {
  const { vault, out, outside, sentinel, id } = viewFixture(t);
  const path = join(out, 'MOC.md');
  if (!viewLink(t, sentinel, path)) return;
  const checkOutside = unchanged(outside, sentinel);
  const cli = fileURLToPath(new URL('../bin/research-vault.mjs', import.meta.url));
  const result = spawnSync(process.execPath, [cli, 'obsidian', '--vault', vault], { cwd: vault, env: testEnv(), encoding: 'utf8' });
  assert.equal(result.status, 2, result.stderr);
  assert.equal(result.stderr, `error: ${refusalMessage(vault, path)}\n`);
  assert.equal(result.stdout, '');
  assert.throws(() => obsidianView(vault), viewRefused(vault, path));
  checkOutside();
  assert.ok(existsSync(join(out, `${id}.md`)));
});

test('obsidian destination refuses an outside MOC with escaped output path controls', t => {
  const { vault, outside, sentinel } = viewFixture(t);
  const name = '_view\u2028';
  const out = join(vault, name);
  mkdirSync(out);
  const path = join(out, 'MOC.md');
  if (!viewLink(t, sentinel, path)) return;
  const checkOutside = unchanged(outside, sentinel);
  assert.throws(() => obsidianView(vault, name), err => {
    assert.equal(err.code, VAULT_PATH_OUTSIDE);
    assert.equal(err.message, '_view\\u2028/MOC.md: path is outside the output directory or cannot be resolved');
    assert.equal(err.message.includes('\u2028'), false);
    return true;
  });
  checkOutside();
});

for (const layout of ['MOC', 'settings directory', 'graph', 'vault root']) {
  test(`obsidian destination allows an inside ${layout} link`, t => {
    const { root, vault, out, id } = viewFixture(t);
    let viewRoot = vault;
    let target;
    if (layout === 'vault root') {
      viewRoot = join(root, 'alias');
      viewLink(t, vault, viewRoot, 'dir');
    } else if (layout === 'settings directory') {
      target = join(out, 'settings');
      mkdirSync(target);
      viewLink(t, target, join(out, '.obsidian'), 'dir');
    } else {
      target = join(out, 'saved');
      writeFileSync(target, 'saved bytes\r\n');
      if (layout === 'graph') mkdirSync(join(out, '.obsidian'));
      if (!viewLink(t, target, layout === 'MOC' ? join(out, 'MOC.md') : join(out, '.obsidian', 'graph.json'))) return;
    }
    obsidianView(viewRoot);
    assert.ok(existsSync(join(out, `${id}.md`)));
    assert.ok(existsSync(join(out, '.obsidian', 'graph.json')));
    if (layout === 'MOC') assert.ok(readFileSync(target, 'utf8').includes(`[[${id}]]`));
    if (layout === 'graph') assert.equal(readFileSync(target, 'utf8'), 'saved bytes\r\n');
  });
}

for (const layout of ['vault root', 'index', 'nested parent', 'file']) {
  test(`obsidian output location refuses ${layout}`, t => {
    const { vault, out, id } = viewFixture(t);
    rmSync(out, { recursive: true });
    const entry = join(vault, 'sources', `${id}.md`);
    let name = '_obsidian';
    let checkTarget = () => {};
    if (layout === 'vault root') {
      if (!viewLink(t, entry, join(vault, `${id}.md`))) return;
      viewLink(t, '.', out, 'dir');
    } else if (layout === 'file') {
      writeFileSync(out, 'not a directory');
      checkTarget = unchanged(vault, out);
    } else {
      const target = join(vault, '_index');
      mkdirSync(target);
      const file = join(target, 'keep');
      writeFileSync(file, 'index bytes\r\n');
      if (layout === 'nested parent') name = 'a/b';
      viewLink(t, target, layout === 'index' ? out : join(vault, 'a'), 'dir');
      checkTarget = unchanged(target, file);
    }
    const checkVault = unchanged(vault, entry);
    assert.throws(() => obsidianView(vault, name), {
      code: VAULT_PATH_OUTSIDE,
      message: `obsidian refused: --out must be a directory and must not be or pass through a link (got ${name})`,
    });
    checkVault();
    checkTarget();
  });
}

test('obsidian refuses a canonical folder linked inside output before overwriting an entry', t => {
  const { vault, out } = viewFixture(t, true);
  const target = join(out, 'code', 'src');
  mkdirSync(target, { recursive: true });
  const entry = join(target, 'a.lua.md');
  cpSync(join(vault, 'notes', '2026-01-01-old.md'), entry);
  rmSync(join(vault, 'notes'), { recursive: true });
  viewLink(t, target, join(vault, 'notes'), 'dir');
  const checkEntry = unchanged(target, entry);
  const names = readdirSync(out, { recursive: true }).sort();
  assert.throws(() => obsidianView(vault), {
    message: 'obsidian refused: canonical folder notes must not be inside --out',
  });
  checkEntry();
  assert.deepEqual(readdirSync(out, { recursive: true }).sort(), names);
});

test('obsidian output location allows missing nested directories after normalization', t => {
  const { vault, id } = viewFixture(t);
  obsidianView(vault, 'unused/../a/b');
  assert.ok(existsSync(join(vault, 'a', 'b', `${id}.md`)));
  assert.ok(existsSync(join(vault, 'a', 'b', '.obsidian', 'graph.json')));
  assert.equal(existsSync(join(vault, 'unused')), false);
});

test('obsidian destination refuses a code note file link outside output', t => {
  const { vault, out, outside, sentinel } = viewFixture(t, true);
  const path = join(out, 'code', 'src', 'a.lua.md');
  mkdirSync(dirname(path), { recursive: true });
  if (!viewLink(t, sentinel, path)) return;
  const checkOutside = unchanged(outside, sentinel);
  assert.throws(() => obsidianView(vault), viewRefused(vault, path));
  checkOutside();
});

test('obsidian destination refuses MOC linked to a non-entry vault file', t => {
  const { vault, out } = viewFixture(t);
  const file = join(vault, 'keep.txt');
  writeFileSync(file, 'vault root bytes\r\n');
  const path = join(out, 'MOC.md');
  if (!viewLink(t, file, path)) return;
  const checkVault = unchanged(vault, file);
  assert.throws(() => obsidianView(vault), viewRefused(vault, path));
  checkVault();
});

for (const outside of [false, true]) {
  test(`obsidian output location escapes controls in ${outside ? 'outside' : 'linked'} refusal`, t => {
    const { vault } = viewFixture(t);
    const name = outside ? '../outside\u2028' : '_view\u2028';
    if (!outside) viewLink(t, '.', join(vault, name), 'dir');
    assert.throws(() => obsidianView(vault, name), err => {
      assert.equal(err.message, outside
        ? 'obsidian refused: --out must be inside the vault (got ../outside\\u2028)'
        : 'obsidian refused: --out must be a directory and must not be or pass through a link (got _view\\u2028)');
      assert.equal(err.message.includes('\u2028'), false);
      if (!outside) assert.equal(err.code, VAULT_PATH_OUTSIDE);
      return true;
    });
  });
}
