import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseFrontmatter } from '../bin/lib/frontmatter.mjs';
import { VERDICTS } from '../bin/lib/gate.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const FIXTURES = join(ROOT, 'test', 'fixtures', 'gate');
const agent = () => parseFrontmatter(readFileSync(join(ROOT, 'agents', 'claims-reviewer.md'), 'utf8'));

test('claims-reviewer frontmatter pins model and effort, omits CLAUDE.md, and only read-only tools', () => {
  const { data } = agent();
  const tools = String(data.tools).split(',').map((t) => t.trim());
  assert.ok(tools.length > 0);
  for (const t of tools) assert.ok(['Read', 'Grep', 'Glob'].includes(t), `tool ${t} is not read-only`);
  assert.equal(data.model, 'opus');
  assert.equal(data.effort, 'high');
  assert.equal(data.omitClaudeMd, true);
});

test('claims-reviewer body carries the no-body, omitted-entry and GATE-LOG rules', () => {
  const { body } = agent();
  assert.match(body, /no-body/);
  assert.match(body, /not on evidence list/);
  assert.match(body, /GATE-LOG\.md/);
});

test('gate fixtures carry a gold verdict per draft', () => {
  const gold = JSON.parse(readFileSync(join(FIXTURES, 'gold.json'), 'utf8'));
  const drafts = readdirSync(FIXTURES).filter((f) => f.endsWith('.html'));
  assert.ok(drafts.length >= 2, `found ${drafts.length} drafts`);
  for (const d of drafts) assert.ok(VERDICTS.includes(gold[d]), `${d}: gold ${gold[d]}`);
});
