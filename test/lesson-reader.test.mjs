// The lesson-reader agent: a fresh reader with no context, Read only, READS or REVISE.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const raw = readFileSync(join(ROOT, 'agents', 'lesson-reader.md'), 'utf8');
const fm = /^---\n([\s\S]*?)\n---\n([\s\S]*)$/.exec(raw);
const field = (k) => new RegExp(`^${k}:\\s*(.+)$`, 'm').exec(fm[1])?.[1].trim();

test('lesson-reader frontmatter allows Read only, pins model and effort, and omits CLAUDE.md', () => {
  assert.ok(fm, 'frontmatter present');
  assert.equal(field('name'), 'lesson-reader');
  assert.equal(field('tools'), 'Read');
  assert.equal(field('model'), 'opus');
  assert.equal(field('effort'), 'high');
  assert.equal(field('omitClaudeMd'), 'true');
});

test('lesson-reader body reads only the lesson and ends with READS or REVISE', () => {
  assert.match(fm[2], /Read only that file\. Never read MISSION\.md, NOTES\.md, GATE-LOG\.md/);
  assert.match(fm[2], /Never fetch the web\. Never run code\. Never edit a file\./);
  assert.match(fm[2], /VERDICT: READS/);
  assert.match(fm[2], /VERDICT: REVISE/);
  assert.match(fm[2], /Do not comment on whether the facts are true/);
  assert.match(fm[2], /the model, fact and example blocks tell one story/, 'Thread check reads the three (spec 41)');
});

test('lesson-reader has a README mode that reads a workspace README.md as a newcomer and reports terms, register and setup (issue 66)', () => {
  assert.match(fm[2], /^## README mode$/m);
  assert.match(fm[2], /When the path is a workspace's `README\.md`, read it as a newcomer who has not opened a lesson/);
  assert.match(fm[2], /\*\*Terms\.\*\*[\s\S]*\*\*Register\.\*\*[\s\S]*\*\*Setup\.\*\*/);
  assert.match(fm[2], /`VERDICT: READS` or `VERDICT: REVISE` as for a lesson/);
});
