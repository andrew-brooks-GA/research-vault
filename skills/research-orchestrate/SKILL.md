---
name: research-orchestrate
description: Use when entering a fresh research task — a question that needs new external research, not yet at retrieval/citation/capture — and a research vault resolves (via .research-vault.json, $RESEARCH_VAULT_PATH, the config pointer, or the OS default). Owns the end-to-end research workflow — vault-first lookup, web fan-out, eager source capture, the §2.6 capture plan, and a lint-gated synthesis — and supersedes generic deep-research skills in vault-bound contexts. For retrieval/citation from the vault use research-vault-usage; for single-entry persistence use research-capture.
---
# Orchestrating research into the vault
<!-- evidence: 2026-11-17-document-lines-research-orchestrate-skill-names -->

The reference implementation of `docs/ORCHESTRATOR-INTEGRATION.md`. Durable conclusions land as atomic vault entries — sources, notes, questions, snippets, experiments, synthesis — never as a monolithic report. Reports are views; the vault is the system of record.

## Invariants

Keep these after a compaction; the section named holds the detail.

- Check the vault first: search it before any web research, and when fresh entries cover the question and no covering `source` is unverified, answer from the vault and stop (§1).
- Append `--vault <absolute vault>` to every CLI call, including reads (§0).
- The Recon and Research workers write no entry; only the Write step writes to the vault, one command at a time. Run no two captures at once on one vault (§0, §2).
- Run `capture --fill` only if the user agreed to store page text (§1, §2, §3).
- A returned id is not evidence that anything was captured: confirm each id is a file in the vault, then run `lint` with the explicit vault: clean, or explain every warning (§4, Close out).
- Run the `research-claims-gate` skill on the synthesis entry file before you present it to the user (§4, Close out).
- Close a question with `verify --id <question> --answered-by <synthesis id>` only after the gate records `PASS` or `MERIT`; if the gate does not pass, show its verdict and leave the questions open (§4, Close out).
- Offline or fetch-blocked, do not fabricate: answer from the vault and record what could not be verified as open `question` entries (§4, Close out).

## 0. Resolve paths once
<!-- evidence: 2026-11-17-cli-lines-behind-research-orchestrate-skill 2026-11-17-document-lines-research-orchestrate-skill-names 2026-11-17-probe-cli-behaviour-research-orchestrate-skill 2026-11-17-third-lines-behind-research-orchestrate-skill -->

- CLI: `node "${CLAUDE_PLUGIN_ROOT}/bin/research-vault.mjs"`. Resolve `${CLAUDE_PLUGIN_ROOT}` to an absolute path now — do not rely on workers inheriting it.
- Resolve the selected vault to an absolute canonical path once. Pass both CLI and vault explicitly to every worker; append `--vault <absolute vault>` to every CLI call, including reads. Vault path resolves in order: `--vault` flag → the repo's `.research-vault.json` binding (which outranks the env var) → `$RESEARCH_VAULT_PATH` → the global config pointer → the OS default (see "Where the vault lives" in `docs/REFERENCE.md`). A binding can name a vault outside its folder when acknowledged with `research-vault trust` (`init --project` acknowledges the binding it writes), or when it matches the user's `RESEARCH_VAULT_PATH`, config pointer or OS default under the [binding rule](../../SECURITY.md#repository-bindings). If discovery refuses the binding (exit 2), report it and stop before dispatching workers; do not copy its raw vault value into `--vault` or set `RESEARCH_VAULT_PATH` to bypass the refusal.
- Make a run key now, new for every run and reused only to resume that run: `run-` and six or more letters or digits, for example `run-apfk3x`. It names the run's plan files and capture operations. It is not shaped like an entry id, and it never appears in an entry's body: the citation check reads a `<date>-<slug>` in prose as an entry id.
- Today's date for `args.today` is the UTC date, `YYYY-MM-DD`: the CLI dates entries in UTC, and the Write step builds ids from it.

You, the session running this skill, are the controller: the Recon and Research workers search, fetch and read, and return what they found without writing an entry; only the Write step writes to the vault, one command at a time. Source captures run outside the capture lock, so run no two captures at once on one vault.

## 1. Clarify, then check the vault first
<!-- evidence: 2026-11-17-cli-lines-behind-research-orchestrate-skill 2026-11-17-document-lines-research-orchestrate-skill-names 2026-11-17-probe-cli-behaviour-research-orchestrate-skill 2026-11-17-third-lines-behind-research-orchestrate-skill -->

1. If the question is underspecified (no version, environment, or success criterion), ask 2–3 narrowing questions before researching.
2. Search the vault (`search --topic`, `--text`, `--body`). If fresh entries (per §2 of research-vault-usage) already cover the question and no covering `source` is unverified (`advise` lists it under unverified sources, or every method in its `verifications` is `captured` or `quote-matched`), answer from the vault and stop; otherwise treat it as partial coverage. If coverage is partial, note the gap — it becomes a `question` entry or the workflow's focus.
3. Interview the user once, before any agent starts, in one set of questions:
   - **Kinds of source** (`args.lanes`, any number; each kind chosen is one lane). Offer every kind that could bear on the question and recommend the widest set that fits it: official documentation and standards; published style guides, books and long-form writing by recognised practitioners; community posts, practitioner writeups and critiques; release notes and changelogs; issue trackers and bug reports; peer-reviewed empirical studies. Add a kind the question calls for that is not in this list.
   - **Breadth** (`args.pagesPerLane`): two pages a lane, or four. Say that the wider run costs more: every further page is read by a lane agent and its quotes are checked and judged by the Write agent.
   - **Page text** (`args.storeText`): may this run store the text of the pages it reads in their source entries? Stored text lets the claims gate read the page, and it is a copy of someone else's page in the vault.

   Word `args.question` to ask what those kinds of source say. Do not add a requirement the user did not state, such as that a practice must rest on a measurement: what a style guide, a book or a tool's documentation recommends is a finding, reported with who makes it. With no user to ask (a subagent, a headless run), pass every kind listed above, two pages a lane, and `storeText` `false`.

## 2. Run the workflow
<!-- evidence: 2026-11-17-cli-lines-behind-research-orchestrate-skill 2026-11-17-document-lines-research-orchestrate-skill-names 2026-11-17-probe-cli-behaviour-research-orchestrate-skill 2026-11-17-third-lines-behind-research-orchestrate-skill 2026-11-17-lines-behind-orchestrate-page-slot-plan 2026-11-17-second-lines-behind-orchestrate-page-slot 2026-11-17-second-trial-planned-skill-edits-widened 2026-11-17-probe-orchestrate-reference-script-stub-hooks 2026-11-17-second-probe-orchestrate-page-slot-plan 2026-11-17-quote-verify-gate-lines-research-vault 2026-11-17-probe-capture-verify-capture-operation-gate 2026-11-17-trial-planned-edits-issue-77-state 2026-11-17-capture-operation-lines-research-vault-issue 2026-11-17-probe-capture-fill-verify-quotes-real 2026-11-17-lines-behind-plan-issue-73-at 2026-11-17-probe-issue-73-sentences-raw-file 2026-11-17-second-probe-issue-73-review-findings 2026-11-17-trial-issue-73-one-agent-runs 2026-11-17-second-trial-issue-73-one-agent 2026-11-17-capture-dedup-advise-pair-lines-issue 2026-11-17-working-tree-probe-issue-72-items -->

Read [`${CLAUDE_PLUGIN_ROOT}/skills/research-orchestrate/workflow`](workflow) and pass its text, adapted to the question, as the Workflow tool's script. Pass absolute paths and the run key via `args` — never rely on env vars inside the script. A returned object that matches a schema is not evidence that anything was captured or checked: ids come from the capture output, and section 4 checks them.

A run that reaches the Write step starts two agents plus one per lane. Every `agent()` call in the script names its model, `model: 'opus'`, the model the claims reviewer is pinned to; keep it on every call when you adapt the script.

| Phase | Does |
|---|---|
| Recon | Map existing vault coverage, gaps and open questions |
| Research | One agent per lane, a lane being one kind of source the user chose in section 1: search, read up to `args.pagesPerLane` pages of the lane's own kind, and return each page's fields and up to eight claims, each with one whole sentence quoted exactly from the page. No writes |
| Write | One agent, told to run one command at a time: capture each `source`, a page marked `maybeSameAs` only when the quote check says it is another document or the page the mark names has no source or failed; store its page text if the user agreed; check every quote with `verify --quotes`; judge each claim against the lines around its quote; search the stored text for a sentence that answers each question it would leave open, and add it as a quoted claim; walk the §2.6 four prompts; `capture --batch` the plan with `--operation-id`; `lint` |

A program, not an agent, confirms that each quoted sentence is on its page. A quote found is recorded on the source as a `quote-matched` row, which says the words are on the page and no more: the Write agent is the one reader that judges whether a claim says what its quote says there.

The script writes nothing itself and takes no id from a worker's memory: source ids come from the Write agent's capture output and are checked again when the plan is captured, which refuses a reference to an id that is not in the vault. A returned id is still only as good as the agent that copied it, so section 4 starts by checking them. A source the result marks "text unusable" is one where none of its quotes was found in its stored text or on its fetched page: the text or the quotes may be at fault, so a person looks before anything is discarded (`capture --fill <id> --discard` is for a person to run). A page marked `maybeSameAs` gets no source of its own when more than half of its quotes are found in the text of the page the mark names, as the Write step is told (a trial run, one agent, did so with three of four quotes found): the Write step is told to file its claims under that page's source, and a source row with the reason "same document as page ..." says so. A PDF source answers `no-text` when its bytes hold a zero byte, as the one PDF probed did: a person who needs its text converts the paper to a `.md` file and runs `capture --fill <id> --content-file <file> --ack-data-egress`.

## 3. Degraded mode and recovery
<!-- evidence: 2026-11-17-cli-lines-behind-research-orchestrate-skill 2026-11-17-document-lines-research-orchestrate-skill-names 2026-11-17-probe-cli-behaviour-research-orchestrate-skill 2026-11-17-third-lines-behind-research-orchestrate-skill 2026-11-17-lines-behind-orchestrate-page-slot-plan 2026-11-17-second-lines-behind-orchestrate-page-slot 2026-11-17-second-trial-planned-skill-edits-widened 2026-11-17-probe-orchestrate-reference-script-stub-hooks 2026-11-17-second-probe-orchestrate-page-slot-plan 2026-11-17-lines-behind-plan-issue-73-at 2026-11-17-probe-issue-73-sentences-raw-file 2026-11-17-second-probe-issue-73-review-findings 2026-11-17-trial-issue-73-one-agent-runs 2026-11-17-second-trial-issue-73-one-agent -->

With no Workflow tool, run the same three steps inline and sequentially, as the only writer: vault search → web search and fetch, keeping for each page up to eight claims with one whole quoted sentence each → then the Write step's numbered steps as written in the script linked from §2, with the same commands: one `capture --type source` per kept URL, `capture --fill` only if the user agreed, `verify --id <source> --quotes <file> --by-id research-orchestrate` for each source, the judging of each claim against the lines around its quote, the coverage step over stored text, the §2.6 plan under the writing rules, `capture --batch` with `--operation-id <run key>-plan-1` under the Persist rules, and `lint`. The parallelism is lost. The script's address repair does not run here either, so do it by hand: give an `http://` address with no port in its `https://` form, unless it has a `user:password@` part, and pass no `--subject-version` for an address whose path has a floating segment (`latest`, `master`, `main`, `stable`, `current`, `head`, `nightly`, `dev` or `trunk`). The script's mark for one document at two addresses does not run here either: when two kept pages on different hosts have the same last path segment, less its extension, and the same subject version or none on both, and that name is not "index" or "readme", check the second page's quotes against the first page's source before you capture the second. If more than half are found, capture no second source, judge the second page's claims from that output and file them under the first source; otherwise capture the second page as usual.

To resume an interrupted run, use its run key and its plan files: take the highest-numbered plan file that exists and never write a new plan over an existing file.

- **`LOCK_BUSY`** (check this first; by the code, the report also carries `recoveryStateCreated` true when a receipt for that operation id is already there): another `--operation-id` capture holds `<vault>/.capture-operations/writer.lock`, or one died holding it. Read `owner.json` in that directory if it is there and confirm that process is gone; only then remove the lock directory and run the original command again. Never remove a lock because it is old.
- **`RECEIPT_IO` or `INPUT_CHANGED`**: stop, and report the error and `<vault>/.capture-operations/<operation id>.json`.
- **Capture stopped part-way** (neither of those two codes, and `recoveryStateCreated` true, or the receipt `<vault>/.capture-operations/<operation id>.json` exists and its `phase` is not `complete`): run the same command again with the same plan file, the same operation id and the same flags. Do not correct the plan under that id.
- **Capture refused the plan** (neither of those two codes, `recoveryStateCreated` false and no receipt for that operation id): correct the plan and capture it as the next file under the next operation id.
- **Sources, fills and quote checks** are safe to run again with the same values: a URL already in the vault under the same subject version comes back as a duplicate with its id (the same URL with another subject version, or with none where one was recorded, is not a duplicate: it is captured as a new entry when its title gives an id that is free), a fill of a source that already holds text answers `kept`, and `verify --quotes` adds no row for a quote whose hash is already on the source.

If `WARN_SYNTHESIS_NO_NOTE_COVERAGE` or `WARN_SYNTHESIS_MONOLITHIC` fires after persistence, either decompose further or declare `synthesis_basis: primary-rollup`, only if it honestly is a factual rollup. To decompose, capture the added notes as a new plan under a new operation id, then edit the existing synthesis in place with research-authoring; never capture a changed synthesis again under its id. Keep the run's directory under `.research-tasks` until the user asks for cleanup. The lock covers `--operation-id` captures only; nothing here protects against another writer editing the same entries, so stop for review if an entry changed under you.

## 4. Close out
<!-- evidence: 2026-11-17-cli-lines-behind-research-orchestrate-skill 2026-11-17-document-lines-research-orchestrate-skill-names 2026-11-17-probe-cli-behaviour-research-orchestrate-skill 2026-11-17-third-lines-behind-research-orchestrate-skill -->

These are the controller's completion checks. Keep four results apart when you report: what the evidence supports, what was persisted, the lint result, and the claims verdict.

1. Confirm each id the workflow returned is a file in the vault, then run `lint` with the explicit vault — clean, or explain every warning.
2. Run the `research-claims-gate` skill on the synthesis entry file (evidence derives from the entry ids its body cites; that skill lists the sources behind the notes and asks before it stores page text for those that hold none; when this run stored page text, its step 1b can cut the first round's evidence to a packet with this run's key), then present it to the user the way you would tell a colleague: the answer, why, how confident, and what is still open (question ids).
3. Only after the gate records `PASS` or `MERIT`, close each question the synthesis actually resolves: `verify --id <question> --answered-by <synthesis id>`. If the gate does not pass, show its verdict and leave the questions open. List the ids created and reused.
4. Offline or fetch-blocked? Do not fabricate: answer from the vault, record what could not be verified as open `question` entries, and say so.

## Anti-patterns (from ORCHESTRATOR-INTEGRATION.md)
<!-- evidence: 2026-11-17-document-lines-research-orchestrate-skill-names -->

Monolithic report files; source→synthesis with no notes (unless a declared `primary-rollup`); "I don't know" as prose instead of a `question`; reusable fragments inline instead of `snippets/`; stub notes written only to silence the lint.

Keep the normal final answer format. Show a replay command or a resume instruction only when work failed or is unfinished; a successful run needs no receipt dump.
