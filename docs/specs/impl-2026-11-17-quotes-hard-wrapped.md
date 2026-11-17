# verify --quotes and hard-wrapped text (issue 77): implementation plan (2026-11-17)

<!-- evidence: 2026-11-17-facts-behind-issue-77-implementation-plan 2026-11-17-trial-planned-edits-issue-77-state 2026-11-17-lines-behind-issue-77-plan-at 2026-11-17-corrected-second-probe-issue-77-review -->

> **For agentic workers:** work the tasks in order. Steps use checkbox (`- [ ]`) syntax for tracking. Read the spec first.

**Goal:** `verify --quotes` finds a quote that is on one line of a source's text or runs over adjacent lines with no blank line between them.

**Architecture:** one new `hitsIn` in `bin/lib/quotes.mjs`, one changed test and two new tests, one sentence in each of three gated files, two `COUPLINGS` rows and one changelog line, in one commit. Nothing changes in `extract.mjs`, `fill.mjs` or `packet.mjs`.

**Tech stack:** Node (`node --version` printed v22.23.5 in this checkout; the facts entry), `node --test`, no dependencies.

**Spec:** `docs/specs/plan-2026-11-17-quotes-hard-wrapped.md`. Read it first. The names D1 to D7 below are its decisions (the facts entry, headings). The spec is a file of this repo, not a vault entry. This plan quotes one sentence and one heading of it, through the facts entry.

This plan rests on four vault entries. The experiment 2026-11-17-facts-behind-issue-77-implementation-plan ("the facts entry") holds the branch state after the push of b9a921b, the spec's decision headings, two steps of the claims-gate skill and one helper of the quotes test. The experiment 2026-11-17-trial-planned-edits-issue-77-state ("the trial") holds the sixteen planned edits as a script, `apply.mjs`, with the exact old and new text of each; a run of them in clones of the repo at commit b9a921b; and the gate state of two documents. The snippet 2026-11-17-lines-behind-issue-77-plan-at ("the snippet") quotes repo lines at that commit. The experiment 2026-11-17-corrected-second-probe-issue-77-review ("the second probe") holds the findings of the adversarial review of the spec. Nothing in this plan is built: the working tree is as it was.

## Global constraints

<!-- evidence: 2026-11-17-facts-behind-issue-77-implementation-plan 2026-11-17-lines-behind-issue-77-plan-at -->

- ESM only, no dependencies, no classes (the snippet, `AGENTS.md` line 17).
- Every change gets a line under `## [Unreleased]` in `CHANGELOG.md` (line 16).
- Five checks pass before the commit (lines 7 to 11): `npm test`, `npm run lint:self`, `node scripts/check-agentsmd-drift.mjs`, `node scripts/check-encoding.mjs`, `node bin/research-vault.mjs gate staged --check`.
- Instructions for this work, from the owner: change `docs/REFERENCE.md` and `docs/RELIABILITY.md` in this commit (the spec says of that choice "the owner decides"; the facts entry); put no Claude attribution on a commit; add a spec under `docs/specs/` with `git add -f`; run the claims gate for two rounds and then decide on merit; commit only when the owner asks; the work lands on `master` of the fork, and a side branch is removed after the push.

## Review focus

<!-- evidence: 2026-11-17-facts-behind-issue-77-implementation-plan 2026-11-17-trial-planned-edits-issue-77-state 2026-11-17-corrected-second-probe-issue-77-review -->

Inputs the tests do not cover. Each is accepted with no test, and this is a judgment.

- A quote found on a page that is fetched over the network. The new test gives the page path the `page` helper of `test/quotes.test.mjs`, which returns fixed bytes (the facts entry).
- Two table rows. The review lists them as adjacent lines that can join (the second probe, C3). The tests hold a heading with its text, and two list items.
- A sentence over five lines or more in a packet. The packet test holds a sentence over two lines.
- The time limit of the new test is two seconds on one input. In the trial's clone the whole suite passed with it; a slow machine was not tried.
- One mutation in the trial did not make a test fail: a blank line joined into a run. A blank line joined in gives two spaces, and a quote has one, so the quote is still not found (the trial, part 5).

---

### Task 1: the code, the tests, the three sentences, the rows and the changelog line

<!-- evidence: 2026-11-17-facts-behind-issue-77-implementation-plan 2026-11-17-trial-planned-edits-issue-77-state 2026-11-17-lines-behind-issue-77-plan-at -->

**Files:**
- Modify: `bin/lib/quotes.mjs` (edits 1 to 8)
- Modify: `test/quotes.test.mjs` (edit 9 changes one test; edit 10 appends one)
- Modify: `test/packet.test.mjs` (edit 11 appends one test)
- Modify: `docs/REFERENCE.md`, `docs/RELIABILITY.md`, `skills/research-orchestrate/SKILL.md` (edits 12, 13 and 14)
- Modify: `scripts/deps.mjs` (edit 15), `CHANGELOG.md` (edit 16)

The exact old and new text of every edit is in `apply.mjs` in the trial. Each old text occurred exactly once in its file at b9a921b (the trial). Find each place by its text. Make the edits by hand or with a copy of that script. The result must be the same but for two changes that this plan names: the comment of edit 1 (step 4) and the name of the test of edit 10 (step 2).

- [ ] **Step 1: start a branch.** `git switch -c fix/quotes-hard-wrapped` from `master`, which is at b9a921b (the facts entry).

- [ ] **Step 2: the tests first (edits 9, 10 and 11).**
  - Edit 9 changes the test at `test/quotes.test.mjs` line 38. Its new name starts "verify --quotes: a quote over two lines is found with its first line in the row". It asserts `lines` `[4]`, a `context` that holds both lines of the sentence, and two `quote-matched` rows, the first with `L4`.
  - Edit 10 appends a test to `test/quotes.test.mjs`. In `apply.mjs` its name ends "a body with no blank line is checked in linear time"; write "a body of 15,000 lines with no blank line is checked in under two seconds" in its place, because the time was measured at one size only. It asserts: a heading and the text under it are found as one quote, at line 3; two list items are found, at line 6; a quote across a blank line is not found, with the reason `not on one line or over adjacent lines of the stored text`; a sentence over two block quote lines is not found; a quote over two lines of a page from the `page` helper is found, with a `confirmed` row; sixteen quotes on 15,000 lines with no blank line are all found in under two seconds.
  - Edit 11 appends a test to `test/packet.test.mjs`. It asserts that the excerpt holds `L40` and `L41` of a sentence over two lines, and that the row holds `L40` and the run key.

- [ ] **Step 3: run them and see them fail.**

Run: `node --test test/quotes.test.mjs test/packet.test.mjs`
Expected: three tests fail: the changed test and the two new ones (the trial, part 2).

- [ ] **Step 4 (D2, D4): edit 1, the new `hitsIn` and `around`.** Replace the two lines that define `hitsIn` and `around` (lines 20 and 21) with the block below. It is edit 1 of `apply.mjs` with one change: the third comment line there ends ", so the time stays linear", and those words are left out here, because the time was measured at one size only.

```javascript
// A quote may run over adjacent lines with no blank line between them, joined by one space, so a
// sentence that a hard-wrapped file breaks over lines is found (issue 77). A hit is [first line, last line].
// Each line is tried with only as many of the next lines as the quote needs.
const hitsIn = (lines, q) => lines.flatMap((l, i) => {
  let t = l, j = i;
  while (l && lines[j + 1] && t.length < l.length + q.length) t += ' ' + lines[++j];
  const x = t.indexOf(q);
  if (x < 0 || x >= l.length) return [];
  let end = l.length, k = i;
  while (end < x + q.length) end += 1 + lines[++k].length;
  return [[i + 1, k + 1]];
});
const around = (lines, at, to = at) => lines.slice(Math.max(0, at - 3), to + 2).filter(l => l.trim()).join(' / ').slice(0, 900);
```

- [ ] **Step 5 (D2 to D5): edits 2 to 8, the comment, the places that use the hits, and the three reasons.**
  - Edit 2: the comment that begins "Is each quote on one line" says "on one line of a source's text, or over adjacent lines with no blank line between them".
  - Edits 3, 5 and 7: `lines` becomes `hits` where the hits are taken and tested, and `const lines = hits.map(h => h[0]);` follows the test for a miss.
  - Edits 4 and 6: each of the three reasons says "not on one line or over adjacent lines" in place of "not on any one line". Edit 6 also changes the page call to `hits = hitsIn(p.soft, quote)`.
  - Edit 8: the context is `around(src, hits[0][0], hits[0][1])`.

- [ ] **Step 6: run the two test files and see them pass.**

Run: `node --test test/quotes.test.mjs test/packet.test.mjs`
Expected: `# tests 10`, `# pass 10`, `# fail 0` (the trial, part 3). In the trial, each of the code edits 1, 3, 4, 5, 6, 7 and 8 left out in turn made at least one test fail (part 4).

- [ ] **Step 7 (D6): edits 12, 13 and 14, the three sentences.** Each gains the words ", or over adjacent lines with no blank line between them" after "one line of the text" or "one line of the source's text". In `docs/REFERENCE.md` and in the skill, "every line it occurs on" becomes "every line it starts on". The skill's sentence is inside the Write prompt (`scripts/deps.mjs` line 196, the snippet).

- [ ] **Step 8: edit 15, the two `COUPLINGS` rows.** After the row that couples `bin/lib/quotes.mjs` and the skill on `foundIn`, add one row for `docs/REFERENCE.md` and one for `docs/RELIABILITY.md`, each with the literal `quote-matched`.

- [ ] **Step 9: edit 16, the changelog line**, as the first line under `## [Unreleased]`. It names issue 77, the rule, the row's form, the `lines` and `context` fields, the new reason, and the two known limits.

- [ ] **Step 10: run `npm test` and `node scripts/deps.mjs`.** Expected: every test passes and `deps.mjs` exits 0. In the trial the full suite gave 757 tests, 757 pass (part 3).

### Task 2: a claims verdict for the three gated files

<!-- evidence: 2026-11-17-facts-behind-issue-77-implementation-plan 2026-11-17-trial-planned-edits-issue-77-state 2026-11-17-lines-behind-issue-77-plan-at -->

**Why:** `AGENTS.md` line 11 says every staged gated file must carry a verdict for its current content (the snippet). In this checkout (the trial, state of the documents):

- `docs/RELIABILITY.md` has no verdict and all six of its units are changed. `check --check` on it exits 1 with 11 uncovered ids and none covered.
- `docs/REFERENCE.md` has no verdict (`reviewer changed`); its changed units are four: `sec:commands/capture`, `sec:commands/verify`, `sec:commands/gate` and `sec:safety-network-and-egress`. `check --check` on it exits 1 with 14 uncovered ids. They are on lines 184, 186, 194 and 293, and on line 328 under `## Resumable capture (opt-in)`.
- The skill holds `MERIT`. Edit 14 changes one sentence of it.

Step 0 of the claims-gate skill says an `uncovered` row stops the gate (the facts entry). So every uncovered id of a document is replaced before its gate. Judgment: a replaced `evidence:` comment changes its unit, and the unit then needs a verdict. For `docs/REFERENCE.md` that makes five units: the four above and the unit of line 328. Judgment: this task is the larger part of the work. Its size is not measured.

**Files:**
- Modify: `docs/RELIABILITY.md`, `docs/REFERENCE.md` (the `evidence:` comments and the ids in the three table rows; a sentence only where a finding names it)
- Append: `GATE-LOG.md` at the repo root, for each merit decision
- Vault: new snippet and experiment entries

- [ ] **Step 1: load the `research-vault:research-claims-gate` skill and follow it** for each file. Run every command from the repo root with `node bin/research-vault.mjs`. The bound vault is the `vault` value of `.research-vault.json`.

- [ ] **Step 2: ask the owner one question before any edit to an evidence id.** The uncovered ids of the two documents are not in the bound vault. Ask: may they be replaced with ids from the local vault? Do not go on without the answer.

- [ ] **Step 3: `docs/RELIABILITY.md`, all six units.**
  - Build the evidence in the bound vault with the `research-vault:research-capture` skill: one snippet of the code and test lines behind what each section says, and one experiment of runs on a scratch vault for the behaviours the document states. Quote the lines at the commit of Task 1's branch.
  - Replace each `evidence:` comment with the new ids. Run `check --check`, then `gate evidence docs/RELIABILITY.md --changed`, then one `research-vault:claims-reviewer` per round. Two rounds, then a merit decision in `GATE-LOG.md`.

- [ ] **Step 4: `docs/REFERENCE.md`, the five units.** The same way. The three table rows of `capture`, `verify` and `gate` and the two sections each need their own evidence. Reuse an entry of step 3 where it covers a sentence.

- [ ] **Step 5: the skill, one unit.** Run `gate changed skills/research-orchestrate/SKILL.md` to name the unit. The trial and the snippet cover the changed sentence. Add their ids to that section's `evidence:` comment, run the gate over the changed unit, two rounds, then merit.

- [ ] **Step 6: after every round run `node --test test/skills.test.mjs test/deps.test.mjs`.** `scripts/deps.mjs` has rows for the skill, and `test/skills.test.mjs` reads it (the facts entry). If a finding changes a sentence of Task 1, tell the owner that this plan's step no longer matches; do not edit this plan.

- [ ] **Step 7: record and confirm.** Record each verdict as step 4 ("Record") of the claims-gate skill says (the facts entry), then check that `gate status <file> --check` exits 0 for each of the three files.

A sentence that describes what an agent does, and that no line of the repo shows, is narrowed or marked as an instruction, not given a made-up source.

### Task 3: checks, then the commit when the owner asks

<!-- evidence: 2026-11-17-facts-behind-issue-77-implementation-plan 2026-11-17-lines-behind-issue-77-plan-at -->

- [ ] **Step 1: stage.** `git add bin/lib/quotes.mjs test/quotes.test.mjs test/packet.test.mjs docs/REFERENCE.md docs/RELIABILITY.md skills/research-orchestrate/SKILL.md scripts/deps.mjs CHANGELOG.md` and `git add -f docs/specs/plan-2026-11-17-quotes-hard-wrapped.md docs/specs/impl-2026-11-17-quotes-hard-wrapped.md`.

- [ ] **Step 2: run the five checks** of "Global constraints". Each must pass. Both spec files must hold a verdict for their current content: check each with `gate status <file> --check`. Do not edit them in this work.

- [ ] **Step 3: show the owner the diff and the check results, and wait.** Commit only on the owner's word. Suggested message: `fix(verify): a quote over adjacent lines of a hard-wrapped text is found (#77)`. No attribution lines.

- [ ] **Step 4: after the owner's word, land it.** Fast-forward `master`, push `master` to the fork, and remove the branch.

- [ ] **Step 5: tell the owner what is left.** Issue 77 is in `andrew-brooks-GA/research-vault`, the `upstream` remote (the facts entry), so a commit on the fork does not close it. By the owner's instruction a pull request comes later. Say which limits of the spec's section "Not shown by this plan" (the facts entry) still stand.

## Not shown by this plan

- `gate staged --check` was not run on the staged edits: the trial's clones have no binding and no ledger.
- The size of Task 2.
- No live research-orchestrate run was made with the new rule.
