# Plan: a faster claims gate (2026-11-12)

This plan's aim is to fix what made the claims gate slow during the work on issues 58 to 67. This is the plan as revised after an adversarial review. Each finding F1 to F12 that takes a claim of the review was checked by a read or a run. The cost link (the judgment on F2), the drift cases under item 2's Rejected and the stale-evidence point in the section on the diff-scoped review, which is not built, are the review's reasoning, not runs. Which plugin root a session loads was not probed (Setup step 3). The plan rests on eight vault entries:
- The snippet 2026-11-12-lines-behind-claims-gate-scope-plan ("the snippet") quotes the repo lines the first draft relied on, read at commit 1fcde5c, plus two files git ignores, read from disk.
- The experiment 2026-11-12-claims-gate-scope-plan-probes ("the experiment") holds the first draft's runs, with their scripts and logs. It also holds the session record of eight claims rounds, marked there as the orchestrator's report and not a run.
- The experiment 2026-11-12-claims-gate-scope-plan-round-two ("the second experiment") holds the probes made after the first claims round on this plan.
- The snippet 2026-11-12-lines-behind-claims-gate-plan-revision ("the revision snippet") quotes the lines the revision relies on, at 1fcde5c or from disk.
- The experiment 2026-11-12-claims-gate-plan-revision-probes ("the revision experiment") holds the revision's runs.
- The experiment 2026-11-12-claims-gate-plan-final-round-probes ("the final experiment") holds two runs on F12's split copy, made for the final claims round.
- The snippet 2026-11-12-claims-gate-plan-decisions-user-confirmed ("the decisions snippet") holds the user's answers of 2026-11-12 to the plan's open questions, as the orchestrator recorded the dialog.
- The snippet 2026-11-12-claims-gate-plan-build-decisions-user ("the build decisions snippet") holds two more answers from the same dialog: build the plan now, and continue in the current session. No open question remains.

A sentence about today's code cites a snippet. A measured number cites an experiment. A sentence marked "Judgment" is this plan's choice, not a fact.

## Setup, before the first commit

1. Start the session that builds this plan with `claude --plugin-dir /Users/andrewbrooks/research-vault`. The hooks are registered under `${CLAUDE_PLUGIN_ROOT}/hooks/` (hooks.json lines 11, 25, 40 and 54). The skill runs its CLI as `node "${CLAUDE_PLUGIN_ROOT}/bin/research-vault.mjs"` (SKILL.md line 12). The reviewer hash is read from `agents/claims-reviewer.md` under the plugin's root (all three in the revision snippet; gate.mjs lines 22 and 27 in the snippet). The installed plugin is 0.11.0 at `~/.claude/plugins/cache/research-vault/research-vault/0.11.0`, from commit 1fcde5c (the revision snippet). At 1fcde5c the repo's `bin/` and reviewer file equal that copy's (the revision experiment, part 4). After commit 2 changes `bin/`, the repo's `bin/` differs from the cached copy, and without this step the hooks may be the cached ones. No commit in this plan changes the reviewer file.
2. The earlier plan for issues 58 to 67 gave the same step and a check (the revision snippet). Its Setup step 2 starts the session with `--plugin-dir`. Its step 5 dispatches an agent whose repo copy differs from the installed one and asks it to quote a line that differs. Judgment: the same check here. After commit 2 changes the claims-gate skill's step 1, load the skill in the session and confirm it shows the new step 1. If it does not, restart with `--plugin-dir`.
3. The standing rule for the earlier work was to run every gate command as `node bin/research-vault.mjs` from the repo root (the revision snippet, the handover note's line 7). That command always runs the repo's code. Judgment: with `--plugin-dir` set to the repo, the skill's `${CLAUDE_PLUGIN_ROOT}` path names the same file, so the two agree. Without it, the CLI would run the repo's code while the Stop hook, the post-tool-use hook and the dispatched reviewer may come from the cache. Which root a `--plugin-dir` session uses was not probed for this plan; step 2's check covers it.
4. This plan builds no change under `agents/`. If one is added later, restart the session before the next gate. The earlier plan's step 2 says so (the revision snippet).
5. For this build (the user's decision, 2026-11-12, the build decisions snippet): the build continues in the current session without `--plugin-dir`. Every gate command is run as `node bin/research-vault.mjs` from the repo root, which runs the repo's code (step 3). The hooks and the dispatched reviewer may come from the installed 0.11.0 copy. What follows for each item:
   - No commit in this plan changes the reviewer file, so the reviewer is the same either way (step 1).
   - Item 2's filter is in the CLI (`gate evidence`), which the repo's code runs.
   - Item 4's exclusion is in `gatedFiles`, which the Stop hook and the post-tool-use hook call. The installed hooks may not honour it until the plugin is updated, so the Stop hook may still name a fixture file.

## What exists

**The ledger row.** `gate record` appends one JSON line to `.research-vault-ledger.jsonl` at the bound repo's root (the snippet, gate.mjs lines 24 and 203 to 215). The row holds `ts`, `event` (`claims`), `file`, `sha256` of the whole file, `verdict`, `units` (one sha256 per unit), `reviewer` when the agent file exists, and `note` when one is given. No field holds the evidence list or the file's text.

**How a unit hash is made.** A Markdown draft is cut by `mdUnits`: one unit per ATX heading section, `sec:<slug>`, and one per table data row, `sec:<slug>/<first-cell slug>` (gate.mjs 50 to 86). A section hashes without its table rows, so a row edit leaves the section's hash alone (lines 109 and 110). A code file that the binding's `code.globs` name is keyed by linked symbol (lines 3, 4 and 99 to 102). A page with data-block elements is cut by its blocks. Anything else is one unit, `all` (lines 104 to 111).

**When a row counts.** A row counts for a file when its event is `claims`, its verdict is `PASS` or `MERIT`, and its `reviewer` is absent or equal to the installed reviewer's hash (gate.mjs line 35). That hash is the sha256 of `agents/claims-reviewer.md` under the plugin's own root (lines 22, 27 and 31). `changedUnits` lists the units of the current content whose hash no counting row holds (lines 189 to 201). `gateStatus` sets `reviewerChanged` when no counting row covers the current content and the file has a passing row from another reviewer hash (lines 225 to 229). The CLI then prints `none (reviewer changed)` (commands/gate.mjs lines 13 and 14).

**The evidence list.** `evidenceFor` takes the draft's citations from `extractCitations(text)` over the whole file and adds the `extra` ids (the revision snippet, gate.mjs lines 260 to 262). It checks them against the vault and returns one entry per resolved id. For a Markdown draft with headings it also returns each section with its line range (lines 287 to 290). With `--changed`, the CLI adds `changedUnits` after `evidenceFor` returns. It prints a `changed units:` line and one `unit <name> <file>:<start>-<end> <status>` line per changed unit (commands/gate.mjs lines 46 to 55). The list of entries does not depend on which units changed. The skill's step 1 passes the draft's snippet and experiment ids with `--extra`, and step 2 sends the reviewer that output verbatim (the snippet, SKILL.md lines 21 to 33).

**Citations.** `extractCitations` finds URLs and `<date>-<slug>` ids in prose. It treats fenced blocks, inline code spans and HTML `pre` and `code` elements as code, and nothing else (the revision snippet, citations.mjs lines 11 to 80). An HTML comment is therefore prose.

**The reviewer.** When the prompt carries a `changed units:` line, the reviewer enumerates claims only inside those units and reads the whole draft for context (the snippet, claims-reviewer.md line 24). Its procedure starts "Enumerate every factual claim in the draft" (line 32).

**What is gated.** `gatedFiles` returns the lessons, reference pages and README of every directory holding `MISSION.md` found under the repo, plus the binding's `gates.globs` files, plus linked code files (the snippet, gate.mjs 306 to 354). Three callers start from it (the revision experiment, part 4):
- `stagedGates` (gate.mjs line 337), which the `staged` branch of `gate` calls (the second experiment);
- the Stop hook (stop-gate.mjs line 36);
- the post-tool-use hook's `citationWarnings`, which reports uncovered or stale citations only for files on its watched list, `gatedFiles` among them (post-tool-use.mjs lines 32 and 33, in the revision snippet).

This repo's binding gates `docs/**/*.md`, `skills/**/*.md`, `agents/*.md`, `commands/*.md`, `README.md` and `AGENTS.md`, and git ignores the binding (the snippet). `test/projectconfig.test.mjs` already checks that `gates.globs` is kept and that a non-array is refused (lines 140 to 143, in the revision snippet).

**Couplings.** A `COUPLINGS` row in `scripts/deps.mjs` says the command table restates the commands map, with no literal (the snippet, line 30). Five rows name "the teach row" in their reason text (lines 128, 132, 184, 191 and 207). A test fails when a row's literal leaves either file (deps.test.mjs 15 to 23).

**The commit rule.** Every change gets a line under `## [Unreleased]` in `CHANGELOG.md`, and each commit passes the checks on AGENTS.md lines 7 to 11, the last being `gate staged --check` (the snippet and the second experiment).

## Findings (measured)

**F1. The teach row.** It is line 193 of `docs/REFERENCE.md`: 16,375 bytes and 2,540 words, 31.8% of the file's 51,472 bytes (the experiment, part 3). The file has 51 units. The next longest command row, `capture`, is 1,623 bytes. The row holds the 14 forms of the `teach` usage line (part 3; the snippet, commands/teach.mjs line 21). The four longest shares are `teach export` (4,731 characters), `teach serve` (3,613), `teach lint` (2,262) and `teach attempt import` (2,060).

**F2. What the row's rounds cost.** By the session record, eight rounds on the row across four commits took 1,851,519 tokens, 413 tool uses and 2,146 seconds (the experiment, part 8). Per round, in tokens, tool uses and seconds:

| Commit | Round 1 | Round 2 |
|---|---|---|
| 5b86a36 | 96,163; 8; 129 (two evidence ids) | 266,200; 66; 310 |
| fdb151a | 156,346; 23; 178 | 325,774; 65; 298 (PASS) |
| 07f3974 | 342,527; 72; 340 | 169,417; 51; 230 (PASS) |
| 9ec4986 | 258,668; 75; 379 (four findings in older text) | 236,424; 53; 282 (PASS) |

The evidence list grew from 2 ids to 92, passed by hand with `--extra` each time. The same row was in all eight rounds, and its own changes were a few clauses per commit.

**F3. What an edit to the reviewer file does.** One sentence appended to a copy of `agents/claims-reviewer.md` moved its hash from `e635db06851b…` to `deebbf5eb705…` (the experiment, part 2). From that copy, `gate status` read `none (reviewer changed)` for `docs/REFERENCE.md` with all 51 units listed. Across the 85 gated files, files with a verdict went from 13 to 0.

**F4. The blob mechanism.** In a scratch repo (the experiment, part 1):
- `git ls-files -s` and `git hash-object` gave the same blob id for a staged file.
- After a commit and an edit, `git diff <blob> -- <file>` diffed the old text against the working file. `--word-diff=plain` marked only the changed words inside a one-line row.
- A blob staged and then unstaged was unreachable. It survived a plain `git gc` and was gone after `git gc --prune=now`. A committed blob survived `--prune=now`. Outside a repo, `git hash-object -w` exited 128.
- git's own documentation gives a grace period of two weeks for loose objects (part 7).

**F5. Fixture workspaces.** Seven of the 85 gated files are under `test/fixtures/` (the experiment, part 4). `check --check` exits 1 on three of them, each with citations the bound vault does not cover (part 5).

**F6. The ENOEXEC sentence.** CI run 43244117090, on commit cb6c895, failed (the experiment, part 6). In its job `test (ubuntu-latest, 22)`, test 598 expected `lab: could not start: ENOEXEC` and got `no interpreter line` followed by `lab: exit 0`. The script was `echo no interpreter line` with no `#!` line (the snippet, commit a057768's test diff).

**F7. COUPLINGS literals in the reference.** Twenty-five `COUPLINGS` rows with a literal have `docs/REFERENCE.md` at one end. Nine of those literals sit on line 193, the teach row, and on no other line (the revision experiment, part 3). Besides that test, a grep for `REFERENCE` under `test/` finds two other tests that read it: one checks the Lua row and one checks a list of key names (the experiment, part 9). Older specs 17 and 19 also say "the teach row" (the revision experiment, part 4).

**F8. Ids in HTML comments.** In a scratch repo bound to a scratch vault (the revision experiment, part 1):
- `extractCitations` returned the ids in two HTML comments. It skipped the id in a comment inside a fenced block as code.
- `check --check` rated the comment ids `ok`, `STALE` and `UNCOVERED` as for any citation, and the post-tool-use hook's `citationWarnings` reported the stale and the uncovered one.
- After a `PASS` and an edit to one row and one section, `gate evidence --changed` still listed every citation of the file.

**F9. How `-U0` hunks fall on units.** In a scratch repo (the revision experiment, part 2):
- A deleted line apart from any other change gave a hunk with a new count of 0, `@@ -6 +5,0 @@`.
- A deleted line next to a changed line merged into one hunk with new lines.
- A section's range holds its table rows, so a row's hunk fell inside both ranges.
- One hunk, `@@ -12,2 +12,2 @@`, covered the end of one section and the heading of the next.

**F10. The ledger's verdicts.** This repo's ledger has 79 rows: 66 `MERIT` and 13 `PASS` (the revision experiment, part 3). Fourteen files have a last row that counts under the installed reviewer; for 11 of them that row is a `MERIT`.

**F11. The older-text findings were real.** Round 1 of commit 9ec4986 raised four findings, all in older text that had passed earlier that day. The orchestrator's log says "Fix on the evidence side: four probes sent to the implementer for one new experiment. Then r2." The next line says round 2 passed (the revision snippet, progress.md lines 363 and 364). The commit message says "two rounds each, with six probes added between the rounds: PASS for docs/REFERENCE.md" (the revision snippet).

**F12. A split layout.** A scratch copy of `docs/REFERENCE.md` was made with the row's text moved under one `###` heading per usage form, in a new `## teach` section, and a one-line row left in the table. The gate's `mdUnits` cut it into 66 units, with no name repeated: `sec:commands/teach`, `sec:teach` and 14 `sec:teach-*` units (the revision experiment, part 3). The largest of the 16 teach units was `sec:teach-export`, 4,747 bytes. All 25 literals were still in the copy.

**Judgment on F2, F8 and F11: the cost driver.** The row measured 16 KB at 1fcde5c, after the last of the four commits, and changed by a few clauses per commit. Round 1 of 5b86a36, with two evidence ids, cost 96,163 tokens and 8 tool uses. The other seven rounds, with the list growing towards 92 ids, cost 156,346 to 342,527 tokens and 23 to 75 tool uses. This plan infers that the size of the evidence list tracks the cost more than the size of the row does. It is an inference from eight rounds: the record gives the list's size only at the start and the end, and a reviewer may also read entries its own search finds.

## Item 1: split the teach row

### 1. Decision

Judgment: move the row's text into a new `## teach` section after `## Commands`. It has one short paragraph and then 14 `###` headings, one per form of the usage line. The text moves word for word. Only punctuation may change where a heading's text is broken into a list: a clause separator becomes a list break, and a trailing comma goes. The command table keeps a one-line `teach` row that points to the section, because the `COUPLINGS` row on line 30 says the table restates the commands map. The five `COUPLINGS` rows that say "the teach row" get "the teach section" in their reason text. The nine literals that sit only on line 193 move with the text, so the literal test still passes (F7, F12). Specs 17 and 19 say "the teach row"; they are history and stay as they are.

Each new section gets an evidence comment under its heading, in item 2's form. Judgment: the builder assigns the ids by reading each entry's subject. The builder starts from the list the last `PASS` on the row used (92 ids by F2), and an entry may sit under more than one heading. These comments keep later rounds small once item 2 lands. Until then they are ordinary citations, and `check --check` reads them (F8). A stale id among them stops the gate at step 0 until it is verified.

### 1. Rejected

- Fourteen table rows in place of headings. A row is one line, so `teach export` would stay one row unit holding its 4,731 characters of text, and a comment on its own line, item 2's form, cannot sit inside a row, since a row is one line.
- Leaving the row and relying on a diff-scoped review. That design is not built (below).

### 1. Files

`docs/REFERENCE.md`, `scripts/deps.mjs` (reason text of five rows), `CHANGELOG.md`.

### 1. Tests

None new. The deps literal test still passes because the nine literals move with the text, as the copy in F12 shows. A grep for `REFERENCE` under `test/` finds two other tests that read it; they check the Lua `comment:` and `decl:` rows and the names of a key list (F7). A script that applies those two tests' checks, with its own copies of their lists, found both Lua rows and no missing key on the split copy (the final experiment). The lists were copied by hand and are not quoted from the test files, so the builder runs `npm test` on the real split before the gate.

### 1. Gated documents reopened

`docs/REFERENCE.md`: the shortened `sec:commands/teach` row and the 15 new units of F12. On F12's split copy, the gate's unit hashes changed for `sec:commands/teach` only, 15 units were added, none was removed, and the other 50 kept their hashes (the final experiment). The copy carries no evidence comments; the comments go only into the 15 new units. Judgment: the first review of the moved text will likely take two rounds and new probes, as round 1 of 9ec4986 did (F11). The moved text is 16 KB, and the comments add up to 92 ids.

## Item 2: per-unit evidence by citation

### 2. Decision

- **The form.** A section of a gated Markdown document names its evidence in an HTML comment on its own line under its heading, written `<!-- evidence: <id> <id> -->`. Any citation inside the section's line range counts, the comment's or the prose's, because `extractCitations` reads a comment as prose (F8). A comment inside a fenced block does not count.
- **The filter.** With `--changed` on a Markdown draft that has headings, `evidenceFor` takes its citations from the changed units' line ranges, not from the whole file, plus `--extra` as today. The change sits at the one line that builds `cites` (gate.mjs line 262). The CLI passes it the changed unit names, which it computes today only after `evidenceFor` returns (commands/gate.mjs lines 47 and 48). Without `--changed`, and for code and lesson drafts, the list is as today.
- **A table row.** A comment on its own line, item 2's form, cannot sit inside a row, since a row is one line. A changed row with no citation in its own line takes its section's citations from the lines outside rows, which hold the section's comment. Judgment.
- **No citation in range.** A changed unit with no citation in its range, after the row rule, falls back to the whole file's citations, today's list. Judgment: a smaller list must never be an empty one.
- **No ledger change.** `gate evidence` writes no ledger row.

The revision experiment, part 1, ran a prototype of these rules (filter.mjs, not repo code). For a changed row with no id, it listed its section's comment ids. For a changed section with none, it listed the whole file's.

### 2. Rejected

- **A remembered list in the ledger** (the first draft's item 2). It only grows. It is kept per file, so one unit's ids leak into every other unit's rounds. It makes `gate evidence` write. It drifts when evidence is re-run or the draft is edited before `gate record`. It would also break the test at `test/gate.test.mjs` line 487, which parses the whole ledger as one JSON value after `gate evidence --changed` at line 475 has run (the revision snippet; the revision experiment, part 4).
- **Ids attributed to units from the reviewer's claim table.** The table is free text.

### 2. Files

`bin/lib/gate.mjs` (`evidenceFor`), `bin/commands/gate.mjs`, `skills/research-claims-gate/SKILL.md` (step 1: name a section's evidence in a comment under its heading, and pass with `--extra` only ids no citation in the changed units carries), `docs/REFERENCE.md` (the Gate bullet and the `gate` row), `CHANGELOG.md`.

### 2. Tests

In `test/gate.test.mjs`:
1. After an edit to one section, `gate evidence --changed` lists that section's comment ids and the `--extra` ids, and no other section's ids.
2. A changed row with no id lists its section's comment ids.
3. A changed section with no id in range lists the whole file's citations.
4. `gate evidence` without `--changed` lists every citation, as today.
5. An id in a comment inside a fenced block is not listed.

The code-draft test at lines 468 to 490 stays as it is.

### 2. Gated documents reopened

`skills/research-claims-gate/SKILL.md` `sec:steps`; `docs/REFERENCE.md` `sec:binding-a-repo-to-a-vault` and `sec:commands/gate`. Judgment: adding a comment to an existing section changes that section's hash and reopens it, so other documents get comments only when a section is edited for another reason.

## Item 5: refuse a script with no `#!` line before it starts

### 5. Decision

`launch()` in `bin/lib/labs.mjs` already reads the script's bytes to check the pin, before `spawn` (the revision snippet, labs.mjs lines 252 to 261). Judgment: after the pin check, return `{ error: "could not start: ENOEXEC" }` when the first two bytes are not `#!`. That is the same test lint's `LAB_SCRIPT_NOT_RUNNABLE` makes (lesson.mjs line 501). The final line keeps the existing `lab: could not start: <code>` form, which spec 49 lines 141 and 182 and `SECURITY.md` line 61 name. Using `ENOEXEC` as the reason keeps the code spec 49's F6 reports (line 21), which SECURITY.md line 58 places on macOS 27.0.1. Judgment: the refusal runs before `spawn`, so it does not depend on the platform, and the server then agrees with lint. No Linux run after the change was made for this plan.

What the spec says about platforms (the revision snippet): F6 on line 21 names no platform. F5 on line 19 names macOS 27.0.1 for its process-group runs. Line 253, under "Not established", lists "Platforms other than macOS 27.0.1 with node v22.23.4".

### 5. Rejected

- **Correcting the spec's sentence only** (the first draft's item 5). The server would still run such a script on ubuntu (F6) and refuse it on macOS, as spec 49 and SECURITY.md line 58 report (the revision snippet). Lint and the server would still disagree.

### 5. Files

`bin/lib/labs.mjs`; `test/teach-labs.test.mjs` (one case: a script with no `#!` line ends with `lab: could not start: ENOEXEC`; the missing-interpreter case from a057768 stays); `docs/specs/49-teach-labs.md` line 148; `SECURITY.md` line 58; `CHANGELOG.md`. Line 148 becomes: the server refuses a script whose first two bytes are not `#!` before `spawn`, with `could not start: ENOEXEC`, and `EACCES` arrives as an event (F6). Line 58 says `ENOEXEC` comes "for a file with no `#!` line ... on macOS 27.0.1 with node v22.23.4" (the revision snippet). It becomes: `ENOEXEC` is the server's own refusal of a file with no `#!` line, and `EACCES` the kernel's for a file without the executable bit, on macOS 27.0.1. `docs/REFERENCE.md` does not contain "could not start" (the revision experiment, part 4), so it does not change.

### 5. Tests

The one new case above. It runs on every platform the CI uses.

### 5. Gated documents reopened

`docs/specs/49-teach-labs.md` `sec:d5-starting-stopping-and-resetting-judgm` (lines 146 to 161; the experiment, part 4). `SECURITY.md` is not in this repo's gates.

## Item 4: fixture workspaces are not gated

### 4. Decision

Judgment: a `gates.exclude` array of globs in the binding. `gatedFiles` drops every file that `expandFiles(exclude, repoRoot)` returns, so all three callers obey it: `stagedGates`, the Stop hook and the post-tool-use hook. An excluded file then also gets no citation warnings after an edit, unless `references.globs`, a linked code file or a `code.versions` file also names it (post-tool-use.mjs lines 30 to 32, in the revision snippet). A typo or a broad glob would drop files without notice, so `gate staged` prints `excluded: <file>` for each staged file the exclusion drops. The binding loader refuses an `exclude` that is not an array, as it does for `globs`. This repo's binding gets `"exclude": ["test/fixtures/**"]` by hand. git ignores the binding, so no commit carries that line.

### 4. Rejected

- Hard-coding `test/` in `gatedFiles`, or adding a name to `SKIP_DIRS`. The plugin would carry one repo's layout, and `SKIP_DIRS` feeds `expandFiles` for every glob (the snippet, files.mjs lines 5 to 14).

### 4. Files

`bin/lib/gate.mjs`, `bin/commands/gate.mjs`, `bin/lib/projectconfig.mjs`, `docs/REFERENCE.md` (the Gate bullet), `CHANGELOG.md`.

### 4. Tests

1. `gatedFiles` with `gates.exclude` drops a workspace lesson and a glob match.
2. `gate staged` with an excluded file staged prints `excluded: <file>` and lists the file under no verdict.
3. In `test/projectconfig.test.mjs`, beside the `gates.globs` test at lines 140 to 143, an `exclude` that is not an array is refused.

### 4. Gated documents reopened

`docs/REFERENCE.md` `sec:binding-a-repo-to-a-vault`.

## Not built: a diff-scoped review

### D. The design

`gate record` would store the draft's blob id (`git hash-object -w`). `gate evidence --changed` would print the word diff of each changed unit against that blob. The reviewer would row only the changed words and any claim whose meaning they change. If the blob was gone it would fall back to the whole unit. F4 still holds and supports this design.

### D. Why it is not built

1. **The older-text findings were not waste.** The four findings of round 1 of 9ec4986 were in text that had passed earlier, and they were closed by new probes before round 2 passed (F11). A diff-scoped review would not have rowed those sentences.
2. **Most baselines are `MERIT`.** 66 of 79 rows are `MERIT` (F10). The skill records a `MERIT` after the merit decision on the bytes as they then stand, and no step sends the text edited after round two to a reviewer (the revision snippet, SKILL.md lines 34 and 35). A diff against such a row would never show that text.
3. **Evidence moves.** An entry superseded or changed since the baseline would not be re-read for a sentence that did not change.
4. **The mapping drops cases.** A deletion apart from other changes is a hunk with no new line, so a rule that places a hunk by its new lines drops it (F9). A row's hunk falls in both the row's and its section's range, and one hunk can cover two units (F9).
5. **The reviewer hash.** The reviewer edit the design needs drops every verdict in this repo's ledger (F3); a row with no reviewer field still passes the `counts` check (gate.mjs line 35, the snippet). Spec 18's D3 says of the agent file: "an edit to any of them is a different reviewer, and the hash covers the whole file" (the revision snippet). A constant that keeps one earlier hash counting would contradict that, and it would not carry to the next reviewer edit.

### D. The decision

The user decided on 2026-11-12 not to build it (the decisions snippet). The gate always reviews the whole changed unit. A later proposal would need at least these guards: a diff only against a `PASS` baseline, a whole-unit fallback when a listed entry changed status, zero-count hunks attached at the deletion point, row lines left out of their section's mapping, the blob written only when the git top level contains the ledger root, and an `EARLIER_REVIEWERS` list with an amendment to spec 18's D3.

## Order of commits

Each commit adds a line under `## [Unreleased]` in `CHANGELOG.md`, passes the checks on AGENTS.md lines 7 to 11, and stages each gated file with a `PASS` or `MERIT` for its current content.

0. Setup, as above.
1. Item 1. Reopens `docs/REFERENCE.md` `sec:commands/teach` and the 15 new units.
2. Item 2. Reopens `skills/research-claims-gate/SKILL.md` `sec:steps`, and `docs/REFERENCE.md` `sec:binding-a-repo-to-a-vault` and `sec:commands/gate`. From this commit on, the skill is used with `--extra` only for ids that no citation in the changed units carries.
3. Item 5. Reopens `docs/specs/49-teach-labs.md` `sec:d5-starting-stopping-and-resetting-judgm`.
4. Item 4. Reopens `docs/REFERENCE.md` `sec:binding-a-repo-to-a-vault`.
5. Measure one round on a `teach` section and record it, to test the cost inference (F2).

## Risks

- **A comment can miss an id.** A section's comment is kept by hand. If it misses an id a claim needs, the reviewer fails the claim; the caller then adds the id to the comment or passes it with `--extra`.
- **Comments reopen sections.** Adding a comment to an existing section reopens it.
- **Stale ids anywhere stop the gate.** `check --check` reads an id in an HTML comment outside a fenced block as a citation (F8), so a stale id in an unchanged section still stops step 0. That is today's behaviour for any citation.
- **Setup skipped.** Without `--plugin-dir`, the hooks and the reviewer may be the cached 0.11.0 ones while the CLI, run as `node bin/research-vault.mjs` from the repo root, runs the repo's code.
- **The installed hooks lag item 4.** In this build (Setup step 5), the Stop hook may still name a fixture file after the exclusion lands, until the plugin is updated.
- **Item 5 changes what the server does with such a script on the ubuntu CI runner.** A script with no `#!` line ran there (F6) and would be refused. Linux in general was not probed.
- **The cost inference is not a measurement** (F2). The measurement in step 5 of the order of commits tests it.

## Not in this plan

- The diff-scoped review, by the user's decision (the decisions snippet).
- Per-unit evidence for lesson pages and code files.
- Any change to the ledger.
- Round caps, and more than one reviewer per round.

## Decisions of the user (2026-11-12)

1. The diff-scoped review: do not build it (the decisions snippet).
2. Item 4: add the exclude list for the fixture lessons (the decisions snippet).
3. Item 5: the server refuses a script with no `#!` first line on all systems (the decisions snippet).
4. Build the plan after its commit (the build decisions snippet).
5. Continue the build in the current session, without a restart with `--plugin-dir`; see Setup step 5 (the build decisions snippet).
