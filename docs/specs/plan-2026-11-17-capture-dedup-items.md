# Plan: a title clash is an error, and one URL with and without a version is paired (issue 72, items 7 and 8) (2026-11-17)

<!-- evidence: 2026-11-17-capture-dedup-lines-behind-plan-issue 2026-11-17-probe-issue-72-items-7-8 2026-11-17-capture-version-librarian-lines-behind-plan 2026-11-17-lines-behind-plan-issue-72-items 2026-11-17-trial-issue-72-items-7-8 2026-11-17-more-lines-behind-plan-issue-72 2026-11-17-gate-globs-research-vault-plugin-repo -->

Items 7 and 8 of issue 72 are about `capture` without `--operation-id`. Item 7: a source whose title gives an id another entry holds is reported as a duplicate of that entry, and in `--batch` its URL is captured nowhere. Item 8: one URL captured once with a subject version and once without becomes two sources, and `advise` lists no pair. This plan fixes each in its own commit with its own test. Items 1 to 6 have their own plan, and item 9 is done (commit 4a2b36e, the commit snippet). Nothing in this plan is built yet. This is the plan as revised after an adversarial review of its first draft, which made nine findings, G1 to G9 (the trial).

The plan rests on seven vault entries:

- The snippet 2026-11-17-capture-dedup-lines-behind-plan-issue ("the snippet") quotes repo lines at commit 4a2b36e and the text of items 7 and 8.
- The snippet 2026-11-17-capture-version-librarian-lines-behind-plan ("the second snippet") quotes, at the same commit, where `capture` stores a subject version, the supersede-suspect lines of `skills/research-librarian/SKILL.md` and line 59 of `skills/research-teach/SKILL.md`.
- The snippet 2026-11-17-lines-behind-plan-issue-72-items ("the operation snippet"), made for the plan of items 1 to 6, quotes `bin/lib/capture-operation.mjs` at the same commit.
- The snippet 2026-11-17-more-lines-behind-plan-issue-72 ("the commit snippet"), made for the plan of items 1 to 6, holds the subject of commit 4a2b36e.
- The snippet 2026-11-17-gate-globs-research-vault-plugin-repo ("the binding snippet") holds this repo's binding on this machine and its gate globs.
- The experiment 2026-11-17-probe-issue-72-items-7-8 ("the probe") reproduces both items in scratch vaults at commit 4a2b36e.
- The experiment 2026-11-17-trial-issue-72-items-7-8 ("the trial") holds the review's findings one line each, writes the revised edits into a copy of the repo, and runs the new tests, the whole suite and fourteen changes to the code on it.

A sentence about the code cites a snippet. A sentence about behaviour cites the probe or the trial. A sentence marked "Judgment" is this plan's choice, not a fact.

## What exists

<!-- evidence: 2026-11-17-capture-dedup-lines-behind-plan-issue 2026-11-17-probe-issue-72-items-7-8 2026-11-17-capture-version-librarian-lines-behind-plan -->

- **Two kinds of refusal share one form.** In `bin/commands/capture.mjs`, `prepareEntry` first looks for a source at the same normalised URL and subject version (lines 45 to 58). Then it makes the id from the date and title and refuses it when an entry of any folder, or an earlier spec of the batch, holds it (lines 61 to 66). A URL match with unchanged content (line 56) and an id clash (line 66) both return `dedup` with `ambiguous: false`; a URL match with changed content is `ambiguous` (line 54). Lines 301 and 302 print both as `duplicate of <id> (...)`, and `--batch` lists both under `skipped` (line 209) (the snippet).
- **The version the URL check uses.** Line 47 takes the version for the URL check from `opts.subjectVersion`. Line 80 stores a subject, and with it the version, only when `opts.subjectName` is given (the snippet, the second snippet).
- **Item 7 at the CLI.** In the probe, a source at another URL whose title gave a taken id printed `duplicate of 2026-11-17-install-guide (entry id 2026-11-17-install-guide already exists in sources/ (supersede via verify, do not overwrite)); run verify instead.` and exited 1, the same exit as a repeated URL. A question whose title gave the id of a source printed the same form.
- **Item 7 in `--batch`.** In the probe, a batch of two sources, the first at another URL with a taken id, exited 0, listed the first under `skipped` with the other page's id, and created the second. No source held the first URL.
- **Who reads the message.** The Write step of `skills/research-orchestrate/SKILL.md` (line 106, inside the script block) tells a repeated URL from a title clash by the text in the brackets. `docs/RELIABILITY.md` line 32 says a title clash "is also refused with a message that begins `duplicate of`". `scripts/deps.mjs` line 35 couples `capture.mjs` and the skill on the literal `existing entry with same url` (the snippet).
- **Item 8.** In the probe, a URL captured with `--subject-name tool --subject-version 1.0` and then without a version under another title gave two sources; a third capture without a version was a duplicate of the second. `advise --json` listed no pair: `supersedeSuspects` and `nearDuplicates` were both empty. `listSupersedeSuspects` (lines 99 to 109 of `bin/lib/advise.mjs`) skips a pair whose versions differ, absent and empty counting as one, and `listNearDuplicates` skips a pair with equal URLs (the snippet).
- **The tests.** The test at line 250 of `test/capture.test.mjs` asserts (lines 257 and 258) that capturing one note twice gives `dedup` with "already exists". The test that starts at line 465 asserts at line 472 that an experiment whose title gives the id of a snippet gives `dedup` with the reason `entry id ... already exists in snippets/ (supersede via verify, do not overwrite)`. The test at line 226 of `test/advise.test.mjs` asserts at line 240 which pairs are supersede suspects; it includes two sources at one URL at versions 1 and 2, which are not paired (the snippet).

## Decisions

<!-- evidence: 2026-11-17-capture-dedup-lines-behind-plan-issue 2026-11-17-capture-version-librarian-lines-behind-plan 2026-11-17-lines-behind-plan-issue-72-items 2026-11-17-trial-issue-72-items-7-8 -->

The exact text of the edits is the two scripts and the diff in the trial.

**D1. Item 7: the URL check uses the version `capture` stores (G1).** Line 47 becomes `verKey(opts.subjectName ? opts.subjectVersion : null)`. Judgment: without it, a source given a version and no subject name misses its own URL match, so D2 would turn a second capture of the same page into an error. In the trial, such a page captured twice gave `duplicate of ... existing entry with same url` with exit 1, and a batch of it run twice skipped it the second time.

**D2. Item 7: a clash with another entry is an error.** In `prepareEntry`, when the id is held, the folder that holds it is found: on disk, or the folder of the earlier spec of the batch. When the entry being captured is a source, or that folder is not its own folder, `prepareEntry` throws `id taken: entry id <id> already exists in <folder>/ and is another entry; give this entry a more specific title`. Otherwise it returns the `dedup` it returns now. Judgment on each part:

- With D1, a source gets to the id check only when no entry holds its URL at the version it would store, so an entry that holds its id is another page, or the same page at another version. An entry in another folder is of another type. Either way the id belongs to another entry.
- An entry of the same non-source type with the same title may be the same entry captured twice; nothing tells the two cases apart, so that case stays a duplicate: in the trial, a question captured twice at the CLI was still a duplicate.
- A thrown error is what `prepareEntry` already does for a blocked source or a missing field. The dispatcher prints `error: <message>` and exits 2 (`bin/research-vault.mjs` lines 46 to 48, the snippet), and `runSpecs` lists it under `errors` with its index, so a batch without `--continue` writes nothing; line 271 returns 1 when `errors` is not empty (the snippet). That is the "exit differently" the issue suggests, and a batch no longer drops a URL without an error.

**D3. Item 7: the readers.** The skill's Write step reads `"error: id taken: ...": the TITLE gives the id of another entry; do NOT use that id, make the title more specific and capture again.` in place of its `duplicate of <id> (entry id ... already exists ...)` clause. `docs/RELIABILITY.md` line 32 says such a page "is refused with an error that begins `id taken` and exit code 2, and in a `--batch` it is listed under `errors`, not `skipped`". `scripts/deps.mjs` line 35 keeps its literal with a narrower reason, and two rows are added on the literal `id taken`: `capture.mjs` with the skill, and `capture.mjs` with `docs/RELIABILITY.md`.

**D4. Item 8: `advise` pairs one URL with a version and without one.** In `listSupersedeSuspects`, two live entries of one type with the same `source_url`, only one of which has a subject version, absent and empty counting as none, are paired with the field `source_url-unversioned` (G5). Two versions of one URL are still not paired. Judgment: the issue says the two sources are "possibly intended" and that `advise` "could list such pairs". `capture` cannot know whether the page without a version is of that version, so it keeps capturing both, and `advise` shows the pair to a person.

**D5. Item 8: the readers.** The `advise` row of the command table in `docs/REFERENCE.md` and the supersede-suspect line of `skills/research-librarian/SKILL.md` (line 17, the second snippet) name the new pair. The librarian skill's guide to judging a pair (line 20) gains guidance for it (G6): when the address floats (`latest`, `main`, `stable` and the like), mark the entry with a version `outdated`, superseded by the one without; otherwise, when the page is of one of the versions captured, mark the entry without a version `outdated`, superseded by the entry of that version; when it is of none, give it its own `subject.version`. A row joins `bin/lib/advise.mjs` and the librarian skill on the literal `source_url-unversioned`.

**D6. Tests.** In `test/capture.test.mjs`, one new test for item 7, with `spawnSync` and `runBatch` imported at the top of the file (G9):

- At the CLI, a source at another URL with a taken id exits 2 with `error: id taken: ... in sources/`, and a question with the id of a source exits 2. The first URL again is still `duplicate of ... existing entry with same url` with exit 1, and a question captured twice is still `duplicate of ... already exists in questions/` with exit 1.
- In `runBatch`, a clash with a source on disk, a clash between two sources of one batch and a clash between a source and a question of one batch (G3) each give one error at the clashing index, and nothing is created.
- A source given a version and no subject name, captured twice at the CLI and in a batch run twice, is a duplicate and a skip the second time (G1).

The test of line 465 changes to expect the error. In `test/advise.test.mjs`, one new test for item 8: one URL at version 1.0 and without a version is paired with the new field, in the return value of `advise()` and in the text output; one URL at versions 2 and 3 is not; a pair whose second entry is superseded is not; one URL with version `''` and with none is paired as `source_url` (G4).

In the trial, the two tests failed on a copy of the commit with only the tests added, and passed with the edits. They failed with each of fourteen changes to the code, one at a time, among them the first draft's URL check, a batch clash given the folder of the entry being captured, and an empty version counted as a version. With all the edits, `npm test` gave 762 of 762, and the encoding, drift and lint checks passed.

**D7. Changelog.** One line under `## [Unreleased]` in `CHANGELOG.md` for each commit.

## Left out, and why

<!-- evidence: 2026-11-17-capture-dedup-lines-behind-plan-issue 2026-11-17-capture-version-librarian-lines-behind-plan 2026-11-17-lines-behind-plan-issue-72-items 2026-11-17-trial-issue-72-items-7-8 -->

- **A different exit code for a title clash than for other errors.** Judgment: exit 2 with `error: id taken` is told apart from a duplicate (exit 1) by its code and from other errors by its words, as the skill already reads them.
- **`ingest` of a URL list whose pages share a title (G2).** In the review's run of the first draft, a URL list of three pages sharing a title gave no entry and two `id taken` errors, and the error's advice cannot be followed in a URL list (the trial, the review's record). Judgment: at the commit those pages were skipped and their URLs captured nowhere, which is the fault item 7 reports; an error is the better of the two. A title from the URL as well is a change to `ingest`, left for when it is asked for.
- **A warning at capture time for item 8.** Judgment: `capture` cannot tell whether the two captures are one page; `advise` is where a person judges pairs.
- **A refusal of a version with no subject name.** The `--operation-id` path refuses it (`bin/lib/capture-operation.mjs` line 56, the operation snippet). Judgment: D1 makes the legacy path consistent with what it stores without failing captures that work today.
- **`skills/research-teach/SKILL.md` line 59.** It says "the same URL at another version becomes its own entry" (the second snippet). Read from the code, not run (the snippet, lines 61 to 66, and the trial's diff): that was already true only when the title gives a free id; with D2 such a capture is an error, not a duplicate, and the sentence is no less true than before.
- **The `--operation-id` path.** It calls `prepareEntry` with `ignoreExisting: true` (`bin/lib/capture-operation.mjs` line 54, the operation snippet), so D1 and D2 do not reach it. There, a different entry with the planned id throws `destination conflict` (line 73), which line 154 reports as `DESTINATION_CONFLICT`, and an entry with the same type and bytes is reused.

## The commits

<!-- evidence: 2026-11-17-gate-globs-research-vault-plugin-repo 2026-11-17-lines-behind-plan-issue-72-items -->

Two commits, item 7 then item 8, on a branch from `master` after the commits of items 1 to 6. The first also adds this plan with `git add -f`. Before each: add the test, see it fail on the code as it stands, make the edit, see it pass, run the five checks of AGENTS.md, and run the claims gate on each gated file the commit changes. This repo's binding gates `docs/**/*.md` and `skills/**/*.md` among others (the binding snippet), so they are this plan in the first commit, `docs/RELIABILITY.md` and `skills/research-orchestrate/SKILL.md` for item 7, and `docs/REFERENCE.md` and `skills/research-librarian/SKILL.md` for item 8.

## Done when

- Each new test fails on the code of commit 4a2b36e and passes with the edits.
- The five checks pass on each commit.
- A comment on issue 72 says items 7 and 8 are done.

## Not shown by this plan

- An orchestrate run that meets the new error. The skill's new clause was not run by an agent.
- A vault where two entries share an id in two folders already; by line 64 and the diff, the error would name the first folder `TYPE_FOLDER` lists.
- `ingest` of a URL list whose pages share a title, with the revised edits; only the review ran that case, on the first draft's edits.
