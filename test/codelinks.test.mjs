import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdirSync, mkdtempSync, readdirSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { ID_RE } from '../bin/lib/citations.mjs';
import {
  LANGS, LINK_RE, langFor, codeFiles, extractCodeLinks, unitText, codeUnits, codeUnitHashes, readVersions, checkCodeLinks, worstStatus,
} from '../bin/lib/codelinks.mjs';
import { parseProjectConfig, compilePattern } from '../bin/lib/projectconfig.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const LUA = LANGS['.lua'];
const SCHEMA = { taxonomy: { volatility: { fast: { refresh_after_days: 90 }, stable: { refresh_after_days: 1095 }, volatile: { refresh_after_days: 0 } } } };
const ID = '2026-01-01-some-entry';
const ID2 = '2026-02-02-other-entry';
const links = (text) => extractCodeLinks(text, LUA).map(({ id, key, version, symbol }) => ({ id, key, version, symbol }));

// One input per supported form and the link or symbol it must yield; no count floors.
const SAMPLES = [
  [`-- see ${ID}\nfunction ns.X(a)\nend\n`, [{ id: ID, key: null, version: null, symbol: 'ns.X' }]],
  [`-- see ${ID}\nlocal function f()\nend\n`, [{ id: ID, key: null, version: null, symbol: 'f' }]],
  [`-- see ${ID}\nlocal T = {\n}\n`, [{ id: ID, key: null, version: null, symbol: 'T' }]],
  [`-- see ${ID}\nns.X = function(a) end\n`, [{ id: ID, key: null, version: null, symbol: 'ns.X' }]],
  [`-- see ${ID}\nfunction a.b:c(x)\nend\n`, [{ id: ID, key: null, version: null, symbol: 'a.b:c' }]],
  [`-- see ${ID}\nns.GrayLevel = grayLevel\n`, [{ id: ID, key: null, version: null, symbol: 'ns.GrayLevel' }]],
  [`-- per ${ID}@dep=1.2.3\nfunction ns.X()\nend\n`, [{ id: ID, key: 'dep', version: '1.2.3', symbol: 'ns.X' }]],
  [`-- per ${ID}@dep=1.2.3.\nfunction ns.X()\nend\n`, [{ id: ID, key: 'dep', version: '1.2.3', symbol: 'ns.X' }]],
  [`-- ${ID} and ${ID2}@dep=7\nfunction ns.X()\nend\n`, [{ id: ID, key: null, version: null, symbol: 'ns.X' }, { id: ID2, key: 'dep', version: '7', symbol: 'ns.X' }]],
  [`-- ${ID}\n-- ${ID2}\nfunction ns.X()\nend\n`, [{ id: ID, key: null, version: null, symbol: 'ns.X' }, { id: ID2, key: null, version: null, symbol: 'ns.X' }]],
  [`-- ${ID}\n\nfunction ns.X()\nend\n`, [{ id: ID, key: null, version: null, symbol: 'ns.X' }]],
];
test('every supported link form yields its link and symbol', () => {
  for (const [text, want] of SAMPLES) assert.deepEqual(links(text), want, text);
});

// One row per "cannot see" item of spec 15 D1: no link, or a link with no symbol.
const NEGATIVE = [
  [`local x = 1 -- see ${ID}\n`, []],
  [`--[[ long comment ${ID} ]]\nfunction f()\nend\n`, []],
  [`--[[\n  ${ID}\n]]\nfunction f()\nend\n`, []],
  [`-- ${ID}\n  local function nested()\n  end\n`, [{ id: ID, key: null, version: null, symbol: null }]],
  [`local s = "${ID}"\n`, []],
  [`-- ${ID}\nx == 1\n`, [{ id: ID, key: null, version: null, symbol: null }]],
  [`-- ${ID}\nlocal a, b = f()\n`, [{ id: ID, key: null, version: null, symbol: null }]],
  [`-- ${ID}\nlocal pending\n`, [{ id: ID, key: null, version: null, symbol: null }]],
  [`-- ${ID}\n`, [{ id: ID, key: null, version: null, symbol: null }]],
];
test('what the Lua row cannot see yields no link or an unattached one', () => {
  for (const [text, want] of NEGATIVE) assert.deepEqual(links(text), want, text);
});

test('a string literal on a declaration line declares the variable, nothing else', () => {
  assert.deepEqual(links(`-- ${ID}\nlocal s = "function fake("\n`), [{ id: ID, key: null, version: null, symbol: 's' }]);
});

// Hash invariants, from one inline file: what the unit hash sees and does not see.
const BASE = [
  'local _, ns = ...', '',
  '-- header', `-- per ${ID}`, 'local function clear()', '  return 1', 'end', '',
  'local function pinWorld(a)', '  return false', 'end', '',
  `-- per ${ID}@dep=1`, 'function ns.PinRoute(r)', '  local s = r[1]', '  return clear()', 'end', '',
  'function ns.TogglePin()', '  return 2', 'end', '',
].join('\n');
const swap = (from, to) => BASE.replace(from, to);
test('unit hashes see a body edit and nothing else: a move, a neighbour edit, a pin bump, a pinned neighbour', () => {
  const base = codeUnitHashes(BASE, LUA);
  assert.deepEqual(Object.keys(base), ['sym:clear', 'sym:ns.PinRoute']);
  const block = `-- per ${ID}@dep=1\nfunction ns.PinRoute(r)\n  local s = r[1]\n  return clear()\nend\n`;
  const moved = BASE.replace(block + '\n', '') + '\n' + block;
  assert.equal(codeUnitHashes(moved, LUA)['sym:ns.PinRoute'], base['sym:ns.PinRoute'], 'moved block');
  assert.equal(codeUnitHashes(swap('  return false', '  return nil'), LUA)['sym:ns.PinRoute'], base['sym:ns.PinRoute'], 'neighbour edit');
  assert.notEqual(codeUnitHashes(swap('  local s = r[1]', '  local s = r[2]'), LUA)['sym:ns.PinRoute'], base['sym:ns.PinRoute'], 'body edit');
  assert.equal(codeUnitHashes(swap('@dep=1', '@dep=2'), LUA)['sym:ns.PinRoute'], base['sym:ns.PinRoute'], 'pin bump');
  const second = swap('function ns.TogglePin()', `-- per ${ID2}@dep=1\nfunction ns.TogglePin()`);
  const two = codeUnitHashes(second, LUA);
  assert.equal(two['sym:ns.PinRoute'], base['sym:ns.PinRoute'], 'a pinned declaration below');
  const bumped = codeUnitHashes(second.replace(`${ID2}@dep=1`, `${ID2}@dep=2`), LUA);
  assert.deepEqual(bumped, two, 'its pin bump');
  assert.equal(codeUnitHashes(swap('-- header', '-- header, edited'), LUA)['sym:clear'] === base['sym:clear'], false, 'a header contiguous with the citing comment is in the unit');
});

test('unitText runs from the comment block to the next declaration block, pins stripped, and a repeated name gets #', () => {
  assert.equal(unitText(BASE, LUA, 5), `-- header\n-- per ${ID}\nlocal function clear()\n  return 1\nend`);
  assert.equal(unitText(BASE, LUA, 14), `-- per ${ID}@dep\nfunction ns.PinRoute(r)\n  local s = r[1]\n  return clear()\nend`);
  assert.deepEqual(codeUnits(BASE, LUA).map((u) => [u.unit, u.start, u.end]), [['sym:clear', 3, 7], ['sym:ns.PinRoute', 13, 17]]);
  const dup = `-- ${ID}\nlocal function f()\nend\n-- ${ID2}\nlocal function f()\nend\n`;
  assert.deepEqual(Object.keys(codeUnitHashes(dup, LUA)), ['sym:f', 'sym:f#']);
  // A column-0 statement between two declarations belongs to the unit above it.
  const handler = `-- ${ID}\nlocal f = CreateFrame("Frame")\nf:RegisterEvent("X")\n\nfunction g()\nend\n`;
  assert.deepEqual(codeUnits(handler, LUA).map((u) => [u.start, u.end]), [[1, 3]]);
});

// ---- statuses ----
const ENTRIES = [
  { id: ID, volatility: 'fast', last_verified: '2026-05-20', status: 'active', superseded_by: null },
  { id: ID2, volatility: 'fast', last_verified: '2020-01-01', status: 'active', superseded_by: null },
  { id: '2026-03-03-gone', volatility: 'fast', last_verified: '2026-05-20', status: 'superseded', superseded_by: '2026-03-04-new' },
  { id: '2026-03-03-hot', volatility: 'volatile', last_verified: '2026-05-30', status: 'active', superseded_by: null },
];
const NOW = '2026-06-01';
const link = (id, key = null, version = null, symbol = 'f') => ({ line: 1, id, key, version, symbol, declLine: symbol ? 2 : null });
const status = (l, versions = { dep: '2' }) => { const r = checkCodeLinks([l], ENTRIES, SCHEMA, versions, NOW)[0]; return r.reason ? `${r.status} (${r.reason})` : r.status; };

test('checkCodeLinks: ok, uncovered, unattached and every stale reason', () => {
  assert.equal(status(link(ID)), 'ok');
  assert.equal(status(link(ID, 'dep', '2')), 'ok');
  assert.equal(status(link('2099-01-01-nope')), 'uncovered');
  assert.equal(status(link(ID, null, null, null)), 'unattached');
  assert.equal(status(link(ID2)), 'stale (time)');
  assert.equal(status(link(ID2, 'dep', '2')), 'ok', 'a pin selects the version rule over the time rule');
  assert.equal(status(link(ID, 'dep', '1')), 'stale (dep 1 -> 2)');
  assert.equal(status(link(ID, 'other', '1')), 'stale (no key other in code.versions)');
  assert.equal(status(link('2026-03-03-gone')), 'stale (superseded by 2026-03-04-new)');
  assert.equal(status(link('2026-03-03-hot', 'dep', '2')), 'stale (time)', 'a volatile entry is always stale, pinned or not');
  const row = checkCodeLinks([link(ID, 'dep', '1', 'ns.X')], ENTRIES, SCHEMA, { dep: '2' }, NOW)[0];
  assert.deepEqual(row, { type: 'id', value: ID, symbol: 'ns.X', line: 1, key: 'dep', version: '1', id: ID, volatility: 'fast', status: 'stale', reason: 'dep 1 -> 2' });
  assert.equal(worstStatus(checkCodeLinks([link(ID), link(ID, 'dep', '1'), link('2099-01-01-nope')], ENTRIES, SCHEMA, { dep: '2' }, NOW)), 'stale (dep 1 -> 2)');
  assert.equal(worstStatus([]), 'ok');
});

// ---- the binding ----
// vault null: the key is absent from the file.
const cfg = (code, vault = 'research') => parseProjectConfig(JSON.stringify(vault === null ? { code } : { vault, code }), SCHEMA);
const PY = { '.py': { comment: '^\\s*#(.*)$', decl: '^(?:async\\s+)?def\\s+(\\w+)|^class\\s+(\\w+)|^(\\w+)\\s*=(?!=)' } };

test('parseProjectConfig accepts the code block on a relative vault and compiles its patterns', () => {
  const c = cfg({ globs: ['src/**/*.lua'], languages: PY, versions: { dep: { file: 'deps.txt', pattern: '^dep (\\S+)' } } });
  assert.deepEqual(c.code.globs, ['src/**/*.lua']);
  assert.ok(c.code.languages['.py'].comment instanceof RegExp);
  assert.equal(c.code.versions.dep.file, 'deps.txt');
  assert.equal(c.code.versions.dep.pattern.flags, 'm');
  assert.deepEqual(cfg({}).code, { globs: [], languages: {}, versions: {} });
  assert.deepEqual(Object.keys(cfg({})), ['vault', 'defaults', 'references', 'gates', 'capture', 'taxonomyExtensions', 'code']);
});

test('parseProjectConfig rejects the code block on an absolute, empty, .. or absent vault', () => {
  const re = /invalid \.research-vault\.json: code links need a project-specific vault inside the repo \(a relative vault path\); this binding points at /;
  for (const vault of ['/home/me/Research', '', '../Research', 'a/../../b', null]) {
    assert.throws(() => cfg({ globs: [] }, vault), re, String(vault));
  }
  assert.throws(() => cfg({ globs: [] }, '/abs'), /this binding points at \/abs$/);
  assert.throws(() => cfg({ globs: [] }, null), /this binding points at \(none\)$/);
  assert.throws(() => cfg({ globs: 'x' }), /code\.globs must be an array of strings/);
  assert.throws(() => cfg([]), /code must be an object/);
  assert.throws(() => cfg({ versions: { dep: { pattern: 'x' } } }), /code\.versions\.dep must be \{ file, pattern \}/);
});

test('compilePattern names the field for a pattern that does not compile or has no capture group', () => {
  assert.throws(() => cfg({ languages: { '.py': { comment: '^#(.*)$', decl: '^def \\w+' } } }), /^Error: invalid \.research-vault\.json: code\.languages\["\.py"\]\.decl: pattern has no capture group$/);
  assert.throws(() => cfg({ languages: { '.py': { comment: '^#', decl: '^def (\\w+)' } } }), /code\.languages\["\.py"\]\.comment: pattern has no capture group/);
  assert.throws(() => cfg({ versions: { dep: { file: 'f', pattern: 'v(\\d+' } } }), /code\.versions\.dep\.pattern: Invalid regular expression/);
  assert.throws(() => cfg({ versions: { dep: { file: 'f', pattern: 'v\\d+' } } }), /code\.versions\.dep\.pattern: pattern has no capture group/);
  assert.equal(compilePattern('f', '(a)(b)', { groups: 2 }).source, '(a)(b)');
  assert.throws(() => compilePattern('f', '(a)', { groups: 2 }), /f: pattern has no capture group/);
  assert.throws(() => compilePattern('f', 7), /f must be a string/);
});

test('readVersions reads the first capture of the first match per key; a missing file or no match is a configuration error', () => {
  const repo = mkdtempSync(join(tmpdir(), 'rv-versions-'));
  writeFileSync(join(repo, 'deps.txt'), '# deps\nname: thing\ndep 4.2.0, 4.3.0\n');
  const c = (file) => cfg({ versions: { dep: { file, pattern: '^dep\\s*(\\S+?),?\\s' } } });
  assert.deepEqual(readVersions(c('deps.txt'), repo), { dep: '4.2.0' });
  assert.throws(() => readVersions(c('missing.txt'), repo), /^Error: versions\.dep: cannot read missing\.txt$/);
  assert.throws(() => readVersions(cfg({ versions: { dep: { file: 'deps.txt', pattern: '^nothing (\\d+)' } } }), repo), /^Error: versions\.dep: pattern matched nothing in deps\.txt$/);
  assert.deepEqual(readVersions(cfg({}), repo), {});
  assert.deepEqual(readVersions({}, repo), {});
});

// ---- D0 contracts ----
test('D0: the engine runs on a .py file whose only language row comes from code.languages', () => {
  const c = cfg({ globs: ['**/*.py'], languages: PY });
  assert.equal(LANGS['.py'], undefined, 'the plugin ships no Python row');
  const lang = langFor('.py', c);
  const text = `import os\n\n# per ${ID}@dep=3\ndef handler(evt):\n    return 1\n\n\nclass Thing:\n    pass\n\nLIMIT = 7\n`;
  assert.deepEqual(extractCodeLinks(text, lang).map(({ id, key, version, symbol, declLine }) => ({ id, key, version, symbol, declLine })),
    [{ id: ID, key: 'dep', version: '3', symbol: 'handler', declLine: 4 }]);
  assert.deepEqual(codeUnits(text, lang).map((u) => [u.unit, u.start, u.end]), [['sym:handler', 3, 5]]);
  assert.equal(unitText(text, lang, 4), `# per ${ID}@dep\ndef handler(evt):\n    return 1`);
});

test('D0: a project .lua row overrides the shipped one; a .py glob with no row is a configuration error', () => {
  const strict = cfg({ globs: ['**/*.lua'], languages: { '.lua': { comment: '^\\s*--(.*)$', decl: '^function\\s+([\\w.:]+)\\s*\\(' } } });
  assert.notEqual(langFor('.lua', strict), LUA);
  assert.deepEqual(extractCodeLinks(`-- ${ID}\nlocal T = {}\n`, langFor('.lua', strict)).map((l) => l.symbol), [null], 'the stricter row sees no table declaration');
  assert.equal(langFor('.lua', cfg({ globs: [] })), LUA);
  assert.equal(langFor('.lua', null), LUA);
  assert.throws(() => langFor('.py', cfg({ globs: ['**/*.py'] })), { message: 'no language for .py in code.globs; add code.languages[".py"] = { comment, decl }' });
});

test('D0: codelinks.mjs names no language outside LANGS, and LINK_RE is built from ID_RE', () => {
  const src = readFileSync(join(ROOT, 'bin', 'lib', 'codelinks.mjs'), 'utf8');
  const start = src.indexOf('export const LANGS = {');
  const end = src.indexOf('\n};\n', start);
  assert.ok(start > 0 && end > start);
  const outside = src.slice(0, start) + src.slice(end + 4);
  assert.doesNotMatch(outside, /\b(lua|python|zig|rust|typescript|javascript|java|ruby|perl|swift|kotlin|cpp|c\+\+)\b/i);
  assert.doesNotMatch(outside, /['"]\.(lua|py|zig|rs|ts|js|java|rb|go|c|h|cpp)['"]/);
  assert.ok(LINK_RE.source.startsWith(`(${ID_RE.source})`), LINK_RE.source);
  assert.equal(LINK_RE.flags, 'g');
});

test('codeFiles is empty without a code block and refuses a bound vault outside the repo', () => {
  const repo = mkdtempSync(join(tmpdir(), 'rv-codefiles-'));
  mkdirSync(join(repo, 'src'));
  mkdirSync(join(repo, 'research'));
  writeFileSync(join(repo, 'src', 'a.lua'), '');
  assert.deepEqual(codeFiles(parseProjectConfig(JSON.stringify({ vault: 'research' }), SCHEMA), repo), []);
  assert.deepEqual(codeFiles(null, repo), []);
  assert.deepEqual(codeFiles(cfg({ globs: ['src/*.lua'] }), repo), [join(repo, 'src', 'a.lua')]);
  const outside = mkdtempSync(join(tmpdir(), 'rv-outside-'));
  execFileSync('ln', ['-s', outside, join(repo, 'linked')]);
  assert.throws(() => codeFiles(cfg({ globs: ['src/*.lua'] }, 'linked'), repo), /code links need a project-specific vault inside the repo; .* resolves outside /);
});

// No project-specific name ships in the plugin: those stay in the spec, the vault and the acceptance clone.
test('bin/ and hooks/ carry no project name, language name outside LANGS or version format', () => {
  const walk = (d) => readdirSync(d).flatMap((n) => { const p = join(d, n); return statSync(p).isDirectory() ? walk(p) : [p]; });
  for (const f of [...walk(join(ROOT, 'bin')), ...walk(join(ROOT, 'hooks'))].filter((f) => ['.mjs', ''].includes(extname(f)))) {
    const text = readFileSync(f, 'utf8');
    assert.doesNotMatch(text, /\bwow\b|QuestRouter|\.toc\b|Interface:/i, f);
  }
});

test('docs/REFERENCE.md quotes the shipped Lua row verbatim', () => {
  const doc = readFileSync(join(ROOT, 'docs', 'REFERENCE.md'), 'utf8');
  assert.ok(doc.includes(`comment: /${LUA.comment.source}/,`), 'comment row');
  assert.ok(doc.includes(`decl: /${LUA.decl.source}/,`), 'decl row');
});
