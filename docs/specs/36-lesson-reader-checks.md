# Spec 36: the lesson-reader's reading order, shape-neutral checks, Lead check, words to avoid, why-now and concrete-example clauses (issue #47)

Plan for issue #47, titled "lesson-reader: the frame's reading order, shape-neutral checks, a Lead check, words to avoid, why a command runs now, concrete examples" on GitHub, at 1493137 on master with a clean working tree (2026-11-02-lines-behind-issue-47-lesson-reader, the status line and the log line). The issue body is the one gated on 2026-11-02 in `docs/specs/issues-2026-11-02-lesson-presentation.md` at 4e2dc2c; this plan turns its six numbered changes into the executable list, after spec 35 landed the lead sentence the Lead check depends on (2026-11-02-lines-behind-issue-47-lesson-reader, the GitHub title and body, the log line). Every repo line named here is quoted in that snippet at 1493137, its round 1 additions included. Where a sentence says what a command does, it is read from the quoted code, not from a run.

## What exists

- `agents/lesson-reader.md` is 26 lines: frontmatter (`name`, `description`, `tools: Read`, `model: opus`, `effort: high`, `omitClaudeMd: true`), line 10 restricting the reader to the one lesson file, line 12 reading the page "the mission block, the fact block, the example block, the quiz, the step, the sources", line 14 "Check, in this order:", the seven numbered checks at lines 16 to 22 (Thread, Terms, Why, Example, Quiz, Step, Register), the output rule at line 24 (findings worst first, then `VERDICT: READS` or `VERDICT: REVISE` with the three changes that would help most, no praise, no rewriting, no truth judgment) and line 26 (2026-11-02-lines-behind-issue-47-lesson-reader, `lesson-reader.md` lines 1 to 26, the `wc` block).
- `test/lesson-reader.test.mjs` asserts the five frontmatter fields and, in the body, the sentences "Read only that file. Never read MISSION.md, NOTES.md, GATE-LOG.md", "Never fetch the web. Never run code. Never edit a file.", `VERDICT: READS`, `VERDICT: REVISE` and "Do not comment on whether the facts are true" (2026-11-02-lines-behind-issue-47-lesson-reader, `lesson-reader.test.mjs` lines 1 to 40).
- The frame is `prereq` (optional), `mission`, the shape's middle, `sources`, `followup`, and the middles are `model`, `fact`, `quiz`, `connect` (`concept`), `model`, `example`, `complete`, `step` (`tool`), `predict`, `model`, `fact`, `quiz` (`diagnose`) and `scaffold` on the mission's first project, then `step` (`project`); `tool` and `project` lessons have no `fact` block, and the block table gives each block's content, the `mission` row now naming the win, the idea and the activity (2026-11-02-lines-behind-issue-47-lesson-reader, `LESSON-FORMAT.md` lines 16 to 36 and 41 to 52). In `example`, each command has "a one-sentence `<p>` before it saying what to look at"; in `step`, every non-empty, non-comment `<pre>` line is a command (2026-11-02-lines-behind-issue-47-lesson-reader, `LESSON-FORMAT.md` lines 86 to 91).
- The skill's line 92 dispatches one `research-vault:lesson-reader` with a prompt that is exactly the lesson's absolute path and nothing else, and reads `VERDICT: READS` or `VERDICT: REVISE` from it; line 65 says the reader never sees `MISSION.md`; REFERENCE's `research-teach` row says lessons are "read by a fresh `lesson-reader`" and says nothing of its checks; no `deps.mjs` row or README line names the agent, and the phrase "Check, in this order" occurs in no other `.md` or `.mjs` file (2026-11-02-lines-behind-issue-47-lesson-reader, the `lesson-reader` grep, the uncut line 32, the check-phrase grep). `REVIEWER_FILE` is `agents/claims-reviewer.md` and `reviewerHash` hashes that file, so, read from that code and not from a run, an edit to `agents/lesson-reader.md` leaves the hash the ledger compares with unchanged; spec 22's D8 left the reader's checks unchanged on the opposite reading, which the issue reverses knowingly (2026-11-02-lines-behind-issue-47-lesson-reader, `gate.mjs` lines 24 to 31, the `reviewerHash` grep, the spec 22 grep).
- Fixture 0004's mission line is the win, the idea sentence spec 35 added, then "You will complete the command yourself." (2026-11-02-lines-behind-issue-47-lesson-reader, `0004-tool-fxctl.html` lines 11 to 13). The four wiki notes and the synthesis the issue cites for its rationale exist in the bound vault (2026-11-02-lines-behind-issue-47-lesson-reader, the `ls` block).

## Decisions

### D0. Contracts kept

1. Text only, in `agents/lesson-reader.md`; no code, no lint. The frontmatter and the five body sentences the test asserts are untouched, so `test/lesson-reader.test.mjs` passes unchanged.
2. The reader still reads only the lesson file: line 10 is untouched, and the reading page of issue #44 ("A reading page: the lesson's conventions explained once, served and linked", issue B of the gated set) is not mentioned.
3. Declined, as the issue decided: time-relative words (issue C, #45, the `WARN_LESSON_TIME_WORD` lint), sentence length (issue D, #46, `teach lint --prose`), a first- or second-person rule.
4. The ledger is untouched: `reviewerHash` reads the claims reviewer's file, not this one, so, read from that code, no gated draft's verdict reopens; `gate staged --check` covers only staged files, and the reading of `reviewerHash` is the basis.

### D1. The six changes

1. Line 12's reading order becomes the frame in page order: "the prereq block if there is one, the mission block, then the shape's middle in the order the page shows it (model, predict, fact, example, complete, scaffold, quiz, connect, step, whichever are present), then the sources, then the follow-up".
2. Thread (line 16) and Quiz (line 20) say "the model and fact blocks" where they said "the fact block", so a `tool` lesson, which has a `model` block but no `fact` block, is checked against what it has; a `project` lesson has neither, and Thread and Quiz find nothing to check there.
3. A new check 1, **Lead**, before Thread, renumbering the rest 2 to 8: "After the mission block, can the reader say in one sentence what this page will teach? Quote the sentence that says it, or name its absence." On a mission without the idea sentence it is expected to report the absence; D3.2 checks it on a win-only mission.
4. Register gains the words to quote: "note that", "of course" and "obviously".
5. Example and Step each gain the clause "Name any command the page runs without a sentence before it saying why it is run now."
6. Why gains: "Name the paragraph where a reader who knows only what the page says they know would need a concrete example to follow, and none is given."

### D2. Documents that restate the behaviour

- `CHANGELOG.md`: one line under `## [Unreleased]`, `### Added`.
- Not changed: `skills/research-teach/SKILL.md` (the dispatch and the verdict handling are the same), `docs/REFERENCE.md` (its row names the reader and none of its checks), `scripts/deps.mjs` (no row names the agent, and its check phrase occurs in no other `.md` or `.mjs` file), `LESSON-FORMAT.md`, the tests.

### D3. Checks

1. `npm test` passes unchanged.
2. The issue's reader round: a copy of fixture 0004 whose `mission` is reduced to its win sentence, with the idea and the activity removed, is read by one `research-vault:lesson-reader` dispatched with the copy's path as the whole prompt; its findings name the missing lead under Lead. The round is captured as an experiment in the bound vault and named in the commit and the issue's closing comment. A second round over the unedited 0004 is not required by the issue and is not run.

## Execution

One person, no sub-agents for the text: the six edits to the agent file and the CHANGELOG line. Two subagents: a fresh claims review through the `research-claims-gate` skill (`AGENTS.md`) for this plan before any edit, and the one lesson-reader round of D3.2 after it. The order: this plan gated; the edits; `npm test`; the reader round, captured; `npm run lint:self`, `node scripts/check-agentsmd-drift.mjs`, `node scripts/check-encoding.mjs`, `node bin/research-vault.mjs gate staged --check`; one commit on master, not pushed.

## Done when

The agent file carries the six changes, `npm test` passes with line 23 of its test untouched, and a reader round over the reduced copy of 0004 names the missing lead under Lead, which is what the issue's "Done when" sentence asks (2026-11-02-lines-behind-issue-47-lesson-reader, the GitHub body); the four other checks `AGENTS.md` lists pass.
