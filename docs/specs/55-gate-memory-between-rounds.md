# Spec 55: what the claims gate remembers between rounds (2026-11-14)

Spec 54 said that if two reviewer rounds on one draft agreed on fewer than three in four of the rows either failed (the benchmark counted them by sentence), the idea spec 53 set aside as "verdicts remembered per claim" would be looked at again. The benchmark gave one in four. This spec looks at it again, and at the partial records spec 54 proposed for later, and builds neither now. Spec 54's trigger fired, and this spec answers it by a reversal: spec 54 took low agreement as a reason to look again at remembering verdicts, and this spec argues that low agreement is a reason against a memory that lets a later round skip what an earlier one passed. It proposes one measurement, whose record also decides whether partial records are looked at again. Nothing here is built. This is the second draft: an adversarial review of the first raised six blocking objections, and the design below is changed by them.

The spec rests on six vault entries:

- The experiment 2026-11-14-zig-gate-rounds-sentence-unit-agreement ("the comparison") sets the benchmark's two rounds on one synthesis side by side, by sentence and by unit.
- The experiment 2026-11-14-spec-54-benchmark-lean-runs-gate ("the benchmark") holds every run and round of the benchmark and its thresholds.
- The experiment 2026-11-14-seven-limits-tests ("the earlier tests") holds T8, an earlier pair of rounds on one input.
- The experiment 2026-11-14-coverage-pass-second-comparison-same-pages ("the second comparison") holds one more first round.
- The snippet 2026-11-14-spec-55-lines-gate-ledger-rounds ("the lines snippet") quotes the gate's code, the gate skill and the two specs.
- The snippet 2026-11-14-spec-55-adversarial-review-report ("the review") holds the adversarial review of this spec's first draft, as handed back.

A sentence about the code, the skill or a spec cites the lines snippet. A sentence about behaviour cites an experiment. A point taken from the review is marked as the review's. A sentence marked "Judgment" is this spec's choice.

## What exists

**What a ledger row holds.** `recordVerdict` writes one row for a file with the verdict given to it and a hash for every unit of the file as it stands (`bin/lib/gate.mjs` lines 203 to 215, in the lines snippet). A unit counts as covered when a `claims` row for the same file, whose verdict is `PASS` or `MERIT` and whose reviewer is absent or equal to the present reviewer's hash, holds the unit's hash (lines 26, 35 and 191 to 201). `recordVerdict` refuses only a verdict outside its list (line 204); by the review, that list holds `FAIL-as-sent`, so a failing row with unit hashes can be written today and would not count. A row holds nothing about a sentence inside a unit.

**What the skill records.** The research-claims-gate skill records `PASS` when the reviewer's verdict is `PASS`, and `MERIT` after the merit decision that follows a second failing round; it tells the session never to record `PASS` for a failing verdict (lines 36 and 37 of the skill, in the lines snippet). Its steps 3 and 4 (lines 36 and 37) give no instruction to record anything after a first failing round.

**What the two specs said.** Spec 53 left out "Verdicts remembered per claim" as needing "a new kind of ledger row" and "a spec of its own" (its line 99). Spec 54 set the test: one synthesis gated twice, and "under three in four reopens" the idea (its line 81). Spec 54 also proposed, for later, to "record, after a failing round, the units in which the reviewer failed nothing", and to cut a section into one unit a paragraph (its line 112). All are in the lines snippet.

## Measured

**M1. Two rounds on one draft shared one failing sentence in four.** On the benchmark's Zig synthesis, round A failed the sentences at draft lines 30, 101 and 103, and round B failed those at lines 30 and 40. Four sentences were failed by either round and one by both (the comparison; the benchmark).

**M2. By the orchestrator's check, all four findings are sound.** For each of the four, the stored source holds the line the reviewer cites, and the draft's sentence says more than that line or, at line 103, gives a reason no entry records. So each round missed at least one sound finding that the other made (the comparison). The check is the orchestrator's reading and not a third reviewer's.

**M3. Each round left clean a unit in which the other found a failing sentence.** The draft has five units. Round A failed sentences in `sec:answer` and `sec:recommendation`; round B in `sec:answer` and `sec:what-the-pages-say` (the comparison).

**M4. The earlier pair agreed more.** In T8, two rounds on another synthesis failed the same five sentences and round A alone failed a sixth: five of six (the earlier tests). Taken together the two pairs give six sentences failed by both rounds of ten failed by either. That figure counts failures, not sound findings: round A's sixth in T8 was not checked. The two pairs are two drafts.

**M5. The reviewers cut the same draft into different rows.** Round A's table had 25 rows and round B's 46 for the same draft; round A marked the sentence at line 40 `supported` inside one row that covered seven bullets (the comparison).

**M6. Four of the benchmark's five first rounds failed, on sentences in the synthesis's own words; the coverage run's passed.** The four failed with two to five failing rows each (the benchmark). The second comparison's round failed three rows more (the second comparison).

## What follows

All judgments, resting on the measurements named.

**F1. A remembered `supported` would have kept a miss (M1, M2).** Had round A's verdicts been remembered per sentence, the sentence at line 40 would have stood as `supported` and a second round would not have read it. Round B read it and failed it, soundly by M2. A memory of `supported` verdicts skips exactly the sentences it no longer reads, and those are where the first round's misses are.

**F2. Spec 54's partial records have the same cost, one level up (M3).** Recording the units a failing round left clean would have marked `sec:what-the-pages-say` covered after round A. Round B's finding at line 40 sits in that unit. The same holds the other way round for `sec:recommendation`.

**F3. A reviewer's rows are no key for a claim (M5).** A verdict remembered per claim needs the same claim to be the same thing in two rounds. The reviewers' rows are not: one row of round A covers seven bullets of the draft. A key cut by the gate itself, a sentence or a paragraph, would be stable, so this is a note on how such a memory would have to be keyed and not a reason of its own against it; the reason is F1.

**F4. A remembered failure adds nothing while the skill is followed.** The skill has the session fix each failing claim before the next round (line 36 of the skill, in the lines snippet), so a failed sentence or its evidence is changed before the next round reads it. A memory of failures would catch a session that left a failed sentence as it was and got it passed by a second round; none of the entries this spec rests on records such a case. Judgment: not built.

**F5. What the disagreement measures is how much one round misses, not that rounds are unreliable when they fail a sentence.** In the one pair checked, each finding was sound (M2), and each round found two or three of the four. The gate today takes one round's `PASS` as final (line 37 of the skill). If a round misses as much as this pair suggests, the weak point is a first-round `PASS`, and no memory between rounds touches that. The benchmark held one first-round `PASS`, on the coverage run's synthesis, and it was read once (the benchmark).

## Design

All judgments. Points 3 to 6 were rewritten after the review, whose objections 1 to 7 and 14 they answer.

1. **Not built now: a memory of verdicts that lets a later round skip a sentence, and a record of the units a failing round left clean.** F1 and F2. The ledger keeps its present rows. This narrows spec 54's later step for item 7 and does not withdraw it: by the review, F1 and F2 rest on one draft and show the cost can occur, not how often, and spec 54 wanted partial records to make a confirmation round cheap, a need this spec does not meet another way. The record of point 3 decides whether partial records are looked at again, by the figure of point 5. Other uses of a per-claim memory, such as one read only by a confirmation round after round two, are not designed here.
2. **The second round stays a full round over every changed unit.** It is the gate's only second reading, and in the one pair measured a second reading found a sound failure the first had passed (M2, M3).
3. **One measurement: a second reviewer on the first round of the next three run syntheses, held back until round two has run.** For each of the next three syntheses that a research-orchestrate run produces in this vault, two reviewers are dispatched at the same time with the identical prompt, on the whole sources and not on a packet. The one dispatched first is X and the other Y, named before either reports. The session then follows the skill with X alone: it applies X's findings and runs a normal round two, or records nothing more if X's verdict is `PASS`. Only then does it open Y's report. Every finding of Y that X did not make is marked caught, if round two failed the same sentence, or surviving. Surviving findings that pass the test of point 4 are then applied; those edits come after the last round, so this spec has each logged with its finding and records `MERIT`. By the review, the skill's step 2 says "ONE subagent"; for these three drafts this spec overrides that, and Y is not a round under the per-unit cap. The instruction lives in this spec, and the skill's text is not changed for a measurement.
4. **The test of a sound finding, written before the runs and applied to every finding, shared or not.** A finding is sound when the line the reviewer cites is in the stored entry as cited, and the draft's sentence says more than that line, or the contrary. A finding that a page lacks something is sound only if a search of the whole stored source finds no such sentence. Each finding is recorded with the cited line and the result. The judge is the session's orchestrator; by the review that is a weakness, and it is kept because a third reviewer on every finding would, by an estimate that was not measured, cost about another round a draft. The record gives the cited lines so a reader can check the judge.
5. **Recorded for each of the three drafts.** X's and Y's verdicts and host tokens; every finding of either with its unit and its soundness; for each sound finding of Y alone, whether round two caught it; and, for point 1, whether each sound finding made by one reviewer alone sits in a unit the other left clean.
6. **Thresholds, written before the runs.** A survivor is a sound finding of Y alone that round two did not catch, or any sound finding of Y on a draft X passed. A second reviewer on the first round becomes the skill's rule for a run's synthesis if two of the three drafts have a survivor and the three together have at least one survivor for every 100,000 host tokens the three Y dispatches cost. It is dropped if no draft has a survivor. Anything between runs three more drafts. Partial records are looked at again only if, over the three drafts, no sound finding made by one reviewer alone sits in a unit the other left clean. If three run syntheses have not been gated in this vault by 2026-12-31, what exists is recorded and nothing is adopted. The benchmark's five first rounds cost 38,086 to 108,307 host tokens each (the benchmark).
7. **No change to the reviewer's file.**

## Not built, and why

All judgments.

- **A ledger row per sentence or per claim, read so as to skip re-reading.** F1.
- **A record of clean units after a failing round.** F2, until the record of design point 3 says otherwise.
- **A second reviewer for every gated draft.** The measurement of design point 3 is on run syntheses only; a spec or a reference doc is a different kind of draft and no pair was run on one here.
- **A third round to settle a sentence two reviewers split on.** A split needs no settling: a sound finding is applied whichever reviewer made it.

## Done when

1. This spec is gated.
2. The three drafts of design point 3 are recorded as an experiment with the fields of design point 5, and each threshold of design point 6 is marked met, not met or extended.
3. If the rule is adopted, the research-claims-gate skill states it and a test pins the sentence.

## Limits of this spec

Two pairs of rounds on two drafts, both syntheses of lean runs about software documentation; the Zig pair with reviewer 0.10.0, and T8's reviewer version is not recorded. The soundness of the four findings in M2 is one reader's check. M4's ten sentences pool two drafts with very different agreement, five of six and one of four, and no reason for the difference is known. F1 and F2 are worked from one draft: they show the cost can occur, not how often. The measurement of design point 3 takes its syntheses as they come, so its three drafts are not chosen to be comparable, and three drafts can show that survivors occur, not how often. Its judge of soundness is the orchestrator who wrote this spec. The threshold of one survivor for every 100,000 tokens is a judgment with no measurement behind it. The review's findings are an agent's report; the orchestrator read line 35 behind its objection 11 and took the `VERDICTS` point and the other objections on their reasoning.
