# Spec 40: the mission interview as dialog questions, with the hygiene rule on term checks (issues #48 and #49)

Plan for issue #48, titled "research-teach: the mission interview is asked one question per turn through the host's question dialog, not as a prose list", and issue #49, titled "research-teach: the interview's term-check options follow the quiz hygiene rule, the correct sentence is not always first" on GitHub, at a062672 on master with a clean working tree (2026-11-03-lines-behind-issues-48-49-mission, the status line, the log line, the branch line in the round 1 additions, and the two issue blocks). #49 is two sentences inside the item #48 rewrites and says it depends on #48, so the two are one plan and one commit. Every `SKILL.md`, `MISSION-FORMAT.md`, `LEARNING-RECORD-FORMAT.md`, `skills.test.mjs`, `deps.mjs`, `CHANGELOG.md` and `AGENTS.md` line named here is quoted in that snippet at a062672, its round 1 additions included. Both issues are text changes with no code.

## What exists

- `skills/research-teach/SKILL.md` section 2 (line 37) says to interview the learner "in this order, and ask the learner to show or say, never to rate themselves" (line 39), then lists six numbered items (lines 41 to 46): why, scope, depth, terms ("for each term the scope needs, one sentence or "pass". A correct sentence goes to `### Known terms`, anything else to `### New to me`"), tools ("daily, have run it, or never"), and session length with the four ways of learning ("diagram first, YAML first, run and predict, read"). The section runs to line 48 (`## 3.` is at line 50), and nothing in it says how many items go in one turn or through which channel; no file under `skills`, `agents` or `docs/*.md` mentions `AskUserQuestion` or a question dialog (2026-11-03-lines-behind-issues-48-49-mission, `SKILL.md` lines 37 to 48, lines 49 to 59 in the round 1 additions, the empty grep block). Line 48 says to write a `prior-knowledge` learning record for the Floor (2026-11-03-lines-behind-issues-48-49-mission, `SKILL.md` line 48).
- Section 4's hygiene rule, line 70: "**Quiz hygiene.** Answers of equal length; correct position varies; no formatting tells." (2026-11-03-lines-behind-issues-48-49-mission, `SKILL.md` lines 60 to 72).
- `MISSION-FORMAT.md` restates the interview rules: scope first, then the floor (line 41), and "The Floor is what the learner showed, not rated. Ask for a one-sentence definition of each term the scope needs; a correct sentence goes to Known terms, anything else to New to me. Ask "daily, have run it, or never" for each tool a lesson will run. `teach lint` enforces both lists." (line 42). Its Floor section holds the headings `### Known tools`, `### Known terms` and `### New to me` (lines 20 to 25), which `deps.mjs` row 114 ties to `bin/lib/lesson.mjs` (2026-11-03-lines-behind-issues-48-49-mission, `MISSION-FORMAT.md` lines 18 to 30 and 36 to 44, the `deps.mjs` grep).
- `LEARNING-RECORD-FORMAT.md`'s record has a `kind` of `prior-knowledge` among four, with a body of "1-3 sentences: what was learned (or what prior knowledge was established), and why it matters" (line 32) and an **Evidence** section, "how the user demonstrated the understanding", "Useful when the claim might be revisited" (line 45); the `prior-knowledge` kind says "Also record the _depth_ claimed" (2026-11-03-lines-behind-issues-48-49-mission, `LEARNING-RECORD-FORMAT.md` lines 24 to 31 and 50 to 56, the format grep in the round 1 additions).
- `test/skills.test.mjs` lines 74 to 82 assert the skill holds a list of strings (`teach next`, `PLAN.md`, `cp -n` and the rest); `deps.mjs` rows 97, 117, 120, 122 and 143 tie the skill to the plugin name, the teach verbs, `--prose`, the lesson URL and the mission block's sentence list; no row ties the skill to `MISSION-FORMAT.md` (2026-11-03-lines-behind-issues-48-49-mission, `skills.test.mjs` lines 74 to 82, the `deps.mjs` grep). `CHANGELOG.md` has `## [Unreleased]` at line 8 with `### Added` at line 10 and the first `### Changed` after it at line 29; `AGENTS.md` lines 7 to 11 name five checks (2026-11-03-lines-behind-issues-48-49-mission, the CHANGELOG and AGENTS.md greps in the round 1 additions).
- Claude Code's hooks reference describes `AskUserQuestion` as "Asks the user one to four multiple-choice questions." (2026-10-26-claude-code-hooks-reference, line 1973), and its subagents reference lists `AskUserQuestion` among the tools removed from every subagent (2026-10-26-claude-code-subagents-reference-create-custom, line 466; both lines also in 2026-11-03-lines-behind-issues-48-49-mission, the round 1 additions). Issue #48 is the only source for the dialog's free-text option, which it calls `Other`.
- Issue #48 records that on 2026-11-02 an agent posted all six items as one prose message and the learner asked to be interviewed question by question through "the default way of asking questions in claude"; issue #49 records that the agent then placed the correct sentence first in eight of eight term checks, and argues an overstated Floor sets the zone too high for every later lesson (2026-11-03-lines-behind-issues-48-49-mission, the two issue blocks).

## Decisions

### D0. Contracts kept

1. No code: `bin/`, `hooks/`, the tests' subjects and the three Floor headings are untouched, so `deps.mjs` row 114 holds.
2. The order of the six items, the scope-before-floor rule and "show or say, never rate" stay; the Floor is still what the learner showed.
3. The skills test's existing strings stay in the text.

### D1. Section 2, the channel and the pacing

Line 39 gains, after "never to rate themselves": "Each numbered item is its own turn, asked through the host's question dialog (the `AskUserQuestion` tool in Claude Code, one to four multiple-choice questions per call, removed from every subagent except a fork, so the interview is never delegated) when one exists, and the next item is written only after the answer to the previous one is read, since scope decides which terms and tools are asked about. Never ask the learner to type a list."

### D2. The six items

- Item 1 (why): the options are the item's own list, a ticket, a design, a talk, the model for its own sake, with the dialog's free-text answer (`Other` in Claude Code, per issue #48) for the rest.
- Item 2 (scope): unchanged (free text; the dialog's free-text answer is the answer box).
- Item 3 (depth): options `explain with a diagram`, `diagnose from output`, `configure from scratch`.
- Item 4 (terms), rewritten: "Terms: for each term the scope needs, one dialog question, up to four terms per call. The options are one correct one-sentence statement of the term, two or three plausible wrong ones, and `Pass`; the learner's own sentence arrives through the free-text answer. Picking the correct sentence or writing a correct one goes to `### Known terms`; a wrong pick, a wrong sentence or `Pass` goes to `### New to me`. Recognition is weaker evidence than production, so the Floor's `prior-knowledge` record says which each Known term was. The hygiene rule of section 4 applies to every term-check question: the correct sentence's position varies across the questions of a call and across calls, the wrong sentences match it in length and register, and `Pass` is not always last. When the learner points out a tell, the answers given under it are re-asked with the positions changed before the Floor is written, and the `prior-knowledge` record says so." The last two sentences are issue #49's.
- Item 5 (tools): "for each tool a lesson will run, one dialog question, options `daily`, `have run it`, `never`, up to four tools per call. Daily goes to `### Known tools`; never gets a `PATH.md` line."
- Item 6: two questions, session length (the free-text answer for a number) and the way they learn best, options `diagram first`, `YAML first`, `run and predict`, `read`.

### D3. Documents that restate the rule

- `MISSION-FORMAT.md` line 42: "Ask for a one-sentence definition of each term the scope needs; a correct sentence goes to Known terms, anything else to New to me." becomes "Check each term the scope needs with one dialog question (`SKILL.md` section 2, item 4); a correct pick or sentence goes to Known terms, anything else to New to me, and the `prior-knowledge` record says whether a Known term was recognised or produced." The tool sentence stays.
- `scripts/deps.mjs`: one row tying `SKILL.md` to `MISSION-FORMAT.md` for the term check and the tool question restated in both (literal `have run it`).
- `CHANGELOG.md`: one line under `## [Unreleased]`, `### Changed` (the first after it, line 29), naming both issues.
- Not changed: `LEARNING-RECORD-FORMAT.md` (its **Evidence** section at line 45 and "the _depth_ claimed" at line 53 already hold what D2 asks the record to say), `LESSON-FORMAT.md`, the agents.

### D4. Tests

`test/skills.test.mjs`: the string-list test at lines 74 to 82 gains `AskUserQuestion`, `up to four terms per call`, `Pass` is not always last` and `have run it`, and one assertion that section 2 (the text between `## 2.` and `## 3.`) holds "position varies" (`## 3.` is at line 50).

## Execution

One person, no sub-agents for the text: the section 2 lines, the format line, the deps row, the CHANGELOG line, the test strings. The one subagent is a fresh claims review through the `research-claims-gate` skill, which `AGENTS.md` line 11 names, for this plan before any text is written. The order: this plan gated; the text; the five checks `AGENTS.md` lines 7 to 11 list (`npm test`, `npm run lint:self`, `node scripts/check-agentsmd-drift.mjs`, `node scripts/check-encoding.mjs`, `node bin/research-vault.mjs gate staged --check`); one commit on master, not pushed; both issues closed.

## Done when

Section 2 says per item which channel and how many questions per turn, item 4 names the hygiene rule and the re-ask, and `npm test` passes, which is the text half of the two issues' "Done when" sentences (2026-11-03-lines-behind-issues-48-49-mission, the two issue blocks). The other half, a fresh agent's interview in an empty workspace asking six or more dialog turns with the correct sentence at more than one position, needs a learner at the dialog and is checked in the next live mission, not in this plan; the four other checks `AGENTS.md` lines 8 to 11 list pass.
