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

test('claims-reviewer keys on the changed-units line the gate prints (spec 14 D6)', () => {
  const printed = readFileSync(join(ROOT, 'bin', 'commands', 'gate.mjs'), 'utf8').match(/`(changed units:)/)[1];
  assert.ok(agent().body.includes(`\`${printed}\``), `agent body lacks \`${printed}\``);
});

test('gate fixtures carry a gold verdict per draft', () => {
  const gold = JSON.parse(readFileSync(join(FIXTURES, 'gold.json'), 'utf8'));
  const drafts = readdirSync(FIXTURES).filter((f) => f.endsWith('.html'));
  assert.ok(drafts.length >= 2, `found ${drafts.length} drafts`);
  for (const d of drafts) assert.ok(VERDICTS.includes(gold[d]), `${d}: gold ${gold[d]}`);
});

test('claims-reviewer may open the image files the evidence lists, and only those (issue 58)', () => {
  const printed = readFileSync(join(ROOT, 'bin', 'lib', 'gate.mjs'), 'utf8').match(/`(image:) \$\{/)[1];
  const { body } = agent();
  assert.ok(body.includes(`\`${printed} <path> sha256:<hash>\``), 'agent body lacks the image line format');
  assert.match(body, /open only those image files with Read/);
  assert.match(body, /alt text, caption and nearest citing paragraph/);
});

test('claims-reviewer description names the image files and the body defines the img: unit (issue 58)', () => {
  const { data, body } = agent();
  assert.match(data.description, /Reads only the draft, the vault and the image files its evidence lists/);
  assert.match(body, /An `img:<src>` unit is one `<img>`/);
  assert.match(body, /those claims are `unsupported`/);
  assert.match(body, /Match the unit's `<src>`.*a trailing `#` on the unit name marks a repeated `src`/);
});
