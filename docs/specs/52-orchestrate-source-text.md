# Spec 52: page text in the sources the orchestrate skill captures (2026-11-14)

The research-orchestrate skill captures each source by URL with no text. In the one gate round run on a synthesis resting on such a source, the gate failed, and the skill closes questions only after the gate passes. This spec proposes how a run stores page text when the user allows it. Nothing in it is built. This is the spec as revised after an adversarial review of its first draft.

The spec rests on seven vault entries:

- The snippet 2026-11-14-spec-52-lines ("the lines snippet") quotes the skill and code at commit c342f09.
- The experiment 2026-11-14-orchestrate-source-text-probes ("the experiment") holds probes T1 to T7.
- The experiment 2026-11-14-spec-52-second-probes ("the second experiment") holds probes U1 to U5, made for this revision.
- The experiment 2026-11-14-orchestrate-skill-live-runs ("the live runs") holds two runs of the skill and the gate on the first run's synthesis.
- The snippet 2026-11-14-spec-52-adversarial-review ("the review") holds the report of the adversarial review. It is a report; where this spec relies on a point of it that no probe here repeats, it says "by the review".
- The snippet 2026-11-14-orchestrate-repair-session-record-part-three ("the session record") holds the question put to the user about this spec and the user's answer.
- The experiment 2026-11-14-reliability-doc-further-probes holds the run behind the sentence on repeated URLs under "Not built".

A sentence about the code cites a snippet or a grep in an experiment. A sentence about behaviour cites an experiment. A sentence marked "Judgment" is this spec's choice.

## What exists

**The skill.** At c342f09 the Seed agent captures each source with `capture --type source --title ... --url ...` and no `--content-file` or `--store-body` (`skills/research-orchestrate/SKILL.md` line 75). Its prompt reads two results beginning "duplicate of" and has no line for one beginning "ambiguous of" (lines 77 to 82). The Fetch prompt says "Do NOT run capture, verify or any command that writes to the vault" (line 70). The script's `args` are `question`, `cli`, `vault`, `today` and `runKey` (line 46). Section 4 closes a question "Only after the gate records `PASS` or `MERIT`", and says that if the gate does not pass the session shows the verdict and leaves the questions open. All of this is in the lines snippet.

**Storing text.** `capture` appends the given content to a source's body only when `storeBody` is set, and refuses `storeBody` without `ackDataEgress`, with the message "storing source text is a data-egress / copyright surface" (`bin/commands/capture.mjs` lines 30, 31 and 118, in the lines snippet). The content hash is the hash of the content file's bytes when one is given (line 41; the experiment, T1).

**What the gate sees.** `gate evidence` marks a source or a note whose body is shorter than 200 characters as `no-body` (`bin/lib/gate.mjs` lines 245, 246 and 300, in the lines snippet). The page of T1, captured with a content file and no `--store-body`, is marked `no-body`; captured with `--store-body --ack-data-egress`, it is not (the experiment, T1 and T2). A stored body under 200 characters would still be marked (line 300).

**What `refresh` compares.** `refresh` fetches the source's URL and reports `confirmed` when the hash of what it fetched equals the entry's `content_hash`, `changed` when it differs, and `unreachable` on an HTTP status of 400 or above or a fetch error (`bin/commands/refresh.mjs` lines 41 to 47, in the lines snippet).

**A changed page at a known URL.** When a URL already in the vault is captured again under the same subject version with content of different bytes, `capture` exits 1 with a line that begins "ambiguous of" and names the existing id. With the same bytes, or with no content, the line begins "duplicate of" (the second experiment, U1).

**The reviewer hash.** A ledger row counts only when its `reviewer` field is absent or equals the hash of `agents/claims-reviewer.md` as it stands (`bin/lib/gate.mjs` lines 27, 31 and 35; the second experiment, U3).

## Findings

**F1. The gate failed on a source with no text.** In the first live run the one source was listed `[source, active, no-body]` and the reviewer's verdict was FAIL-as-sent, with 19 of 32 claim rows marked `exceeds-evidence`. Its first fix reads "The draft's wording already matches the refetched verification lines exactly. Fix: re-capture the source with `--store-body --ack-data-egress`. No rewording is needed." No question was closed (the live runs).

**F2. On the one page probed, raw HTML was poor evidence and heavy.** One documentation page is 277,237 bytes of HTML, and the entry that stores it is 277,806 bytes. A sentence the reviewer would look for, "recursive option will be ignored", is on no line of that entry, because the word `recursive` sits inside a `code` element. The same page as extracted text is 108,211 bytes and holds the sentence on one line (the experiment, T1, T4 and T6).

**F3. The hash must stay the hash of the page's bytes.** With extracted text as the content file, the entry's `content_hash` is the hash of the text, and `refresh` reports `changed` for a page that has not changed. With the raw bytes as the content file, `refresh` reports `confirmed` (the experiment, T3 and T4). By the review, curl's bytes hashed the same as the CLI fetcher's on 8 of 10 real pages, and the other two pages differed between two fetches by the same client.

**F4. By the review, text written out by a worker may not be the page.** By the review, and inferred there: a worker that read the page through a fetch tool saw that tool's rendering, and a model copying 100,000 bytes drifts into summary, which a reviewer cannot tell from the page. In the two live runs, two worker results say they fetched "with curl" (the experiment, T7). The repo already turns HTML into text with regular expressions, in `bin/lib/lesson.mjs` (the second experiment, U4).

**F5. Most sources already in this vault have under 200 characters of body.** Of the 610 source entries in the bound vault, 345 have under 200 characters after the frontmatter (the second experiment, U2). A repeated URL under the same subject version is refused, with a line beginning `duplicate of` or `ambiguous of`, and keeps the entry it has (U1; the experiment 2026-11-14-reliability-doc-further-probes, R7).

## Design

All judgments, resting on the findings named.

1. **Ask once per run, default no.** Section 1 of the skill gains one question: may this run store the text of the pages it reads in the vault? The question says what that means: the text is copied into source entries, which travel wherever the vault goes: if the vault is kept in git, to its remote. The answer is passed to the script as `args.storeText`. It is not saved anywhere, so the next run asks again (F1; the refusal message quoted under "What exists").
2. **The worker saves bytes; the CLI makes the text** (F2, F3, F4). When `storeText` is true, each Fetch agent runs `curl -sL --max-filesize 5000000 -o <run directory>/page-<i>.html <url>` and returns the file's path, or nothing if curl fails. That file is the one write a Fetch agent may make. The session creates the run directory before the workflow starts.
3. **One new flag on `capture`: `--extract-text`.** With `--content-file`, `--store-body` and `--ack-data-egress`, it stores the content as text: `script` and `style` elements dropped, tags replaced by spaces, entities decoded, runs of blank lines collapsed. `content_hash` is still the hash of the file's bytes, as it is today, so `refresh` keeps working. If the extracted text is over 300,000 bytes the command refuses and names the size; no text is cut short, since a truncated page would make "the page does not say X" look checkable when it is not.
4. **The Seed agent** captures a source that has a page file with `--content-file <file> --store-body --ack-data-egress --extract-text`. Its prompt gains two readings:
   - a line beginning "ambiguous of `<id>`": the page is in the vault and its bytes have changed since. Reuse that id, store nothing, and report the source as changed;
   - a refusal for size: capture again without the four flags, and report the source as having no text.

   When it has finished, it deletes every page file of the run, captured or not, so no second copy of any page stays on disk.
5. **When the answer is no,** nothing changes in the run, and section 4 tells the user before the gate that the sources hold no text and the gate is likely to fail for that reason (F1).
6. **What this does not reach** (F5). A source already in the vault keeps the body it has. On a topic researched before, the gate can fail as in F1 for those sources, and section 4 names them.

## What gets built

Each commit passes the repo's checks and carries a changelog line.

**Commit 1. `--extract-text` in `bin/commands/capture.mjs`,** with the size refusal. Tests: a page whose sentence spans a `code` element is stored with the sentence on one line; the entry's `content_hash` is the hash of the HTML bytes; text over the ceiling is refused and nothing is written. The reference doc gains the flag.

**Commit 2. The skill.** `args.storeText`; the question in section 1 and the run directory in section 0; the Fetch prompt's curl line and its one permitted write; the Seed prompt's flags, its two new readings and the deletion; the sentences of points 5 and 6 in section 4. The script builds the four flags in one constant that is empty when `storeText` is false, and the script test asserts that `--store-body` occurs once in the script, in that constant. `docs/RELIABILITY.md` gains a sentence on the page files.

**After the commits: one live run** with `storeText` true on a throwaway vault, then `gate evidence` on its synthesis and one gate round, recorded as an experiment.

## Not built, and why

All judgments.

- **Letting the reviewer take a verification row's quoted line as evidence.** The review proposes it: the Persist step already writes each confirmed observation into the source's verification notes, so the reviewer could accept those lines with no stored text at all, and it would cover sources already in the vault. Two reasons against. Changing `agents/claims-reviewer.md` changes the reviewer hash, and every ledger row recorded under the old hash stops counting (the second experiment, U3), so every file whose counting rows carry that hash would need a new verdict. And the quotes would be chosen by the run that wrote the draft, so a claim would be checked against the lines its own workers picked rather than against the page.
- **Text for sources already in the vault** (F5). It needs a way to add a body to an existing source with a record of the consent, which `capture` refuses for a known URL under the same subject version (the experiment 2026-11-14-reliability-doc-further-probes, R7); by the review, nothing else offers one but a hand edit. It is the larger half of the problem in this vault and deserves its own spec.
- **A fetcher inside `capture --type source`.** The CLI fetches for `refresh` and for bulk ingest and could fetch here, sparing the worker the curl line. It is a second change to the same command; the curl line costs nothing and, by the review, the bytes hashed the same on 8 of the 10 pages it tried (F3).
- **A vault setting that remembers the answer.** Consent to copy text out of a page is per run and per topic; a remembered yes would apply to pages the user has not thought about.
- **Keeping the page files when the answer is no,** so text could be stored later without fetching again. A file of page text on disk is the copy the question asks about.

## Done when

1. `npm test` passes with the new tests and the changed script test, and the repo's other checks pass.
2. In the live run with `storeText` true, `gate evidence` lists no source that the run created as `no-body`; `refresh --id` reports `confirmed` for each created source whose page hashes the same on two curl fetches; no `page-*.html` file is left in the run directory; and the gate's verdict, whatever it is, is recorded with its table.

## Open questions for the user

1. Is 300,000 bytes of text the right ceiling? It is a guess from one page of 108,211 bytes (F2). By the review, ten such bodies are about a megabyte for the reviewer to read, and `search --body` would match them on almost any word.
2. Should the spec for sources already in the vault (F5) come before this one is built? It covers more than half of this vault's sources.

## Limits of this spec

One page was probed for size and for the `code` element problem. The text in T4 was made by a few lines of Python, not by the flag this spec proposes. The 8 of 10 figure is the review's, not a run recorded here. Whether a Workflow worker always has a shell with curl is not shown; two worker results in two runs say they used it. The user's go-ahead for writing this spec is the orchestrator's reading of the session record.
