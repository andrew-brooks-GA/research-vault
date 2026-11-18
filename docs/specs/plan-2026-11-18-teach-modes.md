# Plan: teaching and certification modes for checked tasks, and reviews as offers (issue 79) (2026-11-18)

<!-- evidence: 2026-11-18-lines-behind-plan-issue-79-at 2026-11-18-more-lines-behind-plan-issue-79 2026-11-18-issues-79-78-research-vault-as 2026-11-18-owner-s-answers-2026-11-18 2026-11-18-probe-plan-issue-79-checked-tasks 2026-11-18-adversarial-review-findings-first-draft-plan 2026-11-18-lab-tooling-lines-behind-plan-issue 2026-11-18-probe-teach-lint-warn-lab-bypassed -->

> **For agentic workers:** build this plan one commit at a time, in order, with `superpowers:subagent-driven-development` or `superpowers:executing-plans`. Each commit ends with the steps of "How each commit is reviewed and gated". Steps use checkbox (`- [ ]`) syntax.

Issue 79 holds a proposal for how `research-teach` treats a learner's work on a task a script checks. This plan turns the proposal into five commits. Nothing in this plan is built yet. This is the plan as revised after an adversarial review of its first draft, which made eighteen findings, R1 to R18 (the review).

The plan rests on eight vault entries:

- The snippets 2026-11-18-lines-behind-plan-issue-79-at ("the snippet") and 2026-11-18-more-lines-behind-plan-issue-79 ("the second snippet") quote repo lines at commit 1e0ef62, and this machine's `.research-vault.json`, which is not in the commit, each with its number.
- The snippet 2026-11-18-issues-79-78-research-vault-as ("the issue text") holds issue 79 with the proposal, the owner's direction in its first comment and the practice ideas in its last, and four parts of issue 78.
- The snippet 2026-11-18-owner-s-answers-2026-11-18 ("the answers") holds the owner's answers of 2026-11-18 to the open questions.
- The experiment 2026-11-18-probe-plan-issue-79-checked-tasks ("the probe") reads the six teaching workspaces of one repo, the vault and this checkout.
- The snippet 2026-11-18-adversarial-review-findings-first-draft-plan ("the review") holds the review's findings, one line each.
- The snippet 2026-11-18-lab-tooling-lines-behind-plan-issue ("the lab snippet") quotes, at the same commit, the lines on a repo's lab tooling, and the `lab` block of one binding.
- The experiment 2026-11-18-probe-teach-lint-warn-lab-bypassed ("the lab probe") runs `teach lint` on a task's `setup.sh` with a `lab` block in the binding.

A sentence about the code cites a snippet. A sentence about what a command printed cites the probe. A sentence marked "Judgment" is this plan's choice, not a fact. "P1" to "P5" are the proposal's sections. A "task" in this plan is a checked task; a "requirement" is one thing its check asserts.

**Goal.** A check shows what is right and wrong, and never a score. The answer is given when asked. A grade exists only in a certification run the learner asks for. No review is scheduled unless the learner asks for reminders.

**Tech stack.** Node 22 or later (`package.json` line 6, the second snippet); ESM, no dependencies, no classes; `node --test` (`AGENTS.md` lines 7 and 17, the snippet); bash for the task scripts and the wrapper.

## The owner's decisions

<!-- evidence: 2026-11-18-owner-s-answers-2026-11-18 2026-11-18-issues-79-78-research-vault-as 2026-11-18-probe-plan-issue-79-checked-tasks -->

The issue lists seven open questions as the owner's to decide (the issue text). On 2026-11-18 the owner answered four (the answers):

1. **Reviews become offers for every kind of lesson: yes.** P5 is in this plan.
2. **Quiz scores: kept as they are.**
3. **Exercises: kept out of certification runs.**
4. **A certification run over several tasks: yes, in this plan.** The proposal left it out and did not design it. D8 designs it, and every rule in D8 is Judgment.

The session did not ask the owner about the other three (the answers). This plan settles them as Judgment, and the owner can change each:

- **Question 4, the read-only credential.** D4: `teach check` gives the checker the environment it was started with. `run.sh` sets the read-only credential for its own check lines.
- **Question 6, how few tasks a grade needs.** No rule. The grade is a count, and the skill never words it as a prediction (D8).
- **Question 7, existing workspaces.** Looked at, in one place. In the probe, no workspace under `docs/teach` of vcluster-support-lab held an `evidence/NNNN/check.sh` or a `requirements.json`; the six files named `check.sh` were under `lab/` and `lessons/files/` folders. The probe searched no other folder. Judgment: D3 keeps no support for the old `PASS` output.

## What exists

<!-- evidence: 2026-11-18-lines-behind-plan-issue-79-at 2026-11-18-more-lines-behind-plan-issue-79 2026-11-18-issues-79-78-research-vault-as 2026-11-18-probe-plan-issue-79-checked-tasks -->

All line numbers are at commit 1e0ef62.

- **Attempts.** `gradeAttempt` (`bin/lib/teach.mjs` lines 135 to 146) grades in two ways: a `result` of `pass` or `fail`, stored as one item with an empty `records` list (line 138), or one answer per quiz item. `writeAttempt` (lines 148 to 168) writes the file. The schema's attempt fields are `lesson`, `result`, `total`, `wrong` and `records`, and `total`, `wrong` and `records` are required (`schema/teach.schema.json` lines 6 and 10). `teach attempt add` needs exactly one of `--answers` and `--result` (`bin/commands/teach.mjs` line 304) (the snippet).
- **A record's last attempt.** In `teachIndex`, a record's last attempt is the last one that names the record in `records` or whose lesson's quiz tests it (`teach.mjs` lines 314 and 315). `reviewFailed` is true when the record is active and that attempt names it (line 326) (the snippet).
- **Review-due.** `SPACING_DAYS` is 21 (line 21). A record is `reviewDue` when it is active, was written before the cutoff of 21 days and has no attempt since (lines 312 and 325). `hooks/session-start.mjs` imports the constant and exports it again (lines 18 and 21). `test/sessionstart.test.mjs` imports it and uses it at lines 31, 45 and 83, and `test/teach-store.test.mjs` at lines 10 and 48. A `COUPLINGS` row names it (`scripts/deps.mjs` line 175) (the snippet, the second snippet).
- **Who shows what.** `teach next` prints a `last attempt` column as score over total and the `review-due:` and `review-failed:` lines (`commands/teach.mjs` lines 141 to 150). `progress` puts every attempt of a lesson in one row with first, latest and best (`teach.mjs` lines 337 to 352). `progressText` prints review-due (line 371), `progressHtml` prints "Review due:" (line 403), and the timeline prints "missed item" numbers for an attempt without `result` (line 398). The server sends `progress(...)` at `/progress` and `/progress.json` (lines 996 and 997). The session brief prints the review-due count and `last attempt N/M` (`session-start.mjs` lines 27, 36 and 37). Tests pin these outputs (`test/teach.test.mjs` lines 226, 231, 335 and 349) (the snippet, the second snippet).
- **The mission's bullets.** `MISSION-FORMAT.md` has one bullet in a fixed form, `Task environment:` (line 30, the snippet). In the probe, a grep of `bin` and `hooks` for `Task environment` and one for `Constraints` printed nothing. The shared fixture's `MISSION.md` has one Constraints bullet at line 20, `Ten minutes a session` (the second snippet).
- **The checked task.** `check.sh` "prints `PASS` and exits 0, else prints one `FAIL: <requirement>, <hint>` line per unmet one on stderr and exits 1" (`SKILL.md` line 61). The step holds two bare `<pre>` lines, `evidence/NNNN/setup.sh` and `evidence/NNNN/check.sh`, and states the command "exactly as the experiment's Result quotes it" (`LESSON-FORMAT.md` line 65). The lint takes a `project` lesson to be a checked task when one of the three scripts exists or a step line contains `check.sh` (`bin/lib/lesson.mjs` line 669). It then reports `LESSON_TASK_INCOMPLETE` for a missing script, a step with no line ending `evidence/NNNN/check.sh`, or no experiment in `sources` (lines 670 to 672). The skill records the run by hand with `teach attempt add --result`, and tells the learner that reading the solution first "turns the attempt into a read" (`SKILL.md` line 121). `LESSON-FORMAT.md` line 73 says, as "Judgment, not measured", that for a Kubernetes environment `run.sh` and the skill run `check.sh` under a read-only credential (the snippet).
- **The tool rule.** `commandTools` takes the first word of each step command and strips a leading `./` (`lesson.mjs` line 300, the snippet). In the probe, `commandTools` on a step with the lines `evidence/0007/setup.sh` and `./check 7` returned one tool, `check`.
- **Running a script.** `stopGroup` and `launch` in `bin/lib/labs.mjs` are not exported (lines 240 and 253). `launch` checks a script against a SHA-256 pin and takes an `env` from its caller (lines 255 to 259). It starts the script with no shell as the leader of its own process group (line 259). `runScript` stops the rest of the group when the leader exits and then destroys the streams (lines 270 to 305). The lab runner applies the 1 MiB cap itself (line 322). `LAB_TEXT_BAD_RE` matches control characters, the bidi marks of its class, and U+2028 and U+2029 (line 24) (the snippet, the second snippet).
- **Arguments.** The parser's `BOOL` set holds `dry-run` and does not hold `hints`, `no-hints`, `start`, `certify` or `cancel` (`bin/lib/args.mjs` line 1). A test pins the teach usage string (`test/teach.test.mjs` line 18) (the snippet).
- **The gate.** `unitHashes` hashes a lesson's data-block over the block's own text, and an `img:` unit over the figure and the image file's bytes (`bin/lib/gate.mjs` lines 97 to 131, the snippet). `gateStatus` returns the stored verdict when the page's bytes match a row, unless a pending unit starts with `img:` (line 225). `gate staged` and the Stop hook find a page from a changed file only through `referencedImages` (`gate.mjs` line 361; `hooks/stop-gate.mjs` line 38). `bin/lib/codex-review.mjs` line 52 also calls `referencedImages` (the second snippet).
- **The skill.** "Records in `review-due` or `review-failed` come first, as a review lesson" (`SKILL.md` line 83). The path gets "a review every six or seven lessons" (line 50; `PATH-FORMAT.md` line 29). Line 119 defends the 21 days from a spacing study (the snippet). The interview is in section 2 and its last numbered item is 6 (lines 39 and 48 to 50). The workspace's files are listed in a table that ends at line 35 with `.teach-serve.json`, and line 89 adds that name to `.gitignore` (the second snippet).
- **Issue 78.** Its plan adds `teach check` and the usage string in its commit 1 and a paragraph on a `./check` wrapper in its commit 4. Its header says #79's P2 replaces its recording rule D7, and that `teach check NNNN` is one verb for a lesson's exercises and for a checked task (the issue text). In the probe, a grep of `bin`, `hooks` and `skills` for `teach check` and `requirements.json` printed nothing.
- **Not here.** In the probe, the vault's `snippets`, `synthesis` and `notes` folders held no file named for 2026-11-15, and this checkout's `docs/specs` held none. So the six entries the proposal cites and the proposal file were not found in those places. The issue text holds the proposal verbatim.

## Decisions

<!-- evidence: 2026-11-18-lines-behind-plan-issue-79-at 2026-11-18-more-lines-behind-plan-issue-79 2026-11-18-issues-79-78-research-vault-as 2026-11-18-owner-s-answers-2026-11-18 2026-11-18-probe-plan-issue-79-checked-tasks 2026-11-18-adversarial-review-findings-first-draft-plan 2026-11-18-lab-tooling-lines-behind-plan-issue 2026-11-18-probe-teach-lint-warn-lab-bypassed -->

Every rule in this section is Judgment, applying the proposal, the owner's answers and the review. The differences from the proposal's text that this plan knows of are marked "Differs from the proposal".

### D0. Order with issue 78

This plan is built first. It builds `teach check` for a checked task, the usage string and the `./check` wrapper. Issue 78 then adds exercises to the same verb: its commit 1 no longer adds the verb or the usage string, and its commit 4 no longer adds the wrapper paragraph. The issue says "Amend #78's plan before building either" (the issue text; R18). So before commit 1, and only with the owner's go-ahead, one comment on issue 78 says this.

### D1. Three preferences in `MISSION.md` (P1)

Three bullets under `## Constraints`, each in a fixed form:

| Bullet | Values | When absent |
|---|---|---|
| `- Hints: <value>` | `always`, `on request` | `always` |
| `- Path reviews: <value>` | `yes`, `no` | `no` |
| `- Reminders: <value>` | `none`, `every <N> days` (N from 1 to 3650; `every 1 day` also) | `none` |

- One function reads them: `missionPrefs(workspaceDir)` in `bin/lib/teach.mjs`. It returns `{ hints: 'always' | 'on request', pathReviews: boolean, reminders: number | null, unset: string[], invalid: string[] }`. `unset` holds the names `hints`, `path reviews` and `reminders` that have no valid bullet.
- A bullet is one of the three when its text before the colon is one of the names in any letter case. It is valid only when the name and the value are spelled as in the table, with any spaces after the colon and at the end of the line (R13). `invalid` holds one message for each bullet that is one of the three and not valid, and for a second bullet of one name. An invalid bullet is never read as a value.
- `teach lint` reports `MISSION_PREF_INVALID` on `MISSION.md`, once for each message.
- `teach next` prints, after `review-failed:`, the line `preferences: hints <value>, path reviews <value>, reminders <value>`, and after it `preferences-unset: <names>` when `unset` is not empty (R15). The skill reads the answers from the `preferences:` line. The `preferences-unset:` line tells it to ask a workspace made before this change.
- The interview gains a new last item: one dialog call with the three questions of P1. The skill writes all three bullets. When `teach next` prints the `preferences-unset:` line, the skill asks the same dialog once at the start of the session; for a path that holds `Review of` lines not yet built, it asks whether to keep them. Changing an answer is an edit to the bullet. It is not a mission shift and needs no learning record.

### D2. Reviews are offered (P5)

- `teachIndex` calls `missionPrefs` and returns it as `prefs`. With `reminders` null, every record's `reviewDue` is false. With N, the cutoff is N days in place of 21. `SPACING_DAYS` is removed, with its second export in the hook; the tests that use it take the number 21 and a `Reminders: every 21 days` bullet in its place (R14).
- With no reminders: `teach next` prints no `review-due:` line; `progress` returns `reviewDue: null`, so `/progress.json` carries null, and `progressText` and `progressHtml` leave the review-due text out; the session brief is `research-teach <name>: <m> reference doc(s) with a stale citation<last>` and is empty when `m` is 0 and there is no attempt. With reminders, all are as today. The hook's header comment (line 3) is reworded.
- `review-failed` is not changed. It is the list of records to come back to, and the skill reads it when it chooses the next lesson.
- The shared fixture's `MISSION.md` gains `- Hints: always`, `- Path reviews: yes` and `- Reminders: every 21 days`, so the tests that expect review-due keep their values and gain the one `preferences:` line (R2).
- `SKILL.md` line 83: with reminders, the skill offers a review of the `review-due` records at the start of a session, in that one place, and the learner may decline; otherwise it builds from the fringe, and builds a review when the learner asks for one. Line 119 loses the 21 days and their defence: the days are the learner's number. Line 50 and `PATH-FORMAT.md` line 29: review lines are planned only with `Path reviews: yes`.

### D3. Requirements, and a checker that names them (P2)

`evidence/NNNN/requirements.json`:

```json
{ "version": 1, "timeout": 60,
  "requirements": [
    { "id": "svc-port", "text": "The Service web listens on port 8080.",
      "records": ["0003-service-ports"], "read": "0007-services.html" } ] }
```

- `version` is 1. `timeout` is optional: whole seconds from 1 to 600, 60 when absent. It guards against a script that hangs. It is not a limit on the learner.
- `requirements` holds one or more. An `id` matches `^[a-z][a-z0-9-]{0,39}$` and is unique. `text` and `read` are strings of 1 to 300 characters with no character `LAB_TEXT_BAD_RE` matches. `read` is a file of `lessons/` or `reference/`, or a vault entry's id. `records` is a list of learning-record ids and may be empty. No other key is allowed at either level.
- `check.sh` prints one line on standard output for each requirement it assessed: `ok <id>` or `FAIL <id>: <hint>`. It may stop after a failure; an id it did not print is unreached. It exits 0 when every id is `ok`, and 1 otherwise. Other lines on standard output are ignored. Standard error is not shown, except its last line with a problem.
- A **problem** is one of these:
  - any exit code other than 0 and 1, or a script that cannot start
  - exit 0 without `ok` for every id, or with a `FAIL` line
  - exit 1 with no `FAIL` line
  - an id the file does not hold, or an id printed twice
  - a hint with a character `LAB_TEXT_BAD_RE` matches
  - a run past the timeout, or output past 1 MiB
  - a `requirements.json` that is missing or invalid, or names a record that `learning-records/` does not hold (R16)

  `teach check` then prints one line, `teach check: NNNN: <why>`, on standard error, exits 2 and records nothing.
- The step keeps its `evidence/NNNN/setup.sh` line. Its check line becomes `./check N`, N with or without leading zeros. The step quotes each requirement's `text` word for word. The `mission` block states every requirement `ok` as the observable result, where it states `PASS` today.
- The old output (`PASS`, `FAIL: ...`) is not read.
- **The repo's lab tooling.** This plan changes none of the rules on it. `SKILL.md` line 60 has the skill look for the repo's lab tooling before a checked task needs an environment, the files of the binding's `lab.docs` first. `LESSON-FORMAT.md` line 69 puts a task's `setup.sh` and `solution.sh` in the environment the `Task environment:` bullet names, and puts the author's probes, `run.sh` among them, under the lab-tooling rule. The interview names the repo's lab tooling as the first option for that bullet when the repo has one (`SKILL.md` line 45) (the lab snippet). In the lab probe, with a `lab` block in the binding, `teach lint` printed `WARN_LAB_BYPASSED` for an `evidence/0001/setup.sh` that held a `bypass` string. It printed none when the file also sourced a `uses` path, and none when `PLAN.md` held an `own environment:` line. Judgment: `teach check` and the start of a certification run call no lab tooling themselves. They run `setup.sh` and `check.sh`, and those scripts call it when the learner's task environment is the repo's lab.

### D4. `teach check`, teaching mode (P2, P3)

`teach check [--dry-run] [--hints] <N> [workspace]`. `hints`, `no-hints`, `start`, `certify` and `cancel` join the `BOOL` set. Positional words of one to four digits are lesson numbers; at most one other word is the workspace.

- `N` names the folder `evidence/NNNN/`. With `--dry-run` nothing else is needed, so `run.sh` can run before the lesson is written (R1). Without it, `N` must also name the one file `lessons/NNNN-*.html`, which the attempt records; with none, exit 2.
- `bin/lib/task.mjs` starts the checker itself: by its absolute path, no shell, from the workspace root, leading its own process group, with the environment `teach check` was started with. It does not use `launch`, which needs a pin (R12). It keeps at most 1 MiB of output itself. `stopGroup` is exported from `labs.mjs` and used at the timeout, at the output cap, when the leader exits, and on SIGINT, SIGTERM and SIGHUP.
- Output, one requirement after another in file order:
  - `ok <id>: <text>`
  - `FAIL <id>: <text>`, then `  hint: <hint>` when the mission says `Hints: always` or `--hints` is given, then `  read: <read>`
  - `not reached <id>: <text>`
  - with `Hints: on request`, no `--hints` and one failure or more, a last line: `hints: ./check --hints <N>`
- No count and no fraction is printed. Exit 0 when every id is `ok`, 1 otherwise, 2 for a problem.
- **Recording.** `teach check` writes an attempt when the three lists differ from those of the lesson's last attempt that has a `tested` list, or when there is none. With `--dry-run` it writes nothing. So ten runs against the same failure leave one attempt, and a failure that comes back after a pass is written again.
- **Validation and the credential.** `run.sh` runs `./check --dry-run --hints N` where it ran `evidence/NNNN/check.sh`, so the validation run also proves the output form, its log does not change with the `Hints:` bullet, and its three exit codes are still 1, 0, 1. The step's line is `./check N`; `LESSON-FORMAT.md` says the experiment's Result quotes it with the two flags, which is the one exception to "exactly as the experiment's Result quotes it" (R1). For a Kubernetes environment `run.sh` sets the read-only credential in the environment of those lines. The learner's `./check N` runs with the learner's own credential. The skill runs `./check` only with `--dry-run`.
- **The wrapper.** `check` at the workspace root, as issue 78's D3 has it: `cd "$(dirname "$0")" && exec node "<absolute plugin root>/bin/research-vault.mjs" teach check "$@"` under `#!/usr/bin/env bash`. It holds a path of this machine, so the skill writes it, sets its executable bit and adds `check` to `.gitignore` each time it starts work in a workspace (R11).

### D5. What an attempt stores (P2, P3)

New optional attempt fields: `passed`, `failed`, `unreached`, `tested`, `answered` (lists of ids) and `certification` (a run id, D8). An attempt with a `tested` list is a **task attempt**. Differs from the proposal: P4 stores `certification: true`; a run id lets the attempts of one run be found.

- **From a check:** `passed`, `failed` and `unreached` hold requirement ids. `tested` holds each learning record for which the run reached every requirement that names it. `records` holds each record in `tested` with one of those requirements failed. `total` is the number of requirements and `wrong` the positions of those not in `passed`; the schema requires both and nothing shows them for a task.
- **From an answer:** `teach attempt add --lesson <id> --answered <ids>` (`all` for every id), beside `--answers` and `--result`; exactly one of the three. It stores `answered`, and in both `tested` and `records` every record an answered requirement names. `total` is the number of answered ids and `wrong` every position.
- `writeAttempt` gains a `task` parameter that holds those fields ready-made. `bin/lib/task.mjs` builds them.
- **`teachIndex`.** A task attempt counts for a record only when `tested` names it, never through the lesson's quiz. Any other attempt counts as today. `lastAttempt` gains `kind`: `task`, `answered` or `quiz`. A record gains `answered`: active, and its last attempt is an `answered` one.
- So a record is one to come back to in two cases: the latest run that reached all of its requirements found one failed, or an answer was given. It stops being one when a later such run finds them all `ok`. A run that did not reach them leaves it as it was.
- A requirement removed from the file later leaves its id in old attempts. Every view prints stored ids as they are.
- **The import.** `importAttempts` skips an attempt when a file with its base id exists (`teach.mjs` line 217, the second snippet), so a quiz attempt from a browser is skipped when a task attempt of the same second and lesson exists (R17). This plan leaves that as it is, pins it with a test and marks it with a `ponytail:` comment that names the fix: compare only with attempts that have no `tested` list.

### D6. No score for a task (P3)

One function, `taskSummary(attempt)` in `teach.mjs`, gives the text every view uses:

- an answered attempt: `answered <ids>`
- a certification attempt: `certification <ok> of <total>`, where `ok` is the length of `passed` and `total` the length of the three lists together
- any other: the parts that are not empty of `ok <ids>`, `failed <ids>`, `not reached <ids>`, joined by `; `

Then:

- `teach next`: the `last attempt` column reads `ok`, `failed` or `answered`, then ` on <date>`, for a task attempt. After `review-failed:` comes `answered: <ids or none>`, before the `preferences:` line.
- `progress`: a lesson's task attempts get a second row with `kind: 'task'` and the lesson's id. `progressText` and `progressHtml` show its attempt count and, in the `latest` cell, the summary and date; `first` and `best` are empty. The timeline shows the summary and no "missed item" text.
- The session brief: `; last attempt on <lesson>: <summary>` for a task attempt.
- Quiz attempts and `--result` attempts are shown as today.

### D7. The answer is given (P3)

`SKILL.md` line 121 changes. When the learner asks for the answer, to one requirement or to the whole task, the skill gives the reference solution with what each part does and why, from the lesson's snippet and experiment. Then it records `teach attempt add --lesson <id> --answered <ids>`. The sentence that reading the solution "turns the attempt into a read" goes. The learner may try again whenever they like.

### D8. A certification run, of one task or several (P4, and the owner's fourth answer)

A run is a list of one or more checked tasks with one start, one end and one grade.

Differs from the proposal: P4 has `./check --certify N` for one task with no start. Finding K2 on the proposal's fourth draft was that the CLI "had no way to know a run was under way" (the issue text). The proposal's answer to K2 had no review of its own, and a run of several tasks with a timer needs a start. So this plan has one form for one task and for several.

- **State.** `.teach-certify.json` at the workspace root: `{ "id": "c-YYYYMMDD-HHMMSS", "started": "<ISO time>", "tasks": ["0007", "0009"], "minutes": 60, "pass": 70, "hints": true }`. `minutes` and `pass` are null when not given. The skill adds the name to `.gitignore`, as it does for `.teach-serve.json`.
- **Start.** `./check --start <N> [<N> ...] [--minutes <M>] [--pass <P>] [--no-hints]`. M is whole minutes from 1 to 1440. P is a whole percentage from 1 to 100. `--no-hints` is the learner's answer "hold the hints back" (R5).
  - It refuses, with exit 2 and nothing changed, when a number is given twice, or a task has no lesson file, or its `requirements.json` or one of its scripts is missing or invalid.
  - It writes the state file first, with the flag that fails when the file exists, and `started` null. A run that is open, or a second start at the same moment, gets exit 2 (R4).
  - It then prints and runs each task's `setup.sh` in order, so the run starts from fresh scopes. A setup runs with no timeout, its output goes straight to the terminal, and SIGINT, SIGTERM and SIGHUP stop its group. A setup that does not exit 0 removes the state and stops the start with exit 2; the line names the tasks whose scopes were already reset (R7).
  - Then it sets `started` to the time after the last setup, so a slow setup takes none of the learner's limit, and prints the run id, the tasks, the number of requirements, the limit and the pass line when set, whether hints are held back, and the two ways to end.
- **While a run is open.** `./check N` for a task in the run prints the requirements as D4 does, records nothing, and adds a last line: `certification run <id>: <m> minutes` with ` of <M>` when a limit is set, then `; end: ./check --certify; drop: ./check --cancel`. With hints held back it prints no hint line and no `hints:` line, and `--hints` is refused with exit 2. Other lessons check as usual. `teach next` prints `certification: open <id>, tasks <NNNN, ...>, <m> minutes`, with ` of <M>` and `, hints held back` when set, so a new session knows a run is open (R6).
- **End.** `./check --certify`, with no number. It runs each task's checker. On a problem in any task it prints the problem, writes nothing, keeps the run open and exits 2. Otherwise:
  - it renames the state to `.teach-certify.ending.json`; a second end at the same moment finds no state and exits 2 (R4)
  - it writes one attempt for each task, always, with `certification: <run id>`
  - it removes the renamed file and prints, in this order: one line for each task, `<lesson id>: <ok> of <total>`; `grade: <ok> of <total> requirements`, over every requirement of every task, so an unreached requirement counts as not met; with a pass line, `pass line <P>%: met` when `ok * 100 >= P * total`, else `pass line <P>%: not met`; `time: <m> minutes`, with ` (limit <M>)` inside a limit or `, <k> over the limit of <M>` past it; then each task's requirements as in D4, with hints by the mission's bullet
  - it exits 0
- **Cancel.** `./check --cancel` removes the state, prints that nothing was recorded and exits 0. When it finds `.teach-certify.ending.json`, left by an end that was killed, it removes it and prints that attempts of the run may be recorded. With neither file it exits 2. `--start` and `--certify` that find the ending file exit 2 and name `--cancel`.
- **Other forms.** `--certify` or `--cancel` with a number or another flag, `--start` with `--certify`, and `--minutes`, `--pass` or `--no-hints` without `--start` print the usage and exit 2. The skill gives the start line with the numbers first, because the parser takes a number that follows `--minutes` as its value (R7).
- **The grade.** `certificationRuns(attempts)` derives it: for each run id, the last attempt of each lesson (R4). After `answered:`, `teach next` prints `certification: <run id> <ok> of <total> (<NNNN> <ok> of <total>, ...)` for the latest run when there is one. The grade is never stored. A requirement counts once; there are no weights. The time is reported and changes no grade: the proposal's research found no checked quote that says lowering a score for time improves learning (the issue text).
- Only checked tasks. A lesson of exercises is refused at `--start` when issue 78 adds them.
- **The skill.** When the learner asks to be tested, the skill asks one dialog: which tasks (one or several), whether hints are held back, a pass line, a time limit. It says that the start resets each task's scope, and gives the learner the `./check --start` line to run. When `teach next` shows an open run, it gives no solution for the run's tasks, and no hint when those are held back, and says so when asked. After the grade it gives answers on request. It never words the grade as a likelihood of passing a real exam.

### D9. Lint and gate (P2)

- A `project` lesson is a checked task when one of the three scripts or `requirements.json` exists, or a step line starts with `./check ` (R8).
- `LESSON_TASK_INCOMPLETE` changes its step rule: the step has a line `./check N` for this lesson's number, in place of the line ending `evidence/NNNN/check.sh`. It gains two findings: `evidence/NNNN/requirements.json is missing`, and `step does not hold the text of requirement <id>`.
- A new code, `TASK_REQUIREMENTS_INVALID`, on the file, once for each problem of D3's rules for the file, for each `records` id with no learning record and for each `read` that names no file of `lessons/` or `reference/` and no vault entry (R16).
- `commandTools` skips a first word that is exactly `./check`.
- **The gate** (R3). `gate.mjs` gains `taskFile(page)`: the absolute path of `evidence/NNNN/requirements.json` for a lesson page when the file exists, else null. `unitHashes` hashes the `step` unit over the block and that file's bytes. `gateStatus` line 225 treats a pending `step` unit as it treats a pending `img:` unit. `gate staged` (line 361) and the Stop hook (line 38) also take a page whose `taskFile` is staged or changed. `codex-review.mjs` line 52 is not changed: the step quotes every requirement's text, so a reviewer needs no second file.

### D10. The skill and the formats

`SKILL.md`: the workspace table gains rows for `check`, `.teach-certify.json` and `evidence/NNNN/requirements.json` (R11); lines 50, 61, 83, 119, 120 and 121 and the interview change as D1 to D8 say. `LESSON-FORMAT.md`: the Checked task section (lines 65 and 73). `MISSION-FORMAT.md`: the three bullets after line 30. `PATH-FORMAT.md`: line 29. `docs/REFERENCE.md`: every verb and line this plan changes. Each is a gated file under this checkout's binding (`.research-vault.json`, the snippet), so each edit gets the claims gate in the commit that makes it. Each edit is in the commit that changes the code it describes (R9).

## Left out, and why

<!-- evidence: 2026-11-18-issues-79-78-research-vault-as 2026-11-18-owner-s-answers-2026-11-18 -->

- **Hiding quiz scores.** The owner's second answer.
- **Exercises**, in teaching and in certification. They are issue 78's, and the owner's third answer keeps them out of certification runs.
- **The proposal's first-result, cold-flag and reset-marker rules.** The proposal dropped them (the issue text).
- **A stored grade, weights, a reduced grade for hints or retries, a wait, a cap on tries.** The proposal rejects them (the issue text). Judgment: a reduced grade for time is left out too.
- **Feedback held until the end of a run.** The issue's last comment lists it as something a learner may ask for (the issue text). Judgment: P4 holds back the answer and, on request, the hints; a check during a run still shows which requirements are met. It waits until a learner asks.
- **The practice ideas 1 to 4 and 7 of the issue's last comment** (goal not method, a named target, a restart check, fault-finding, what may be consulted). They had no adversarial review (the issue text). Judgment: they are authoring advice, and they wait for a task built on a real mission.
- **Windows.** The wrapper and the scripts are bash.

## How each commit is reviewed and gated

<!-- evidence: 2026-11-18-lines-behind-plan-issue-79-at 2026-11-18-owner-s-answers-2026-11-18 -->

The owner asked for "separate agent reviews and claims gates at key points such as commits" (the answers). Every commit below ends with these steps, in order. A commit is not made until each has passed.

- [ ] **Checks.** `npm test`, `npm run lint:self`, `node scripts/check-agentsmd-drift.mjs` and `node scripts/check-encoding.mjs` all pass (`AGENTS.md` lines 7 to 10, the snippet).
- [ ] **One review by a fresh agent.** Dispatch one general-purpose agent, not a fork, with no summary of the work. Give it three things: the output of `git diff --staged`, the path of this plan, and the name of the commit's section. Its task, word for word: "Find where this diff does not do what the plan's section says, where it breaks behaviour the section does not name, and which test would still pass with the code wrong." Fix each finding it shows to be real, and run the checks again. A small fix gets no second review.
- [ ] **Claims gate.** Run the `research-claims-gate` skill on each staged gated file, with a new "lines behind" snippet for the lines the edit states: two rounds, then a merit decision in `GATE-LOG.md`.
- [ ] **`node bin/research-vault.mjs gate staged --check`** exits 0 (`AGENTS.md` line 11).
- [ ] **Commit**, with one line under `## [Unreleased]` in `CHANGELOG.md`, a `COUPLINGS` row for each shared string the commit adds, and no Claude attribution in the message.

Work is on the branch `feat/79-teach-modes`. Each commit leaves the skill, the formats and the code saying the same thing. One part waits: the `Hints:` bullet is read and printed from commit 1 and first changes what a check prints in commit 2. After commit 5, one more fresh agent reviews the whole branch diff against "Done when". Then the branch is merged to `master` whole, pushed, and deleted at once.

## The commits

<!-- evidence: 2026-11-18-lines-behind-plan-issue-79-at 2026-11-18-more-lines-behind-plan-issue-79 2026-11-18-issues-79-78-research-vault-as 2026-11-18-adversarial-review-findings-first-draft-plan 2026-11-18-lab-tooling-lines-behind-plan-issue 2026-11-18-probe-teach-lint-warn-lab-bypassed -->

Before commit 1:

- [ ] `git add -f docs/specs/plan-2026-11-18-teach-modes.md` and commit the plan with its verdict; `docs/specs/` is gitignored (the issue text).
- [ ] Ask the owner; on a yes, post the comment of D0 on issue 78.

### Commit 1: preferences, and reviews as offers (D1, D2)

**Files:** `bin/lib/teach.mjs`, `bin/lib/lesson.mjs`, `bin/commands/teach.mjs`, `hooks/session-start.mjs`, `scripts/deps.mjs`, `test/fixtures/teach/MISSION.md`, `test/teach-store.test.mjs`, `test/teach.test.mjs`, `test/sessionstart.test.mjs`, `test/skills.test.mjs`, `skills/research-teach/SKILL.md`, `skills/research-teach/MISSION-FORMAT.md`, `skills/research-teach/PATH-FORMAT.md`, `docs/REFERENCE.md`.

**Produces:** `missionPrefs(workspaceDir)` as D1 gives it; `teachIndex(...).prefs`; `progress(...).reviewDue` is `null` with no reminders.

- [ ] Run `node scripts/deps.mjs bin/lib/teach.mjs` and `grep -rn "21 days\|SPACING_DAYS" .` outside `node_modules`. Every hit is changed in this commit or named in the commit message as left.
- [ ] Tests first for `missionPrefs`, each on a `MISSION.md` written to a temporary workspace:
  - no bullet: `{ hints: 'always', pathReviews: false, reminders: null }`, `unset` is `['hints', 'path reviews', 'reminders']`, `invalid` is empty
  - `- Hints: on request`, `- Path reviews: yes`, `- Reminders: every 14 days`: `'on request'`, `true`, `14`, `unset` empty
  - `- Reminders: every 1 day` gives 1
  - `- hints: Always`, `- Reminders: every 0 days`, `- Reminders: weekly`, and `- Hints: always` twice: each gives one `invalid` message, and the first three leave the name in `unset`
  - a bullet with one of the names under another heading is not read
- [ ] Tests first for the readers:
  - `teach lint` prints a line that starts `MISSION_PREF_INVALID  MISSION.md:` for a bad bullet and exits 1
  - `teach next` on a workspace with the `Hints:` bullet missing prints `preferences: hints always, path reviews yes, reminders every 21 days` and then `preferences-unset: hints`; with all three it prints no `preferences-unset:` line
  - a record 30 days old with no attempt: `reviewDue` is false with no bullet, with `Reminders: weekly` and with `every 45 days`; true with `every 21 days` and with `every 7 days`
  - `teach next` with no bullet prints no line starting `review-due:` and still prints `review-failed:`
  - `progressText` with no bullet holds no `review-due:`; `progressHtml` holds no `Review due`; `/progress.json` holds `"reviewDue":null`
  - `workspaceBrief` with no bullet, one stale doc and one quiz attempt is `research-teach learn/k8s: 1 reference doc(s) with a stale citation; last attempt 2/3 on 0001-x`; with nothing stale and no attempt it is `''`
  - the asserts that `SPACING_DAYS` is 21 are removed; the tests at lines 226, 231, 335 and 349 of `test/teach.test.mjs` change only by the one `preferences:` line in the two `teach next` outputs
- [ ] Run them; they fail. Write the code. Run them; they pass.
- [ ] The skill and format edits of D1 and D2. The `COUPLINGS` row of line 175 loses the 21 days, and a new row joins `teach.mjs` and `MISSION-FORMAT.md` on `Reminders:`.
- [ ] The steps of "How each commit is reviewed and gated".

### Commit 2: the checked task's new form (D3, D4 without recording, D9 without the gate)

**Files:** create `bin/lib/task.mjs`, `test/teach-task.test.mjs`, `test/fixtures/teach-task/` (its own workspace: `MISSION.md`, a learning record `0001-files`, one `project` lesson `0001-files`, `evidence/0001/` with the three scripts and `requirements.json`); modify `bin/lib/labs.mjs` (export `stopGroup`), `bin/lib/args.mjs`, `bin/lib/lesson.mjs`, `bin/commands/teach.mjs`, `scripts/deps.mjs`, `test/teach.test.mjs` (the usage string), `test/lesson.test.mjs`, `test/skills.test.mjs`, `skills/research-teach/SKILL.md`, `skills/research-teach/LESSON-FORMAT.md`, `docs/REFERENCE.md`. The shared fixture gets no lesson.

**Produces,** from `bin/lib/task.mjs`:

- `readRequirements(ws, nnnn)` returns `{ timeout: number, requirements: { id, text, records, read }[], problems: string[] }`
- `parseChecker(requirements, { code, stdout })` returns `{ passed: string[], failed: { id, hint }[], unreached: string[] }` or `{ problem: string }`
- `runChecker(ws, nnnn, { timeoutMs, env, limits })` returns a promise of `{ code, stdout, stderr }` or `{ problem: string }`
- `reportLines(requirements, parsed, { hints, n })` returns the lines of D4

The fixture task has three requirements, `a-exists`, `b-exists` and `b-text`. `a-exists` and `b-exists` name the record `0001-files`; `b-text` names none. `setup.sh` makes an empty folder `teach-0001/` in the workspace. `solution.sh` writes two files in it. `check.sh` tests them with `[ -f ]` and `grep -q` and stops after the first failure.

- [ ] Read first what `exportPage` (`teach.mjs` line 675) does with a checked task's step. The export must do the same after this commit.
- [ ] Tests first for `parseChecker`: one case for each problem of D3; all `ok` with code 0; one `FAIL` then silence with code 1 gives the rest unreached; a line that is neither form is ignored.
- [ ] Tests first for `readRequirements`: the valid file; then one problem each for an unknown key, a bad id, a repeated id, an empty list, a `timeout` of 0 and of 601, a `text` with a control character, a record id that `learning-records/` does not hold.
- [ ] Tests first for `teach check` on a copy of the fixture:
  - after `setup.sh` it exits 1 and prints `FAIL a-exists: ...`, the hint, the `read` line and two `not reached` lines
  - after `solution.sh` it exits 0 and prints three `ok` lines
  - no output line matches `\d+ of \d+` or `\d+/\d+`
  - with `Hints: on request` there is no hint line and the last line is `hints: ./check --hints 1`; `--hints` prints the hint
  - with the lesson file removed, `--dry-run 1` still runs and a plain `1` exits 2
  - no run writes an attempt in this commit
- [ ] Tests first for the runner: a checker replaced by `sleep 30 & sleep 30` with `timeout` 1 gives exit 2 inside 10 seconds with `ran past 1 seconds`, and no process of its group is left; SIGINT sent to `teach check` while the checker sleeps leaves none either; a checker that prints 2 MiB gives exit 2; a checker without the executable bit gives exit 2.
- [ ] Tests first for the arguments: `teach check 9` with no `evidence/0009/` exits 2; `teach check` with no number prints the usage and exits 2; `--hints 1` and `--dry-run 1` both read 1 as the lesson number.
- [ ] Tests first for the lint:
  - the fixture task lints clean, with no `LESSON_TOOL_NOT_INTRODUCED` for `check`; a step line `./other 1` still gives one
  - without `requirements.json`, with a step that lacks `./check 1`, and with a step that lacks one requirement's text, each gives its `LESSON_TASK_INCOMPLETE` finding
  - a `project` lesson with a `./check 1` step line and no script gives the three missing-script findings
  - an invalid file, an unknown record id and a `read` that names nothing each give `TASK_REQUIREMENTS_INVALID`
  - with a `lab` block whose `docs` is `LAB.txt`, `uses` is `lab/lib.sh` and `bypass` is `kind create cluster`: the fixture's `setup.sh` with a line `kind create cluster` gives `WARN_LAB_BYPASSED` on `evidence/0001/setup.sh`; with a line that sources `lab/lib.sh` added it gives none. The lab probe printed both results at commit 1e0ef62, so this test is expected to pass before any code of this commit is written.
- [ ] Run; fail; write the code; pass.
- [ ] `SKILL.md` line 61 gains one sentence: a task's `setup.sh` and `solution.sh` run in the environment of the `Task environment:` bullet, which is the repo's lab tooling when the learner chose it, and `run.sh` follows the lab-tooling rule of line 60. The sentence restates lines 45 and 60 and `LESSON-FORMAT.md` line 69 (the lab snippet) and changes no rule.
- [ ] `SKILL.md` line 61 (the files, the output form, `run.sh` with `./check --dry-run --hints N`), the wrapper where the skill starts work in a workspace, the two workspace-table rows for `check` and `requirements.json`, `check` in the `.gitignore` line. `LESSON-FORMAT.md`: the Checked task section as D3 and D4 say, and line 73 names `run.sh` alone. `test/skills.test.mjs` pins `./check` and `requirements.json`. `COUPLINGS` rows: `task.mjs` with `LESSON-FORMAT.md` on `FAIL <id>`, `task.mjs` with `SKILL.md` on `./check`, and the rows of lines 145 and 197 reworded.
- [ ] The steps of "How each commit is reviewed and gated".

### Commit 3: the gate reads the requirements file (D9, the gate)

**Files:** `bin/lib/gate.mjs`, `hooks/stop-gate.mjs`, `test/gate.test.mjs`, `test/stopgate.test.mjs`, `docs/REFERENCE.md`.

**Produces:** `taskFile(page)` from `gate.mjs`.

- [ ] Tests first, on a copy of the fixture task in a bound repo, after a `PASS` on the lesson:
  - an edit to `requirements.json` makes `gate changed` list `step` and no other unit, and `gate status --check` on the lesson exits 1
  - `gate staged --check` reports the lesson when only `requirements.json` is staged
  - the Stop hook's `missingGates` lists the lesson when only `requirements.json` changed
  - a lesson with no `requirements.json` hashes its `step` unit as today
- [ ] Run; fail; write the code; pass.
- [ ] The steps of "How each commit is reviewed and gated".

### Commit 4: recording, no score for a task, and the answer (D5, D6, D7)

**Files:** `schema/teach.schema.json`, `bin/lib/task.mjs`, `bin/lib/teach.mjs`, `bin/commands/teach.mjs`, `hooks/session-start.mjs`, `test/teach-task.test.mjs`, `test/teach-store.test.mjs`, `test/sessionstart.test.mjs`, `test/skills.test.mjs`, `skills/research-teach/SKILL.md`, `docs/REFERENCE.md`, and `skills/research-teach/LEARNING-RECORD-FORMAT.md` if it lists the attempt fields.

**Produces:** `checkAttempt(requirements, parsed, certification = null)` and `answeredAttempt(requirements, ids)` from `task.mjs`, each returning the `task` object of D5; `writeAttempt(ws, { lesson, answers, result, task, now }, schema)`; `taskSummary(attempt)`; `lastAttempt.kind`; a record's `answered`.

- [ ] Read `importAttempts` (line 201) and `postAttempt` (line 882) first. Neither may write or change a task attempt.
- [ ] Tests first for recording, on the fixture task:
  - a failing `./check 1` writes one attempt with `failed: [a-exists]`, `unreached: [b-exists, b-text]`, `passed: []`, `total: 3`; a second run writes none; `--dry-run` writes none
  - fail, pass, then the same fail: three attempts
  - fail, a quiz attempt on the same lesson, the same fail: the second fail writes none
  - **two requirements, one record:** with `a-exists` ok and `b-exists` failed, the record `0001-files` is in `tested` and `records`; with `a-exists` failed and the run stopped before `b-exists`, the record is not in `tested`, and its `reviewFailed` is what it was before the run
  - a failed requirement makes its record's `reviewFailed` true; a later run with every id `ok` makes it false
  - a lesson with a quiz and a task: a task attempt does not change the last attempt of a record that only the quiz tests
- [ ] Tests first for the answer:
  - `--answered a-exists` stores `answered`, sets the record's `answered` and `reviewFailed`, and `teach next` prints the record on the `answered:` line
  - a passing check after it is written and clears both, though its lists equal those of the passing check before the answer
  - `--answered nope`, and `--answered` with `--result`, exit 2
- [ ] Tests first for the views:
  - `teach next`, `teach progress`, the progress page and `workspaceBrief` show the summaries of D6 for the task and no `\d+/\d+` for it; the quiz lesson's row is byte-for-byte what it was
  - an attempt whose `failed` holds an id the file no longer has is printed with that id and nothing throws
  - `teach lint` is clean on a workspace that holds a check attempt and an answered attempt
  - an import of a quiz attempt whose base id a task attempt holds prints `skipped ...: already recorded`
- [ ] Run; fail; write the code; pass.
- [ ] `SKILL.md` line 121 as D7 says; `test/skills.test.mjs` pins `--answered`.
- [ ] The steps of "How each commit is reviewed and gated".

### Commit 5: the certification run (D8)

**Files:** `bin/lib/task.mjs`, `bin/lib/teach.mjs`, `bin/commands/teach.mjs`, `test/teach-task.test.mjs`, `test/fixtures/teach-task/` (a second task, `0002-more`, with two requirements), `test/skills.test.mjs`, `skills/research-teach/SKILL.md`, `docs/REFERENCE.md`.

**Produces:** `certificationRuns(attempts)` returns `{ id, date, ok, total, tasks: { lesson, ok, total }[] }[]`, oldest first.

- [ ] Tests first for the start, with the clock passed in:
  - `--start 1 2` runs both setups, writes the state and exits 0; `started` is the clock's time after the second setup
  - a second `--start` exits 2 and leaves the state as it was
  - `--start 1 1`, `--minutes 0`, `--pass 101`, a task with no `requirements.json` and a number with no lesson file exit 2 and leave no state
  - task 2's `setup.sh` exits 3: exit 2, no state, and the line names task 0001 as reset
  - `--start 1 --certify`, `--certify 1`, `--cancel 1` and `--minutes 5 1` without `--start` print the usage and exit 2
- [ ] Tests first for an open run:
  - `./check 1` prints the requirements and the `certification run` line with the minutes, exits 1 and writes no attempt
  - after `--start 1 --no-hints`, `./check 1` prints no hint line, and `./check --hints 1` exits 2
  - `teach next` prints `certification: open ...` with the tasks and the minutes
- [ ] Tests first for the end:
  - `--certify` with no run exits 2
  - with task 1 solved and task 2 untouched it writes two attempts with the same `certification` id, though task 1's lists equal its last attempt's; prints `0001-files: 3 of 3`, `0002-more: 0 of 2`, `grade: 3 of 5 requirements`; leaves neither state file
  - `--pass 60` prints `pass line 60%: met` for 3 of 5, and `--pass 61` prints `not met`
  - `--minutes 60` with 42 minutes passed prints `time: 42 minutes (limit 60)`; with 65 passed, `time: 65 minutes, 5 over the limit of 60`, and the grade line is the same
  - a plain `./check 1` after the run, with the same lists, writes no attempt
  - **a problem at the end:** task 2's checker exits 7; `--certify` exits 2, writes no attempt for either task, and the state is still there; `--cancel` then removes it and exits 0
- [ ] Tests first for a crash:
  - a state file that is not JSON: `--certify` exits 2 and names `--cancel`; `--cancel` removes it
  - with `.teach-certify.ending.json` in place, `--start` and `--certify` exit 2 and name `--cancel`; `--cancel` removes it and prints that attempts may be recorded
  - `certificationRuns` over two attempts with one run id and one lesson counts the later one only
- [ ] Tests first for the views: `teach next` prints the `certification:` line of D8 for the run, and the progress timeline shows `certification 3 of 3`; `teach lint` is clean on the workspace.
- [ ] Run; fail; write the code; pass.
- [ ] `SKILL.md`: the certification dialog and rules of D8, the workspace-table row and the `.gitignore` entry for `.teach-certify.json`. `test/skills.test.mjs` pins `--start`, `--certify` and `--cancel`.
- [ ] The steps of "How each commit is reviewed and gated". Then the whole-branch review, the merge and the branch's removal.
- [ ] Ask the owner; on a yes, post a closing note on issue 79.

## Review focus

<!-- evidence: 2026-11-18-probe-plan-issue-79-checked-tasks 2026-11-18-issues-79-78-research-vault-as -->

Five conditions that the proposal names or implies and that are most likely to bite a learner, and where this plan tests each.

1. **A checker that hangs, or leaves a child that holds its output open.** `teach check` ends inside the timeout plus the stop sequence, exits 2 and records nothing (commit 2).
2. **A workspace made before this change.** In the probe, the six workspaces held 96 attempt files, 5 with a `result:` field, and no preference bullet. Their quiz rows, records and `review-failed` lists read as before; only review-due goes (commits 1 and 4).
3. **A bullet typed by hand in a near-miss form.** It is reported by the lint and never read as a value (commit 1).
4. **One record tested by two requirements, with the run stopped between them.** The record's standing does not change (commit 4).
5. **A certification run that cannot be graded, or an end that is killed.** Nothing is recorded for any task on a problem, the run stays open, and cancel always works (commit 5).

## Done when

<!-- evidence: 2026-11-18-lines-behind-plan-issue-79-at -->

- The five checks of `AGENTS.md` lines 7 to 11 pass on each of the five commits, and each commit has its review and its claims verdicts.
- On the fixture task: `./check 1` shows each requirement as `ok`, `FAIL` or not reached and no number over a number; an answered requirement appears on `teach next`'s `answered:` line and clears on a passing check.
- A run of two tasks prints one grade over the requirements of both, and nothing is recorded when it is cancelled.
- A workspace with no `Reminders:` bullet shows no review-due anywhere, and one with `every 7 days` shows a record 8 days old as due.
- An edit to a task's `requirements.json` reopens the lesson's `step` verdict.

## Not shown by this plan

<!-- evidence: 2026-11-18-lines-behind-plan-issue-79-at 2026-11-18-issues-79-78-research-vault-as 2026-11-18-owner-s-answers-2026-11-18 2026-11-18-probe-plan-issue-79-checked-tasks 2026-11-18-adversarial-review-findings-first-draft-plan -->

- The tests do not show that either mode teaches. That needs one checked task built on a live mission and read against the attempts it leaves.
- A first `./check N` on a fresh setup fails by design (`SKILL.md` line 61, the snippet) and is recorded, so the records of the requirements that run reached and failed are on `review-failed` until a later run that reaches them finds them all `ok`. The proposal's review raised this as J6, and the proposal keeps no rule for it (the issue text).
- D8 has had one review, of this plan's first draft (the review), and none of its revised form. The owner chose it after being told it was not designed (the answers).
- Nothing of the checker, the process groups or the run's state file was run for this plan. The plan rests on reading the code, and commit 2's tests are the first run.
- The review reports that `postAttempt` and `quiz.js` write only quiz attempts (the review). This plan's session read neither, nor the body of `exportPage`. Commits 2 and 4 read them first.
- The review reads the skill as running `run.sh` before the lesson is written (R1). This plan's session did not check that order; D4 holds either way.
- The six entries the proposal cites were not found in this vault (the probe). Its quotes of the Linux Foundation, Guskey, Talbert and killer.sh are known here only through the issue text.
