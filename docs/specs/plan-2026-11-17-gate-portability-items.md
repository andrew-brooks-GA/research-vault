# Plan: the gate counts the cited ids this vault lacks, and the session start names a reviewer mismatch (issue 72, items 12 and 13) (2026-11-17)

<!-- evidence: 2026-11-17-gate-ledger-reviewer-hash-sessionstart-lines 2026-11-17-probe-issue-72-items-12-13 2026-11-17-trial-issue-72-items-12-13 2026-11-17-lines-behind-plan-issue-72-items 2026-11-17-gate-label-stop-hook-sessionstart-reviewer -->

Items 12 and 13 of issue 72 are about the process around the claims gate. Item 12: the evidence ids on the `evidence:` comments of most docs, and the ledger rows for them, exist only on the machine where they were made, so on another checkout any edit to such a doc needs the whole doc gated again against evidence rebuilt there. Item 13: a verdict counts only for the reviewer whose hash its row carries, and the Stop hook and `gate staged` can read two different reviewer files. Judgment: neither can be removed by code, because the evidence lives in one person's vault and the reviewer that runs is the installed one. This plan makes each visible where it bites, in one commit each. The edits are applied in the working tree of branch fix/issue-72-items-1-6 and not yet committed (the working-tree snippet). This is the plan as revised after an adversarial review of its first draft, which made ten findings, I1 to I10 (the trial).

The plan rests on five vault entries:

- The snippet 2026-11-17-gate-ledger-reviewer-hash-sessionstart-lines ("the snippet") quotes repo lines at commit 4a2b36e, the text of items 12 and 13, the sha256 of `agents/claims-reviewer.md` in the repo and in each plugin copy in this machine's plugin cache, and `git check-ignore` for the ledger, the binding and the gate log.
- The experiment 2026-11-17-probe-issue-72-items-12-13 ("the probe") runs the gate on two copies of the commit, one standing for the plugin and one for a checkout bound to another vault.
- The experiment 2026-11-17-trial-issue-72-items-12-13 ("the trial") holds the review's findings one line each, writes the revised edits into a copy of the repo, and runs the new tests, the whole suite and thirteen changes to the code on it.
- The snippet 2026-11-17-gate-label-stop-hook-sessionstart-reviewer ("the working-tree snippet") quotes the edited lines in the working tree and runs the new tests there.
- The snippet 2026-11-17-lines-behind-plan-issue-72-items ("the AGENTS snippet"), made for the plan of items 1 to 6, quotes `AGENTS.md` lines 7 to 18.

A sentence about the code cites a snippet. A sentence about behaviour cites the probe or the trial. A sentence marked "Judgment" is this plan's choice, not a fact.

## What exists

<!-- evidence: 2026-11-17-gate-ledger-reviewer-hash-sessionstart-lines 2026-11-17-probe-issue-72-items-12-13 2026-11-17-trial-issue-72-items-12-13 -->

- **The ledger, the binding and the gate log are ignored by git.** `.gitignore` lists `.research-vault-ledger.jsonl`, `.research-vault.json` and `GATE-LOG.md` (the snippet).
- **Item 12 on another vault.** In the probe, a checkout bound to a vault made from `vault-template` gave `check: 1 file(s); 0 ok, 0 stale, 5 uncovered` for `docs/RELIABILITY.md`, `gate status` gave `none` with the sections listed as changed units, and after an edit `gate staged --check` exited 1 with `docs/RELIABILITY.md: none`. `check` counts the uncovered citations (5); `gate status` and `gate staged` do not say that this is why there is no verdict.
- **Where the label comes from.** `gate staged` and `gate status` print `label(s)`: the verdict, or `none (reviewer changed)` when a passing row from another reviewer exists, or `none` (`bin/commands/gate.mjs` line 15, the snippet). `evidenceFor` lists, under `uncovered`, the citations that the vault does not hold, of a file's changed units when `--changed` is given and of the whole draft otherwise (`bin/lib/gate.mjs` lines 274 to 292, the snippet). The Stop hook's reason line for a file with no verdict says to run the gate skill and record a verdict (the trial's diff, the removed line of `reasonLine`; `hooks/hooks.json` names `hooks/stop-gate.mjs`, the snippet).
- **Item 13, the hash.** `reviewerHash` hashes `agents/claims-reviewer.md` beside the running code (`bin/lib/gate.mjs` lines 22 to 31), and a row counts only when its `reviewer` is that hash or absent (line 35). The Stop hook runs from `${CLAUDE_PLUGIN_ROOT}`, and `.githooks/pre-commit` runs the repo's own `bin/research-vault.mjs gate staged --check` (the snippet).
- **Item 13 in a run.** In the probe, a PASS recorded by the plugin copy's CLI counted in the checkout while the two reviewer files were equal. After the checkout's reviewer was edited, the checkout's `gate status` gave `none (reviewer changed)`, and the plugin copy's still gave `PASS`.
- **Today the hashes are equal.** The repo at 4a2b36e and the plugin copies 0.11.0, 0.11.1 and 0.12.1 in the cache have the same reviewer hash; copy 0.9.0 has another (the snippet).
- **The session start.** `hooks/session-start.mjs` prints a vault summary and, in a bound repo, one line per teach workspace that has review-due records, a reference doc with a stale citation, or an attempt; it is silent on failure and always exits 0 (lines 1 to 63, the snippet). `hooks/hooks.json` gives `SessionStart` no matcher (the snippet).

## Decisions

<!-- evidence: 2026-11-17-gate-ledger-reviewer-hash-sessionstart-lines 2026-11-17-trial-issue-72-items-12-13 2026-11-17-lines-behind-plan-issue-72-items -->

The exact text of the code edits is the script and the diff in the trial.

**D1. Item 12: the label counts the cited ids the vault lacks.** `bin/lib/gate.mjs` gains `missingEvidence`: the number of distinct `id` citations, in the units of a Markdown file that have no verdict, that the vault does not hold; 0 for a code file or on an error (I2). `gate staged` and `gate status` add it to a file with no verdict, building the vault's manifest once per call (I5). The label names each cause: `none (reviewer changed)`, `none (<n> cited id(s) not in this vault)`, or both, `none (reviewer changed; <n> cited id(s) not in this vault)`, with `id` for one and `ids` for more (I3). Judgment on each part:

- The gate cannot rebuild another person's evidence; it can say that this is why there is no verdict, so the person rebuilds the evidence before gating.
- Only the units with no verdict count, as `gate evidence --changed` lists them; in the trial, a file passed and then edited in a section that cites a held id showed plain `none`.
- URL citations are left out: the count is of ids.

**D2. Item 12: the Stop hook names the count.** The Stop hook's reason line for such a file reads `- <file>: <n> cited id(s) not in this vault: rebuild that evidence, then run the research-claims-gate skill ...` (I6). In the trial, `missingGates` gave a count of 1 for a file citing one missing id, and the reason line read `- docs/x.md: 1 cited id not in this vault: rebuild that evidence, then ...`.

**D3. Item 13: the session start names a reviewer mismatch.** The checkout is the git top level of the session's working directory, or the directory that holds the binding when there is none (I1). In a bound repo whose vault exists (the vault resolved from `.research-vault.json`), when the checkout's `package.json` names `research-vault` and its `agents/claims-reviewer.md` differs from the running plugin's, `hooks/session-start.mjs` prints one line: the checkout's claims reviewer differs from the plugin running this session, verdicts recorded with that plugin will not count for this checkout's `gate staged`, and the checkout should be loaded as the plugin (`--plugin-dir <checkout>` in Claude Code) (I4). Judgment on each part:

- A verdict recorded by the plugin's CLI carries the plugin's reviewer hash, which is the reviewer that ran; recording it a second time with the repo's CLI would claim a review the repo's reviewer never made. So the fix is to run the session with the checkout as the plugin, and the hook says so before any gate is run.
- The line comes on every SessionStart event, as the hook's other lines do, since `SessionStart` has no matcher (I9), and never blocks.
- Nothing changes in which verdicts `gate staged` or the Stop hook count.

In the trial, the line was printed for a checkout named `research-vault` with another reviewer, and not for the same reviewer or another package name. For a git checkout inside the bound repo, as a worktree is, the line named that inner checkout when its reviewer differed and was not printed when only the outer one's did.

**D4. Docs.** The Gate bullet of `docs/REFERENCE.md` gains the new label and the Stop hook's count; the SessionStart row of `docs/CODEX-PARITY.md` and the header comment of `hooks/session-start.mjs` gain the new line (I7). `docs/REFERENCE.md` and `docs/CODEX-PARITY.md` are gated, so each commit runs the claims gate on its changed unit.

**D5. Tests.** In `test/gate.test.mjs`, one test for D1: the count for a staged file, both causes named, a recorded verdict, and a partly gated file. In `test/stopgate.test.mjs`, one test for D2. In `test/sessionstart.test.mjs`, one test for D3 with the cases above (I10). In the trial, the three tests failed on a copy of the commit with only the tests added and passed with the edits. At least one of them failed with each of thirteen changes to the code, one at a time, among them the whole file counted and the binding's directory taken as the checkout. With the edits, `npm test` gave 763 of 763, and the encoding, drift and lint checks passed.

**D6. Changelog.** One line under `## [Unreleased]` in `CHANGELOG.md` for each commit, as `AGENTS.md` line 16 asks (the AGENTS snippet).

## Left out, and why

- **Committing the ledger, the binding or the vault.** Judgment: the vault is one person's research; whether to share it is not a code question.
- **Counting a verdict from either reviewer.** Judgment: a verdict is evidence that one reviewer read one text; accepting it for another reviewer would undo what the reviewer hash is for.
- **A `--plugin-dir` check inside `gate staged`.** Judgment: the commit hook cannot know which plugin a session ran; the session start can.

## The commits

Two commits, item 12 then item 13, after the commit of item 10. The first also adds this plan with `git add`, with `-f` when `git check-ignore` reports its path as ignored. Before each: add the tests, see them fail on the code as it stands, make the edit, see them pass, and run the five checks of `AGENTS.md` lines 7 to 11 (the AGENTS snippet).

## Done when

- Each new test fails on the code of commit 4a2b36e and passes with the edits.
- The five checks pass on each commit.
- A comment on issue 72 says items 12 and 13 are done, and what each change does and does not do.

## Not shown by this plan

- A real second machine. The probe stands one in with a vault made from `vault-template`.
- A checkout with no binding: by the code, it gets no line.
- A session under Codex; the line's wording for Codex was not seen in a Codex session.
- A git worktree made with `git worktree add`; the test uses a nested `git init`, and a worktree's top level was not probed.
