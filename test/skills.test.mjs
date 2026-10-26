import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseFrontmatter } from '../bin/lib/frontmatter.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => readFileSync(join(ROOT, p), 'utf8');

test('research-claims-gate skill and command exist with the expected frontmatter', () => {
  const skill = parseFrontmatter(read('skills/research-claims-gate/SKILL.md'));
  assert.equal(skill.data.name, 'research-claims-gate');
  assert.match(String(skill.data.description), /^Use when a draft that cites vault evidence is about to be shown, sent or taught/);
  for (const s of ['check --check', 'gate evidence', 'subagent_type: claims-reviewer', 'GATE-LOG.md', 'gate record']) {
    assert.ok(skill.body.includes(s), `skill body lacks ${s}`);
  }
  // Regex, not parseFrontmatter: the vault parser rejects `<draft> [ids]`, which is valid YAML.
  const [, fm, body] = read('commands/research-claims-gate.md').match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
  assert.match(fm, /^description: \S/m);
  assert.match(fm, /^argument-hint: \S/m);
  assert.match(body, /`research-claims-gate` skill/);
});

test('teach, orchestrate and authoring skills name research-claims-gate', () => {
  for (const s of ['research-teach', 'research-orchestrate', 'research-authoring']) {
    assert.match(read(`skills/${s}/SKILL.md`), /`research-claims-gate` skill/, s);
  }
  assert.match(read('skills/research-teach/SKILL.md'), /RERUNS\.md/);
});

test('teach skill no longer writes the in-draft claims-gate marker', () => {
  assert.doesNotMatch(read('skills/research-teach/SKILL.md'), /<!-- claims-gate:/);
});
