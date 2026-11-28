import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FLOATING } from '../bin/lib/fill.mjs';
import { slugify } from '../bin/lib/ids.ts';
import { context, extract } from '../scripts/deps.mjs';
import { readFileSync, statSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => readFileSync(join(ROOT, p), 'utf8');
const WORKFLOW = join('skills', 'research-orchestrate', 'workflow');
const ctx = context();
const skillMarkdown = ctx.files.filter(f => /^skills\/[^/]+\/.+\.md$/.test(f));
const skillAndCommandMarkdown = [...skillMarkdown, ...ctx.files.filter(f => /^commands\/[^/]+\.md$/.test(f))];
const readBody = file => read(file).replace(/^---\n[\s\S]*?\n---\n/, '');
const isFile = path => statSync(path, { throwIfNoEntry: false })?.isFile() === true;

// Guard copyable CLI commands against reliance on a PATH shim in Claude skill and command Markdown.
test('source scan: skills and command files contain no bare research-vault invocations', () => {
  const bare = new RegExp(`(?<![\\w./-])research-vault[ \\t]+(?:${ctx.commands.join('|')})\\b`);
  for (const file of skillAndCommandMarkdown) {
    assert.doesNotMatch(read(file), bare, file);
  }
});

// Guard plugin document pointers in skill and command bodies against resolving in the user's repo.
// Only a resolving relative link destination is exempt. Link labels and code examples still count.
test('source scan: skill and command document pointers use the plugin root or resolving relative links', () => {
  const bare = /(?<![\w-]|\$\{CLAUDE_PLUGIN_ROOT\}\/)docs\/(?:[\w.-]+\/)*[\w.-]+\.md\b/;
  const markup = /^ {0,3}(`{3,}|~{3,})[^\n]*\n[\s\S]*?^ {0,3}\1[ \t]*$|(`+)[^\n]*?\2|((?<!\\)\[[^\]\n]+\]\()([.\w][\w./-]*)((?:#[^)\s]*)?(?:[ \t]+"[^"\n]*")?\))/gm;
  for (const file of skillAndCommandMarkdown) {
    const body = readBody(file).replace(markup, (match, _fence, _code, label, target, suffix) =>
      target && bare.test(target) && isFile(resolve(ROOT, dirname(file), target)) ? label + suffix : match);
    assert.equal(bare.exec(body)?.[0], undefined, file);
  }
});

test('source scan: plugin-root document pointers name existing repository files', () => {
  const rooted = /\$\{CLAUDE_PLUGIN_ROOT\}\/(docs\/(?:[\w.-]+\/)*[\w.-]+\.md)\b/g;
  for (const file of skillAndCommandMarkdown) {
    for (const [, target] of readBody(file).matchAll(rooted)) {
      assert.ok(isFile(join(ROOT, target)), `${file} names missing document ${target}`);
    }
  }
});

test('skills that use the CLI define its plugin-root entry point', () => {
  const definition = '- CLI: `node "${CLAUDE_PLUGIN_ROOT}/bin/research-vault.mjs"`.';
  const usingCLI = new Set(skillMarkdown.filter(f => extract(f, read(f), ctx).some(e => e.kind === 'invokes-cli'))
    .map(f => f.split('/')[1]));
  for (const name of usingCLI) {
    const file = `skills/${name}/SKILL.md`;
    assert.ok(read(file).split('\n').some(line => line.startsWith(definition)), file);
  }
});

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
  for (const b of ['mission', 'fact', 'example', 'quiz', 'step', 'sources', 'followup', 'prereq', 'note', 'complete', 'predict', 'connect', 'scaffold']) {
    assert.ok(f.includes(`\`${b}\``), `format lacks block ${b}`);
  }
  for (const s of [
    'lessons/NNNN-slug.html', 'lessons/NNNN-review-slug.html', 'reference/<slug>.html', 'data-cite', 'data-quiz', 'data-lesson',
    '"record"', 'data-introduces', 'at most three', '`model`', '<dfn>', 'PATH-FORMAT.md', 'at least 3 items', '3 non-empty options by default; 4 are allowed', 'nameable misreading', '`Not this one`', 'item 0', '1.6', 'evidence/NNNN/PLAN.md', '## Revisions', 'data-shape', 'Elements',
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
  assert.match(s.split('## 2.')[1].split('## 3.')[0], /position varies/, 'section 2 names the hygiene rule (spec 40)');
  for (const x of [
    'LESSON-FORMAT.md', 'teach next', 'evidence/NNNN/PLAN.md', '## Revisions', 'teach lint', 'cp -n', 'AskUserQuestion', 'up to four terms per call', '`Pass` is not always last', 'have run it', '.gitignore',
    '.teach-serve.json', 'kill -0', 'teach serve', 'http://127.0.0.1:<port>/lessons/<id>.html', 'xdg-open', '`open`',
    'attempts/', 'teach record add', 'teach record supersede', 'lessons/NNNN-review-slug.html', 'review-due', 'review-failed', 'fringe:', 'inner:', 'teach path candidates', 'teach path edges',
  ]) {
    assert.ok(s.includes(x), `teach skill lacks ${x}`);
  }
  const pf = read('skills/research-teach/PATH-FORMAT.md');
  for (const x of ['PATH_AFTER_FORWARD', 'PATH_AFTER_CYCLE', 'fringe', 'WARN_PATH_TERM_UNPLANNED', 'teach path edges']) assert.ok(pf.includes(x), `PATH-FORMAT lacks ${x}`);
  // Lint comes before the gate in §5.
  const s5 = s.slice(s.indexOf('## 5.'), s.indexOf('## 6.'));
  assert.ok(s5.indexOf('teach lint') >= 0 && s5.indexOf('teach lint') < s5.indexOf('`research-claims-gate` skill'), 'lint before gate in §5');
});

test('the teach skill and formats state the three preferences and reviews as offers (issue 79 D1, D2)', () => {
  const s = read('skills/research-teach/SKILL.md');
  for (const x of ['preferences:', 'preferences-unset:', 'Hints:', 'Path reviews:', 'Reminders:', 'Path reviews: yes']) assert.ok(s.includes(x), `teach skill lacks ${x}`);
  assert.ok(!s.includes('21 days') && !s.includes('Cepeda'), 'the skill keeps no fixed review gap');
  const mf = read('skills/research-teach/MISSION-FORMAT.md');
  for (const x of ['- Hints: always', 'on request', '- Path reviews: yes', '- Reminders: none', 'every <N> days', 'MISSION_PREF_INVALID']) assert.ok(mf.includes(x), `MISSION-FORMAT lacks ${x}`);
  assert.ok(read('skills/research-teach/PATH-FORMAT.md').includes('Path reviews: yes'), 'PATH-FORMAT plans reviews only with Path reviews: yes');
});

test('the teach skill and LESSON-FORMAT state the checked task form: ./check and requirements.json (issue 79 D3, D4)', () => {
  const s = read('skills/research-teach/SKILL.md');
  for (const x of ['./check', 'requirements.json', './check --dry-run --hints', 'ok <id>', 'FAIL <id>: <hint>', 'echo /check >> .gitignore']) assert.ok(s.includes(x), `teach skill lacks ${x}`);
  const f = read('skills/research-teach/LESSON-FORMAT.md');
  for (const x of ['./check', 'requirements.json', 'FAIL <id>', 'not reached', 'TASK_REQUIREMENTS_INVALID']) assert.ok(f.includes(x), `LESSON-FORMAT lacks ${x}`);
  for (const old of ['prints `PASS`', 'FAIL: <requirement>']) assert.ok(!s.includes(old) && !f.includes(old), `the old checker output is still stated: ${old}`);
});

test('the teach skill states the certification run: --start, --certify, --cancel and its state file (issue 79 D8)', () => {
  const s = read('skills/research-teach/SKILL.md');
  for (const x of ['./check --start <N>', '--minutes <M>', '--pass <P>', '--no-hints', './check --certify', './check --cancel', 'certification: open', '.teach-certify.json', 'echo .teach-certify.json >> .gitignore']) assert.ok(s.includes(x), `teach skill lacks ${x}`);
});

test('the teach skill gives the answer and records it with --answered (issue 79 D7)', () => {
  const s = read('skills/research-teach/SKILL.md');
  for (const x of ['teach attempt add --lesson <id> --answered <ids>', 'answered:']) assert.ok(s.includes(x), `teach skill lacks ${x}`);
  assert.ok(!s.includes('turns the attempt into a read'), 'reading the solution is no longer a read');
});

test('research-authoring has a Code section whose first sentence states the code block condition (spec 15 D5)', () => {
  const s = read('skills/research-authoring/SKILL.md');
  const section = s.slice(s.indexOf('## Code\n'));
  const first = section.split('\n\n')[1].split('. ')[0];
  assert.match(first, /applies only when the binding has a `code` block and the file you are editing matches its `code\.globs`/);
  for (const x of ['<id>@<key>=<version>', 'versions:', 'node "${CLAUDE_PLUGIN_ROOT}/bin/research-vault.mjs" check', '--superseded-by', 'Never move a pin']) assert.ok(section.includes(x), `Code section lacks ${x}`);
  assert.match(read('agents/claims-reviewer.md'), /A `sym:<name>` unit is a code symbol/);
  assert.match(read('agents/claims-reviewer.md'), /`unit sym:<name> <file>:<start>-<end> <status>`/);
});

test('research-vault-usage tells the agent to take search terms from manifest --topics (spec 18 D5)', () => {
  const skill = read('skills/research-vault-usage/SKILL.md');
  assert.ok(skill.includes('`manifest --topics`'));
  assert.ok(skill.includes('rather than inventing a synonym'));
});

test('the claims-gate skill holds the packet rules and the rule for edits after round two (spec 54 items 5 and 7)', () => {
  const skill = read('skills/research-claims-gate/SKILL.md');
  for (const s of ['--packet', '--run <run key>', 'can fail a draft and cannot pass one', 'After round two change only the sentences a finding names', 'record `MERIT`, never `PASS`']) assert.ok(skill.includes(s), s);
  assert.ok(read(WORKFLOW).includes('--run ${args.runKey}'), 'the Write step puts the run key in its quote rows');
});

// R-17: a compaction re-attaches only the first part of a skill (about 14,500 bytes of these files), so the
// gate rules sit in a block that ends well before that. Offsets are bytes, not characters.
test('the gate rules of research-teach and research-orchestrate sit in an Invariants block within the first 12,000 bytes', () => {
  for (const [skill, names] of [
    ['research-teach', ['teach lint', 'lesson-reader', 'research-claims-gate', 'MERIT']],
    ['research-orchestrate', ['research-claims-gate', 'Close out', 'MERIT', 'Write step']],
  ]) {
    const bytes = readFileSync(join(ROOT, `skills/${skill}/SKILL.md`));
    const start = bytes.indexOf('\n## Invariants\n');
    assert.ok(start >= 0, `${skill} has no ## Invariants heading`);
    const end = bytes.indexOf('\n## ', start + 1);
    assert.ok(end > start && end < 12000, `${skill}: the Invariants block ends at byte ${end}`);
    const block = bytes.subarray(start, end).toString('utf8');
    for (const n of names) assert.ok(block.includes(n), `${skill}: the Invariants block lacks ${n}`);
  }
});

function workflowSection() {
  return read('skills/research-orchestrate/SKILL.md').split('\n## 2. Run the workflow\n')[1].split('\n## ')[0];
}

test('orchestrate section 2 has no fenced JavaScript block', () => {
  assert.doesNotMatch(workflowSection(), /^[ \t]*(?:`{3,}|~{3,})[ \t]*javascript\b/im);
});

test('orchestrate section 2 names a Workflow script file under the plugin root', () => {
  const reference = workflowSection().match(/`(\$\{CLAUDE_PLUGIN_ROOT\}\/skills\/research-orchestrate\/[^`\s]+)`/);
  assert.ok(reference, 'section 2 names the script under the plugin root');
  const path = resolve(reference[1].replace('${CLAUDE_PLUGIN_ROOT}', ROOT));
  assert.equal(path, join(ROOT, WORKFLOW));
  assert.ok(statSync(path).isFile(), reference[1]);
});

// Scan the prompt and STOPWORDS declaration for candidates so an addition on either side is tested through slugify.
test('source scan: the Workflow Write prompt lists the stopwords slugify drops', () => {
  const listed = read(WORKFLOW).match(/ the words ([a-z, ]+) dropped, and the first /);
  assert.ok(listed, 'the Write prompt lists its slug stopwords');
  const expected = new Set(listed[1].split(', '));
  const declared = read('bin/lib/ids.ts').match(/const STOPWORDS = new Set\(\[([^\]]*)\]\)/);
  assert.ok(declared, 'ids.ts lists the stopword probe candidates');
  const sourceWords = [...declared[1].matchAll(/['"]([a-z0-9]+)['"]/g)].map(m => m[1]);
  const candidates = new Set([...expected, ...sourceWords]);
  const control = 'quartz';
  assert.equal(slugify(control), control, 'the control word is kept');
  const dropped = new Set([...candidates].filter(word => slugify(`${word} ${control}`) === control));
  assert.deepEqual(dropped, expected);
});

test('the Workflow Write prompt states the word limit slugify applies', () => {
  const stated = read(WORKFLOW).match(/the first ([a-z]+) remaining words joined by hyphens/);
  assert.ok(stated, 'the Write prompt states a word limit');
  const counts = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven'];
  assert.equal(slugify('amber birch cedar dogwood elm fir gum').split('-').length, counts.indexOf(stated[1]));
});

test('the Workflow Write prompt states the prefix slugify uses when no word remains', () => {
  const stated = read(WORKFLOW).match(/When no word is left, the slug is ([a-z0-9]+-) and a hash/);
  assert.ok(stated, 'the Write prompt states a prefix');
  const slug = slugify('日本語');
  assert.ok(slug.startsWith(stated[1]), `${slug} should start with ${stated[1]}`);
});

// Pull request 71 shipped a reference script the Workflow tool cannot take; this is the smallest check that fails on it.
test('the orchestrate skill\'s reference script is a Workflow script', () => {
  const skill = read('skills/research-orchestrate/SKILL.md');
  const script = read(WORKFLOW);
  assert.match(script, /^export const meta = \{/);
  assert.doesNotMatch(script, /\bagent\(\s*\{/, 'agent takes a prompt string');
  assert.doesNotMatch(script, /\bimport\b|\brequire\(|Date\.now\(|Math\.random\(|new Date\(\)/);
  // It parses as the body of an async function once `export` is dropped (never run here).
  const AsyncFunction = (async () => {}).constructor;
  assert.doesNotThrow(() => new AsyncFunction('agent', 'parallel', 'pipeline', 'phase', 'log', 'args', 'budget', 'workflow', script.replace(/^export /, '')));
  // Every bare call outside the prompts is to a Workflow hook, a keyword or a name the script defines;
  // the prompts are template literals and are cut out first.
  const code = script.replace(/`(?:\\[\s\S]|[^`\\])*`/g, '``');
  const defined = [...code.matchAll(/\b(?:const|let|function)\s+([A-Za-z_$][\w$]*)/g)].map((m) => m[1]);
  const allowed = new Set(['agent', 'parallel', 'pipeline', 'phase', 'log', 'workflow', 'if', 'for', 'while', 'switch', 'catch', 'Map', 'Set', 'String', 'Number', 'Boolean', ...defined]);
  const calls = [...code.matchAll(/(?<![.\w$])([A-Za-z_$][\w$]*)\s*\(/g)].map((m) => m[1]);
  assert.deepEqual([...new Set(calls)].filter((c) => !allowed.has(c)), []);
  // Every phase the script enters or assigns is one meta declares.
  const titles = [...script.slice(0, script.indexOf('\n}\n')).matchAll(/title: '([^']+)'/g)].map((m) => m[1]);
  const used = [...script.matchAll(/phase\('([^']+)'\)|phase: '([^']+)'/g)].map((m) => m[1] || m[2]);
  assert.ok(titles.length > 0);
  assert.deepEqual([...new Set(used)].filter((t) => !titles.includes(t)), []);
  for (const flag of ['--operation-id', '--vault', 'recoveryStateCreated', '--quotes']) assert.ok(script.includes(flag), flag);
  // Spec 53: three phases, so two agents plus one per lane, and no agent that reads a page a second time.
  assert.deepEqual(titles, ['Recon', 'Research', 'Write']);
  // The lanes are the user's choice: the script reads them from args and holds no list of its own.
  assert.ok(script.includes('const lanes = args.lanes') && !/const lanes = \[/.test(script), 'lanes come from args.lanes');
  assert.ok(script.includes('args.pagesPerLane') && script.includes('up to ${PER_LANE} of the most authoritative URLs'), 'pages a lane come from args');
  for (const s of ['Interview the user once', '`args.lanes`', '`args.pagesPerLane`', 'Do not add a requirement the user did not state']) assert.ok(skill.includes(s), s);
  // Every agent names its model: one with none runs on the session's model, whatever that is.
  const agents = code.match(/(?<![.\w$])agent\(/g).length;
  assert.ok(agents >= 3);
  assert.equal(code.match(/\bmodel: 'opus'/g)?.length, agents, 'every agent() call in the script carries model: opus');
});

// Issues 74, 75 and 76: the script repairs an address before the Write step, and the prompts say the rest.
test('the orchestrate script hands the Write step https addresses and no version on a floating address', async () => {
  const skill = read('skills/research-orchestrate/SKILL.md');
  const script = read(WORKFLOW);
  const page = (url, extra = {}) => ({ url, title: 't', domain: 'd', topics: 'x', authorityTier: 'a', authorityBasis: 'b', summary: 's', claims: [{ claim: 'c', quote: 'q' }], ...extra });
  const v = { subjectName: 'X', subjectVersion: '2.0' };
  const lanePages = [
    page('http://example.com/blog/a/'), page('https://example.com/docs/latest/r', v), page('https://example.com/x/v10.15.0/r.md', v),
    page('https://example.com/a?ref=main', v), page('https://example.com/mainline/a', v), page('https://example.com/blog/a/'),
    page('HTTP://Example.com/Docs/Main/x', v), page('https://example.com?next=/main/', v), page('http://example.com:8080/x'), page('http://user:pw@example.com/x'),
    page('https://main/x', v), page('https://example.com/a#/main/', v), page('http://example.com?x=1'),
  ];
  let prompt = '';
  const agent = async (text, opts) => (opts.phase === 'Recon' ? 'none' : opts.phase === 'Research' ? { pages: structuredClone(lanePages) } : ((prompt = text), { status: 'complete', lint: '' }));
  const AsyncFunction = (async () => {}).constructor;
  await new AsyncFunction('agent', 'parallel', 'pipeline', 'phase', 'log', 'args', 'budget', 'workflow', script.replace(/^export /, ''))(
    agent, (fns) => Promise.all(fns.map((f) => f())), null, () => {}, () => {}, { question: 'q', cli: '/cli', vault: '/v', today: '2026-11-17', runKey: 'run-test01', storeText: true, lanes: ['one lane'], pagesPerLane: 4 });
  const got = JSON.parse(prompt.slice(prompt.lastIndexOf('PAGES: ') + 7)).map((p) => [p.url, p.subjectName ?? null, p.subjectVersion ?? null, p.claims.length]);
  assert.deepEqual(got, [
    ['https://example.com/blog/a/', null, null, 2],
    ['https://example.com/docs/latest/r', 'X', null, 1],
    ['https://example.com/x/v10.15.0/r.md', 'X', '2.0', 1],
    ['https://example.com/a?ref=main', 'X', '2.0', 1],
    ['https://example.com/mainline/a', 'X', '2.0', 1],
    ['https://Example.com/Docs/Main/x', 'X', null, 1],
    ['https://example.com?next=/main/', 'X', '2.0', 1],
    ['http://example.com:8080/x', null, null, 1],
    ['http://user:pw@example.com/x', null, null, 1],
    ['https://main/x', 'X', '2.0', 1],
    ['https://example.com/a#/main/', 'X', '2.0', 1],
    ['https://example.com?x=1', null, null, 1],
  ]);
  // The script's word list is a copy of FLOATING in bin/lib/fill.mjs.
  const inFill = [...FLOATING];
  const inScript = script.match(/const FLOATING = \/\\\/\(([^)]*)\)/)[1].split('|');
  assert.deepEqual(inScript, inFill);
  for (const s of ['[--subject-name <subjectName>] [--subject-version <subjectVersion>]', 'Pass each of the two only when the page has that field; never make up a version.', 'A PDF may give no text to check (the one PDF probed gave none): where a paper or a report has an HTML page of its full text, read that page and give its address; give a PDF address only when there is none, and its quotes may then stay unchecked.']) assert.ok(script.includes(s), s);
  for (const s of ['A PDF source answers `no-text`', '`capture --fill <id> --content-file <file> --ack-data-egress`']) assert.ok(skill.includes(s), s);
  // Section 3 gives the same nine words by hand.
  const byHand = skill.slice(skill.indexOf("The script's address repair does not run here")).split('\n')[0];
  assert.deepEqual([...byHand.matchAll(/`([a-z]+)`/g)].map((m) => m[1]), inFill);
  for (const s of ['give an `http://` address with no port in its `https://` form', 'pass no `--subject-version`']) assert.ok(byHand.includes(s), s);
});

// Issue 73: a raw file and its rendered page are one document at two addresses. The script marks the second page,
// and the Write step tests the mark with the quote check before it captures that page.
test('the orchestrate script marks a page that may be a second address of an earlier page', async () => {
  const skill = read('skills/research-orchestrate/SKILL.md');
  const script = read(WORKFLOW);
  const page = (url, extra = {}) => ({ url, title: 't', domain: 'd', topics: 'x', authorityTier: 'a', authorityBasis: 'b', summary: 's', claims: [{ claim: 'c', quote: 'q' }], ...extra });
  const v = { subjectName: 'X', subjectVersion: '9.0' };
  const lanePages = [
    page('https://raw.githubusercontent.com/eslint/eslint/main/docs/src/rules/max-lines.md'), page('https://eslint.org/docs/latest/rules/max-lines'),
    page('https://eslint.org/docs/latest/rules/max-depth'), page('https://eslint.org/docs/v9.x/rules/max-lines', v),
    page('https://github.com/a/b/blob/main/README.md'), page('https://example.com/project/readme'), page('https://example.com'), page('https://example.org/'),
    page('https://Mirror.example.net/Docs/Max-Lines.HTML?x=1#top'), page('https://example.com/a/faq/'), page('https://example.org/b/faq'),
    page('https://example.org/copy/max-depth.html', { claims: [] }), page('https://example.com/x/index.html'), page('https://example.org/y/index'),
    page('https://one.example/guide/setup'), page('https://one.example/v2/guide/setup'), page('https://two.example/setup.md'),
    page('https://one.example/v3/setup'), page('https://three.example/tagged/v9/max-lines.md', v),
  ];
  let prompt = '';
  const agent = async (text, opts) => (opts.phase === 'Recon' ? 'none' : opts.phase === 'Research' ? { pages: structuredClone(lanePages) } : ((prompt = text), { status: 'complete', lint: '' }));
  const AsyncFunction = (async () => {}).constructor;
  const out = await new AsyncFunction('agent', 'parallel', 'pipeline', 'phase', 'log', 'args', 'budget', 'workflow', script.replace(/^export /, ''))(
    agent, (fns) => Promise.all(fns.map((f) => f())), null, () => {}, () => {}, { question: 'q', cli: '/cli', vault: '/v', today: '2026-11-17', runKey: 'run-test73', storeText: true, lanes: ['one lane'], pagesPerLane: 4 });
  const want = [null, 0, null, null, null, null, null, null, 0, null, 9, null, null, null, null, null, 14, null, 3];
  assert.deepEqual(JSON.parse(prompt.slice(prompt.lastIndexOf('PAGES: ') + 7)).map((p) => p.maybeSameAs ?? null), want, 'marks in the Write prompt');
  assert.deepEqual(out.pages.map((p) => p.maybeSameAs ?? null), want, "marks in the script's return");
  for (const s of [
    '1. Sources. Leave out every page that has maybeSameAs: step 3 decides whether it gets a source.',
    'If more than half of this page\'s quotes are found, the two pages are one document: run no capture and no fill for this page; its row has status reused, the sourceId of page <maybeSameAs>, the reason "same document as page <maybeSameAs>"',
  ]) assert.ok(script.includes(s), s);
  for (const s of [
    'capture each `source`, a page marked `maybeSameAs` only when the quote check says it is another document or the page the mark names has no source or failed;',
    'A page marked `maybeSameAs` gets no source of its own when more than half of its quotes are found in the text of the page the mark names',
    'The script\'s mark for one document at two addresses does not run here either: when two kept pages on different hosts have the same last path segment, less its extension, and the same subject version or none on both, and that name is not "index" or "readme"',
  ]) assert.ok(skill.includes(s), s);
});

test('teach profile formats share their markers and interview references', () => {
  const skill = read('skills/research-teach/SKILL.md');
  const mission = read('skills/research-teach/MISSION-FORMAT.md');
  for (const text of ['- Draft:', '- Depth:', 'teach-profile']) {
    assert.ok(skill.includes(text), `skill lacks ${text}`);
    assert.ok(mission.includes(text), `mission format lacks ${text}`);
  }
  assert.ok(skill.includes('--topic teach-profile'));
  assert.ok(mission.includes('--topics teach-profile'));
  assert.ok(skill.includes('AUTHOR-INTERVIEW.md'));
  const rule = read('skills/research-teach/PATH-FORMAT.md').split('\n').find(line => line.startsWith('- **Cut a profile'));
  assert.ok(rule.includes('PATH_PROJECT_AFTER'));
});
