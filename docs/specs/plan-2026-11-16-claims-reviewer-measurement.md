# Plan: a person checks the claims reviewer and the merit decisions (2026-11-16)

No entry this plan rests on records how often the claims reviewer, on Opus and on Codex, is right when a person checks it, or how often a person agrees with a merit decision. This plan's aim is to learn both.

The plan builds no code and changes no skill, reviewer or ledger. It needs no new review run and sends nothing to an outside service. The user labels two samples and the session records the result.

This is the plan as revised after an adversarial review of its first draft. The first draft proposed building a `--timeout` flag and running a live trial of a Codex second round on three new drafts. The review's objections 12 and 13 showed a shorter way, and this draft takes it. The plan rests on these vault entries:

- The snippet 2026-11-16-lines-behind-plan-measure-claims-reviewer ("the lines snippet") quotes the repo lines this plan relies on, read at commit c205b7b, and two files of the session's memory directory.
- The experiment 2026-11-16-claims-gate-ledger-gate-log-counts ("the counts") holds the ledger and gate log counts, the record of two claims rounds on one synthesis, and the checks made after the review.
- The experiment 2026-11-16-claims-reviewer-opus-codex-gpt-6 ("the model measurement") holds the planted-defect runs of the reviewer on Opus and on Codex.
- The snippet 2026-11-16-adversarial-review-report-first-draft-claims ("the review") holds the adversarial review as handed back. It is an agent's report.
- The sources 2026-11-16-hamel-husain-using-llm-as-judge ("Husain's guide") and 2026-11-16-hamel-husain-ai-evals-faq-same ("Husain's FAQ") hold two quoted pages.
- The synthesis 2026-11-16-multi-agent-verification-ai-written-output ("the synthesis") compares the gate with published practice.

A sentence about today's code or files cites the lines snippet. A measured number cites an experiment. A point taken from the review is marked as the review's. A sentence marked "Judgment" is this plan's choice, not a fact.

## What exists

**One reviewer, two rounds, then a merit decision.** The gate skill dispatches "ONE subagent" of type `research-vault:claims-reviewer`. After the second round the session is told to "decide each surviving finding on its merits" and to log each decision in `GATE-LOG.md`. It records `PASS` when the reviewer's verdict line is `VERDICT: PASS`, or `MERIT` after the merit decision (the lines snippet, SKILL.md lines 24, 36 and 37).

**The gate skill does not tell the session to save the reviewer's report.** The reviewer returns "a markdown table (claim | location | verdict | evidence)" and one verdict line (the lines snippet, claims-reviewer.md line 35). No line of the skill tells the session to save the report to a file (the lines snippet).

**The model measurement's files are kept.** They were in a session's scratch directory under `/private/tmp` and are now copied to `~/research-vault-bench/2026-11-15-reviewer-measurement/` (the counts, run 5). `results/runs/` holds 17 files ending `report.md` and 9 ending `report.json`. `results/` holds one `judged-draft<n>.json` for each of the three drafts and `map.json`. `bench/drafts/` holds the three drafts with their planted defects, and `bench/research/` holds the vault copy (the counts, run 5).

**What the judge files hold.** The three files hold 151 findings: 51, 62 and 38. Each finding has `draftLines`, `claim`, `sound`, `basis` and `flaggedBy`, a list of report ids, and `map.json` gives each report id its arm (the counts, run 6).

**The Codex runner's time limit.** `runCodexReview` passes `timeout: options.timeout ?? 180000` to the spawn, and the object that `host review codex` passes has no `timeout` key (the lines snippet, codex-review.mjs line 69 and host.mjs line 11).

## Measured

**M1. Most ledger rows are merit decisions.** The plugin repo's ledger holds 99 rows on 32 files: 77 `MERIT` and 22 `PASS`. The gate log has 69 headings. Of these, 64 hold the words "merit decision": 44 after round two, 16 after one round, 2 with no reviewer round and 2 with no round named (the counts, runs 1 to 3). The 77 and 22 are rows, not drafts.

**M2. Planted recall did not separate Opus from Codex.** Opus found 51 of 54 and Codex 50 of 54 over nine runs each (the model measurement).

**M3. On other findings the two differed, by an agent's rating.** Of the sound findings that the judged reports raised together, Opus found 259 of 372 (70%) and Codex 342 of 372 (92%). Opus raised 0.7 false findings a run and Codex 4.9. The 372 is the union of what the judged reports raised, so both shares are relative. The judge of soundness was one agent a draft (the model measurement).

**M4. The same files, counted by finding.** Of the 151 findings, 48 were flagged by Codex reports and by no Opus report: the judge rated 26 sound and 22 false. Nine were flagged by Opus reports and by no Codex report: 7 sound and 2 false. 93 were flagged by both: 90 sound and 3 false. One was flagged by neither arm (the counts, run 6).

**M5. A Codex review took longer than the CLI's limit.** The mean wall time of a Codex review was 433 s, with a range of 253 to 762 s, and that arm ran with a timeout of 900 s (the model measurement).

**M6. On one synthesis, round two failed words that round one had marked supported.** Round one made eight findings and round two, on the corrected text, made four more. One of the four names words in a row that round one's table had marked `supported`. The soundness of the twelve is the controller's reading (the counts).

**M7. What two quoted pages say about measuring a judge.** Husain's guide says "Treat the human labels as ground truth and report the judge’s True Positive Rate and True Negative Rate separately." and "Aim for about 100 examples per failure mode, with enough Pass and Fail examples to measure both classes." Husain's FAQ says "For any data used for testing/validating LLM-as-Judge evaluators, hand-validate each label."

**M8. Neither `shuf` nor `gshuf` is on the PATH.** `command -v shuf gshuf` printed nothing, and `sort -R` runs (the counts, run 7).

## What follows

All judgments, resting on the measurements named.

**F1. No number says how often the reviewer is right by a person's check.** M2 uses planted defects. M3's and M4's ratings are an agent's. No entry this plan rests on holds a verdict that a person checked.

**F2. The kept files can be labelled now.** By the review's objection 13, the user can label a sample of the model measurement's rows with no new run. M4's 48 and 9 are the findings on which Codex and Opus differ, so a person's labels on them check the difference that M3 reports.

**F3. A live trial of a Codex second round is not needed to answer F1, and has open faults.** The review raised nine blocking objections to the first draft's trial. Among them: the Codex report reaches the session before step 4 of the first draft's trial is done (objection 4); the threshold could not tell a second model family from a second reading (objection 5); and the label file could not be built, because no copy of the draft was kept for each round (objection 7). These are the review's points. Judgment: the trial is left out of this plan, and Item 1's result decides whether a spec for one is written.

**F4. The merit decision is made by the session that runs the gate, and most rows are merit rows.** The skill gives the decision to the session (the lines snippet); in M6 that session also wrote the corrections (the counts). M1 gives the share. No entry this plan rests on records how often a person would decide a finding the other way.

## Item 1: the user labels a sample of the kept reviews

### 1. What is sampled

Four groups, from the files in `~/research-vault-bench/2026-11-15-reviewer-measurement/`:

- **Opus alone:** all nine findings flagged by Opus reports and by no Codex report (M4).
- **Codex alone:** 15 of the 48 findings flagged by Codex reports and by no Opus report, picked with `sort -R`.
- **Both:** 10 of the 93 findings flagged by both, picked with `sort -R`.
- **Passed by Opus:** up to 20 of the rows that the first Opus report on each draft marks `supported` outside `sec:preamble`, picked with `sort -R` from the three reports' rows pooled. Those reports hold 12, 1 and 26 such rows, 39 in all (the counts, run 10), so draft 2 gives one row at most. A row whose lines hold a planted defect of that draft's key file is left out before the pick.

Judgment: 54 items at most. The picks are made by `sort -R`, which gave two different orders in two runs (the counts, run 11), and are not split by the judge's rating. The numbers are Decision 1 for the user.

### 1. The label file

The session writes two files in a new directory `labels/` beside `results/`:

- `items.md`: the items in one list, in an order made with `sort -R`, numbered from 1. Each item holds the draft's file name, the draft's text at the lines the finding or the row names, taken from `bench/drafts/`, and the claim in the judge's or the reviewer's words. It holds no verdict, no rating, no `basis` and no arm. It ends with the ids on that draft's evidence list.
- `key.json`: for each item number, its group, the judge's `sound` value or the reviewer's verdict, and the report ids. The user does not open it before the labels are done.

By the review's objections 7 and 8, the text comes from the kept drafts and the item shows neither the verdict nor the reader. The kept drafts' hashes equal the draft hash in each of the nine Codex reports (the counts, run 9). The session writes a throwaway script for this in `labels/`. It is not committed.

### 1. What the user does

For each item the user reads the draft's text and writes one word under it: `fail` if the sentence says more than the evidence, or the contrary, or has no evidence; `ok` if the evidence states it. The evidence is in `bench/research/`, under the ids the item lists. The time this takes was not measured.

### 1. What is recorded

One vault experiment, with every item, its key and the user's label, and these counts:

- **The judge:** of the labelled findings the judge rated sound, the count the user labelled `fail`; of those it rated false, the count the user labelled `ok`.
- **Codex alone:** of the 15, the count labelled `fail`.
- **Opus alone:** of the nine, the count labelled `fail`.
- **Passed by Opus:** of the rows picked, the count labelled `fail`.

These are not the true positive rate and true negative rate of Husain's guide. The items are the reviewers' own rows, so a claim that no reviewer listed is not counted. The record says so, and says that 54 items is under the guide's "about 100 examples per failure mode" (M7).

### 1. What the counts are for

All judgments. By the review's objection 14, counts this small are a prompt for the user and not a trigger.

- If the user labels `fail` most of the 15 Codex-alone items, a person's check agrees that Codex finds sound things Opus misses. The session then asks the user whether to write a spec for a live trial of a Codex second round. That spec must answer the review's objections 2 to 10, 16 and 17.
- If the user labels `fail` several of the rows that Opus passed, the session asks the user whether to write a spec for a second reader when a first round passes. The gate takes a first-round `PASS` as final today (the lines snippet, SKILL.md line 37).
- If the user and the judge often differ, M3 does not stand on a person's check, and the record says so.

## Item 2: the user reads a sample of merit decisions

### 2. What is sampled

Ten of the 64 gate log headings that hold the words "merit decision" (M1), picked at the plugin repo's root with `grep -n '^## ' GATE-LOG.md | grep 'merit decision' | sort -R | head -n 10`. By the review's objection 15, the sample is from all 64 and not from the 44 after round two.

### 2. What the user does

For each finding under a sampled heading, the user writes `agree` or `disagree` with the decision and one line of reason. The user may open the draft and the vault entry.

### 2. What is recorded

In the same experiment: each heading, each finding, the label and the reason. Judgment: if the user disagrees with any decision, the session asks the user whether to write a spec that looks at the merit step.

### 2. Limits

These are the review's points, from its objection 15. The user reads the deciding session's own account of each finding. Some drafts have changed since their entry was written. The sample is the plugin repo's log and not the log of the repo that holds the vault.

## Not built, and why

All judgments.

- **A `--timeout` flag for `host review codex`.** The first draft proposed it. By the review's objection 12, `runCodexReview` already takes a `timeout` option (the lines snippet, line 69), and no step of this plan runs Codex. The limit of 180 s against a shortest measured review of 253 s (M5) stays a known gap. That a review through the CLI would be cut off is worked from the two numbers; no `host review codex` command was run.
- **A live trial of a Codex second round.** F3.
- **A change to the gate skill, the reviewer or the ledger.** Nothing is known yet that would justify one.
- **A command that builds the label file.** One use; a throwaway script.
- **Debate between reviewers.** The synthesis quotes a NeurIPS 2025 paper: "Majority Voting alone accounts for most of the performance gains typically attributed to MAD."

## Order of work

1. The user answers Decision 1.
2. The session writes `labels/items.md` and `labels/key.json`, and lists the ten sampled headings of Item 2.
3. The user labels.
4. The session captures the experiment and adds a CHANGELOG line with the counts.
5. The session asks the questions of "What the counts are for" that the counts raise.

No step makes a commit except step 4's CHANGELOG line and this plan.

## Risks

- **Planted drafts.** The three drafts are syntheses with six planted defects each. Rows at planted lines are left out of the `supported` sample, but a reviewer may read a draft with planted defects differently from a normal one.
- **Three drafts, one labeller.** The counts can show that a thing occurs, not how often. No second person checks the labels.
- **The label leads less, but still leads.** An item shows the claim in the judge's or the reviewer's words. For a finding, those words may hint at the defect.
- **The model that ran.** The Codex event stream names no model, so the model that ran in the model measurement is the configured one, not confirmed (the model measurement).
- **The kept files are a copy.** They were copied once from a scratch directory (the counts, run 5). Run 9 checked the kept drafts against the nine Codex reports' hashes. Nothing checks the report files, or the drafts against the Opus runs.

## Decisions for the user

1. **The sample sizes.** 9, 15, 10 and up to 20 for Item 1 and ten headings for Item 2, or other numbers.
2. **Whether to do Item 2 at all.** It costs the user's reading time and its limits are listed.

## Outcome: stopped before any label (2026-11-16)

The labelling was started and stopped, and no label was written (the counts, run 12).

After this plan was gated the user chose a smaller sample: 24 items, the nine Opus-alone findings and 15 of the 48 Codex-alone findings. The two other groups of Item 1 and all of Item 2 were left out. The session wrote `labels/items.md` and `labels/key.json`, and then added to each item a list of the entries on its draft's evidence list that share words with it (the counts, run 12).

The user then wrote: "I feel like this process is a little too cumbersome for the benefit", and closed the work with "yes, close it out". All 24 label lines were empty at that point. No label was compared with the key and none of the counts of "What is recorded" was made (the counts, run 12).

So F1 stands as written: no entry this plan rests on holds a verdict that a person checked. No Codex review was run on 2026-11-16, and the directories `skills`, `agents`, `bin` and `hooks` equal commit c205b7b (the counts, run 12).

Judgment: the gate stays as it is. If the question of a Codex second round comes up again, the next step is one Codex review on a real draft that is being gated, read by the user, and not a labelled sample. The session's memory file says "A Codex run sends the draft and vault evidence to an outside service, so name what will be sent and get the user's yes before the first run of a task." (the lines snippet), so the session asks the user first.
