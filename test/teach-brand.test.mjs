// Spec 50 commit 1: a workspace's brand/ on every served and exported page, on workspaces built here (nothing under
// test/fixtures/teach/); each test removes the directories it makes.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync, cpSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { request } from 'node:http';
import { once } from 'node:events';
import { spawn, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { fixtureVault, put } from './helpers.mjs';
import { recordVerdict } from '../bin/lib/gate.mjs';
import { createServer, exportWorkspace } from '../bin/lib/teach.mjs';
import { readBrand, BRAND_TOKENS } from '../bin/lib/brand.mjs';
import { buildManifest } from '../bin/lib/manifest.mjs';
import { loadSchema, loadTeachSchema } from '../bin/lib/schema.mjs';
import { lintWorkspace } from '../bin/lib/lesson.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const BIN = join(ROOT, 'bin', 'research-vault.mjs');
const FIX = join(ROOT, 'test', 'fixtures', 'teach');
const ASSETS = join(ROOT, 'skills', 'research-teach', 'assets');
const NOW = new Date('2026-10-26T09:00:00Z');
const sha = (b) => createHash('sha256').update(b).digest('hex');

// A bound repo holding learn-ws: the fixture lessons with the plugin's three assets, every lesson and reference page
// passed by the gate, and, when `brand` is given, brand/brand.json (an object, or a string written as it is) and `files`.
function brandRepo(brand, files = {}) {
  const repo = mkdtempSync(join(tmpdir(), 'rv-teach-brand-'));
  const vault = fixtureVault(join(repo, 'research'));
  put(vault, 'source', '2026-01-01-nope', { source_type: 'article', source_url: 'https://example.org/nope' });
  writeFileSync(join(repo, '.research-vault.json'), JSON.stringify({ vault: 'research' }) + '\n');
  const ws = join(repo, 'learn-ws');
  cpSync(FIX, ws, { recursive: true });
  mkdirSync(join(ws, 'assets'));
  for (const f of ['lesson.css', 'quiz.js', 'reading.html']) cpSync(join(ASSETS, f), join(ws, 'assets', f));
  for (const f of [...readdirSync(join(ws, 'lessons')).map((f) => `lessons/${f}`), 'reference/good.html']) recordVerdict(repo, join(ws, f), 'PASS');
  if (brand !== undefined) setBrand(ws, brand, files);
  return { repo, vault, ws };
}
function setBrand(ws, brand, files = {}) {
  rmSync(join(ws, 'brand'), { recursive: true, force: true });
  mkdirSync(join(ws, 'brand'));
  writeFileSync(join(ws, 'brand', 'brand.json'), typeof brand === 'string' ? brand : JSON.stringify(brand, null, 2));
  for (const [p, body] of Object.entries(files)) {
    mkdirSync(dirname(join(ws, 'brand', p)), { recursive: true });
    writeFileSync(join(ws, 'brand', p), body);
  }
}
const LESSONS = ['0001-good', '0002-bad', '0003-review-good', '0004-tool-fxctl', '0005-diagnose-fx', '0006-project-fx'].map((id) => `/lessons/${id}.html`);
const HTML_PATHS = ['/', '/progress', ...LESSONS, '/reference/good.html', '/assets/reading.html'];
const get = (port, path) => new Promise((res) => request({ host: '127.0.0.1', port, path, headers: { Host: `127.0.0.1:${port}` }, setHost: false }, (r) => {
  const c = [];
  r.on('data', (d) => c.push(d));
  r.on('end', () => res({ status: r.statusCode, body: Buffer.concat(c) }));
}).end());
// Each path's reply from a server on `ws` at NOW: { path: text }.
async function served(ws, paths = HTML_PATHS) {
  const server = createServer(ws, { schema: loadTeachSchema(ROOT), now: () => NOW });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  try {
    const out = {};
    for (const p of paths) {
      const r = await get(server.address().port, p);
      assert.equal(r.status, 200, p);
      out[p] = r.body.toString('utf8');
    }
    return out;
  } finally { server.close(); }
}
const exported = (repo) => exportWorkspace(join(repo.repo, 'learn-ws'), { vaultPath: repo.vault, entries: buildManifest(repo.vault).entries, env: {} });
const styleOf = (html) => /<style>\n([\s\S]*?)<\/style><\/head>/.exec(html)?.[1];
// teach lint's lines for the workspace, as the CLI prints them.
const lintLines = (repo) => lintWorkspace(repo.ws, {
  workspaceDir: repo.ws, vaultPath: repo.vault, entries: buildManifest(repo.vault).entries, schema: loadSchema(ROOT, { vaultPath: repo.vault }),
  teachSchema: loadTeachSchema(ROOT), now: NOW,
}).map((f) => `${f.warning ? 'warning ' : ''}${f.code}  ${f.file}: ${f.message}`);
// Replace `from`, which must occur once in the workspace file `rel`, with `to`.
const edit = (ws, rel, from, to) => {
  const t = readFileSync(join(ws, rel), 'utf8');
  assert.equal(t.split(from).length, 2, from);
  writeFileSync(join(ws, rel), t.replace(from, to));
};
const treeHash = (dir) => readdirSync(dir, { recursive: true }).sort().map((p) => { try { return `${p} ${sha(readFileSync(join(dir, p)))}`; } catch { return p; } }).join('\n');

// Computed at dffe549, the parent commit, by this file's brandRepo with no brand/ (scratch t11b/base-hashes.mjs).
const BASE_SERVED = {
  '/': 'c111d4926863e9ca09f35e69a57aac4547f3ee0b57ee648a81e6d5195e3245f2',
  '/progress': 'f637a583e3766f32883b8983e92a55845f246cab93c50582aca7bfb554652dc8',
  '/lessons.json': '062c18d9a1f28ee43ae29a952950a5ae199d69806f71ecdb278569b12b026f52',
  '/lessons/0001-good.html': '4dbd823d9927d5de1fc4074c6ca0dc6f921178480e7fbd5b1f5e49a44dca51b2',
  '/lessons/0002-bad.html': '6d016155a2fb4b0cdfac5d02b5d5c385a5ae9d9d81a6474aaf14d82cd7ba4b7e',
  '/lessons/0003-review-good.html': '16fab265248a5c7a1faad1cfabc5859fb7b219a4ba8ce61a33da12d6e89a87fa',
  '/lessons/0004-tool-fxctl.html': '70abeaa79974dbd49c085568528d42c08888fbf12aa49fa2dae6bae960e6722e',
  '/lessons/0005-diagnose-fx.html': 'af262c45ebeb079578a48df2157d41d9344012d163d4160a9550da459a9bc6f2',
  '/lessons/0006-project-fx.html': '47cf09e698eb9a107e2688745faa845bd809cbf45c75125846819544b690523c',
  '/reference/good.html': '0dcec77cfe8fe264f8c6ab0d67a1dc4997733f6b8aee98e1f544326310b287dd',
  '/assets/reading.html': 'aca943f8815f66d03d8b2e3cb35faee92aac427636effedae9019d4b2ce97a1e',
};
const BASE_EXPORTED = {
  'lessons/0001-good.html': '9d12d40a12a086869ecfc2dd450c8a0cac96568c97bb4088e3e7c5ef51432295',
  'lessons/0002-bad.html': 'bfdbeafc0ebe1a80f001a4411dadbbfbe8c702748f77b89419abff08d86a21e9',
  'lessons/0003-review-good.html': '4185234629aa33e94196e99fc9d1eeac53b94a9b20125f6fffcb63b7de3f4b32',
  'lessons/0004-tool-fxctl.html': '271d2d91bed1415d5f4af940f2e217589a595280d158b94135c5bd12acd0d3a3',
  'lessons/0005-diagnose-fx.html': '2eac32fa2425c7c769f5bed8de6a8135949a90433421aae4d9a500b7784ed27f',
  'lessons/0006-project-fx.html': '03fec945b3fa74ba0bca441c614c9d81da5ce075b3af57d6cef48748388d3978',
  'reference/good.html': '93759de0f2042134079b0c91b073a35d71762572fa5a005730448eea056b1c2c',
  'index.html': '6b4966adf46d9d0a5bc8e34e7bc9655a8588f99753198924502ff56753f31f5e',
  'progress.html': 'f8685389274ac9669710265d851e66beeb002ca5a1bef6329cedf05a92c30603',
  'assets/reading.html': '52fd319a6d394e5524f362404f97f919633fe46a8a7b00003437ab9a9eed0b4a',
  'assets/quiz.js': 'eda7aa95b6cd79d14cc9eb0cfd2e28a217c118d6677049a15b60c0719f4d0e60',
  'assets/lesson.css': '5c7a7c12b9c3aac3a203b83a588340a8676dcfa9afabe8b9df5304c038585041',
  'GLOSSARY.md': 'efcfcb71409f5fb07a868cbf663d9d284bfd66c61fa96d4592b2976277edf920',
  'sources.html': 'e4fabb4e2cab93fcd5e939bf5937c49e4df93f6aea816269f43f14e5c700c6d2',
};

const SVG = (fill) => `<svg xmlns="http://www.w3.org/2000/svg" width="40" height="20"><rect width="40" height="20" fill="${fill}"/></svg>`;
const LOGO_FILES = { 'logo.svg': SVG('#c2410c'), 'img/logo-dark.svg': SVG('#fdba74'), 'favicon.png': 'png' };
const TWO_COLOURS = {
  name: 'Acme <A&B> "Co"', favicon: 'favicon.png',
  logo: { light: 'logo.svg', dark: 'img/logo-dark.svg', alt: 'Acme <logo> & "mark"' },
  color: { light: { '--link': '#c2410c', '--bg': '#fafaf0' } },
};

test('with no brand/ folder every served reply and every exported file has its bytes at the parent commit (spec 50 test 1)', async () => {
  const repo = brandRepo();
  try {
    const s = await served(repo.ws, Object.keys(BASE_SERVED));
    assert.deepEqual(Object.fromEntries(Object.entries(s).map(([p, t]) => [p, sha(t)])), BASE_SERVED);
    const ex = exported(repo);
    assert.equal(ex.code, 0, ex.lines.join('\n'));
    assert.deepEqual(Object.fromEntries([...ex.files].map(([p, b]) => [p, sha(b)])), BASE_EXPORTED);
    assert.deepEqual(readBrand(repo.ws), { brand: null, problems: [] });
  } finally { rmSync(repo.repo, { recursive: true, force: true }); }
});

test('a logo and two colours reach every served page and every exported page, logo and favicon relative, nothing fetched; lessons/ and assets/ unchanged (spec 50 test 2)', async () => {
  const repo = brandRepo(TWO_COLOURS, LOGO_FILES);
  try {
    const before = treeHash(join(repo.ws, 'lessons')) + treeHash(join(repo.ws, 'assets'));
    const s = await served(repo.ws);
    const header = '<header class="brand-header"><a href="/"><img class="brand-logo-light" src="/brand/logo.svg" alt="Acme &lt;logo&gt; &amp; &quot;mark&quot;">' +
      '<img class="brand-logo-dark" src="/brand/img/logo-dark.svg" alt="Acme &lt;logo&gt; &amp; &quot;mark&quot;"></a><span class="brand-name">Acme &lt;A&amp;B&gt; &quot;Co&quot;</span></header>';
    for (const [p, html] of Object.entries(s)) {
      assert.match(styleOf(html), /^:root \{ --link: #c2410c; --bg: #fafaf0; \}$/m, p);
      assert.ok(html.includes('<link rel="icon" href="/brand/favicon.png"><style>'), p);
      assert.equal(html.split(header).length, 2, `${p}: one header`);
      assert.ok(!html.includes('<A&B>'), p);
      // After the nav bar the server put there, or right after <body> on a page that loads quiz.js (which prepends its bar).
      if (/<script[^>]*quiz\.js/.test(html)) assert.match(html, /<body\b[^>]*>(<header class="brand-header">)/, p);
      else assert.ok(html.includes(`</nav>${header}`), p);
    }
    const files = await served(repo.ws, ['/brand/logo.svg', '/brand/img/logo-dark.svg', '/brand/brand.json']);
    assert.equal(files['/brand/logo.svg'], LOGO_FILES['logo.svg']);
    const ex = exported(repo);
    assert.equal(ex.code, 0, ex.lines.join('\n'));
    for (const p of ['brand/brand.json', 'brand/logo.svg', 'brand/img/logo-dark.svg', 'brand/favicon.png']) assert.ok(ex.files.has(p), p);
    for (const [p, body] of ex.files) {
      if (!p.endsWith('.html')) continue;
      const html = body.toString('utf8');
      const up = '../'.repeat(p.split('/').length - 1);
      assert.match(styleOf(html), /^:root \{ --link: #c2410c; --bg: #fafaf0; \}$/m, p);
      assert.ok(html.includes(`<link rel="icon" href="${up}brand/favicon.png">`), p);
      assert.ok(html.includes(`<a href="${up}index.html"><img class="brand-logo-light" src="${up}brand/logo.svg"`), p);
      assert.ok(html.includes(`src="${up}brand/img/logo-dark.svg"`), p);
      assert.match(html, /<\/nav><header class="brand-header">/, `${p}: the bar first`);
      const brandParts = styleOf(html) + /<header class="brand-header">[\s\S]*?<\/header>/.exec(html)[0];
      assert.doesNotMatch(brandParts, /url\(|\/\/|src="\/|href="\//, p);
    }
    assert.equal(treeHash(join(repo.ws, 'lessons')) + treeHash(join(repo.ws, 'assets')), before);
  } finally { rmSync(repo.repo, { recursive: true, force: true }); }
});

test('light values under :root, dark values under both dark selectors, a light-only token in no dark rule; lesson.css names colours in the quiz, progress-table and figure rules only through var(-- (spec 50 test 3)', async () => {
  const repo = brandRepo({ color: { light: { '--link': '#c2410c', '--c-quiz': '#0f766e' }, dark: { '--link': '#fdba74', '--bg': '#101010' } } });
  try {
    const style = styleOf((await served(repo.ws, ['/']))['/']);
    const dark = '--link: #fdba74; --bg: #101010;';
    assert.ok(style.startsWith(`:root { --link: #c2410c; --c-quiz: #0f766e; }
@media (prefers-color-scheme: dark) { :root:not([data-theme="light"]) { ${dark} } }
:root[data-theme="dark"] { ${dark} }
`), style);
    assert.equal(style.split('--c-quiz').length, 2, 'set for light only: in the :root rule only');
    assert.equal(BRAND_TOKENS.length, 23);
    const css = readFileSync(join(ASSETS, 'lesson.css'), 'utf8');
    const rules = [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].filter(([, sel]) => /quiz|table\.progress|figure/.test(sel) && !sel.includes(':root'));
    assert.ok(rules.length > 10, `${rules.length} rules`);
    for (const [, sel, body] of rules) assert.doesNotMatch(body, /#[0-9a-f]{3}|rgb\(|hsl\(/i, sel.trim());
  } finally { rmSync(repo.repo, { recursive: true, force: true }); }
});

test('the footer: the audience\'s classification, the copyright with the server\'s year, and lesson N of M on a lesson; a new audience changes the classification only (spec 50 test 4)', async () => {
  const footer = { classification: { internal: 'Internal <only>', customer: 'Customer copy' }, copyright: '(c) {year} Acme & Co' };
  const repo = brandRepo({ footer, audience: 'internal' });
  try {
    const one = await served(repo.ws);
    for (const [p, html] of Object.entries(one)) {
      const i = LESSONS.indexOf(p);
      const pos = i === -1 ? '' : `<span>lesson ${i + 1} of ${LESSONS.length}</span>`;
      assert.ok(html.includes(`<footer class="brand-footer"><span>Internal &lt;only&gt;</span> <span>(c) 2026 Acme &amp; Co</span>${pos && ` ${pos}`}</footer></body>`), p);
      assert.equal(html.split('brand-footer').length, 3, `${p}: one footer element (the class is also in the style)`);
    }
    assert.doesNotMatch(one['/'], /<header/, 'no name and no logo: no header');
    setBrand(repo.ws, { footer, audience: 'customer' });
    const two = await served(repo.ws);
    for (const p of HTML_PATHS) assert.equal(two[p], one[p].replace('<span>Internal &lt;only&gt;</span>', '<span>Customer copy</span>'), p);
    const ex = exported(repo);
    assert.equal(ex.code, 0, ex.lines.join('\n'));
    assert.ok(ex.files.get('lessons/0002-bad.html').includes(`<span>(c) ${new Date().getFullYear()} Acme &amp; Co</span> <span>lesson 2 of 6</span></footer></body>`));
  } finally { rmSync(repo.repo, { recursive: true, force: true }); }
});

test('colours and families written as references into a design-tokens file, one through two aliases, serve the same bytes as written by hand; a cycle is BRAND_INVALID (spec 50 test 6)', async () => {
  const tokens = {
    color: { orange: { $type: 'color', $value: '#ff6600' }, primary: { $value: '{color.orange}' }, link: { $value: '{color.primary}' }, night: { $value: { hex: '#101010' } } },
    font: { body: { $value: ['Georgia', 'serif'] }, code: { $value: 'Menlo, monospace' } },
  };
  const byRef = { tokens: 'tokens.json', color: { light: { '--link': '{color.link}' }, dark: { '--bg': '{color.night}' } }, font: { body: '{font.body}', code: '{font.code}' } };
  const byHand = { color: { light: { '--link': '#ff6600' }, dark: { '--bg': '#101010' } }, font: { body: 'Georgia, serif', code: 'Menlo, monospace' } };
  const repo = brandRepo(byRef, { 'tokens.json': JSON.stringify(tokens) });
  try {
    const a = await served(repo.ws);
    setBrand(repo.ws, byHand);
    const b = await served(repo.ws);
    assert.deepEqual(a, b);
    assert.match(styleOf(a['/']), /^body, a\.cite, a\[data-cite\]:not\(\.cite\):not\(\[href\]\) \{ font-family: Georgia, serif; \}$/m);
    assert.match(styleOf(a['/']), /^code, pre \{ font-family: Menlo, monospace; \}$/m);
    setBrand(repo.ws, { tokens: 'tokens.json', color: { light: { '--link': '{a}' } } }, { 'tokens.json': JSON.stringify({ a: { $value: '{b}' }, b: { $value: '{a}' } }) });
    const { brand, problems } = readBrand(repo.ws);
    assert.equal(brand, null);
    assert.deepEqual(problems, [{ code: 'BRAND_INVALID', message: 'color.light.--link: {a}: more than eight aliases' }]);
    // Eight aliases are followed; a ninth is too many.
    const chain = Object.fromEntries(Array.from({ length: 10 }, (_, i) => [`t${i}`, { $value: i === 9 ? '#123456' : `{t${i + 1}}` }]));
    setBrand(repo.ws, { tokens: 'tokens.json', color: { light: { '--link': '{t1}' } } }, { 'tokens.json': JSON.stringify(chain) });
    assert.equal(readBrand(repo.ws).brand.color.light['--link'], '#123456');
    setBrand(repo.ws, { tokens: 'tokens.json', color: { light: { '--link': '{t0}' } } }, { 'tokens.json': JSON.stringify(chain) });
    assert.equal(readBrand(repo.ws).problems[0].message, 'color.light.--link: {t0}: more than eight aliases');
  } finally { rmSync(repo.repo, { recursive: true, force: true }); }
});

test('brand lint: each BRAND_ code an error naming the path, token, colour or term; a term in <code> or <pre> is not reported; without brand/ the findings are as before and a figure colour is WARN_FIGURE_COLOR (spec 50 test 7)', () => {
  const repo = brandRepo();
  const L = 'lessons/0001-good.html';
  try {
    edit(repo.ws, L, '<p>The body of fx is <code>return n * 6;</code>.', '<p>The Zorblax body of fx is <code>Quuxly n * 6;</code>.');
    edit(repo.ws, L, 'export function fx(n)', 'export function Quuxly(n)');
    edit(repo.ws, L, '<rect x="70" y="15" width="60" height="30" fill="none"', '<rect x="70" y="15" width="60" height="30" fill="#ff0000"');
    edit(repo.ws, L, '</head>', '<style>#abc { color: rgb(1, 2, 3); }\n@media print { p { background: #ABCDEF; } }</style></head>');
    edit(repo.ws, 'reference/good.html', '<h1>The fixture note</h1>', '<h1 style="color: hsl(10, 50%, 50%)">The fixture note</h1>');
    const base = lintLines(repo);
    const figure = `${L}: figure 1: fill or stroke #ff0000; use currentColor, none or var(--muted)`;
    assert.ok(base.includes(`warning WARN_FIGURE_COLOR  ${figure}`), base.join('\n'));
    assert.ok(!base.some((l) => l.includes('BRAND_')));
    const offPalette = [
      `BRAND_OFF_PALETTE  ${figure}`,
      `BRAND_OFF_PALETTE  ${L}: colour rgb(1, 2, 3) in a style attribute or <style> element; use a var(--token) the brand sets`,
      `BRAND_OFF_PALETTE  ${L}: colour #ABCDEF in a style attribute or <style> element; use a var(--token) the brand sets`,
      'BRAND_OFF_PALETTE  reference/good.html: colour hsl(10, 50%, 50%) in a style attribute or <style> element; use a var(--token) the brand sets',
    ];
    // The lines a brand adds to the base, and the base lines it takes away.
    const diff = (brand, files) => {
      setBrand(repo.ws, brand, files);
      const got = lintLines(repo);
      return { added: got.filter((l) => !base.includes(l)), removed: base.filter((l) => !got.includes(l)) };
    };
    const brandOnly = (brand, files) => {
      const { added, removed } = diff(brand, files);
      assert.deepEqual(removed, [`warning WARN_FIGURE_COLOR  ${figure}`]);
      assert.deepEqual(added.filter((l) => l.startsWith('BRAND_OFF_PALETTE')).sort(), offPalette.slice().sort());
      assert.ok(added.every((l) => l.startsWith('BRAND_')), added.join('\n'));
      return added.filter((l) => !l.startsWith('BRAND_OFF_PALETTE'));
    };
    const J = 'brand/brand.json';
    assert.deepEqual(brandOnly({}), []);
    assert.deepEqual(brandOnly({ logo: { light: 'img/logo.svg', alt: 'Logo' } }), [`BRAND_FILE_MISSING  ${J}: logo.light: brand/img/logo.svg is not a regular file`]);
    assert.deepEqual(brandOnly({ name: 'X', colour: {} }), [`BRAND_INVALID  ${J}: brand.json: unknown key colour`]);
    assert.deepEqual(brandOnly({ color: { light: { '--brand-primary': '#ff6600' } } }), [`BRAND_TOKEN_UNKNOWN  ${J}: color.light: --brand-primary is not a token of lesson.css`]);
    assert.deepEqual(brandOnly({ logo: { light: 'logo.svg' } }, { 'logo.svg': SVG('#000') }), [`BRAND_ALT_MISSING  ${J}: logo has no non-empty alt; set logo.alt to the text the logo shows`]);
    const contrast = brandOnly({ color: { light: { '--ink': '#f6f7fa' } } });
    assert.equal(contrast.length, 6, contrast.join('\n'));
    assert.ok(contrast.includes(`BRAND_CONTRAST  ${J}: light: --ink #f6f7fa on --bg #f6f7fa is 1.00:1, under 4.5:1`), contrast.join('\n'));
    assert.ok(contrast.every((l) => l.startsWith(`BRAND_CONTRAST  ${J}: light: --ink #f6f7fa on --`)));
    assert.deepEqual(brandOnly({ color: { light: { '--link': '#777777' } } }), [
      `BRAND_CONTRAST  ${J}: light: --link #777777 on --bg #f6f7fa is 4.18:1, under 4.5:1`,
      `BRAND_CONTRAST  ${J}: light: --link #777777 on --card #ffffff is 4.48:1, under 4.5:1`,
    ]);
    assert.deepEqual(brandOnly({ color: { dark: { '--link': '#333' } } }), [
      `BRAND_CONTRAST  ${J}: dark: --link #333 on --bg #0b1020 is 1.50:1, under 4.5:1`,
      `BRAND_CONTRAST  ${J}: dark: --link #333 on --card #131a33 is 1.36:1, under 4.5:1`,
    ]);
    // Case-sensitive and whole-word; Quuxly is only in a <code> and a <pre>.
    assert.deepEqual(brandOnly({ voice: { avoid: [{ term: 'Zorblax', use: 'the' }, { term: 'Quuxly' }, { term: 'ZORBLAX' }, { term: 'Zorbla' }] } }),
      [`BRAND_VOICE  ${L}: uses "Zorblax"; use "the" (brand voice.avoid)`]);
    // teach lint exits 1 on an invalid brand.json and prints the code.
    setBrand(repo.ws, '{');
    const r = spawnSync(process.execPath, [BIN, 'teach', 'lint', repo.ws], { encoding: 'utf8' });
    assert.equal(r.status, 1);
    assert.ok(r.stdout.split('\n').includes(`BRAND_INVALID  ${J}: brand/brand.json is not JSON`), r.stdout);
    rmSync(join(repo.ws, 'brand'), { recursive: true });
    assert.deepEqual(lintLines(repo), base);
  } finally { rmSync(repo.repo, { recursive: true, force: true }); }
});

test('two unrelated brands serve, export and lint through the same code; neither brand\'s name, colours or terms are in bin/ or the plugin\'s assets (spec 50 test 8)', async () => {
  const brands = [
    { name: 'Quillfeather Guild', color: { light: { '--ink': '#1a2b3c' }, dark: { '--ink': '#d4e5f6' } }, font: { body: 'Gill Sans, sans-serif' }, voice: { avoid: [{ term: 'Frobnicator', use: 'tool' }] } },
    { name: 'Brightmoor Assembly', color: { light: { '--mark': '#f1e2d3' } }, font: { code: 'Courier New' }, voice: { avoid: [{ term: 'Wibblewidget' }] } },
  ];
  const repo = brandRepo();
  try {
    for (const b of brands) {
      setBrand(repo.ws, b);
      const s = await served(repo.ws, ['/', LESSONS[0]]);
      for (const html of Object.values(s)) assert.ok(html.includes(`<span class="brand-name">${b.name}</span>`) && styleOf(html).includes(Object.values(b.color.light)[0]));
      const ex = exported(repo);
      assert.equal(ex.code, 0, ex.lines.join('\n'));
      assert.ok(ex.files.get('index.html').toString().includes(b.name));
    }
    // Lint: each brand's own term, and its own colour on lesson.css's background, through the same code.
    edit(repo.ws, 'lessons/0001-good.html', '<p>The body of fx is', '<p>The Frobnicator and the Wibblewidget: the body of fx is');
    brands[0].color.light['--muted'] = '#c9d8e7';
    brands[1].color.dark = { '--link': '#0a1b2c' };
    const linted = brands.map((b) => { setBrand(repo.ws, b); return lintLines(repo).filter((l) => l.startsWith('BRAND_')); });
    assert.deepEqual(linted, [
      ['BRAND_CONTRAST  brand/brand.json: light: --muted #c9d8e7 on --bg #f6f7fa is 1.36:1, under 4.5:1',
        'BRAND_CONTRAST  brand/brand.json: light: --muted #c9d8e7 on --card #ffffff is 1.45:1, under 4.5:1',
        'BRAND_VOICE  lessons/0001-good.html: uses "Frobnicator"; use "tool" (brand voice.avoid)'],
      ['BRAND_CONTRAST  brand/brand.json: dark: --link #0a1b2c on --bg #0b1020 is 1.09:1, under 4.5:1',
        'BRAND_CONTRAST  brand/brand.json: dark: --link #0a1b2c on --card #131a33 is 1.01:1, under 4.5:1',
        'BRAND_VOICE  lessons/0001-good.html: uses "Wibblewidget" (brand voice.avoid)'],
    ]);
    const needles = ['Quillfeather', 'Brightmoor', '1a2b3c', 'd4e5f6', 'f1e2d3', 'Frobnicator', 'Wibblewidget', 'Gill Sans', 'Courier New', 'c9d8e7', '0a1b2c'];
    for (const dir of [join(ROOT, 'bin'), ASSETS]) {
      for (const f of readdirSync(dir, { recursive: true })) {
        let text;
        try { text = readFileSync(join(dir, f), 'utf8').toLowerCase(); } catch { continue; }
        for (const n of needles) assert.ok(!text.includes(n.toLowerCase()), `${n} in ${f}`);
      }
    }
  } finally { rmSync(repo.repo, { recursive: true, force: true }); }
});

test('an invalid brand.json: pages served unbranded with one start line from teach serve; teach export refuses and writes nothing', async () => {
  const repo = brandRepo({ name: 'X', colour: {} });
  const out = join(repo.repo, 'site');
  try {
    assert.deepEqual(readBrand(repo.ws).problems, [{ code: 'BRAND_INVALID', message: 'brand.json: unknown key colour' }]);
    const s = await served(repo.ws, Object.keys(BASE_SERVED));
    assert.deepEqual(Object.fromEntries(Object.entries(s).map(([p, t]) => [p, sha(t)])), BASE_SERVED);
    const ex = exported(repo);
    assert.deepEqual([ex.code, ex.lines.filter((l) => l.startsWith('brand'))], [1, ['brand brand/brand.json: invalid; run teach lint']]);
    const r = spawnSync(process.execPath, [BIN, 'teach', 'export', repo.ws, '--out', out], { encoding: 'utf8' });
    assert.deepEqual([r.status, r.stdout.split('\n').filter((l) => l.startsWith('brand')), existsSync(out)], [1, ['brand brand/brand.json: invalid; run teach lint'], false]);
    const child = spawn(process.execPath, [BIN, 'teach', 'serve', repo.ws], { env: { ...process.env, RESEARCH_VAULT_PATH: repo.vault }, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '', stderr = '';
    child.stderr.setEncoding('utf8').on('data', (c) => { stderr += c; });
    child.stdout.setEncoding('utf8');
    await new Promise((ok, fail) => {
      child.stdout.on('data', (c) => { stdout += c; if (stdout.includes('\n')) ok(); });
      child.on('exit', (code) => fail(new Error(`serve exited ${code}`)));
    });
    child.kill('SIGTERM');
    await once(child, 'exit');
    assert.equal(stderr, 'brand: brand/brand.json is invalid; run teach lint\n');
    assert.match(stdout, /^serving /);
    // Each kind of problem readBrand reports.
    const cases = [
      ['{', 'brand/brand.json is not JSON'],
      [{ logo: { light: '../x.svg' } }, 'logo.light must be a path under brand/ whose segments are [A-Za-z0-9._-], none starting with .'],
      [{ color: { light: { '--nope': '#fff' } } }, 'color.light: --nope is not a token of lesson.css'],
      [{ color: { dark: { '--bg': 'red' } } }, 'color.dark.--bg must be #rgb, #rrggbb or a {reference}'],
      [{ font: { body: '"Inter", serif' } }, 'font.body must be comma-separated names of letters, digits, spaces and hyphens, or a {reference}'],
      [{ footer: { classification: { a: 'A' } }, audience: 'b' }, 'audience "b" is not a key of footer.classification'],
      [{ audience: 'b' }, 'audience needs a footer.classification by audience'],
      [{ color: { light: { '--bg': '{x.y}' } } }, 'color.light.--bg: {x.y}: no tokens file'],
    ];
    for (const [b, message] of cases) {
      setBrand(repo.ws, b);
      assert.equal(readBrand(repo.ws).problems[0]?.message, message, JSON.stringify(b));
    }
  } finally { rmSync(repo.repo, { recursive: true, force: true }); }
});

test('brand text in the header and footer is read by the export\'s phrase check (spec 50 D8)', () => {
  const repo = brandRepo({ footer: { classification: 'Ask in the terminal' } });
  try {
    const ex = exported(repo);
    assert.equal(ex.code, 1);
    for (const p of ['index.html', 'progress.html', 'lessons/0001-good.html', 'reference/good.html']) assert.ok(ex.lines.some((l) => l.startsWith(`mention ${p}: Ask in the terminal`)), ex.lines.join('\n'));
  } finally { rmSync(repo.repo, { recursive: true, force: true }); }
});
