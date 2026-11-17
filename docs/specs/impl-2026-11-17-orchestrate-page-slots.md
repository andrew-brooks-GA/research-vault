# Orchestrate page slots (issues 74, 75 and 76): implementation plan (2026-11-17)

<!-- evidence: 2026-11-17-second-trial-planned-skill-edits-widened 2026-11-17-trial-planned-skill-edits-test-issues 2026-11-17-lines-behind-orchestrate-page-slot-plan 2026-11-17-second-lines-behind-orchestrate-page-slot 2026-11-17-probe-orchestrate-skill-s-gate-state -->

> **For agentic workers:** work the tasks in order. Steps use checkbox (`- [ ]`) syntax for tracking. Read the spec first.

**Goal:** the reference script of `skills/research-orchestrate/SKILL.md` hands the Write step an https address in place of an `http://` address with no port and no password, and no version on an address with a floating path segment, and its prompts steer away from a PDF.

**Architecture:** five text edits to one skill file, one new test, one `COUPLINGS` row and one changelog line, in one commit. Nothing changes in `bin/`.

**Tech stack:** Node 22 (the trials ran v22.23.5), `node --test`, no dependencies.

**Spec:** `docs/specs/plan-2026-11-17-orchestrate-page-slots.md`. Read it first. The names D1, D1b, D2, D3 and D4 below are its decisions. The spec is a file of this repo, not a vault entry, and this plan quotes nothing from it.

This plan rests on five vault entries. The experiment 2026-11-17-trial-planned-skill-edits-test-issues ("the first trial") holds a run of the first draft's edits and test in the working tree, which was then undone, and a run of `gate staged --check` on the staged skill. The experiment 2026-11-17-second-trial-planned-skill-edits-widened ("the trial") holds a run of the edits and the test below, as they now stand, in a scratch copy, and the eight findings (B1 to B7 and what held) of an adversarial review of this plan's first draft. The snippets 2026-11-17-lines-behind-orchestrate-page-slot-plan ("the snippet") and 2026-11-17-second-lines-behind-orchestrate-page-slot ("the second snippet") quote the repo lines. The experiment 2026-11-17-probe-orchestrate-skill-s-gate-state ("the gate probe") shows the skill's verdict state. Nothing in this plan is built: the tree is as it was before the first trial.

## Global constraints

<!-- evidence: 2026-11-17-lines-behind-orchestrate-page-slot-plan -->

- ESM only, no dependencies, no classes (the snippet, `AGENTS.md` line 17).
- Every change gets a line under `## [Unreleased]` in `CHANGELOG.md` (line 16).
- A copied value shared by two files gets a `COUPLINGS` row in `scripts/deps.mjs` (line 18).
- Five checks pass before the commit (lines 7 to 11): `npm test`, `npm run lint:self`, `node scripts/check-agentsmd-drift.mjs`, `node scripts/check-encoding.mjs`, `node bin/research-vault.mjs gate staged --check`.
- The reference script stays a Workflow script: no import (`test/skills.test.mjs` line 119). This plan's own choice: it also keeps the new lines to string and regular-expression methods, with no `new URL`.
- Instructions for this work: put no Claude attribution on a commit; add a spec under `docs/specs/` with `git add -f`; run the claims gate for two rounds and then decide on merit; commit only when the owner asks.

## Review focus

<!-- evidence: 2026-11-17-second-trial-planned-skill-edits-widened 2026-11-17-trial-planned-skill-edits-test-issues -->

Inputs the test does not cover. Each is accepted with no test, and this is a judgment.

- The test's port address and password address (`http://example.com:8080/x`, `http://user:pw@example.com/x`) are not rewritten. `fill.mjs` line 73 refuses a `source_url` that is not https (the snippet). The test covers that the address is left alone, not what the fill then does.
- An https form that does not answer: `fill.mjs` lines 79 and 80 return `unreachable` (the snippet). No run was made.
- A directory named with one of the nine words makes a page lose its version. The test has `latest` and `Main` as path segments; the other seven words are in the same regular expression and were not run.
- A lane that does not obey the PDF sentence. No test can show what a lane does.

---

### Task 1: the test, the five edits, the row and the changelog line

<!-- evidence: 2026-11-17-second-trial-planned-skill-edits-widened 2026-11-17-trial-planned-skill-edits-test-issues 2026-11-17-lines-behind-orchestrate-page-slot-plan 2026-11-17-second-lines-behind-orchestrate-page-slot -->

**Files:**
- Modify: `test/skills.test.mjs` (append one test at the end of the file)
- Modify: `skills/research-orchestrate/SKILL.md` (five places)
- Modify: `scripts/deps.mjs` (one row, after the row at line 200)
- Modify: `CHANGELOG.md` (one line under `## [Unreleased]`)

Line numbers are for commit 237720a, before any edit. Step 5 adds eight lines, so the places of steps 6, 7 and 8 are eight lines lower once it is done (B6); find each by its text. Each old text below occurred exactly once in the skill at that commit (the trial's patch script fails otherwise, and it ran).

- [ ] **Step 1: start a branch.** `git switch -c fix/orchestrate-page-slots` from `master`.

- [ ] **Step 2: append the failing test to `test/skills.test.mjs`.** The file already defines `read` and imports `test` and `assert`.

```javascript
// Issues 74, 75 and 76: the script repairs an address before the Write step, and the prompts say the rest.
test('the orchestrate script hands the Write step https addresses and no version on a floating address', async () => {
  const skill = read('skills/research-orchestrate/SKILL.md');
  const script = skill.slice(skill.indexOf('## 2. Run the workflow')).match(/```javascript\n([\s\S]*?)\n```/)[1];
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
  const inFill = read('bin/lib/fill.mjs').match(/const FLOATING = new Set\(\[([^\]]*)\]\)/)[1].replace(/['\s]/g, '').split(',');
  const inScript = script.match(/const FLOATING = \/\\\/\(([^)]*)\)/)[1].split('|');
  assert.deepEqual(inScript, inFill);
  for (const s of ['[--subject-name <subjectName>] [--subject-version <subjectVersion>]', 'Pass each of the two only when the page has that field; never make up a version.', 'A PDF cannot be checked: where a paper or a report has an HTML page of its full text, read that page and give its address; give a PDF address only when there is none, and its quotes will then stay unchecked.']) assert.ok(script.includes(s), s);
  for (const s of ['A PDF source answers `no-text`', '`capture --fill <id> --content-file <file> --ack-data-egress`']) assert.ok(skill.includes(s), s);
  // Section 3 gives the same nine words by hand.
  const byHand = skill.slice(skill.indexOf("The script's address repair does not run here")).split('\n')[0];
  assert.deepEqual([...byHand.matchAll(/`([a-z]+)`/g)].map((m) => m[1]), inFill);
  for (const s of ['give an `http://` address with no port in its `https://` form', 'pass no `--subject-version`']) assert.ok(byHand.includes(s), s);
});
```

- [ ] **Step 3: run it and see it fail.**

Run: `node --test --test-name-pattern="hands the Write step" test/skills.test.mjs`
Expected: `# pass 0`, `# fail 1` (the trial, "before the skill edit").

- [ ] **Step 4 (D2): the lane prompt, line 68.** After the sentence `For a file on a code host give the address of the raw file.` add, on the same line:

```
 A PDF cannot be checked: where a paper or a report has an HTML page of its full text, read that page and give its address; give a PDF address only when there is none, and its quotes will then stay unchecked.
```

- [ ] **Step 5 (D1): the script, before the comment at line 70.** Insert these lines above `// A page two lanes both read is kept once, with both lanes' claims.`:

```javascript
// Issue 76: the fetcher is https-only, so an http address is tried in its https form.
// Issue 74: capture --fill answers version-floating for a version on a floating address, so the version is dropped.
// The words are FLOATING in bin/lib/fill.mjs.
const FLOATING = /\/(latest|master|main|stable|current|head|nightly|dev|trunk)(\/|$)/i
for (const p of researched) {
  p.url = p.url.replace(/^http:\/\/(?=[^/?#:]*([/?#]|$))/i, 'https://')
  if (FLOATING.test(p.url.replace(/[?#].*$/, '').replace(/^https:\/\/[^/]*/i, ''))) delete p.subjectVersion
}
```

- [ ] **Step 6 (D1b): the Write prompt, lines 84 and 85.** Replace

```
[--subject-name <subjectName> --subject-version <subjectVersion>]${V}
Never pass --force.
```

with

```
[--subject-name <subjectName>] [--subject-version <subjectVersion>]${V}
Pass each of the two only when the page has that field; never make up a version. Never pass --force.
```

- [ ] **Step 7 (D3): section 2, the end of line 102.** After `` (`capture --fill <id> --discard` is for a person to run). `` add:

```
 A PDF source answers `no-text`: a person who needs its text converts the paper to a `.txt` file and runs `capture --fill <id> --content-file <file> --ack-data-egress`.
```

The flag `--ack-data-egress` is needed: `bin/lib/fill.mjs` line 57 throws without it (the trial; B1).

- [ ] **Step 8 (D4): section 3, the end of line 106.** After `Only the parallelism is lost.` add:

```
 The script's address repair does not run here, so do it by hand: give an `http://` address with no port in its `https://` form, and pass no `--subject-version` for an address whose path has a floating segment (`latest`, `master`, `main`, `stable`, `current`, `head`, `nightly`, `dev` or `trunk`).
```

- [ ] **Step 9: run the test and see it pass.**

Run: `node --test --test-name-pattern="hands the Write step" test/skills.test.mjs`
Expected: `# pass 1`, `# fail 0` (the trial, "after the skill edit"). In the trial each of fifteen single mutations of the edited skill made this test fail. Ten are mutations of D1's lines, one of them a word dropped from the script's list; the other five are a word dropped from section 3's list, two of D1b's sentence and bracket, and one each of D2 and D3 (all listed in the trial).

- [ ] **Step 10: the `COUPLINGS` row.** In `scripts/deps.mjs`, after the row that couples `bin/lib/fill.mjs` and the skill on `version-floating` (line 200), add:

```javascript
  ['bin/lib/fill.mjs', 'skills/research-orchestrate/SKILL.md', 'the script\'s FLOATING regular expression and the list in section 3 copy the nine words of FLOATING in fill.mjs; test/skills.test.mjs compares the three lists', 'nightly'],
```

The literal `nightly` is in both files once step 5 is done. With the row in place `node scripts/deps.mjs` exited 0 and the full suite passed, `test/deps.test.mjs` included (the trial).

- [ ] **Step 11: the changelog line.** In `CHANGELOG.md`, as the first line under `## [Unreleased]`, add:

```
- research-orchestrate (#74, #75, #76): the reference script gives the Write step an `http://` address with no port and no password in its `https://` form and drops `subjectVersion` when the path matches the script's copy of `FLOATING` in `bin/lib/fill.mjs`, so those pages no longer meet the https test or the floating-version test as `fill.mjs` lines 73 to 75 read; the Write prompt takes `--subject-name` and `--subject-version` each by itself and must not make up a version; the lane prompt asks for an HTML page of a paper's full text in place of a PDF; section 2 says a person supplies a PDF's text with `capture --fill <id> --content-file <file> --ack-data-egress`, and no PDF reader is built; section 3 gives the two address rules in words. One test runs the script with stub hooks. By the duplicate check on URL and version (`capture.mjs` line 51; issue 72 item 8), a floating address the vault already holds with a version gets a second, versionless source when a later run reads it again.
```

- [ ] **Step 12: run `npm test` and `node scripts/deps.mjs`.** Expected: every test passes and `deps.mjs` exits 0. In the trial the full suite gave 755 tests, 755 pass.

### Task 2: a claims verdict for the whole skill file

<!-- evidence: 2026-11-17-second-trial-planned-skill-edits-widened 2026-11-17-trial-planned-skill-edits-test-issues 2026-11-17-probe-orchestrate-skill-s-gate-state 2026-11-17-second-lines-behind-orchestrate-page-slot -->

**Why:** with the edited skill staged, `gate staged --check` printed `skills/research-orchestrate/SKILL.md: none` and exited 1 (the first trial). `gate status` lists all ten units of the file as changed, and the two ids on its `evidence:` comment at line 6 are not in the bound vault (the gate probe). So the whole file needs a verdict in this checkout, as item 12 of issue 72 describes (the second snippet).

**Files:**
- Modify: `skills/research-orchestrate/SKILL.md` (the `evidence:` comments only)
- Append: `GATE-LOG.md` at the repo root, if a merit decision is made
- Vault: new snippet and experiment entries

- [ ] **Step 1: load the `research-vault:research-claims-gate` skill and follow it.** The steps below say only what is particular to this file. Run every command from the repo root with `node bin/research-vault.mjs`. The bound vault is the `vault` value of `.research-vault.json`.

- [ ] **Step 2: ask the owner one question before any edit to the `evidence:` comment (B5).** The two ids at line 6 are not in the bound vault. New ids will be from this machine's vault. Ask: may line 6 be replaced with ids from the local vault? Do not go on without the answer.

- [ ] **Step 3: build the evidence in the bound vault.** Make each entry with the `research-vault:research-capture` skill, as a `snippet` whose body quotes lines with their numbers. Quote the lines at commit 237720a; this commit changes nothing in `bin/`, and in `docs/` only the two spec files. Judgment: the least that covers the file is:
  - one snippet of the CLI lines behind what each section says a command does; read each section to list the commands it names;
  - one snippet of the lines of each document a section names;
  - the five entries this plan cites, which already cover the five edited places.
  A sentence that describes what an agent or the Workflow tool does, and that no line of the repo shows, is narrowed or marked as an instruction, not given a made-up source. No live research-orchestrate run is needed for this commit.

- [ ] **Step 4: write the `evidence:` comments.** Replace the comment at line 6 with the new ids, and give each `##` section its own `<!-- evidence: ... -->` line under its heading. Keep every comment outside the fenced `javascript` block.

- [ ] **Step 5: run the gate.** `check --check skills/research-orchestrate/SKILL.md`, then `gate evidence skills/research-orchestrate/SKILL.md --changed`, then one `research-vault:claims-reviewer` per round with the prompt the skill gives. Two rounds, then a merit decision in `GATE-LOG.md`. After round two change only the sentences a finding names.

- [ ] **Step 6: after every round run `node --test test/skills.test.mjs test/deps.test.mjs`.** Many sentences of the skill are pinned by those tests and by `COUPLINGS` literals. If a finding changes one of the sentences of Task 1, change the matching string in the test, and tell the owner that this plan's step no longer matches; do not edit this plan.

- [ ] **Step 7: record and confirm.** Record the verdict as step 4 of the claims-gate skill says, then check that `gate status skills/research-orchestrate/SKILL.md --check` exits 0.

Judgment: this task is the larger part of the work. Its size is not measured.

### Task 3: checks, then the commit when the owner asks

<!-- evidence: 2026-11-17-lines-behind-orchestrate-page-slot-plan -->

- [ ] **Step 1: stage.** `git add skills/research-orchestrate/SKILL.md test/skills.test.mjs scripts/deps.mjs CHANGELOG.md` and `git add -f docs/specs/plan-2026-11-17-orchestrate-page-slots.md docs/specs/impl-2026-11-17-orchestrate-page-slots.md`.

- [ ] **Step 2: run the five checks** of "Global constraints". Each must pass. Both spec files must hold a verdict for their current content: check each with `gate status <file> --check`. Do not edit them in this work.

- [ ] **Step 3: show the owner the diff and the check results, and wait.** Commit only on the owner's word. Suggested message: `fix(orchestrate): the script repairs http and floating-version addresses before the Write step (#74, #75, #76)`. No attribution lines.

- [ ] **Step 4: tell the owner what is left for them.** Issues 74, 75 and 76 are closed by their owner: this session's account has read permission only on the upstream repo. Issue 74's own condition names "the lane prompt or Write step"; say that D1 runs between the two and D1b is in the Write step, and let the owner accept it or not.

## Not shown by this plan

- No lane and no live run was made. The first run after the commit is the first real test.
- The size of Task 2.
- One test in `test/teach-labs.test.mjs` failed once in a full run during the first trial and did not fail in two later full runs. It was not investigated.
