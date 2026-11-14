# Spec 54: seven limits of specs 52 and 53, and what to do about each (2026-11-14)

Specs 52 and 53 propose storing page text for the claims gate and a leaner research run. This spec takes the seven limits the orchestrator listed to the user after spec 53 (the session record), gives a measurement for six, and says what gets built, tested first or left out for each. Nothing here is built. This is its second draft: an adversarial review of the first raised nine blocking objections, and the designs below are changed by them. Two measurements went against what the orchestrator had said or written, and the spec says so.

The spec rests on ten vault entries:

- The experiment 2026-11-14-seven-limits-tests ("the tests") holds W1 to W3 and T7 to T11.
- The experiment 2026-11-14-lean-run-rules-fetch-tool-tests ("the earlier tests") holds T5 and T6, the runs the new ones are compared with.
- The experiment 2026-11-14-lean-run-evidence-packet-tests ("the first tests") holds T1 to T4.
- The experiment 2026-11-14-source-text-revision-three-probes ("the probes") holds the survey of which sources the CLI's fetcher can read, by domain.
- The experiment 2026-11-14-source-text-decision-probes ("the survey") holds the count of sources and questions in this vault.
- The experiment 2026-11-14-spec-54-review-checks-raw-markdown ("the checks") holds C1 and R1, the orchestrator's checks of two points of the review.
- The snippet 2026-11-14-spec-54-lines ("the lines snippet") quotes code at a4ace68 and lines of specs 52 and 53.
- The snippet 2026-11-14-spec-54-lines-part-two ("the second lines snippet") quotes further lines of the two specs, of `refresh`, of the fetcher, of the gate skill and of the reviewer's file.
- The snippet 2026-11-14-spec-54-design-review-report ("the review") holds the adversarial review of this spec's first draft, as handed back.
- The snippet 2026-11-14-orchestrate-repair-session-record-part-six ("the session record") holds the seven items as shown to the user and the user's instruction.

A sentence about the code or the two specs cites a lines snippet. A sentence about behaviour cites an experiment. A sentence that gives the review's finding says so; where the orchestrator checked the finding, the check is cited. A sentence marked "Judgment" is this spec's choice. Token figures are the host's subagent totals.

## What exists

**Specs 52 and 53.** Spec 52's design has `capture --fill`, with `--replace` for a fill that stored the wrong thing, and leaves out "a form of the fill that takes a saved file". Spec 53's design has three phases, a quote for every claim, `verify --quotes` and a Write agent that judges each claim; it leaves out trimmed evidence for the reviewer, a separate judging agent and more claims a page. Both are quoted in the lines snippet. `capture` at a4ace68 has no `--fill` (the lines snippet).

**The gate's units and rounds.** A Markdown draft with headings is cut into one unit per heading section and one per table row (`bin/lib/gate.mjs` lines 59 and 95). `recordVerdict` writes a ledger row with the verdict given to it (lines 203 to 213), and the units listed as changed are those no counting row holds (line 191). The research-claims-gate skill allows two rounds: after the second, "decide each surviving finding on its merits ... Then stop dispatching" (line 34). All are in the lines snippet. The skill's table of mistakes has "Re-rolling the reviewer for a PASS" (the second lines snippet).

**The fetcher and `refresh`.** The fetcher follows a redirect only to https and fetches the address it is given (`bin/lib/fetchsource.mjs` lines 80 to 87, in the lines snippet). `refresh` fetches an entry's `source_url` and reports `changed` when the hash it gets differs from the entry's `content_hash` (`bin/commands/refresh.mjs` lines 41 to 45, in the second lines snippet). Spec 52 has the fill store "the hash of the fetched bytes" and keep a hash it replaces in its row's note (spec 52 lines 53 and 83, same snippet).

## The seven items

Each has what was measured, what the review found, then the design. Designs are judgments.

### 1. The lean run answered less than its page held

**Measured.** With a coverage pass and eight claims a page in place of five, the Write agent added 8 claims from the stored text and reported five questions answered from it; all 20 quotes were found. The run cost 212,632 tokens against 199,252 without the pass, on the same question, each with 4 agents (the tests, T7; the earlier tests, T6). T6 had left the grant flags and the stability level open; T7's synthesis states the grant flags from a quote and quotes the history row on stability.

**The review's finding.** The gate did worse on T7's synthesis than on T6's, and the first draft left that out. Both reviewer rounds on T7's synthesis failed the same five sentences (the tests, T8). One of the five, "One read is allowed with no grant", rests on claim 14, one of the eight claims numbered 12 to 19 that carry line numbers from the run (the checks, C1). The review also says that T7 changed two things at once, so the pass's effect cannot be told from the effect of eight claims a page, and that under the pass the Write agent writes claims it then judges, where spec 53 says of that agent "it did not write the claims" (the review, A1; the second lines snippet, spec 53 line 79).

**Design.** Spec 53's script asks each lane for eight claims a page. The coverage pass is not built until the benchmark of item 3 has compared a run with it and a run without it on the same question. In that comparison the pass has one rule the T7 prototype lacked: a claim the pass adds appears in the synthesis only as its quote, with no restatement. Judgment: the failed sentence was a restatement of a quote, so the rule aims at the failure seen; one case is thin ground and the comparison decides.

### 2. A stored text can be the wrong text, or cannot be fetched

**Measured.** For a file view on a code host, fetching the address as given stored 2,232 bytes with no line holding the word looked for; fetching the raw file stored 251,797 bytes with it. Discarding a stored text put the source back to `no-body` for the gate. The extractor turned a saved HTML file into its text (the tests, W1 to W3). In this vault the CLI's fetcher got usable text for 68% of the no-body sources in the learning domain and 97% in llm-assisted-dev (the probes).

**The review's findings, and one new probe.** By the review (A2 to A5):

- A fill that fetches the raw file but leaves `content_hash` to be compared with a fetch of `source_url` makes `refresh` report `changed` every time; a hash taken from a saved file does the same. The lines of `refresh` are in the second lines snippet.
- A sentence quoted from the rendered page may not be on a line of the raw Markdown. Probe R1 bears this out: of 40 sampled list lines of a raw changelog, the rendered form matched a stored line 0 times with the prototype's matcher and 40 times once links, emphasis marks, code marks and escapes were removed. The rendered form was the orchestrator's approximation; no quote from a fetch tool was tried (the checks, R1).
- A discard run because "no quote was found" can delete correct text when the quotes were the fault, and it clashes with the fetch that spec 53's `verify --quotes` makes when a stored body lacks a quote (spec 53 line 63, the second lines snippet).
- `--content-file` given to an agent is a path from any local text file into the vault.

**Design.** Four changes to spec 52, which is revised with them; its "not built" line for the saved-file form goes.

- **A file view is fetched as the raw file, by the fetcher itself.** For an address of the form `https://github.com/<owner>/<repo>/blob/<ref>/<path>`, `fetchSource` fetches the raw file's address, without any query or fragment, and reports the address it used. Every caller gets the same bytes: the fill, `refresh` and the fetch inside `verify --quotes`. The rewritten address passes the same safety check as any other (line 36 of the fetcher, the second lines snippet). The entry's `source_url` is not changed. One host to begin with.
- **Markdown is stored as a reader sees it.** For a fetched file whose path ends in `.md`, the extractor reduces a link to its text and removes emphasis marks, code marks and backslash escapes. Before this is built, one run checks quotes returned by a fetch tool against text stored this way.
- **`--discard`.** It resets a body that a fill wrote, restores the hash the fill's row says it replaced or removes the hash the fill set, and appends a row whose note begins `discarded:`. It refuses a body no fill row describes. No agent runs it. A run whose source has no quote found names that source in its result, as spec 53 already says (spec 53 line 66, same snippet), and a person decides.
- **`--content-file <file>`.** The text comes from a saved file, through the same extractor. `content_hash` is left as it is; the row's note begins `filled-from-file:` and gives the file's name and hash. It accepts `.html`, `.htm`, `.txt` and `.md`, needs `--ack-data-egress`, uses no network, and appears in no skill text given to an agent. A PDF is converted to text first.

### 3. The sample is small and the four-lane saving is an estimate

**Measured.** Nothing new: five lean runs on two questions about one project's documentation, and no run of the present script at four lanes (the first tests; the earlier tests; the tests).

**The review's finding.** The first draft's benchmark named no threshold, ran prototypes that write rows in a form spec 53 does not design, and was priced low; a design of about four lean questions decides the same thing for about half (the review, A8 and B).

**Design: a benchmark, run on the prototypes, with its thresholds written first.** All figures below are judgments.

- Four questions from this vault's 79 open questions (the survey, Q4): one in software-engineering as the control, one in learning, one in data-ml, and one whose likely sources are community posts.
- For each: the lean script at four lanes and eight claims a page, with item 2's fetcher change and the prototype changed to write the row spec 53 designs; then one gate round on its synthesis.
- For one of the four: a second lean run with the coverage pass of item 1, gated once; and a second gate round on the first run's synthesis, for item 4.
- Recorded for every run: agents, host tokens, seconds, pages returned and distinct, fill result for each source, quotes checked and found, claims cut or dropped, claims added, and the gate's rows by verdict.
- Thresholds. Spec 53 goes ahead as written if, on at least three of the four questions, four quotes in five are found and the gate fails no more than three rows in twenty. The coverage pass is built if its run's synthesis has no more failing rows than the run without it and the gate supports at least one answer the other run left open. The audit of item 6 is built if, on two or more questions, a failing row traces to a note that says more than its quote.
- Cost: five lean runs at 330,000 tokens or more each and six gate rounds at 60,000 to 95,000, about 2.1 million tokens. The present script at four lanes is one optional further run, 400,000 to 800,000 by the orchestrator's estimate (the session record), which the review restates; it has never been measured.

It is not run by this spec. The user wrote "Plan to do all 7"; the orchestrator read that as a plan (the session record).

### 4. Reviewer rounds can disagree

**Measured.** Two rounds on identical input gave the same pass or fail on 39 of 40 rows. Both failed the same five sentences; one round alone failed a sixth (the tests, T8). The earlier report of disagreement compared two rounds whose evidence lists differed, though it also recorded disagreement on claims whose evidence was the same in both (the probes). A third dispatch on spec 53 failed three sentences that stood in text its second round had read (the tests, T11).

**The review's finding.** Agreement over all rows is carried by the easy rows. Counted over the rows either round failed, T8 agreed on 5 of 6 (the review, A9).

**Design.** No change to the gate. In the benchmark one synthesis is gated twice, and the measure is the share of rows failed by either round that both failed. Judgment: under three in four reopens "verdicts remembered per claim", which spec 53 set aside.

### 5. Trimmed evidence lost rows

**Measured.** A packet cut from the lines each quote was found at, three lines either side, with small sources whole, cost 38,158 tokens a round against 65,212 and 62,520 with the sources whole. Every row quoting a sentence of a page was supported. It failed the five sentences the whole-source rounds failed, and three more: two statements that a page lacks something and one about which heading a row sits under. Of those the reviewer wrote that an excerpt "cannot show that something is absent" (the tests, T9). The first packet, cut by shared words, had failed two rows for want of the supporting lines (the first tests, T2).

**The review's finding.** A packet weakens the gate in ways no record shows (the review, A7). The reviewer looks for entries its list omits by searching the vault's folders (`agents/claims-reviewer.md` line 20, the second lines snippet); given a packet as its vault, it finds none. A pass on a packet would stand though the whole source was never read. A line number recorded against a text that was fetched and not stored points nowhere once a later fill stores a different text. A draft that is not the run's own gets excerpts cut around another draft's quotes.

**Design.** The record first; the packet only if it pays.

- `verify --quotes` puts into the row's note the line the quote was found at and the first eight hex digits of the hash of the body it was found in, and only when it was found in the stored body. The number counts lines of the entry's body: the two sources of T7 had bodies beginning 124 and 52 lines into their files (the tests, T7 and T8), and the packet prototype counts body lines because the frontmatter grows with each verification row (the tests, T9). This goes into spec 53's commit for the command, with the note's form stated once there.
- `gate evidence --packet <dir>` is not built now. If it is built, three rules hold. It is offered only for a synthesis whose line rows all carry its own run key and the hash of the body as it stands. A packet round can fail a draft and cannot pass one: a `PASS` needs a round on whole sources. The reviewer's file is not edited.
- Judgment: under the second rule a packet saves tokens only when round 1 fails. T5's synthesis passed its first round and T6's failed one row of 34 (the earlier tests), so the benchmark's four first rounds decide: the packet is worth building if three or more fail.

### 6. One reader judges the claims

**Measured.** An audit agent given eight of the 20 claims found seven sound and one overstated, for 56,796 tokens. The overstated one is a sentence both gate rounds also failed. Outside its sample it noticed one dropped qualifier that neither gate round listed (the tests, T10 and T8).

**The review's finding.** Do not build it: its one finding in its sample was the gate's too, it costs about a gate round, and spec 53's own condition for a judging agent, "if gates show claims slipping through", was not met (the review, B; spec 53 line 97, the second lines snippet). A sample of every third claim up to eight never reaches a claim numbered past 21.

**Design.** Not built now. It is built if the benchmark meets item 3's threshold for it. If built: one agent a run, after the Write agent, reading only the run's entries; it takes eight claims spread evenly over all of them, the coverage pass's included, reads each quote's lines and five either side, judges every use of the quote in the run's notes, and returns the uses that say more than the quote. The session fixes those notes before the gate or files a question.

### 7. Edits after the last round are not reviewed

**Measured.** A third dispatch on spec 53, limited to the two sections edited after round 2, found four problems. One was made by a round-2 edit; three stood in text round 2 had read. It cost 108,201 tokens against 111,746 for round 2 over all nine sections (the tests, T11). The orchestrator had told the user this round would be cheap "because the ledger already tracks sections" (the session record). It was not.

**The review's finding.** The first draft's "third dispatch on the units edited since round 2" cannot be built on the ledger as it is: the skill records no row after a failing round, so the changed units are all those no passing row covers. And a clean third round recorded as `PASS` is the mistake the skill's table names (the review, A6; the second lines snippet).

**Design, in two steps.**

- **Now: two rounds stay the rule, and the edits after round 2 are held to the findings.** After round 2 the session changes only the sentences a finding names, and logs each in `GATE-LOG.md` with the finding it answers. If an edit after round 2 adds a claim no finding named, one more round runs, over every unit the command lists as changed; its findings are applied and the verdict is `MERIT`, never `PASS`. There is no round after that.
- **Later, to make a confirmation round cheap: smaller units and partial records.** The skill records no row after a failing round, and only `PASS` or `MERIT` rows count, so every unit no earlier passing row covers stays listed as changed; and in a Markdown draft a section is the smallest unit of prose. Judgment: record, after a failing round, the units in which the reviewer failed nothing; and cut a section into one unit a paragraph, as a table is already cut into one unit a row. This changes how units are hashed and needs a spec and a measurement of its own.

## What gets built, and in what order

Each commit passes the repo's checks and carries a changelog line.

1. Spec 52, revised with item 2's four changes, then its commits. They do not wait for the benchmark.
2. The benchmark of item 3, with the comparisons of items 1 and 4. Its record is set against the thresholds.
3. Spec 53's commits, if its threshold is met, with eight claims a page and item 5's line and body hash in `verify --quotes`.
4. The rule of item 7's first step in the research-claims-gate skill.
5. Whichever of the coverage pass, the audit agent and the packet met its threshold, each as its own commit.

## Not built, and why

All judgments.

- **The coverage pass, the audit agent and the packet, until the benchmark.** Each has one measurement of the form proposed (the packet's line-based form in T9; T2 measured an earlier form cut by shared words), and the review recommends against each as first drafted.
- **Item 7's second step.** It changes unit hashing for every gated draft.
- **A fix for reviewer disagreement** (item 4). One comparison on identical input found one row in 40.
- **A list of raw-file rules for many hosts** (item 2). One host was met.
- **A discard run by an agent.** A missing quote does not say whether the text or the quote is at fault.

## Done when

1. Spec 52 is revised and gated, and `npm test` passes with tests for item 2: a file view is fetched raw by every caller and the entry's address is unchanged; a `.md` file is stored without link and emphasis syntax; `--discard` restores a replaced hash, writes its row and refuses a body no fill wrote; `--content-file` stores extracted text, leaves `content_hash` alone and refuses other file types.
2. The benchmark's record exists as an experiment with every field of item 3 for every run and each threshold marked met or not.
3. For each later item built, `npm test` passes with a test for it: `verify --quotes` records a body line and body hash only for a stored body; the skill holds the rule of item 7.

## Limits of this spec

Every test in the seven-limits experiment is one run or one round on one question about one project's documentation, except T11; the survey figures are vault-wide counts. The coverage pass, the packet and the audit were each tried once on the same run's output. T7 met no page the fetcher could not read, so the discard was tried only by hand, and the extractor was run on one saved HTML file; the saved-file form itself was not tried. The Markdown rule rests on R1, which used an approximation of the rendered page. Every threshold and the benchmark's cost are judgments made before any run. The review's findings are an agent's report; the orchestrator checked A1 in part and A3 by probe and read the code lines behind A2 and A6. Three of the seven items are now conditional on the benchmark; the user asked for a plan for all seven, and the reading of "Plan to do all 7" as a plan and not a run is the orchestrator's.
