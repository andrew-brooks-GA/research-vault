import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { mkdtempSync, cpSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseFrontmatter, serializeFrontmatter } from '../bin/lib/frontmatter.mjs';
import { lintVault, fixVault, unwrapQuoteArtifact } from '../bin/lib/lintrules.mjs';
import { applyVerification } from '../bin/commands/verify.mjs';
import { reportFallback } from '../bin/lib/resolve.mjs';

// Expected values below match what a spec-compliant YAML parser (yq v4) returns for the
// same input, so the subset parser stays a subset rather than a dialect.
const fm = (s) => parseFrontmatter(`---\n${s}\n---\n`).data;

function freshVault() {
  const dir = join(mkdtempSync(join(tmpdir(), 'rv-')), 'v');
  cpSync(fileURLToPath(new URL('./fixtures/vault', import.meta.url)), dir, { recursive: true });
  return dir;
}

test('single-quoted scalars: quotes stripped, doubled quote decoded', () => {
  assert.equal(fm("title: 'Tool: X install'").title, 'Tool: X install');
  assert.equal(fm("title: 'it''s'").title, "it's");
  assert.equal(fm("title: ''").title, '');
  assert.equal(fm("title: it's plain").title, "it's plain");
});

test('single-quoted title survives a rewrite without gaining literal quotes', () => {
  const src = "---\ntitle: 'Tool: X install'\ntype: note\n---\n# b\n";
  const { data, body } = parseFrontmatter(src);
  data.type = 'note';
  const out = serializeFrontmatter({ ...data }, body);
  assert.equal(parseFrontmatter(out).data.title, 'Tool: X install');
  assert.ok(!out.includes(`"'`), out);
});

test('flow sequences: commas inside quotes do not split items', () => {
  assert.deepEqual(fm('topics: ["a, b", c]').topics, ['a, b', 'c']);
  assert.deepEqual(fm("topics: ['x, y', z]").topics, ['x, y', 'z']);
  assert.deepEqual(fm('topics: [a, b] # note').topics, ['a', 'b']);
});

test('inline comments are dropped; # without preceding space is content', () => {
  assert.equal(fm('status: active # note').status, 'active');
  assert.equal(fm('url: https://example.com/a#frag').url, 'https://example.com/a#frag');
  assert.equal(fm('title: "q # not a comment" # c').title, 'q # not a comment');
});

test('block scalars parse with literal/folded style, chomping, and indentation indicator', () => {
  const cases = [
    ['k: |\n  a\n  b', 'a\nb\n'],
    ['k: |-\n  a\n  b', 'a\nb'],
    ['k: |+\n  a\n  b\n\n\nn: 1', 'a\nb\n\n\n'],
    ['k: >\n  a\n  b\n\n  c', 'a b\nc\n'],
    ['k: >-\n  a\n  b', 'a b'],
    ['k: >\n  a\n    more\n  b', 'a\n  more\nb\n'],
    ['k: |2\n    lead\n  x', '  lead\nx\n'],
    ['k: | # c\n  a', 'a\n'],
  ];
  for (const [src, want] of cases) assert.equal(fm(src).k, want, JSON.stringify(src));
  assert.equal(fm('k: >-\n  one\n  two\nnext: 2').next, 2, 'key after a block scalar still parses');
});

test('block scalars in nested fields throw instead of swallowing the next line', () => {
  assert.throws(() => fm('subject:\n  name: |\n    k: v'), /not supported in nested fields/);
  assert.throws(() => fm('verifications:\n  - date: 2026-01-01\n    notes: >-\n      x'), /not supported in nested fields/);
  assert.deepEqual(fm('subject:\n  name: x # c').subject, { name: 'x' });
});

test('multi-line strings round-trip through a block scalar', () => {
  for (const v of ['a\nb', 'a\nb\n', 'a\n\n', '  lead\nx', '\nfirst blank']) {
    const out = serializeFrontmatter({ summary: v, type: 'note' }, '');
    assert.equal(parseFrontmatter(out).data.summary, v, JSON.stringify(v));
  }
});

test('strings that look like YAML syntax are quoted so they round-trip', () => {
  for (const v of ["'quoted'", '| pipe', '> gt', "it's", 'Tool: X']) {
    const out = serializeFrontmatter({ title: v }, '');
    assert.equal(parseFrontmatter(out).data.title, v, JSON.stringify(v));
  }
});

test('rewrite keeps unchanged keys byte-identical and places a new key canonically', () => {
  const src = [
    '---',
    "title: 'Tool: X install'",
    'type: note',
    'created: "2026-01-01"',
    'domain:',
    '  - systems-infrastructure',
    'topics:',
    '  - alpha',
    '  - beta',
    'status: active',
    '---',
    '# b',
    '',
  ].join('\n');
  const { data, body } = parseFrontmatter(src);
  data.status = 'superseded';
  data.updated = '2026-02-02';
  const out = serializeFrontmatter(data, body, ['title', 'type', 'created', 'updated', 'domain', 'topics', 'status']);
  assert.equal(out, src
    .replace('created: "2026-01-01"\n', 'created: "2026-01-01"\nupdated: 2026-02-02\n')
    .replace('status: active', 'status: superseded'));
});

test('preserve: false normalizes every key (lint --fix path)', () => {
  const { data, body } = parseFrontmatter("---\ntitle: 'A: b'\ntopics:\n  - x\n  - y\n---\n");
  const out = serializeFrontmatter(data, body, null, { preserve: false });
  assert.equal(out, '---\ntitle: "A: b"\ntopics: [x, y]\n---\n');
});

test('verify on a block-list entry adds only its own lines', () => {
  const dir = freshVault();
  const f = join(dir, 'sources', '2026-01-01-a.md');
  const before = readFileSync(f, 'utf8').replace(/^topics: \[(.*)\]$/m, (_, t) => 'topics:\n' + t.split(', ').map(x => `  - ${x}`).join('\n'));
  assert.match(before, /^topics:\n  - x$/m, 'fixture rewritten to a block list');
  writeFileSync(f, before, 'utf8');
  applyVerification(dir, { id: '2026-01-01-a', method: 'refetched-source', result: 'confirmed', byId: 'test' });
  const after = readFileSync(f, 'utf8');
  const removed = before.split('\n').filter(l => !after.split('\n').includes(l));
  assert.deepEqual(removed, [], 'no existing line changed: ' + removed.join(' | '));
});

test('unwrapQuoteArtifact: unwraps a stored single-quoted scalar, leaves real text alone', () => {
  assert.equal(unwrapQuoteArtifact("'Tool: X'"), 'Tool: X');
  assert.equal(unwrapQuoteArtifact("'it''s'"), "it's");
  assert.equal(unwrapQuoteArtifact("'a' and 'b'"), null);
  assert.equal(unwrapQuoteArtifact('plain'), null);
  assert.equal(unwrapQuoteArtifact("'"), null);
});

test('lint warns on a quote artifact and --fix repairs it; clean entries are not flagged', () => {
  const dir = freshVault();
  const f = join(dir, 'sources', '2026-01-01-a.md');
  writeFileSync(f, readFileSync(f, 'utf8').replace(/^title: .*$/m, `title: "'Tool: X install'"`), 'utf8');
  const hits = lintVault(dir, process.cwd()).warnings.filter(w => w.code === 'WARN_QUOTE_ARTIFACT');
  assert.equal(hits.length, 1, JSON.stringify(hits));
  assert.match(hits[0].file, /2026-01-01-a\.md$/);
  fixVault(dir, process.cwd());
  assert.equal(parseFrontmatter(readFileSync(f, 'utf8')).data.title, 'Tool: X install');
  assert.equal(lintVault(dir, process.cwd()).warnings.filter(w => w.code === 'WARN_QUOTE_ARTIFACT').length, 0);
});

test('reportFallback names the vault for config/default writes only', () => {
  const lines = [];
  const stream = { write: (s) => lines.push(s) };
  for (const source of ['flag', 'project', 'env']) reportFallback({ path: '/v', source }, stream);
  assert.equal(lines.length, 0);
  reportFallback({ path: '/v', source: 'config' }, stream);
  reportFallback({ path: '/w', source: 'default' }, stream);
  assert.equal(lines.length, 2);
  assert.match(lines[0], /\/v \(from the user config\)/);
  assert.match(lines[1], /\/w \(from the OS default\)/);
});
