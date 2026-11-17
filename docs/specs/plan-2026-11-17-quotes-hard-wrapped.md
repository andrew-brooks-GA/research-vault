# Plan: verify --quotes finds a sentence that a hard-wrapped file breaks over lines (issue 77) (2026-11-17)

<!-- evidence: 2026-11-17-lines-behind-issue-77-plan-at 2026-11-17-probe-issue-77-hard-wrapped-quotes 2026-11-17-corrected-second-probe-issue-77-review 2026-11-17-gate-state-documents-that-state-one -->

`verify --quotes` finds a quote only when it is on one line of a source's text. Issue 77 reports whole sentences that it did not find because the stored Markdown file breaks them over two lines. This plan changes the quote check so that it also finds a quote that runs over adjacent lines with no blank line between them. Nothing in it is built: the working tree of the repo is as it was. This is the plan as revised after an adversarial review of its first draft, which made ten findings, C1 to C10.

The plan rests on four vault entries:

- The snippet 2026-11-17-lines-behind-issue-77-plan-at ("the snippet") quotes repo lines at commit b9a921b and the text of issue 77.
- The experiment 2026-11-17-probe-issue-77-hard-wrapped-quotes ("the probe") runs `verify --quotes` on a hard-wrapped file as the CLI stands (part A), on a copy of the repo with the first prototype (part B), and runs two test files of that copy (part C).
- The experiment 2026-11-17-corrected-second-probe-issue-77-review ("the second probe") holds the review's findings one line each, the state of the branches, more repo lines, and runs of a simpler form of the prototype (parts D, E and F) and of the first prototype under a time limit (part G). It replaces an earlier entry whose timing line for the first prototype was wrong.
- The experiment 2026-11-17-gate-state-documents-that-state-one ("the gate probe") shows the claims verdict state of three files.

A sentence about the code cites a snippet or the lines in the second probe. A sentence about behaviour cites a probe. A sentence marked "Judgment" is this plan's choice, not a fact.

## What exists

<!-- evidence: 2026-11-17-lines-behind-issue-77-plan-at 2026-11-17-probe-issue-77-hard-wrapped-quotes 2026-11-17-corrected-second-probe-issue-77-review -->

- **The check is one line at a time.** `hitsIn` at `bin/lib/quotes.mjs` line 20 returns the numbers of the lines that include the quote. Line 71 calls it on the lines of the stored body and line 76 on the lines of the fetched page (the snippet).
- **A match ignores a small set of differences.** `soft` at line 19 removes backticks, makes quote marks and dash forms the same, and turns each run of white space into one space (the snippet).
- **The Markdown extractor keeps the file's line breaks.** `mdToText` at `bin/lib/extract.mjs` lines 49 to 56 is a chain of `replace` calls. Judgment from reading them: none removes or adds a line break (the snippet; C9). `htmlToText` at lines 36 to 38 folds white space, and its comment says "a paragraph is one line of text" (the snippet).
- **A found quote in a stored body adds a row with one line number.** Lines 83 to 85 of `quotes.mjs` write the note `<hash> L<line>@<body hash>[ <run key>]: <quote>`, with `lines[0]` as the line (the snippet).
- **The packet parses that row.** `LINE_ROW` at `bin/lib/packet.mjs` line 13 reads the line number. Line 53 keeps the lines from three before it to three after it; `AROUND` is 3 at line 11 (the snippet).
- **The command's output has `lines` and `context`.** Line 87 of `quotes.mjs` returns `lines`, `occurrences`, `rowAdded` and `context` (the snippet). `around` at line 21 cuts the context and caps it at 900 characters (the second probe, lines). For a quote on body line 8 the context held lines 6 to 10: two lines before to two lines after (the second probe, part F; C4).
- **One test asserts the present rule.** The test at `test/quotes.test.mjs` line 38 is named "a quote over two lines is not found, a short quote is refused, and a quote on three lines reports all three" (the snippet). Its line 46 asserts that `matched(dir).length` is 1, and `matched` at line 17 keeps the rows whose method is `quote-matched` (the second probe, lines).
- **Three files state the rule in words.** The binding of this checkout gates `docs/**/*.md` and `skills/**/*.md` (the second probe, lines of `.research-vault.json`). `docs/REFERENCE.md` line 186 says the command prints "whether it is on one line of the text". `docs/RELIABILITY.md` line 36 says "A quote found on one line of the source's text adds one `quote-matched` row". Line 98 of `skills/research-orchestrate/SKILL.md` says "whether the quote is on one line of the source's text (found)" (the snippet).
- **What the issue reports.** Two READMEs stored by `capture --fill` are hard-wrapped at about 80 columns; `verify --quotes` found 13 of 18 and 9 of 14 quotes, and the misses were whole sentences that the file breaks across two lines (the snippet, issue text). This plan did not repeat those runs.
- **The miss is reproduced on a small file.** On a scratch vault with one hard-wrapped Markdown source, the CLI at commit b9a921b found one of six quotes: the sentence that sits on one line. Each of the four wrapped sentences got the reason `not on any one line of the stored text` (the probe, part A).
- **The lines are those of a branch.** Commit b9a921b is on `fix/orchestrate-page-slots` only, and `master` is at 237720a. On `master` the skill's sentence is at line 87 (the second probe, branches; C2).

## Decisions

<!-- evidence: 2026-11-17-lines-behind-issue-77-plan-at 2026-11-17-probe-issue-77-hard-wrapped-quotes 2026-11-17-corrected-second-probe-issue-77-review -->

The issue gives two options: `mdToText` joins the lines of a paragraph, or `verify --quotes` tries a quote against lines joined by a space (the snippet, issue text).

**D1. The check changes, not the extractor.** Judgment, for four reasons (C7):

- The issue says the first option "changes stored bodies for new fills only". The check reads the body each time it runs (`quotes.mjs` lines 38 and 39), so a change to the check also covers a body that is already stored.
- A new fill is not a way out for a stored body. `fill.mjs` line 54 refuses `--replace` when the newest verification row is not a fill's (the second probe, lines). Judgment: a source that has a `quote-matched` row after its fill is such a source.
- A rule that joins lines is rough (see D2). Judgment: in the extractor a wrong join changes the stored text; in the check it changes nothing that is stored.
- `extractText` applies `mdToText` only to a path that ends in `.md` (line 73). A change to `mdToText` does not cover a wrapped file of another kind.

The other side, as the review argued it (the second probe, C7): a hard wrap is not something a reader sees, and one fix in the extractor would also help the packet and a reviewer who reads the body. Judgment: the four reasons weigh more.

**D2. A quote may run over adjacent lines with no blank line between them, joined by one space.** The lines are the `soft` lines, so a line that is empty after `soft` ends a run. A quote on one line is still found. The lines are those of `patch2` in the second probe, the simpler form the review proposed (C10): a new `hitsIn` of nine lines, with no table of offsets. With them:

- The probe's six quotes gave the same result as the first prototype. The four quotes n 0, 1, 2 and 5 were found; three are sentences over two lines, and one of those is a list item whose second line is indented. A sentence in a block quote, whose second line starts with `>`, was not found. A quote made of the last line of one paragraph and the first line of the next was not found (the second probe, part D; the probe, part B).
- The rule is not "one paragraph" (C3). A quote made of a heading and the text under it was found, and so was a quote made of two list items; `checkQuotes` at b9a921b found neither (the second probe, part F). Judgment: accepted. The quote must still be in the text word for word and in order, with a line break in place of a space, and the Write step still judges a claim against the lines around its quote.
- The page path gets the same rule, because line 76 calls the same function. Line 84 of `quotes.mjs` sets the result `confirmed` for a quote found on the page (the snippet). No run of the page path was made for this plan.
- The first prototype was too slow on a hostile text (C1): on 15,000 lines with no blank line and 16 quotes it did not finish, and the process was ended at 100 s (the second probe, part G). The same input took 41 ms with the simpler lines and 9 ms at b9a921b, one run each (the second probe, part F). The comment at `extract.mjs` line 20 asks that every pattern there "stay linear on a hostile page of 5 MiB" (the second probe, lines). Judgment: the check takes the same rule, and a test holds it.

**D3. The row keeps its form and holds the first line of the quote.** The issue says the second option "changes the row's line form that `gate evidence --packet` parses". Judgment: it need not. The row holds one line number today, and the first line of the hit goes there. With the simpler lines each new row matched the present form, for example `2ba956fd L8@31a5cd3f run-probe77: ...`, and the tests of `test/packet.test.mjs` passed (the second probe, parts D and E). `packet.mjs` is not changed.

The cost of D3 (C5): the packet keeps the lines up to three after the row's line (`packet.mjs` line 53). Judgment: a sentence over five lines or more then has its last lines outside the excerpt, and a reviewer on a packet may not see the end of that quote. Judgment: the cost is then a finding that the whole source would answer. Judgment: accepted for this commit. The upgrade is small: `packet.mjs` keeps the lines after the third up to the first blank line.

**D4. The output keeps its fields.** `lines` holds the first line of each hit, and `occurrences` is their count. `context` runs from two lines before the first hit's first line to two lines after its last line, under the same cap of 900 characters. A quote that is on one line and also over two lines later gave `lines=[6,9]` (the second probe, part F). No field is added.

**D5. The reason for a miss says what is now true.** Three strings at `quotes.mjs` lines 72 and 76 say "not on any one line" (the snippet; C9). Judgment: each says "not on one line or over adjacent lines" in its place. The test at `test/quotes.test.mjs` line 42 matches the old words and changes with them.

**D6. The three documents say the new rule.** Each of the three sentences of "What exists" gains the words "or over adjacent lines with no blank line between them". Where a file says "every line it occurs on", it says "every line it starts on". The comment at `quotes.mjs` lines 23 and 24 changes the same way.

**D7. Nothing changes in `extract.mjs`, `fill.mjs` or `packet.mjs`.** Stored bodies stay as they are.

## The commit

<!-- evidence: 2026-11-17-lines-behind-issue-77-plan-at 2026-11-17-probe-issue-77-hard-wrapped-quotes 2026-11-17-corrected-second-probe-issue-77-review 2026-11-17-gate-state-documents-that-state-one -->

One commit, on a branch from a `master` that holds commit b9a921b (C2). Until that commit is on `master`, the line numbers of this plan are those of `fix/orchestrate-page-slots`.

1. `bin/lib/quotes.mjs`: D2 to D5. `patch2` in the second probe holds the lines: a new `hitsIn` and `around`, and the five places that use the hits.
2. `test/quotes.test.mjs` (C6):
   - The test at line 38 is the one test that failed in the copy (8 tests, 7 pass, 1 fail; the second probe, part E). Its "over two lines" part changes to assert a find, with the row's line and the `context`. Judgment: its row count at line 46 changes too, because the two-line quote now adds a row.
   - New parts assert the two misses of D2 (a quote across a blank line; a block quote line with its mark) and the two finds that D2 accepts (a heading and its text; two list items).
   - One part runs the page path with a stub fetch and asserts a `confirmed` row for a wrapped sentence.
   - One part runs the 15,000-line input of the second probe and asserts a time limit. Judgment: two seconds, which is far above the 41 ms of the one run and far below the 100 s that the first prototype did not finish in.
3. `test/packet.test.mjs`: one part builds a packet from a body over 8,000 bytes whose row is for a two-line sentence, and asserts that the excerpt holds both lines. This is the issue's "the packet still cuts the right lines". No run of it was made for this plan.
4. `docs/REFERENCE.md`, `docs/RELIABILITY.md` and `skills/research-orchestrate/SKILL.md`: D6.
5. `scripts/deps.mjs` (C8): two new rows couple `bin/lib/quotes.mjs` to `docs/REFERENCE.md` and to `docs/RELIABILITY.md` on the stated rule, with the literal `quote-matched`, which each of the two files holds (the second probe, lines). The row at line 197 already couples `packet.mjs` and `quotes.mjs` on the note form, and D3 keeps that form (the snippet).
6. `CHANGELOG.md`: one line under `## [Unreleased]`, naming issue 77.
7. This plan, added with `git add -f`.

**The cost that is not code.** The three files of item 4 are gated. In this checkout `docs/RELIABILITY.md` has no verdict and `gate status` lists its sections as changed. `docs/REFERENCE.md` has none either, and its list of changed units holds `sec:commands/verify`, by its name the table row of `verify`. The skill holds `MERIT` for its content on the branch (the gate probe). `AGENTS.md` line 11 says every staged gated file must carry a verdict for its current content (the snippet). Judgment: both documents then need a gate over every unit that `gate status` lists, against evidence built in this vault, and the skill needs a gate over the one unit that changes. Judgment: that is the larger part of the work. Its size is not measured.

Judgment on one way to make it smaller: leave `docs/REFERENCE.md` and `docs/RELIABILITY.md` out of this commit, with their two rows of item 5, and record the two stale sentences in an issue. The cost is two documents that state the old rule until they are gated. This plan does not choose it; the owner decides.

**Checks before the commit** (the snippet, `AGENTS.md` lines 7 to 11): `npm test`, `npm run lint:self`, `node scripts/check-agentsmd-drift.mjs`, `node scripts/check-encoding.mjs`, `node bin/research-vault.mjs gate staged --check`.

## Done when

<!-- evidence: 2026-11-17-lines-behind-issue-77-plan-at -->

- The issue's own condition is met: "a quote that spans a soft line break in a stored Markdown body is found, with a test, and the packet still cuts the right lines".
- The five checks pass on the commit.
- The issue is closed by its owner, `andrew-brooks-GA`.

## Not shown by this plan

- This plan did not read or check the READMEs of the issue. The reviewer reports from its own runs that, of the sentences of their wrapped paragraphs, the prototype found 550 of 557 and 180 of 183, against 90 and 37 at b9a921b (the second probe, findings). Those runs are not in a vault entry.
- A sentence over two block quote lines, the second starting with `>`, is still not found (one case probed). The review names a small answer (the second probe, C9): remove a leading `>` from body lines before `soft`. It is left out.
- A quote found on a fetched page was not run. The page path calls the same function.
- A packet built from a row for a wrapped sentence was not run.
- The time of the check was measured once, on one input.
