# Plan: the `--operation-id` capture path, items 1 to 6 of issue 72 (2026-11-17)

<!-- evidence: 2026-11-17-lines-behind-plan-issue-72-items 2026-11-17-probe-issue-72-items-1-6 2026-11-17-temporary-file-names-research-vault-bin 2026-11-17-capture-dedup-lines-behind-plan-issue 2026-11-17-trial-issue-72-items-1-6 2026-11-17-more-lines-behind-plan-issue-72 2026-11-17-second-probe-issue-72-items-1 -->

Items 1 to 6 of issue 72 are faults in `bin/lib/capture-operation.mjs`, the code behind `capture --batch <plan> --operation-id <key>`. This plan fixes the six, each in its own commit with its own test, except item 4, which has no test. Item 9 is done (commit 4a2b36e, the more lines snippet). Items 7, 8 and 10 to 13 stay open for later plans. Nothing in this plan is built yet. This is the plan as revised after an adversarial review of its first draft, which made nine findings, F1 to F9 (the trial).

The plan rests on seven vault entries:

- The snippet 2026-11-17-lines-behind-plan-issue-72-items ("the snippet") quotes repo lines at commit 4a2b36e and the text of items 1 to 6 of issue 72.
- The experiment 2026-11-17-probe-issue-72-items-1-6 ("the probe") reproduces each item in a scratch vault at commit 4a2b36e, item 4 by `path.win32` and not on Windows.
- The snippet 2026-11-17-temporary-file-names-research-vault-bin ("the grep") holds a grep at commit 4a2b36e for `randomUUID` and `.tmp` in `bin`, `hooks` and `scripts`.
- The snippet 2026-11-17-capture-dedup-lines-behind-plan-issue ("the section 2 snippet"), made for the plan of items 7 and 8 at the same commit, quotes `skills/research-orchestrate/SKILL.md` lines 100 to 140.
- The snippet 2026-11-17-more-lines-behind-plan-issue-72 ("the more lines snippet") quotes `walkEntries`, `writeManifest` and the heading over `docs/RELIABILITY.md` line 16 at commit 4a2b36e, the subject of that commit, and the whole text of issue 72.
- The experiment 2026-11-17-second-probe-issue-72-items-1 ("the second probe") runs the planned edits in the cases the first round of the claims gate found unshown.
- The experiment 2026-11-17-trial-issue-72-items-1-6 ("the trial") holds the review's findings one line each, writes the revised edits into a copy of the repo, and runs the new tests, the whole suite and sixteen changes to the code on it.

A sentence about the code cites the snippet. A sentence about behaviour cites the probe, the second probe or the trial. A sentence marked "Judgment" is this plan's choice, not a fact.

## What exists

<!-- evidence: 2026-11-17-lines-behind-plan-issue-72-items 2026-11-17-probe-issue-72-items-1-6 2026-11-17-more-lines-behind-plan-issue-72 -->

- **Item 1, a killed writer.** Line 204 names a temporary file `<entry path>.<uuid>.tmp`. Line 208 writes it, line 210 links the entry to it, and the `finally` at line 214 unlinks it (the snippet). In the probe, a writer killed with SIGKILL at the `published` event left `questions/2026-11-17-first.md.<uuid>.tmp` beside the entry, with the receipt and the lock. `walkEntries` reads only names that end in `.md` (the more lines snippet, line 15), so the file is not read as an entry.
- **Item 2, the mode.** Line 208 writes with `mode: 0o600`. `writeEntry` passes no mode (the snippet). In the probe, with umask 022, the entry written by the operation had mode 600, and the entry written by `capture` without `--operation-id` had 644.
- **Item 3, a lock with no `owner.json`.** Line 132 makes the lock directory. Line 133 gives the same `LOCK_BUSY` message for any error and whatever the directory holds: "inspect owner.json and confirm the original process is gone before explicitly removing this lock". Line 135 writes `owner.json` after the directory is made (the snippet). In the probe, an empty `writer.lock` directory gave that message.
- **Item 4, Windows paths.** Line 82 stores `relative(vault, chosen.path)` as the row's path, and line 100 accepts a row only when its path is `<folder>/<id>.md` with a `/` (the snippet). In the probe, `path.win32.relative('C:\\v', 'C:\\v\\questions\\x.md')` gave `questions\x.md`, which is not that form. No run was made on Windows.
- **Item 5, a resumed reuse.** `prepare` reuses an existing source when it is a source at the planned URL and version (line 67), and refuses it when it is not active or its content hash or stored body differs from the plan's (line 70). It reuses another entry only when its bytes are the plan's (lines 71 to 75). On replay, lines 185 to 201 check a reused row as they check a written one: the file must be a regular file, readable as an entry, and its sha256 must equal the row's fingerprint. Line 187 skips a row that reuses a row still pending, and line 197 lets a pending row be absent (the snippet). In the probe, an operation reused a source and failed at its second row; `verify` then added a verification to the source; the replay stopped with `DESTINATION_CONFLICT` at index 0, "destination fingerprint changed".
- **Item 6, errors in reading the plan.** `input` (lines 32 to 43) throws at the first entry that is not an object or whose `contentFile` cannot be read, and the outer `catch` at line 229 reports one error. `prepare` (lines 62 to 94) collects one error per failing entry (the snippet). In the probe, a plan with two non-object entries gave one error, for index 0, and a plan with two missing `contentFile`s gave one error, for index 0.
- **The docs.** `docs/RELIABILITY.md` line 16 says that a replay refuses "changed files or missing previously completed files", and line 18 that "Validation reports one error for each entry that fails on its own" (the snippet).

## Decisions

<!-- evidence: 2026-11-17-lines-behind-plan-issue-72-items 2026-11-17-temporary-file-names-research-vault-bin 2026-11-17-capture-dedup-lines-behind-plan-issue 2026-11-17-trial-issue-72-items-1-6 2026-11-17-more-lines-behind-plan-issue-72 2026-11-17-second-probe-issue-72-items-1 -->

All code edits are in `bin/lib/capture-operation.mjs`, and all tests are appended to `test/capture-operation.test.mjs`. The exact text of the code edits and the tests is the script and the diff in the trial.

**D1. Item 1: the next lock holder removes the litter.** After the lock is taken and `owner.json` is written (line 135), the writer reads each folder of `ENTRY_FOLDERS` and unlinks every name that ends `.md.<uuid>.tmp`, with the uuid as eight, four, four, four and twelve lowercase hex digits; in the second probe, 10000 values of `randomUUID` all had that form. An error in the sweep is ignored. Judgment on each part:

- In `bin`, `hooks` and `scripts`, only line 204 names a temporary file `<entry path>.<uuid>.tmp` (the grep). Line 23 of `atomicJson` adds a uuid to the path of a JSON file, which `atomicJson` writes in `.capture-operations/` (the snippet, lines 109 and 135). `writeEntry` (`bin/lib/fsutil.mjs` line 33) and `writeManifest` (`bin/lib/manifest.mjs` line 96, inside the function that starts at line 93) add `.tmp` with no uuid (the grep, the more lines snippet). Only one writer holds the lock, so a file of that name found by the lock holder is a dead writer's. The entry it was linked to is a separate link and stays.
- In the second probe, a writer killed at the `artifact` event, before it writes the temporary file, left its row `pending`, and the replay with the edits created the entry and left no `.tmp`. A kill between the write and the link was not run; by the code (lines 210 and 211) the row is still `pending` then, so a replay writes the entry again and the temporary file is not the only copy that counts.
- Not chosen: writing the temporary file in `.capture-operations/`. Judgment, by the usual rule of hard links and not checked here: a link cannot join two file systems, and a vault's folders may not all be on one, while a temporary file beside the entry is on the entry's own.

**D2. Item 2: the default mode.** Line 208 drops `mode: 0o600`. With the edit, the entry the operation wrote had the mode of an entry `captureEntry` wrote: 644 under umask 022 (the second probe) and 664 under umask 002 (the trial). The receipt and `owner.json` keep 0600: `atomicJson` writes them in `.capture-operations/`, made with 0700 at line 128. Judgment: an entry is shared vault content; the receipt is private state.

**D3. Item 3: two messages.** When `mkdir` fails with `EEXIST` and the lock directory holds no `owner.json`, the message says the lock "holds no owner.json, so it names no process: confirm that no --operation-id capture is running before explicitly removing this lock". In any other case the message stays as it is (F4). Judgment: a lock with no `owner.json` can be a live writer's between line 132 and line 135, so the message tells the user to confirm, not to remove. `skills/research-orchestrate/SKILL.md` line 132 already says to read `owner.json` "if it is there" (the section 2 snippet), so the skill does not change.

**D4. Item 4: `/` in the receipt.** Line 82 stores `relative(vault, chosen.path).split(sep).join('/')`, and the comparison for `reuseOf` on the same line uses that value. `join(vault, row.path)` at lines 188 and 204 turns that path into a path of the platform: in the second probe, `path.win32.join('C:\\v', 'questions/x.md')` gave `C:\v\questions\x.md`. Judgment: the fix is one expression; no test can show it, because the suite does not run on Windows (below, "Not shown").

**D5. Item 5: a reused source is checked again by the rules it was reused by (F1).** The test of line 67 and the test of line 70 become two named helpers, `sameSource` and `suitable`, used by `prepare` as before. On replay, a `reused` row whose planned entry is a source passes when the file on disk passes both helpers; any other row, a question reused for its bytes among them, keeps the byte check. A reused entry that is gone still gives `DESTINATION_CONFLICT`. Judgment: the operation did not write a reused source, so an edit that keeps it what the plan asked for, such as a verification, is no conflict; an edit that `prepare` would refuse, such as a supersede, another URL or another type, still is. In the trial, the replay completed after a verification and gave `DESTINATION_CONFLICT` at index 0 for each of those three edits, for a removed source, and for a question reused for its bytes and then edited.

**D6. Item 6: every read error.** `input` catches the error of each entry, keeps its index, and throws the first with the list of all; the outer `catch` reports one `INPUT_INVALID` error per entry in the list. When any entry cannot be read, `prepare` does not run, so an entry that can be read and fails validation is not reported (F3). Judgment: that limit is the same as before the change, and D8 adds it to `docs/RELIABILITY.md`.

**D7. Tests.** Five tests, one each for items 1, 2, 3, 5 and 6:

- Item 1: a writer killed at `published` leaves one `.tmp`; a file `other.md.tmp` is added; after the lock is removed, the replay completes, and `other.md.tmp` is the only `.tmp` left.
- Item 2: under umask 002, the entry the operation writes and an entry `captureEntry` writes both have mode 664 (F5). Skipped on Windows.
- Item 3: an empty lock gives a message with "holds no owner.json" and without "inspect owner.json"; with `owner.json` added, the message has "inspect owner.json"; with `.capture-operations/` made mode 500, the message does not have "holds no owner.json" (F4). The last part is skipped on Windows and for root.
- Item 5: six cases of a source or a question reused by a second operation, which fails at its next row; the reused entry is then verified, removed, superseded, given another URL, given another type, or (the question) given another body. Only the verified case completes, with the source's bytes as the verification left them.
- Item 6: a plan with two non-object entries and two missing `contentFile`s gives four `INPUT_INVALID` errors, for indexes 0, 2, 3 and 4, and writes nothing (F6).

In the trial, the five tests failed on a copy of the commit with only the tests added, and passed with the edits. They failed with each of sixteen changes to the code, one at a time, but one: the item 4 change, which no test covers. The sixteen include the first draft's D5, `mode: 0o644` written in, and a fix that stops at the first unreadable `contentFile`. With the edits, `npm test` gave 765 of 765, and the encoding, drift and lint checks passed.

**D8. Docs and changelog.** One line under `## [Unreleased]` in `CHANGELOG.md` for each commit. `docs/RELIABILITY.md` changes in two places (F2, F3), and its section "Replay and repair" (the more lines snippet) adds the trial to its evidence comment:

- Line 16 gains: "An entry the operation reused and did not write is checked by other rules: a reused source must still be an active source at the planned URL and version, with the content hash and stored body the plan gives, so a verification added to it since does not stop the replay; any other reused entry must keep its bytes." It goes in the commit of item 5.
- Line 18 gains: "A plan entry that cannot be read, because it is not an object or its `contentFile` cannot be read, gives one error each in the same way; when any entry cannot be read, the others are not validated." It goes in the commit of item 6.

`docs/RELIABILITY.md` is a gated file, so each of the two commits needs a claims verdict for it.

## Left out, and why

- **Items 7, 8 and 10 to 13.** They are outside `bin/lib/capture-operation.mjs`; each section of the issue gets its own plan.
- **The pid and operation from `owner.json` in the message.** Judgment: the item asks only for the case with no file.
- **A sweep of `.capture-operations/` for temporary receipts.** `atomicJson` removes its temporary file in a `finally` (line 27, the snippet), as line 214 does, so a kill can leave one there too. Judgment: that directory is private and outside discovery; the item is about litter beside entries.
- **Litter of `writeEntry` (`<id>.md.tmp`).** Outside this protocol and not in the issue.
- **A sentence on the temporary file in the section "Writer lock" of `docs/RELIABILITY.md`.** Judgment: no sentence there becomes false, and the changelog carries it.
- **The review's F9.** The item 1 test asserts one `.tmp` after the kill. A fix that unlinks before the `published` event would fail it. Judgment: the assertion shows the test reaches the state the item reports.

## The commits

<!-- evidence: 2026-11-17-trial-issue-72-items-1-6 -->

One commit per item, in the order 1, 2, 3, 4, 5, 6, on a branch from `master`. Each commit holds the edit, its test (none for item 4) and its changelog line; the commits of items 5 and 6 also hold their sentence in `docs/RELIABILITY.md`. The first commit also adds this plan, with `git add -f`. Before each commit: add the test, see it fail on the code as it stands, make the edit, see it pass, and run the five checks of AGENTS.md. The edits of items 1 to 6 are those the trial's script writes; that script writes them all at once, so each commit takes its part of them.

## Done when

- Each new test fails on the code of commit 4a2b36e and passes with the edits.
- The five checks pass on each commit.
- A comment on issue 72 says which items are done. Issue 72 stays open for its other items.

## Not shown by this plan

- Item 4 on Windows. No test or run covers it.
- A kill at another point than the `published` and `artifact` events, such as between the write (line 208) and the link (line 210).
- Item 2 under another umask than 002 and 022.
- Item 3 when a live writer is between line 132 and line 135; the message for that case was not seen.
