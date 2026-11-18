# Plan: the Codex copy of the orchestrate script runs the pinned launcher, and the orchestrate Write step is already told to store page text only on consent (issue 72, items 10 and 11) (2026-11-17)

<!-- evidence: 2026-11-17-orchestrate-codex-install-lines-behind-plan 2026-11-17-second-probe-issue-72-items-10 2026-11-17-page-text-commits-spec-lines-behind 2026-11-17-trial-issue-72-item-10-review 2026-11-17-lines-behind-plan-issue-72-items -->

Items 10 and 11 of issue 72 are about the research-orchestrate skill. Item 10: under Codex, the script's `args.cli` would bypass "the pinned launcher that `host-install` writes". Item 11: the skill captured sources without their text, and storing it "needs its own spec". This plan fixes item 10 in one commit with one test. It closes item 11 with no code, because specs 52 and 53 and four commits already did what it asks. Nothing in this plan is built yet. This is the plan as revised after an adversarial review of its first draft, which made nine findings, H1 to H9 (the trial).

The plan rests on five vault entries:

- The snippet 2026-11-17-orchestrate-codex-install-lines-behind-plan ("the snippet") quotes repo lines at commit 4a2b36e, the creation time of issue 72, the text of items 10 and 11, and the commits that touched spec 52 or `storeText` in the skill.
- The snippet 2026-11-17-page-text-commits-spec-lines-behind ("the commits snippet") holds the messages of commits cbd1c95, 5659fa8, 75a2411 and 4071297, point 5 of spec 52, the first line of spec 53, and line 30 of the skill.
- The experiment 2026-11-17-second-probe-issue-72-items-10 ("the probe") runs the skill's script with stub agents, and builds in memory the files `host install codex` would write. No Codex run is made.
- The snippet 2026-11-17-lines-behind-plan-issue-72-items ("the AGENTS snippet"), made for the plan of items 1 to 6, quotes `AGENTS.md` lines 7 to 18: the five checks and the changelog rule.
- The experiment 2026-11-17-trial-issue-72-item-10-review ("the trial") holds the review's findings one line each, writes the revised edit into a copy of the repo, and runs the new test, the whole suite and four changes to the code on it.

A sentence about the code cites a snippet. A sentence about behaviour cites the probe or the trial. A sentence marked "Judgment" is this plan's choice, not a fact.

## What exists

<!-- evidence: 2026-11-17-orchestrate-codex-install-lines-behind-plan 2026-11-17-second-probe-issue-72-items-10 2026-11-17-page-text-commits-spec-lines-behind -->

- **Item 11 was answered after the issue was opened.** Issue 72 was created at 2026-11-14T17:10:37Z (the snippet). That day, cbd1c95 ("--fill stores a source's page text") and 5659fa8 ("the claims gate asks before it fills no-body sources") were commits 1 and 3 of spec 52, and 75a2411 ("Spec 53, commit 3") made the orchestrate Write agent store page text "when the user agreed"; 4071297 made the skill ask "whether page text may be stored" (the commits snippet).
- **The skill asks, and its Write prompt runs `capture --fill` only on yes.** The skill's interview asks "may this run store the text of the pages it reads in their source entries?" and passes the answer as `args.storeText` (the snippet, line 28). In the probe, with `storeText` true, step 2 of the Write prompt runs `capture --fill <sourceId> --ack-data-egress --json`; with `storeText` false it runs no such command, says "run no capture --fill" and gives every source the fill result "not stored". With no user to ask, the skill passes `storeText` `false` (the commits snippet, line 30).
- **The script's CLI comes from `args.cli`.** Line 53 says `cli = absolute path to research-vault.mjs`, and line 54 builds from it the CLI constant that the Write and Recon commands use: ``const CLI = `node "${args.cli}" ` `` (the snippet).
- **The Codex copy rewrites the CLI line, not the script.** `generatedSkill` in `bin/lib/host-install.mjs` replaces the quoted form `"${CLAUDE_PLUGIN_ROOT}/bin/research-vault.mjs"` with the quoted launcher path. It also adds an adapter section that says to run CLI commands with the launcher, which "checks the installed package before execution" (lines 53 to 67, the snippet). In the probe, the generated copy's CLI line named `.research-vault-host/codex/run.mjs`, while its args comment still said `cli = absolute path to research-vault.mjs` and its CLI constant was still built from `args.cli`. The generated files also held the package CLI at `.research-vault-host/codex/package/bin/research-vault.mjs`, and `run.mjs` began by pinning a hash for each package file (the probe).
- **The Codex copy tells a session without Workflow to run the steps inline.** The adapter says to "Use sequential orchestration when Workflow is unavailable" (line 67, the snippet), and the skill's fallback says to run "the Write step's numbered steps as written in §2, with the same commands" (the snippet, line 128).
- **The coupling.** `scripts/deps.mjs` line 48 couples `bin/lib/host-install.mjs` and the skill on "the plugin-root form translated for Codex", with no literal (the snippet).

## Decisions

<!-- evidence: 2026-11-17-orchestrate-codex-install-lines-behind-plan 2026-11-17-trial-issue-72-item-10-review 2026-11-17-page-text-commits-spec-lines-behind 2026-11-17-lines-behind-plan-issue-72-items -->

The exact text of the edit is the script and the diff in the trial.

**D1. Item 10: the Codex copy pins the script's CLI constant and rewrites its args comment.** `generatedSkill` gains two replacements, after the one for the CLI line. ``const CLI = `node "${args.cli}" ` `` becomes `const CLI = "node '<launcher>' "`: the launcher path quoted for the shell as the CLI line quotes it, the whole written as a JSON string. The args comment `cli = absolute path to research-vault.mjs` becomes `cli = not read in this Codex copy: every command runs the launcher of section 0` (H3). Judgment on each part:

- When the script runs, the Codex copy runs the launcher whatever `args.cli` names. In the trial, with `args.cli` set to `/bypass/research-vault.mjs`, the Write and Recon prompts ran the launcher and never named `/bypass`.
- The Codex copy tells a session without Workflow to run the steps inline from the text (above). In the trial, the generated script text held the launcher in its constant and named neither `${args.cli}` nor "absolute path to research-vault.mjs" (H1).
- The Claude copy does not change: the skill's own text is not edited.
- The test's project path, which holds a space, a `$` and a single quote, does not break the script.

**D2. Item 10: coupling rows.** Two rows join `bin/lib/host-install.mjs` and `skills/research-orchestrate/SKILL.md`, on the literals ``const CLI = `node "${args.cli}" ` `` and `cli = absolute path to research-vault.mjs`. Judgment: such a row is meant to make a change to either text in the skill fail `npm test` until the replacement follows; the trial did not edit the skill to show it.

**D3. Item 10: a test.** In `test/host-install.test.mjs`, one test builds the Codex files for a project and takes the generated orchestrate script. It runs the script with stub agents and `args.cli` set to `/bypass/research-vault.mjs`, and asserts that the Write prompt runs `node '<launcher>' capture --fill`, that the Recon prompt runs `node '<launcher>' search` (H9), and that neither names `/bypass`. It also asserts the constant of D1 and that the old args comment is gone (H1). In the trial, the test failed on the code of the commit, with the CLI line not replaced, with the args comment not rewritten, and with the package CLI in place of the launcher. With the edit, `npm test` gave 761 of 761, and the encoding, drift and lint checks passed.

**D4. Item 11: no code.** Judgment: the item asks for a spec on "where the bytes come from, and how consent is asked". Spec 52 answers both for the claims gate, and spec 53 with 4071297 for the orchestrate run (H5). The comment on the issue names the two specs and the four commits. When no consent is given, as in a headless run or a subagent, where `storeText` is `false`, spec 52 says the gate reports which claims are likely to fail for want of text (H6). Judgment: that is the consent rule working, not a fault.

**D5. Changelog.** One line under `## [Unreleased]` in `CHANGELOG.md` for the commit of item 10, as `AGENTS.md` line 16 asks (the AGENTS snippet).

## Left out, and why

<!-- evidence: 2026-11-17-trial-issue-72-item-10-review -->

- **A Codex run.** Judgment: this plan probes item 10 by reading the code; the probe and the test build the Codex files in memory and run the script with stubs.
- **A readable constant for every path (H2).** For a project path holding `'` or `\`, the constant is a JSON string with escapes, which a reader copying it by hand would get wrong (the trial, the review's record). Judgment: section 0's CLI line and the adapter line give the plain form, and the comment of D1 sends the reader there.
- **The Codex hooks (H4).** The review reported that the generated `.codex/hooks.json` runs the package's `hooks/codex.mjs` directly, outside the launcher's hash check (the trial, the review's record). Judgment: item 10 is about `args.cli`; the hooks are a separate question.

## The commits

<!-- evidence: 2026-11-17-lines-behind-plan-issue-72-items -->

One commit for item 10, after the commits of items 1 to 8; it also adds this plan with `git add -f`. Before it: add the test, see it fail on the code as it stands, make the edit, see it pass, and run the five checks of `AGENTS.md` lines 7 to 11 (the AGENTS snippet). Item 11 gets no commit.

## Done when

- The new test fails on the code of commit 4a2b36e and passes with the edit.
- The five checks pass on the commit.
- A comment on issue 72 says item 10 is done and item 11 was done by specs 52 and 53 and commits cbd1c95, 5659fa8, 75a2411 and 4071297.

## Not shown by this plan

- A Codex session running the skill.
- That a Codex controller copies the constant's command when it runs the steps inline.
