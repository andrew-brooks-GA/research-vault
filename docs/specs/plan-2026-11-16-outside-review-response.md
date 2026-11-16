# Plan: what to do about the outside review of research-vault (2026-11-16)

This plan lists the work chosen in answer to an outside review of this repository, and the order of that work.

The plan rests on two vault entries:

- The snippet 2026-11-16-lines-behind-plan-that-answers-outside ("the lines snippet") quotes the repository lines this plan relies on, read at commit c205b7b.
- The experiment 2026-11-16-search-no-match-counts-transcript-query ("the probes") holds the counts and the probe outputs.

A sentence about the code or the files cites the lines snippet. A measured number cites the probes. A sentence marked "Judgment" is this plan's choice, not a fact.

## Findings

<!-- evidence: 2026-11-16-lines-behind-plan-that-answers-outside 2026-11-16-search-no-match-counts-transcript-query -->

**F1. `search --text` tests one substring.** The filter lower-cases the `--text` value and keeps a row when the title, the joined topics or the summary includes that value (the lines snippet, search.mjs lines 15 to 25). The usage skill states this as the contract: `--text` is "a case-insensitive substring of title, topics and summary", and the skill tells the agent to "take terms from the vault's own vocabulary" (the lines snippet, SKILL.md line 10).

**F2. The usage log shows many searches with no result, and does not show why.** In the log, 51 of 113 `search` events had the outcome `no-match`. Of the 86 events that hold neither a `type` nor a `topic` key, 41 had that outcome. No event holds the query text (the probes, runs 1 and 2). `search` passes `process.cwd()` to `loadProjectConfig` and writes the text only when that config's `usage.text` is `true` (the lines snippet, search.mjs lines 87 to 94).

**F3. A replay of recovered queries shows a small gain from per-term matching.** The session recovered 134 distinct `--text` values from session transcripts and tested them against the vault as it is today. As a substring, 114 hit and 20 missed. Of the 20 misses, 15 were one word and 5 were more than one word. For 4 of the 5, at least one row holds every term of the value (the probes, runs 3 and 4). A match on any one term returned between 21 and 829 rows for those five values (the probes, run 5).

**F4. The log and the replay are different populations.** The probes entry says that the two miss counts "are therefore not two measures of one rate, and nothing here explains the difference", and that a search with no row can be a duplicate check that is meant to find nothing (the probes, Limits).

**F5. A change to the `--text` test reaches more than `search`.** `matchRows` with a `text` key is also called from `bin/lib/lesson.mjs` (the lines snippet, lesson.mjs lines 840 to 845; the probes, run 7). The contract is written in SKILL.md line 10 and in `docs/REFERENCE.md` line 187, and `schema/AGENTS.golden.md` line 86 names the fields that `--text` reads (the lines snippet). This repository's binding gates `docs/**/*.md`, `skills/**/*.md` and `README.md` (the lines snippet, .research-vault.json).

**F6. `RESEARCH_VAULT_PATH` is one of several ways to find the vault.** `resolveVault` returns the flag, then the project binding's vault, then the variable, then the config pointer, then the default path (the lines snippet, resolve.mjs lines 32 to 58). `init` writes the config pointer when none exists or when `--set-default` is given, and then prints the profile hint (the lines snippet, init.mjs lines 96 to 108). README line 100 says that the last install line "prints a `RESEARCH_VAULT_PATH` line to add to your shell profile so later sessions find your vault" (the lines snippet). Judgment: a reader can take that sentence to mean that the variable is required.

**F7. The Stop hook and the pre-commit hook enforce the gate.** The Stop hook's header says that it blocks the end of a turn while a changed gated draft has no `PASS` or `MERIT`, and that it "always exits 0, and says so in a systemMessage when it fails open" (the lines snippet, stop-gate.mjs lines 2 to 5). `.githooks/pre-commit` runs `gate staged --check`, and its comment says to enable it once per clone (the lines snippet).

**F8. The README states two gaps.** Line 28 says that the dialogue and transcript "are illustrative, not captured acceptance runs". Line 57 says that "authenticated Claude acceptance has not been run for this update" (the lines snippet).

**F9. `node:sqlite` loads with a warning on this machine.** On Node v22.23.5, `require('node:sqlite')` printed `ExperimentalWarning: SQLite is an experimental feature and might change at any time` (the probes, run 6).

## Steps

<!-- evidence: 2026-11-16-lines-behind-plan-that-answers-outside 2026-11-16-search-no-match-counts-transcript-query -->

**Step 1. Correct README line 100.** Change the sentence so that the variable reads as one optional way to find the vault (F6). Add a line under `## [Unreleased]` in `CHANGELOG.md`, as `AGENTS.md` requires (the lines snippet, AGENTS.md lines 7 to 18). `README.md` is a gated file (F5), so the edit needs a claims verdict.

**Step 2. Record the query text.** First check that the vault's `.gitignore` holds the `_index/` line. Then set `"usage": { "text": true }` in the binding. `search` reads the setting from the config that it loads for its working directory (F2). Judgment: set it in the binding of each repository where searches run, and confirm with one search from each that the log line holds the text. `docs/REFERENCE.md` line 49 says that the same setting also writes the pre-web hook's terms to the log (the lines snippet). This repository's binding is ignored by git (the lines snippet, .gitignore). No code changes.

**Step 3. Read the log after one week.** List the `search` events with the outcome `no-match` and their text. Sort them by hand into three groups: a duplicate check, a one-word miss and a multi-word miss.

**Step 4. Decide on the all-terms rule, and build it only if step 3 supports it.** The rule: a row matches when the substring test matches, or when `termsOf` gives two or more terms and the row's fields hold every one. Every row that matches today still matches, because the substring test stays. Judgment: build it only if multi-word misses that are not duplicate checks are a large share of the misses in step 3; the replay alone, at 4 of 134 values (F3), does not justify the cost in F5. If built, the work includes at least the change in `matchRows`, one test, the sentences in SKILL.md and `docs/REFERENCE.md` named in F5 and their claims verdicts, a change to `schema/` or the generator and a regenerated `schema/AGENTS.golden.md` (never edited by hand), and a `CHANGELOG.md` line (the lines snippet, AGENTS.md lines 7 to 18).

**Step 5. Optional: captured output in the README.** Replace the illustrative transcript (F8) with the real output of a captured run. Judgment: do this only if new users are a goal.

## Not planned

<!-- evidence: 2026-11-16-lines-behind-plan-that-answers-outside 2026-11-16-search-no-match-counts-transcript-query -->

Each line below is a Judgment.

- **More blocking hooks.** The two hooks in F7 already cover the end of a turn and the commit. A hook that refuses edits until `check` passes would also refuse the edit that repairs the file.
- **An acceptance run in CI, or a smoke script.** The README already states the gap (F8). The plan adds no process for it.
- **A SQLite or BM25 index, and an MCP server.** F3 does not show a need for an index, and the module printed an experimental warning on the one Node version probed (F9). When probed, among the repository's `.mjs`, `.md` and `.json` files only `docs/CODEX-PARITY.md` held `mcp` as a word, `sqlite`, `bm25` or `fts5` (the probes, run 8), so each would be new surface.
- **A split of the teaching skill, and an init wizard.** No measurement in this plan supports them.

## Risks

<!-- evidence: 2026-11-16-lines-behind-plan-that-answers-outside 2026-11-16-search-no-match-counts-transcript-query -->

- The replay in F3 used values from every project on the machine and tested them against today's vault (the probes, run 3 and Limits). It may understate or overstate the misses of real searches.
- The replay's substring test joined the three fields into one string, where `matchRows` tests each field apart (the probes, run 4). The count of 114 hits can be too high by the values that span two fields.
- Step 2 writes query text to `_index/usage.jsonl` in the vault. Judgment: that is acceptable as long as the vault's `.gitignore` ignores `_index/`, which step 2 checks first.
