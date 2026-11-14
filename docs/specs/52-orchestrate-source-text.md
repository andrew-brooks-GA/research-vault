# Spec 52: page text for the sources behind a gated draft (fourth revision, 2026-11-14)

In the gate rounds run so far on a synthesis that states what a page says, the gate failed when the source held no page text. This revision replaces the design pushed as a4ace68 and the second revision that followed it. It gives an answer, with the measurement, code line or reply it rests on, to each point those drafts left open, and proposes three changes: the gate lists the sources behind the notes a draft cites; one command fills a source that has no text; and the claims-gate skill asks before it runs that command. Three adversarial reviews shaped it. This fourth revision adds four changes that spec 54 named after a fourth review (S15 to S18 and design points 6 and 7), and records the user's answer to the decision the third revision left open (S14).

The spec rests on fifteen vault entries:

- The experiment 2026-11-14-source-text-gate-b ("the A/B experiment") holds three gate rounds on one test synthesis, with and without stored page text.
- The experiment 2026-11-14-source-text-decision-probes ("the probes") holds Q1 to Q4: quote survival under extraction, a survey of this vault's sources with no text, the hashes they carry, and how much research rests on them.
- The experiment 2026-11-14-source-text-revision-three-probes ("the later probes") holds V1 to V5 and two gate rounds, G1 and G2, on one real synthesis in copies of the vault.
- The experiment 2026-11-14-source-text-software-synthesis-gate ("the software gate") holds two more rounds, G3 and G4, on a second real synthesis.
- The snippet 2026-11-14-spec-52-revision-three-lines ("the lines snippet") and the snippet 2026-11-14-spec-52-revision-two-lines ("the earlier lines snippet") quote the code and docs at a4ace68.
- The snippet 2026-11-14-spec-52-revision-two-adversarial-review ("the second review") and the snippet 2026-11-14-spec-52-revision-three-adversarial-review ("the third review") hold the review of the second revision and the review of an earlier text of this one.
- The snippet 2026-11-14-orchestrate-repair-session-record-part-four ("the session record") holds the user's messages and an earlier review of which path to take ("the path review").
- The experiment 2026-11-14-orchestrate-skill-live-runs ("the live runs") holds the gate on a live run's synthesis.
- The experiment 2026-11-14-spec-52-second-probes ("the earlier probes") holds U1, on a known URL captured again.
- The experiment 2026-11-14-seven-limits-tests ("the later tests") holds W1 to W3: a file view on a code host, discarding a stored text, and a saved copy.
- The experiment 2026-11-14-spec-54-review-checks-raw-markdown ("the checks") holds R1, quotes against a raw Markdown file.
- The snippet 2026-11-14-spec-54-design-review-report ("the fourth review") holds the review of spec 54's first draft.
- The snippet 2026-11-14-orchestrate-repair-session-record-part-seven ("the later session record") holds the user's answer on building this spec.

A sentence about the code or docs cites a snippet. A sentence about behaviour cites an experiment. A sentence marked "Judgment" is this spec's choice. The reviews are reports; a point taken from one that no probe here repeats is marked as theirs.

## What exists

**The reviewer's rule.** `agents/claims-reviewer.md` tells the reviewer to read "only the draft and those entries" on its list (line 10). It says an entry flagged `no-body` "supports only the claim that the document exists and concerns the subject" (line 18), and that an entry "whose only verification is `captured`, supports only a hedged claim" (line 14). All three are in the lines snippet.

**The evidence list.** `gate evidence` builds its list from the ids found in the draft's text plus any passed as `--extra` (`bin/lib/gate.mjs` lines 259 and 283, in the lines snippet). It does not add the sources a listed note names (the later probes, G1).

**The skills.** Step 1 of the research-claims-gate skill runs `gate evidence` for every gated draft, step 0 names `--store-body --ack-data-egress` as the way to keep a source's text, and step 3 says to "capture the missing source with a body" (lines 20, 21 and 34). Section 4 of the orchestrate skill runs that skill on the synthesis and closes a question "Only after the gate records `PASS` or `MERIT`" (lines 147 and 148). Both are in the lines snippet.

**Storing text.** `docs/REFERENCE.md` line 184 says `--store-body` "needs `--ack-data-egress`" and that "a single capture never fetches the URL itself" (the lines snippet). `capture` refuses `storeBody` without `ackDataEgress` and appends content to the body only with `storeBody` (`bin/commands/capture.mjs` lines 30, 31 and 118, in the earlier lines snippet). `capture --batch` over a URL list does fetch, and stores the fetched text as it came (lines 176 to 179, in the lines snippet). A single `capture` of a URL already in the vault under the same subject version is refused (the earlier probes, U1).

**`refresh`.** `SECURITY.md` says of it: "Hash-only", it "computes the SHA-256 of the raw bytes", and "Never mutates" (lines 95 and 96). It reports `changed` when that hash differs from `content_hash` (`bin/commands/refresh.mjs` lines 43 and 45). Both are in the lines snippet. For a `changed` result with `storedBody` true the research-verify skill says to compare the page's text with the stored body (line 8, in the earlier lines snippet).

**`verify`.** It appends a verification row; it refuses the method `captured`, and the function quoted never writes `content_hash` (`bin/commands/verify.mjs` lines 25 and 36). A row resets an entry's freshness only when its result is `confirmed` or `changed-trivially` (`bin/lib/manifest.mjs` line 16). Both are in the lines snippet.

**The reviewer hash.** A ledger row counts only when its `reviewer` is absent or equals the hash of `agents/claims-reviewer.md` (`bin/lib/gate.mjs`, quoted by grep in the lines snippet).

## What was settled

**S1. Does stored text make the gate pass?** It makes statements about a page checkable; it does not make a draft pass. Three cases:

- A test synthesis of verbatim quotes: without the text, FAIL-as-sent with 12 of 14 rows `exceeds-evidence`; with it, 11 of 12 `supported` and one sentence `contradicted` by the page; with that sentence corrected, PASS (the A/B experiment).
- A real synthesis in software-engineering: as the gate lists it today, 2 of 16 rows `supported` and 14 `exceeds-evidence`, each because a note is captured-only. With its notes' sources listed and 6 of 8 filled, 10 of 21 `supported`; of the 10 `exceeds-evidence` rows, 4 rest on the two pages the fill could not read and 4 find that a stored page says less than the draft (the software gate, G3 and G4).
- A real synthesis in learning: with its notes' sources listed and 3 of 10 filled, 15 of 21 `supported` and 6 `exceeds-evidence`; as listed today, 7 fixes, none about a source's text (the later probes, G1 and G2).

All four real rounds returned FAIL-as-sent.

**S2. Do the gate's lists reach the sources at all?** Mostly not. `gate evidence` lists a source for 10 of this vault's 36 syntheses, and a no-body source for 7. 26 list notes and no source. With the sources of each listed note added, 31 reach a no-body source; the median number of sources reached is 12, and the median number of no-body sources reached is 8 (the later probes, V1).

**S3. Can the CLI's fetcher get the text?** For 78% of the 343 active no-body sources overall: 267 gave 500 bytes of text or more (the probes, Q2). Among the domains with more than two such sources it runs from 97% in llm-assisted-dev (32 of 33) to 68% in learning (88 of 129) (the later probes).

**S4. Is extracted text good evidence?** On the two pages tested, all 12 sentences the live runs' workers quoted are on one line of the extracted text, and 8 of them cannot be found in the raw HTML (the probes, Q1). The prototype left named entities such as `&rsquo;` undecoded on other pages (the later probes, V5).

**S5. Which hash?** The bytes'. Two fetches a few seconds apart gave different bytes for 19 of 62 sampled sources and the same extracted text for 61 (the later probes, V2). The second review proposes hashing the text and teaching `refresh` to do the same. Judgment: `SECURITY.md` promises that `refresh` hashes raw bytes and nothing else, so the fill stores the text and the bytes' hash and `refresh` is not changed. The cost, by the third review: on a host whose bytes differ at every fetch, `refresh` reports a filled source as `changed` each time it comes due, and the user's step is the research-verify skill's, compare the text and record `changed-trivially`.

**S6. What of a source that already carries a different hash?** Replace it when the entry has no text. 24 of the 26 hashed no-body sources hash differently today, 22 of them captured through a fetch tool (the probes, Q3). By the second review, read from the code, `verify` cannot replace a hash and a second capture is refused, so reporting such a source as changed would strand it. Judgment: with no stored text there is nothing to compare, so the fill stores the text and the new hash and keeps the old hash in its row's note.

**S7. What of a source pinned to a version?** Refuse when its URL floats. 130 of the 267 carry a subject version, and 30 of those have `master`, `latest`, `main` or `stable` as a path segment (the later probes, V3). Judgment: the page fetched today may be another version's.

**S8. What row does the fill leave?** Method `refetched-source`, result `inconclusive`. Judgment: the page was fetched again and no claim was checked. The result does not count toward freshness (the lines snippet, `manifest.mjs` line 16). The method matters because, by the third review, a filled source whose only rows are `captured` would still support only a hedged claim under the reviewer's line 14.

**S9. What ceiling?** 300,000 bytes of text. For the 267: median 8,057, 95th percentile 62,459; 4 are over (the probes, Q2).

**S10. What does it cost a gate round?** On the test synthesis, 2,100 to 2,800 more reviewer tokens against a 264,049-byte body (the A/B experiment). On the two real syntheses, 83,517 tokens with 17 entries listed against 31,335 with 5, and 94,006 with 12 against 24,740 with 4 (the later probes; the software gate). The survey fetched 343 URLs in 51 seconds (the probes, Q2).

**S11. Which command, and where is the question asked?** `capture`, since `refresh` is promised never to change an entry. The question belongs in the research-claims-gate skill, which runs `gate evidence` for every gated draft (the second review, A7). Judgment: `agents/claims-reviewer.md` is not edited, because that changes the hash under which ledger rows count.

**S12. Is the gate itself consistent?** Not fully. On claims resting on the same two notes, G1 marked two sentences `supported` that G2 marked `exceeds-evidence`, and G1 marked three details `unsupported` that G2 did not list (the later probes). This spec does not address it.

**S13. Is the full build worth it against the smaller option?** The third review ranks a smaller option first, the listing step plus an instruction to the orchestrate Plan step to cite source ids, with no fill, and names the fact that would change its ranking: how many failing rows rest on a source that could have been filled. Judgment: G3 and G4 answer it for one software-engineering synthesis. Listing alone would have put eight no-body sources on that list; with six filled, eight more rows were supported and four rows now fail on a comparison with a stored page rather than on a captured-only note.

**S14. May a command change an existing source entry?** Yes, by the orchestrator's reading of the user's reply to the question of building this spec, "go with your recommendations" (the later session record). Three conditions hold: an explicit flag, `--ack-data-egress`, and only an entry whose text after the title line is under the gate's 200 characters.

**S15. What of a file view on a code host?** The fetcher reads the raw file. Fetching such an address as given stored 2,232 bytes with no line holding the word looked for; fetching the raw file stored 251,797 bytes with it (the later tests, W1). By the fourth review, a fill that fetched the raw file while `refresh` fetched `source_url` would make `refresh` report `changed` every time. Judgment: the rewrite goes into the fetcher, so the fill, `refresh` and the URL-list path read the same bytes.

**S16. What of a Markdown file?** It is stored as a reader sees it. Of 40 sampled list lines of a raw Markdown changelog, the form a reader sees matched a line of the raw text 0 times and matched 40 times once links, emphasis marks, code marks and escapes were removed; the reader's form was the orchestrator's approximation, and no quote from a fetch tool was tried (the checks, R1).

**S17. How is a wrong stored text removed?** By `--discard`, run by a person. In the prototype a discard put the source back to `no-body` (the later tests, W2). By the fourth review a discard that removes the hash can lose a hash the fill replaced, and a discard run because no quote was found can delete correct text when the quotes were at fault. Judgment: the discard restores what the fill's row recorded, writes its own row, and no skill gives it to an agent.

**S18. What of a page the fetcher cannot read?** `--content-file` takes a saved copy. The extractor turned a saved HTML file into its text (the later tests, W3); the form itself was not tried. By the fourth review a hash taken from a saved file would never match what `refresh` fetches, and the flag in an agent's hands is a path from any local text file into the vault. Judgment: it leaves `content_hash` alone, takes four file types, and appears in no skill text given to an agent.

## Design

All judgments, resting on the settled points named.

1. **`gate evidence` lists the sources behind listed notes** (S2). For each note on the list it adds the entries the note's `sources` field names, once each, marked as it marks any entry. One step only. Where a note names another note, as 8 of 746 such values in this vault do by the third review, that note is listed and its own sources are not followed.
2. **`capture --fill <id> --ack-data-egress`** (S3 to S9, S14). One id per call. It needs `RESEARCH_VAULT_ALLOW_NETWORK=1`. It prints one result, and with `--json` one object; it exits 0 on `filled` or `kept` and 1 otherwise. For an address of the form `https://github.com/<owner>/<repo>/blob/<ref>/<path>` the fetcher reads the raw file's address, without query or fragment, for every caller, and the result names the address read (S15); `source_url` is not changed, and the blocklist is checked against both addresses.
   - `kept`: the text after the title line is 200 characters or more. Nothing is changed.
   - `refused`, with the reason: the entry is not a source, is not active, is blocked by the vault's blocklist, or its URL is not https.
   - `version-floating`: the entry carries a subject version and its URL has `latest`, `master`, `main`, `stable`, `current`, `head`, `nightly`, `dev` or `trunk` as a path segment (S7).
   - `unreachable`: an HTTP status of 400 or above, or a fetch error.
   - `no-text`: the bytes are binary, or the text is under 200 characters.
   - `too-large`: the text is over 300,000 bytes (S9).
   - `filled`: the body becomes the title line and the text; `content_hash` becomes the hash of the fetched bytes; `updated` is set; and one verification row is added as in S8, with a note that begins `filled:` and gives the date, the text's size and any hash it replaced (S5, S6).
3. **`--replace`, for a fill that stored the wrong thing.** By the third review, a login wall or an error page served with status 200 is stored as `filled`, and afterwards every fill answers `kept`. With `--replace`, an entry whose last `filled:` row is its newest verification row is filled again. It never touches a body that no fill wrote.
4. **One extractor**, used by the fill and by `capture --batch` over a URL list, which today stores the text as it came (S4). It folds line breaks outside `pre` and keeps `pre` as it is, drops `script`, `style`, `template`, `svg` and `noscript`, turns block tags into line breaks, drops other tags, decodes numeric references and a table of common named entities, decodes the bytes by the page's declared charset, and decompresses a gzip body before any of that. Plain text is stored as it is, except a file whose path ends in `.md`: a link is reduced to its text, and emphasis marks, code marks and backslash escapes are removed (S16). The hash is always of the bytes as fetched; 4 of the 10 sources the survey counted as binary were gzip (the later probes, V4).
5. **The research-claims-gate skill, after step 1** (S11). If the list holds a `no-body` source and a user is present, the session asks once for that gate: may it fetch those pages and store their text in the vault? The question gives the count and the hosts, and says the text is copied into source entries, which go wherever the vault goes. In a subagent, a Workflow agent or a headless run it does not ask and the answer is no. On yes it runs the fill for each such source, one command at a time, runs `gate evidence` again, and reports each source's result. It does not ask again for the gate's second round. On no it says which claims are likely to fail for want of text and continues. Section 4 of the orchestrate skill needs no step of its own.
6. **`capture --fill <id> --discard`** (S17). It applies to an entry whose latest row among the `filled:`, `filled-from-file:` and `discarded:` rows is a fill's. The body becomes the title line; `content_hash` goes back to what the `filled:` row says it was, or is removed when that row says there was none, and is left alone after a `filled-from-file:` row; one row is added, method `human-spot-check`, result `inconclusive`, with a note that begins `discarded:`. Any other entry is `refused`. It needs no network and no skill names it to an agent.
7. **`capture --fill <id> --content-file <file> --ack-data-egress`** (S18). The text comes from the file through the extractor of point 4, with the results `kept`, `refused`, `no-text`, `too-large` and `filled` as in point 2. The file's name must end in `.html`, `.htm`, `.txt` or `.md`. `content_hash` is left as it is; the row is method `human-spot-check`, result `inconclusive`, with a note that begins `filled-from-file:` and gives the file's name, its hash and the text's size. It needs no network and no skill names it to an agent. `--replace` applies to it as to a fetched fill.

## What this buys, and what it does not

Judgment, from S1, S3, S12 and S13. Statements of what a page says become checkable against the page, for sources the fetcher can read: most of the software and tooling research in this vault, about two thirds of the rest. A failing row then names a gap between the draft and a page, where today it names a note's missing verification. A draft whose sources are papers behind a 403 gains little. No draft is made to pass, and two reviewer runs can still disagree.

## What gets built

Each commit passes the repo's checks and carries a changelog line.

**Commit 1. The extractor, `capture --fill` with `--replace`, and the URL-list path.** Tests with an injected fetch and no network: every result of point 2; an entry with 200 characters of text is byte-identical after `kept`; a replaced hash is in the row's note; the row does not change the entry's last-verified date; `--replace` refills an entry a fill wrote and refuses one it did not; a sentence spanning a `code` element lands on one line; `pre` is kept; a named entity from the table is decoded; a gzip body is read; a URL-list capture with `--store-body` stores text; a file view is fetched as the raw file and the entry's address is unchanged; a `.md` file is stored without link and emphasis syntax; `--discard` restores a replaced hash, writes its row and refuses a body no fill wrote; `--content-file` stores extracted text, leaves `content_hash` alone and refuses other file types. By the third review a test in `test/batch.test.mjs` asserts the raw form today and must change with it. `SECURITY.md` names the new network use.

**Commit 2. `gate evidence` and its sources-of-notes step.** Tests: a draft citing only a note lists the note's sources; a source listed twice appears once; a note named by a note is listed and not followed; `--changed` keeps working.

**Commit 3. The skills and `docs/RELIABILITY.md`.** The step of point 5 in the research-claims-gate skill, with its steps 0 and 3 pointing to the fill for a source already in the vault; one sentence in section 4 of the orchestrate skill; one sentence in the research-verify skill on a filled source that `refresh` reports as changed (S5); two sentences in `docs/RELIABILITY.md`.

**Commit 4. `docs/REFERENCE.md`.** Line 184's sentence that a single capture never fetches is rewritten, and the flags are added. By the second review this commit can be made separately, on the machine that holds that file's ledger rows; by the third review, no test checks `docs/REFERENCE.md` for capture flags and the only coupling of `capture.mjs` to it is `operation-id`.

**After the commits: one run.** In a copy of this vault, gate the two syntheses of G1 to G4 through the changed skill, and record each fill result and each verdict as an experiment.

## Not built, and why

All judgments.

- **A text hash in `refresh`** (S5), for the promise in `SECURITY.md`. The third review argues for changing that promise; it is the first thing to revisit if `changed` on filled sources becomes a nuisance.
- **A request header asking for an uncompressed response.** By the third review it would change what `refresh` fetches for every source, and a hash taken from a gzip response would stop matching.
- **A discard run by an agent, and raw-file rules for hosts other than the one met** (S15, S17).
- **A sweep that fills every source.** The fill is per source on a gate's list.
- **Changing what the reviewer accepts,** such as a verification row's quoted line. By the path review, the run would then grade its own quotes; and the reviewer file's hash would change (S11).
- **Anything for S12.** Reviewer runs disagreeing is a property of the gate, not of the sources.
- **The design pushed as a4ace68.** By the path review it depends on a worker having curl and leaves sources already in the vault untouched.

## Done when

1. `npm test` passes with the new tests, and the repo's other checks pass.
2. In the copy, every source on each gate's list has one of the seven results of point 2; `gate evidence` afterwards flags `no-body` only for sources whose result was not `filled` or `kept`; no entry outside those lists has changed; and each verdict is recorded with its table.

## Limits of this spec

The pass in S1 is one page and one synthesis written for the test. G1 to G4 are two real syntheses, one reviewer run each; the host attached a security warning to G1's report, and the vault was unchanged after it. The extractor is a prototype tried for quotes on two pages. The survey is one fetch per URL on one day from one network, and its 500-byte line is not the design's 200-character one. By the third review, adding notes' sources makes the Codex review runner refuse more drafts, since it refuses a list holding a stale entry. By the second review, the same source filled on two machines on different days can hold different text and a different hash, and the ledger does not record which evidence a verdict saw. Of the fourth revision's additions, the raw-file rule and the discard were tried in a prototype once each, the Markdown rule rests on an approximation of the rendered page, and the saved-file form was not tried.
