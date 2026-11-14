# Spec 53: lean research runs with mechanical quote checks (2026-11-14)

A research run through the orchestrate skill starts two agents for every page it reads. This spec proposes a run with a fixed number of agents, in which a program, not an agent, confirms that each quoted sentence is on its page, and the one agent that writes judges each claim against the lines around its quote. It builds on spec 52, which stores page text and lets the gate reach it. Nothing here is built. Four runs of a prototype are measured below. This is the spec as revised after an adversarial review and a first claims round.

The spec rests on ten vault entries:

- The experiment 2026-11-14-lean-run-evidence-packet-tests ("the tests") holds T1 to T4: where the tokens of two earlier runs went, a gate round on trimmed evidence, and two runs of a lean script with the gate on each.
- The experiment 2026-11-14-lean-run-rules-fetch-tool-tests ("the later tests") holds T5 and T6: the lean script with writing rules, and with lanes limited to the fetch tool and a writer that judges each claim, with the gate on each.
- The experiment 2026-11-14-orchestrate-skill-live-runs ("the earlier runs") holds two runs of the orchestrate script, cut to two lanes and one URL per lane, and a gate on the first.
- The experiment 2026-11-14-source-text-software-synthesis-gate ("the software gate") holds gate rounds G3 and G4 on a real synthesis.
- The snippet 2026-11-14-spec-53-lines ("the lines snippet") and the snippet 2026-11-14-spec-52-revision-three-lines ("the second lines snippet") quote the skill and code at a4ace68.
- The snippet 2026-11-14-spec-52-design-lines-at-e667d28 ("the spec 52 snippet") quotes spec 52's design.
- The snippet 2026-11-14-spec-53-adversarial-review ("the review") holds the adversarial review of this spec's first draft.
- The snippet 2026-11-14-orchestrate-repair-session-record-part-five ("the session record") holds the user's messages that led here.
- The experiment 2026-11-14-source-text-decision-probes ("the probes") holds Q1, on whether quoted sentences survive text extraction.

A sentence about the code cites a snippet. A sentence about behaviour cites an experiment. A sentence marked "Judgment" is this spec's choice. A point taken from the review that no test here repeats is marked as the review's. Token figures are the host's subagent totals unless the sentence says "from the transcripts".

## What exists

**The script.** Section 2 of the orchestrate skill runs one Recon agent, one Sweep agent per lane over four lanes, one Fetch agent per URL found, one Seed agent, one Verify agent per captured source, one Plan agent and one Persist agent (`skills/research-orchestrate/SKILL.md` lines 58 to 123, in the lines snippet). With four lanes and N pages that is 8 agents plus 2 for each page. The Verify agent is told to fetch the page again and return "the sentence or output you saw" (line 99), and the Persist agent records it in a verification row (line 113).

**The run key.** Section 0 gives `2026-11-14-apf-k3` as an example of a run key (line 14, in the lines snippet). The citation extractor treats any `<date>-<slug>` in prose as an entry id, and treats text inside a code span as code, not as a citation (`bin/lib/citations.mjs` lines 4, 5 and 12, in the lines snippet).

**`verify` and verification rows.** `verify` appends one row per call and has no check for a row already present (`bin/commands/verify.mjs` line 36, in the lines snippet). The allowed methods are `refetched-source`, `cross-referenced`, `existence-check`, `human-spot-check`, `inferred-stable`, `tool-probe` and `captured` (`schema/taxonomy.json` line 22). A row resets an entry's freshness when its result is `confirmed` or `changed-trivially` (`bin/lib/manifest.mjs` line 16). The reviewer treats an entry "whose only verification is `captured`" as supporting only a hedged claim (`agents/claims-reviewer.md` line 14). All three are in the second lines snippet.

**Spec 52.** It proposes `capture --fill`, which stores a source's page text, a step by which `gate evidence` lists the sources behind listed notes, and a question to the user before text is stored (the spec 52 snippet). It is not built either.

## Findings

**F1. Agents are the unit of cost. Judgment.** In the two earlier runs every agent took in 26,000 to 68,000 tokens of input that was not read from cache, and the Seed and Verify agents, which produced 567 to 1,044 tokens of output, took in about 41,000 each (the tests, T1, from the transcripts). By the review, part of that is the first turn writing the cache, and the host's totals come to 48,000 to 54,000 tokens an agent across the runs of 8, 4 and 6 agents.

**F2. Four agents did the question that eight did, for about half the tokens.** Three lean runs with two lanes: 198,937, 203,918 and 199,252 tokens, each with 4 agents, in 125 to 170 seconds. The earlier run of the script on the first of those questions, cut to two lanes and one URL per lane and as it stood before its code review, took 8 agents, 386,515 tokens and 230 seconds (the tests, T3; the later tests, T5 and T6; the earlier runs).

**F3. At four lanes the lean run used 6 agents.** 326,500 tokens and 197 seconds, with four sources captured (the tests, T4). The script was not run at four lanes. Judgment, from its shape: it would start 16 agents for the same four pages. What that would cost is not measured: by the review's reading 400,000 to 600,000 tokens, and by the host's average an agent in F1 about 800,000.

**F4. A program found the quotes, with the fetch tool too.** In T3 and T4 the writer checked 20 quotes and the prototype found all 20 (the tests). By the review, the lanes in those runs fetched with curl and stripped tags themselves, much as the checker does. In T6 the lanes fetched pages only with the WebFetch tool and ran no shell command naming curl or wget, the checker required each quote to sit within one line of the stored text, and all 9 quotes were found (the later tests). Earlier, the 12 sentences that Verify agents had quoted were all found in extracted text (the probes, Q1).

**F5. A found quote is not a judged claim.** By the review, read from the T4 vault: one recorded quote was a fragment whose words occur five times on the page, and its claim added a version number the quote does not hold; the claim went into a note, and the gate's fixes did not name it. In T6 the writer was told to read the lines around each quote and to cut any claim down to what the quote says there; it cut one claim down and filed two unquoted statements as questions (the later tests).

**F6. With writing rules, a run's synthesis passed the gate.** Gate results for one question across three runs: the earlier run's synthesis, whose source held no text, 12 of 32 rows `supported`; the lean run's, 26 of 33, with five fixes that all concern an inference stated as fact; the lean run with writing rules, PASS on the first round, 22 of 22. For the other question: 29 of 40 at four lanes without the rules, and 33 of 34 with the rules and the judging writer, the one failure being "three limits" where the stored page states more (the earlier runs; the tests, T3 and T4; the later tests, T5 and T6). The first of those comparisons is confounded: the earlier run's reviewer said of its draft "No rewording is needed" and asked for the source's text.

**F7. What the gate still caught, before the rules.** No fix in T3 or T4 concerned a missing text. The fixes were of five kinds (the tests): an inference stated as fact in a title, a heading or the body; wording that goes beyond its quote; a rule stated without the exceptions another line of a stored page gives, or something listed as open that a listed source answers; an entry named in the body inside a code span and left out of `contributing_ids`, so the gate did not list it; and the run key named in the draft, which the gate reads as an entry id with no entry. In T5 and T6 the last two did not occur: `check --check` reported nothing uncovered and neither synthesis held its run key (the later tests).

**F8. Lanes overlapped in T4; told to return a page of their own kind, two lanes did not, in two runs.** In T4 three of four lanes returned the same two pages, and by the review the script then kept one lane's claims for each page and discarded the others'. In T5 and T6, with each lane told to return a page of its own kind, the two lanes returned different pages (the tests; the later tests).

**F9. A stored text can be the wrong text.** In T5 the page was a file view on a code host; the fill stored 2,232 bytes of the site's frame. None of that page's three quotes was found, no row was written, and its claims became a question (the later tests).

**F10. In T6 the lean run answered less than its page held.** In T6 the run left two questions open that the stored page answers; it had asked for at most five claims a page (the later tests).

**F11. In one round on one synthesis, trimmed evidence cut the gate's cost and lost two rows.** 38,079 tokens against 94,006 with the sources whole; two rows the whole sources supported were failed, and one row was passed that the other round failed (the tests, T2; the software gate, G4).

## Design

All judgments, resting on the findings named.

1. **Three phases and a fixed number of agents** (F1 to F3). Recon, as now. Research: one agent per lane searches, reads up to two pages of its own kind and returns each page's fields and its claims; it writes nothing. A page two lanes both return is kept once with both lanes' claims (F8). Write: one agent does every write, one command at a time. A run starts two agents plus one per lane.
2. **Every claim carries a quote** (F4, F5). For each claim a Research agent returns one whole sentence copied exactly from the page, and the claim says no more than the quote. For a file on a code host it gives the address of the raw file (F9).
3. **`verify --id <source> --quotes <file>`** (F4, F5). The file is a JSON array of quotes. For each, the command looks for the quote within one line of the source's text, ignoring only differences of white space, quote marks and dash forms. A quote under four words or twenty characters is refused. It prints, for each quote, whether it was found, every line it occurs on, and the lines around the first. For each quote found it appends one row with a new method, `quote-matched`, and a note that begins with the first eight hex digits of the quote's hash; a quote whose hash is already on the source adds nothing, so a repeated or resumed run cannot add a row twice. The text it compares against is:
   - the stored body, when the entry holds one; the row's result is then `inconclusive`, which does not reset freshness;
   - else the page, fetched with the CLI's fetcher and extracted in memory, when `RESEARCH_VAULT_ALLOW_NETWORK` is `1`; the row's result is then `confirmed`. Nothing is stored.

   When a stored body does not hold a quote, the command fetches the page, compares again, and says which text the quote was found in; it does not change the body or `content_hash`. The user has said that fetching a local source again is acceptable when its stored copy is found wanting (the session record).
4. **`quote-matched` means the words are on the page and no more** (F5). The method is added to the taxonomy. `lint` treats a source whose rows are all `captured` or `quote-matched` as it treats a captured-only source today, with `WARN_SOURCE_UNVERIFIED` (the later tests, T5), and `advise` lists such a source as unverified. The reviewer's file is not edited: a ledger row that records a reviewer counts only while that reviewer equals the hash of that file, and a row written before the field keeps standing (`bin/lib/gate.mjs`, quoted by grep in the second lines snippet), so an edit would reopen the recorded verdicts that name a reviewer.
5. **The Write agent judges each claim** (F5). Reading the lines the command prints, it cuts a claim down to what its quote says in that place, or drops it, when the quote sits in a history row, a quoted comment or another section, occurs on several lines with different subjects, or says less than the claim. It lists what it cut and why. A claim with no quote found becomes a question.
6. **Storing text during the run.** Section 1 of the skill asks once: may this run store the text of the pages it reads? On yes the Write agent runs spec 52's `capture --fill` for each source before it checks quotes. On no the quotes are checked against pages fetched in memory. When no quote of a page is found in its stored text, the run's result names that source as holding unusable text (F9).
7. **Writing rules in the Write prompt** (F6, F7). These are the rules tested in T5 and T6, whose full text is in the later tests, with one addition: the rule on counts was added after T6's one failure and is untested.
   - the title, summary and answer state only what a verified quote says; an inference is worded as one or filed as a question;
   - no "only", "nothing except", "always", "never" or "complete", and no count of things, unless a quote says it; where a page gives exceptions to a rule, they are stated;
   - a quote is pasted, not retyped;
   - `contributingIds` lists every entry the body names;
   - the run key does not appear in any entry's body.
8. **A run key that is not shaped like an entry id** (F7): `run-` and six or more letters or digits.
9. **Resuming.** The Write prompt takes the shipped Persist step's rule for plan files: use the highest-numbered plan file that exists and never write over one. The skill says a source captured again with the same URL and subject version comes back as a duplicate (`SKILL.md` line 138, in the lines snippet), and rows are keyed by the quote's hash (point 3).
10. **Section 3, with no Workflow tool,** runs the same three steps inline with the same commands.

## What this gives up

Judgment. Today a second agent reads each page again and judges whether it supports each claim. In the lean run a program confirms the words are on the page and the agent that writes judges each claim against its surroundings; it did not write the claims, but it is one reader, not one per source. F5 shows a claim that slipped through before that step existed. The lean run also asks each lane for a few claims a page and so can leave open what its pages answer (F10).

## What gets built

Each commit passes the repo's checks and carries a changelog line. They follow spec 52's first two commits, since point 3 uses its extractor and point 6 its fill.

**Commit 1. The method `quote-matched`.** The taxonomy value, the regenerated vault instructions, and the `lint` and `advise` lines of point 4. Tests: a source with only `captured` and `quote-matched` rows still gets `WARN_SOURCE_UNVERIFIED`.

**Commit 2. `verify --quotes`.** Tests with an injected fetch and no network: a quote on one line of a stored body adds one `inconclusive` row and a second call adds none; a quote differing only in white space or quote marks is found; a quote that spans two lines is not; a short quote is refused; a quote occurring on three lines reports all three; a quote absent from the stored body and present on the fetched page is reported as found on the page, with the body unchanged; with no stored body and the network variable set the row is `confirmed`; without the variable the command refuses. `SECURITY.md` names the fetch.

**Commit 3. The skill.** The script of points 1, 2 and 5 to 9, and section 3. The script test keeps its present checks and gains two: the script names no phase beyond Recon, Research and Write, and it holds `--quotes`. `docs/RELIABILITY.md` gains the sentences that describe the new steps; the reference doc gains the flag, in the commit spec 52 sets aside for that file.

**After the commits: two runs,** one with two lanes and one with four, on fresh vaults, each followed by one gate round, recorded as an experiment with the host's token figures.

## Not built, and why

All judgments.

- **A separate agent to judge claims.** The review ranks it first. T6 had the Write agent do the judging at no extra agent; if gates show claims slipping through, a judging agent is one more agent a run, not one per source.
- **Trimmed evidence for the reviewer** (F11). It saved 60% of a round and wrongly failed 2 rows of 19. Once rows record the line each quote was found at, a packet can be built from those lines. It is the next thing to measure.
- **Verdicts remembered per claim.** It needs a new kind of ledger row and is a spec of its own.
- **More claims a page** (F10). Five was the prototype's number. Raising it trades tokens for coverage and was not measured.
- **Running the script as it is at four lanes,** to replace F3's estimate with a figure.
- **Keeping the Verify agents as an option.** One path is cheaper to keep right than two.

## Done when

1. `npm test` passes with the new tests, and the repo's other checks pass.
2. In each of the two runs the script starts two agents plus one per lane; every verification row the run adds is `quote-matched`; no entry's body holds the run key; and `check --check` on the synthesis reports nothing uncovered.
3. Each run's token total and gate verdict are recorded beside the figures of F2, F3 and F6. No figure is promised.

## Limits of this spec

Four lean runs, on two questions about one project's documentation, with one gate round each and no second reviewer run. Every page but one was one the CLI's fetcher could read, and text was stored in every run; a run without stored text was not made. T5 and T6 differ from T3 and T4 in several ways at once, so the gain in F6 cannot be given to one rule. The prototype's `quotes` command is not the proposed `verify --quotes`, and no row in the tests carried the method `quote-matched`. Two lanes were the most the rules were tried with. The reading of the user's message as leave to fetch local sources again is the orchestrator's.
