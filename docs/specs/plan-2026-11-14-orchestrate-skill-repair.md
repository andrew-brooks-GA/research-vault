# Plan: repair the research-orchestrate skill after pull request 71 (2026-11-14)

Pull request 71 was merged as 0238d82 on 2026-11-14. It rewrote the reference script of `skills/research-orchestrate/SKILL.md` and added `bin/lib/research-controller.mjs` and `bin/lib/capture-operation.mjs`, both absent at its parent 2c26db0 (the fourth experiment, P18). This plan says what in that change does not work in Claude Code, recommends a repair, and lists the commits. Nothing in it is built yet. This is the plan as revised after an adversarial review of its first draft.

The plan rests on ten vault entries:

- The snippet 2026-11-14-orchestrate-repair-plan-skill-doc-lines ("the skill snippet") quotes the skill at 0238d82 and at 2c26db0 (its parent on master, the state before the pull request), plus doc and ignore-file lines at 0238d82.
- The snippet 2026-11-14-orchestrate-repair-plan-code-lines-at ("the code snippet") quotes code and test lines at 0238d82.
- The snippet 2026-11-14-orchestrate-repair-plan-revision-more-lines ("the lines snippet") quotes further code, doc, changelog and test lines at 0238d82.
- The snippet 2026-11-14-orchestrate-repair-plan-workflow-tool-constraints ("the Workflow snippet") quotes Claude Code's documentation of its Workflow tool as it was shown to the model on 2026-11-14. It is documentation, not a run of the tool.
- The experiment 2026-11-14-orchestrate-repair-plan-probes-at-0238d82 ("the experiment") holds probes P1 to P9.
- The experiment 2026-11-14-orchestrate-repair-plan-second-probes-cli ("the second experiment") holds probes P10 to P12.
- The experiment 2026-11-14-orchestrate-repair-plan-revision-third-probes ("the third experiment") holds probes P13 to P17, made for this revision.
- The experiment 2026-11-14-orchestrate-repair-plan-claims-round-one ("the fourth experiment") holds probes P18 to P21, made after the first claims round on this plan.
- The snippet 2026-11-14-orchestrate-repair-plan-session-record-user ("the session record") holds the user's three messages, the seven findings sent to a first review agent, that agent's report and the recommendation shown to the user.
- The snippet 2026-11-14-orchestrate-repair-plan-revision-adversarial-review ("the review record") holds the report of the adversarial review of this plan's first draft.

A sentence about the code or the docs cites a snippet. A sentence about behaviour cites an experiment. A sentence marked "Judgment" is this plan's choice, not a fact. The two agents' reports are reports; where the plan relies on a point of theirs that no probe here repeats, it says so. No Workflow run and no Codex run was made for this plan.

## What exists

**The skill before the pull request.** At 2c26db0 section 2 of the skill held a script, lines 32 to 77, that began with `export const meta` (line 33) and built one command prefix from `args.cli` (line 42). Each `agent` call took a template string. The fetch agents captured each source themselves with `capture --type source` and were told "If it reports a duplicate, reuse the existing id" (line 58). The verify agents recorded a confirmed claim themselves with `verify --id <source> --method refetched-source --result confirmed` (line 64). One Persist agent wrote the plan to a temp file, ran `capture --batch`, fixed the plan from the per-entry report and retried, at most 3 attempts in all, ran `lint`, and then ran `verify --id <question> --answered-by <synthesis id>` for each question the synthesis answers (line 74). Section 4 ran the `research-claims-gate` skill on the synthesis in the session, after the workflow (line 86). All of this is in the skill snippet.

**The skill after the pull request.** At 0238d82 section 2 says to use the Workflow tool with the reference script and to use the primitives of `bin/lib/research-controller.mjs` in the controller, "via a Node adapter if the Workflow runtime cannot import Node modules" (line 22). The script is lines 35 to 87 of the file. It has no `export const meta`. It calls `context`, `createTask`, `command`, `workers`, `saveBatch`, `persistBatch`, `associateClaims`, `verifyClaim` and `closeOut`. Its Recon and Sweep steps call `agent` with an object (lines 44 and 49). Line 33 names five host adapters, `fetchProposal`, `evaluateClaim`, `executeJson`, `lint` and `gate`, and says `gate` "invokes the existing research-claims-gate skill on the current synthesis and returns its recorded verdict". The authored plan is saved under the fixed label `'authored-1'` (line 82). Section 3 tells a session with no Workflow tool to "use the same primitives with `mode = 'sequential'`" (line 95). All of this is in the skill snippet.

**The controller module.** `bin/lib/research-controller.mjs` imports `node:fs` (line 3) and its second line says "this is not a CLI task runner". `createTask` takes its default key from `randomUUID()` (line 25). `docs/RELIABILITY.md` line 32 says "there is no new CLI task runner". Three tracked files name `research-controller`: `scripts/deps.mjs`, the skill and `test/research-controller.test.mjs` (the code snippet, the skill snippet and the experiment, P5). `COUPLINGS` rows at lines 30, 33 and 34 of `scripts/deps.mjs` name the module; the one at line 33 ties it to the skill through the literal `persistBatch` (the code snippet).

**The two capture paths.** `capture --batch <plan> --operation-id <key>` branches at `bin/commands/capture.mjs` line 247 into `captureOperation`; the path below it is reached only without `--operation-id`, and the name `ignoreExisting` occurs on three lines of the repo: it is set at `capture-operation.mjs` line 54 and read at `capture.mjs` lines 43 and 63 (the code snippet; the fourth experiment, P20). This plan calls the first "the opt-in path" and the second "the legacy path". The opt-in path takes an exclusive `writer.lock` directory (lines 131 to 134) and writes a receipt at `.capture-operations/<key>.json`. Its output object carries `created` and `skipped` rows, each with an `index` and an `id`, and a `recoveryStateCreated` field (line 108).

**What the Workflow tool accepts.** By its documentation a script must begin with a literal `export const meta`, `agent` takes a prompt string, and a script has "No filesystem or Node.js API access"; `Math.random()`, `Date.now()` and `new Date()` with no argument throw (the Workflow snippet).

**The checks on a commit.** `AGENTS.md` lists five: `npm test`, `npm run lint:self`, the AGENTS.md drift script, the encoding script and `gate staged --check`. It asks for a `CHANGELOG.md` line per change and a `COUPLINGS` row for a non-path dependency (the skill snippet).

## Findings

**F1. The reference script is not a Workflow script.** It lacks the `meta` literal the tool's documentation requires, passes objects where `agent` takes a string, and calls functions of a module that imports `node:fs`, where the documentation says a script has "No filesystem or Node.js API access" (the skill snippet, the code snippet, the Workflow snippet; the counts are in the experiment, P5). The documentation quoted does not say whether a script may hold an `import` statement. Before the pull request the skill held `export const meta` once; after it, not at all (P5). Judgment: the script cannot run as written. This rests on the documentation, not on a run.

**F2. The script's adapters are not in the repo.** `fetchProposal`, `evaluateClaim`, `executeJson`, `workflowAvailable` and `questionsActuallyResolved` each occur in one tracked file, the skill itself (the experiment, P5). The controller has no CLI surface (the code snippet, line 2; `docs/RELIABILITY.md` line 32 in the skill snippet). Judgment: a session can reach the controller only by writing its own Node scripts that import the module, in Workflow mode and in sequential mode alike.

**F3. `closeOut` does not fit a session either.** It calls `host.lint` and continues only when the result has no `errors` and a truthy `disposed` (the code snippet, line 256). `lint --json` prints an object whose only top-level keys are `violations` and `warnings`; when `host.lint` returns that object `closeOut` never calls the gate (the experiment, P3). It calls `host.gate()` with no argument (line 257; P3). The tests give it `{ errors: 0, disposed: true }` (`test/research-controller.test.mjs` line 92, in the code snippet). The skill defines `gate` as running the claims-gate skill (line 33). Judgment: that is a step the session takes, not a function a Node process can call.

**F4. On the opt-in path a plan with invalid entries reports one of them.** A three-entry plan with two invalid entries exits 1 and reports one error, for the first invalid entry; nothing is created and no receipt is written. On the legacy path the same plan reports both (the experiment, P1). `prepare` throws at the first failing entry (`capture-operation.mjs` lines 81 to 85, in the code snippet). A reference to an id that does not exist is reported with the code `DESTINATION_CONFLICT`, because line 151 chooses the code by matching the words "conflict", "ambiguous" or "unsuitable" in the message and the message reads "unresolved or ambiguous reference" (the code snippet; the second experiment, P11). The skill at 0238d82 has no instruction to correct a plan and try again; the skill before it had one (the skill snippet).

**F5. What a failed opt-in capture leaves decides the next step.** After a validation failure `recoveryStateCreated` is false and no receipt exists; a corrected plan is then accepted under the same key (the experiment, P1; the second experiment, P11). In the one publication failure probed, an `ARTIFACT_IO` error with `questions/` read-only, `recoveryStateCreated` is true and the phase is `needs-repair`; once the directory is writable the same command run again completes the operation (the third experiment, P17). Other failures during publication were not probed. Once a key has a receipt, a changed plan under it is refused with `INPUT_CHANGED` (P11).

**F6. One batch is the wrong unit for sources.** Three source specs, two with the same title and different URLs: the opt-in path fails the whole batch and creates nothing. The legacy batch exits 0, creates two, and lists the second spec as skipped with the first source's id, so its URL is in no entry (the third experiment, P14). One `capture --type source` call per source, run one after another, keeps each failure to its own source: a repeated URL exits 1 naming the existing id and "same url", and a different URL whose title gives a taken id exits 1 with a message that also begins "duplicate of" but says "entry id ... already exists" (P13). Judgment: an agent told only "if it reports a duplicate, reuse the existing id", as line 58 of the old skill said, would give the second page the first page's id. Those calls leave no `.capture-operations` directory (P13).

**F7. Two opt-in captures at the same time: one loses.** In five rounds of two simultaneous `--operation-id` captures on one vault, one exited 0 and the other exited 1 with `LOCK_BUSY`, not retryable, having created nothing (the second experiment, P12).

**F8. A lock can outlive its writer.** With a `writer.lock` directory that holds no `owner.json`, an opt-in capture exits 1 with `LOCK_BUSY` and tells the reader to inspect `owner.json`; a capture on the legacy path is not affected (the third experiment, P16). The cleanup at line 225 puts `unlinkSync(owner.json)` and `rmdirSync(lock)` in one `try`, and line 132 sets `owned` before line 133 writes `owner.json` (the code snippet). Judgment, from reading and not from a run: if that write fails, the unlink throws and the directory stays. A test named "process interruption after publication retains lock" kills the writer and then reads the lock's `owner.json` (`test/capture-operation.test.mjs` line 80, in the lines snippet).

**F9. Repeating a verification adds a row; repeating a question closure does not.** The same `verify --id <source> --method refetched-source --result confirmed --notes <text>` run twice leaves two rows with that text. `verify --id <question> --answered-by <synthesis>` run twice leaves the question file byte-identical after the second run (the third experiment, P15).

**F10. Sources are captured without their text unless the plan asks.** A source spec with `contentFile` and `storeBody: true` stores the text through the opt-in path when the command carries `--ack-data-egress` (the second experiment, P10). The skill before the pull request captured sources by URL with no `--store-body` (line 58), so bodiless sources are not new. What is new is the order: section 4 now closes questions "Only after persistence and the required claims gate pass" (line 109), where the old Persist agent closed them before the gate (line 74 of the old skill). By the orchestrator's own statement in finding F5 as sent to the first agent, which is this project's experience and not a probe here, a claims review that rests on sources without bodies fails most claims (the session record).

**F11. Two new directories in the vault are not ignored.** A run of the controller leaves `.capture-operations` and `.research-tasks` at the vault's top level (the experiment, P4). `vault-template/.gitignore` has three lines and names neither (the skill snippet). `walkEntries` does not read them, since it reads only the entry folders (`bin/lib/fsutil.mjs` lines 7 to 14, in the code snippet), and `search` listed only the two captured sources with plan files present under `.research-tasks` (the second experiment, P10). Lint, compile and the Obsidian export were not probed. Judgment: a vault kept in git would commit them.

**F12. The merged docs cite evidence that this machine's vault does not hold.** Every one of the 84 ids on an `evidence:` comment in `docs/*.md` and in the skill is missing from the bound vault, among them the nine dated 2026-11-13 (the experiment, P6). 52 of the 55 tracked files under `docs/` have no counting verdict in this checkout's ledger; the ledger is ignored by git and was last modified on 2026-11-03 (P7). Judgment: this is a condition of the checkout, not of the pull request, and an edit here to one of those docs needs that doc's whole evidence rebuilt before `gate staged --check` passes.

**F13. `currentPersistence` fails a batch that references an archived entry.** A note that cites a source with `status: archived` is captured as `complete` and lints with 0 violations, yet `currentPersistence` returns `persistence: false`, and `closeOut` then runs neither lint nor the gate (the experiment, P2). It resolves every entry reachable from the batch with `resolveEntry`, which requires `status: active` (the code snippet, lines 58 and 223 to 228).

**Reported by the agents and not probed here.** Both marked as inferred in their reports: on Windows the receipt would store a path with backslashes that `validReceipt` rejects, and a resumed operation re-checks the fingerprint of an entry it only reused (the session record; the review record). Windows is not in the CI matrix, at the user's request of 2026-10-27 (the session record).

## Recommendation

Each point is a judgment resting on the findings named.

1. **Section 2 of the skill goes back to a script the Workflow tool can run, made of agents that call the CLI** (F1, F2). The CLI is the one surface a Workflow agent and a plain session can both reach, and the script before the pull request was built on it.
2. **Sources are captured one call each, on the legacy path, by one agent, one after another** (F6, F7). A failure stays with its source, a repeated URL returns the existing id, and no lock is involved. The agent reuses an id only when the message says "same url"; when it says the entry id already exists, it changes the title and captures again.
3. **The authored plan is captured on the opt-in path, by one agent** (F5). That is where a receipt and a replay earn their place: one call that writes several entries. The retry rule follows `recoveryStateCreated`: false means correct the plan and run it again; true means run the same command again, unchanged, and stop with the receipt's path if that fails.
4. **Verification rows carry a marker, and a row is not written twice** (F9). The agent puts `research-run:<runKey>:claim:<n>` at the start of `--notes` and skips a claim whose marker the source file already holds.
5. **The gate and the question closures stay in the session, after the workflow, in the pull request's order** (F10). If the gate does not pass, the session shows the verdict and leaves the questions open. A closure can be repeated safely (F9).
6. **`bin/lib/research-controller.mjs` and its test are deleted** (F2, F3, F13). After point 1 nothing calls the module, and it would ship with two known defects. The review record makes the same choice. It is the user's to confirm, since the pull request added the module (the fourth experiment, P18) and the other option shown to the user, a CLI surface for it, is not built (the session record).

What this gives up: the controller's saved intent before each change, and its check of a returned source id against the URL it was fetched from. Point 2 and point 4 cover the cases the probes showed. An id in the plan that does not exist in the vault is refused before anything is written (the second experiment, P11). An id that exists but belongs to another page is accepted, because line 78 of `capture-operation.mjs` tests only that the id resolves to one entry (the code snippet); that is the check given up, and the Seed agent taking each id from the capture output is what stands in for it.

## What gets built

Each commit passes the five checks and carries a `CHANGELOG.md` line. Nothing is pushed before the user has reviewed it (the session record).

**Commit 1. `bin/lib/capture-operation.mjs`.**

- `prepare` collects one error per failing entry instead of throwing at the first (F4). Nothing is written when any entry fails, as now. Errors raised while the plan file is read, before `prepare` runs, stay as they are.
- A reference to an id that does not exist gets the code `INPUT_INVALID`, by testing for it apart from the "ambiguous" case (F4).
- The cleanup removes `owner.json` and the lock directory in separate `try` blocks (F8).
- Tests in `test/capture-operation.test.mjs`: the P1 plan yields two errors, for index 1 and index 2, and nothing on disk; a reference to an id that does not exist yields `INPUT_INVALID`.

**Commit 2. The skill, the controller and the docs that describe them.** One commit, so no doc describes a flow the skill no longer has.

The script in section 2 begins with `export const meta`, passes strings to `agent`, and calls nothing it does not define. Its `args` are `question`, `cli`, `vault`, `today` and `runKey`; the session makes `runKey` before the call, since a script has no randomness (the Workflow snippet). Every CLI call carries `--vault`. The phases:

- Recon and Sweep, as before the pull request, read only.
- Fetch, in parallel, with no capture: each agent returns the fields of a source and the claims it read.
- Seed, one agent, as in point 2 of the recommendation. It returns the id for each URL.
- Verify, in parallel, with no write: each agent returns a verdict and what it observed.
- Plan, as before the pull request.
- Persist, one agent: it records each confirmed verdict as in point 4, saves the plan as `<vault>/.research-tasks/<runKey>/plan-1.json`, captures it with `--operation-id <runKey>-plan-1` under the rule of point 3 with at most 3 corrections, then runs `lint`. It returns the ids, the lint result and the questions the synthesis answers.

Section 3 describes the same steps run inline, and recovery: the retry rule of point 3, and for `LOCK_BUSY` the steps `docs/RELIABILITY.md` already gives, read `owner.json`, confirm the process is gone, remove the lock directory (lines 22 to 25, in the skill snippet). Section 4 is point 5.

With it, in the same commit:

- `bin/lib/research-controller.mjs` and `test/research-controller.test.mjs` are deleted, and every `COUPLINGS` row that names the module is removed: the rows at lines 30, 33 and 34, and any other the build finds. A row is added for the skill's use of `--operation-id`.
- One test in `test/skills.test.mjs`: the first fenced block of section 2 begins with `export const meta`, holds no `agent({`, and every bare call in it is to `agent`, `parallel`, `pipeline`, `phase`, `log` or a name the block defines.
- `docs/RELIABILITY.md`: the section "Research task recovery" (lines 27 to 36) and the sentence on mocked controller callbacks (line 41) are rewritten to what the skill does.
- `docs/ORCHESTRATOR-INTEGRATION.md` line 118: "controller completion checks" goes, and "at fetch time" becomes "before distillation" (the lines snippet).
- `CHANGELOG.md`: the Unreleased line that lists "validated source/claim handoffs, serialized intents and reconciled lifecycle completion" (line 12, in the lines snippet) is corrected, and a line for this change is added.

Both docs are gated and neither has a counting verdict in this checkout (the fourth experiment, P21), so this commit needs their whole evidence in the vault that the build uses (F12).

**Commit 3. The template's ignore file.** Add `.capture-operations/` and `.research-tasks/` to `vault-template/.gitignore` (F11). The `CHANGELOG.md` line tells the owner of an existing vault kept in git to add the two lines by hand.

**After the commits: one live run.** A real `research-orchestrate` run in Claude Code with the Workflow tool, on a throwaway vault and a small question, recorded as an experiment. It spawns agents, so it needs the user's word first.

## Not built, and why

All judgments.

- **A CLI surface for the controller.** It needs a new command, and no run on record shows the lost acknowledgment it would guard against; the pull request's own doc says real-host acceptance is "NOT RUN" (`docs/RELIABILITY.md` line 41, in the skill snippet).
- **Storing page text.** F10 is older than the pull request. Storing needs a decision on where the bytes come from, and the review record's point 4 says a fetch agent's text is not the page's bytes; that point is inferred there and not probed here. It belongs in its own spec.
- **The Windows receipt path and the fingerprint re-check on resume.** Both are in `capture-operation.mjs`, which the skill will call. Neither is reproduced, and Windows is outside CI by the user's decision. They go on an issue.
- **The legacy batch's skipped row for a title clash** (F6). The skill will not send sources through a batch. It goes on the same issue.
- **Regating the other docs the pull request touched.** It needs the other machine's vault entries and ledger (F12).

## Done when

1. `npm test` passes with the new tests, and the other four checks pass.
2. The live run ends with a synthesis captured and linted, the gate run in the session, questions closed only after a passing gate, and every source id in the plan taken from capture output.

## Open questions for the user

1. Is the recommendation accepted, the deletion of the controller module included?
2. Which machine builds commit 2? The two docs it edits have no counting verdict here (the fourth experiment, P21), and the evidence they cite is not in this vault (F12). Judgment: build on the machine that holds them, or copy that vault and ledger here first.
3. May the live run go ahead once the commits are in?
4. Should storing page text get its own spec next?

## Limits of this plan

No Workflow run was made, so F1 rests on the tool's documentation. The Codex installer generates its skills from the same skill files; commit 2 changes what it generates, and that output was not looked at, by the user's instruction of 2026-11-14 not to test the Codex elements (the session record). Whether a Workflow agent can run the shell commands the script asks of it rests on the script before the pull request having been built that way; it is not shown by a run here.
