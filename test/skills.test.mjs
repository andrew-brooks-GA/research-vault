import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => readFileSync(join(ROOT, p), 'utf8');

test('research-claims-gate skill exists with the expected frontmatter', () => {
  // Regex, not parseFrontmatter: the vault parser rejects the `argument-hint` key.
  const [, fm, body] = read('skills/research-claims-gate/SKILL.md').match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
  assert.match(fm, /^name: research-claims-gate$/m);
  assert.match(fm, /^description: Use when a draft that cites vault evidence is about to be shown, sent or taught/m);
  assert.match(fm, /^argument-hint: \S/m);
  for (const s of ['check --check', 'gate evidence', 'subagent_type: research-vault:claims-reviewer', 'GATE-LOG.md', 'gate record']) {
    assert.ok(body.includes(s), `skill body lacks ${s}`);
  }
});

test('research-capture skill lists every authority_basis value (spec 14 D6)', () => {
  const listed = read('skills/research-capture/SKILL.md').match(/--authority-basis <([^>]+)>/)[1].split('|');
  assert.deepEqual(listed, JSON.parse(read('schema/taxonomy.json')).authority_basis);
});

test('teach, orchestrate and authoring skills name research-claims-gate', () => {
  for (const s of ['research-teach', 'research-orchestrate', 'research-authoring']) {
    assert.match(read(`skills/${s}/SKILL.md`), /`research-claims-gate` skill/, s);
  }
  assert.match(read('skills/research-teach/SKILL.md'), /RERUNS\.md/);
  assert.match(read('skills/research-teach/SKILL.md'), /research-vault:claims-reviewer/);
});

test('teach skill no longer writes the in-draft claims-gate marker', () => {
  assert.doesNotMatch(read('skills/research-teach/SKILL.md'), /<!-- claims-gate:/);
});

test('LESSON-FORMAT.md names every block, the quiz rules and PLAN.md', () => {
  const f = read('skills/research-teach/LESSON-FORMAT.md');
  for (const b of ['mission', 'fact', 'example', 'quiz', 'step', 'sources', 'followup', 'prereq', 'note']) {
    assert.ok(f.includes(`\`${b}\``), `format lacks block ${b}`);
  }
  for (const s of [
    'lessons/NNNN-slug.html', 'lessons/NNNN-review-slug.html', 'reference/<slug>.html', 'data-cite', 'data-quiz', 'data-lesson',
    '"record"', 'data-introduces', 'at most three', '`model`', '<dfn>', 'PATH-FORMAT.md', 'at least 3 items', '3 or 4', '1.6', 'evidence/NNNN/PLAN.md', '## Revisions',
    'You can ask follow-up questions in the terminal.', '../assets/lesson.css', '../assets/quiz.js', 'teach lint',
  ]) {
    assert.ok(f.includes(s), `format lacks ${s}`);
  }
});

// The example is the only ```html fence. Its body runs from the line after the opening fence up to,
// not including, the closing ``` line, so it ends with the fixture's own trailing newline.
test('the format file example is byte-identical to the good fixture', () => {
  const f = read('skills/research-teach/LESSON-FORMAT.md');
  const fences = [...f.matchAll(/^```html\n([\s\S]*?)^```$/gm)];
  assert.equal(fences.length, 1, `html fences: ${fences.length}`);
  assert.equal(fences[0][1], read('test/fixtures/teach/lessons/0001-good.html'));
});

test('LEARNING-RECORD-FORMAT.md carries the frontmatter template and kind values', () => {
  const f = read('skills/research-teach/LEARNING-RECORD-FORMAT.md');
  assert.match(f, /^<!-- Adapted from the `teach` skill in mattpocock\/skills \(MIT/);
  for (const s of [
    'type: learning-record', 'status: active', 'superseded_by', 'kind: ', 'lesson: ',
    'understanding', 'prior-knowledge', 'misconception', 'mission-shift',
    'NNNN-slug', 'teach record add', 'teach record supersede', 'teach lint --fix',
  ]) {
    assert.ok(f.includes(s), `record format lacks ${s}`);
  }
  assert.doesNotMatch(f, /Status: superseded by LR-NNNN`? rather than/);
});

test('teach skill names teach next, PLAN.md, teach lint, the assets copy, teach serve and the open command', () => {
  const s = read('skills/research-teach/SKILL.md');
  for (const x of [
    'LESSON-FORMAT.md', 'teach next', 'evidence/NNNN/PLAN.md', '## Revisions', 'teach lint', 'cp -n', '.gitignore',
    '.teach-serve.json', 'kill -0', 'teach serve', 'http://127.0.0.1:<port>/lessons/<id>.html', 'xdg-open', '`open`',
    'attempts/', 'teach record add', 'teach record supersede', 'lessons/NNNN-review-slug.html', 'review-due', 'review-failed',
  ]) {
    assert.ok(s.includes(x), `teach skill lacks ${x}`);
  }
  // Lint comes before the gate in §5.
  const s5 = s.slice(s.indexOf('## 5.'), s.indexOf('## 6.'));
  assert.ok(s5.indexOf('teach lint') >= 0 && s5.indexOf('teach lint') < s5.indexOf('`research-claims-gate` skill'), 'lint before gate in §5');
});
