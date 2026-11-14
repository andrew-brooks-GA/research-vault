---
name: research-orchestrate
description: Use when entering a fresh research task — a question that needs new external research, not yet at retrieval/citation/capture — and a research vault resolves (via .research-vault.json, $RESEARCH_VAULT_PATH, the config pointer, or the OS default). Owns the end-to-end research workflow — vault-first lookup, web fan-out, eager source capture, the §2.6 capture plan, and a lint-gated synthesis — and supersedes generic deep-research skills in vault-bound contexts. For retrieval/citation from the vault use research-vault-usage; for single-entry persistence use research-capture.
---
# Orchestrating research into the vault
<!-- evidence: 2026-11-14-orchestrate-skill-live-runs 2026-11-14-reliability-doc-probes -->

The reference implementation of `docs/ORCHESTRATOR-INTEGRATION.md`. Durable conclusions land as atomic vault entries — sources, notes, questions, snippets, experiments, synthesis — never as a monolithic report. Reports are views; the vault is the system of record.

## 0. Resolve paths once

- CLI: `node "${CLAUDE_PLUGIN_ROOT}/bin/research-vault.mjs"`. Resolve `${CLAUDE_PLUGIN_ROOT}` to an absolute path now — do not rely on workers inheriting it.
- Resolve the selected vault to an absolute canonical path once. Pass both CLI and vault explicitly to every worker; append `--vault <absolute vault>` to every CLI call, including reads. Vault path resolves in order: `--vault` flag → the repo's `.research-vault.json` binding (which outranks the env var) → `$RESEARCH_VAULT_PATH` → the global config pointer → the OS default (see README's "Where the vault lives").
- Make a run key now, new for every run and reused only to resume that run: `run-` and six or more letters or digits, for example `run-apfk3x`. It names the run's plan files and capture operations. It is not shaped like an entry id, and it never appears in an entry's body: the citation check reads a `<date>-<slug>` in prose as an entry id.
- Today's date for `args.today` is the UTC date, `YYYY-MM-DD`: the CLI dates entries in UTC, and the Write step builds ids from it.

You, the session running this skill, are the controller: the Recon and Research workers search, fetch and read, and return what they found without writing an entry; only the Write step writes to the vault, one command at a time. Two captures at once on one vault collide.

## 1. Clarify, then check the vault first

1. If the question is underspecified (no version, environment, or success criterion), ask 2–3 narrowing questions before researching.
2. Search the vault (`search --topic`, `--text`, `--body`). If fresh entries (per §2 of research-vault-usage) already cover the question, answer from the vault and stop. If coverage is partial, note the gap — it becomes a `question` entry or the workflow's focus.
3. Ask the user once: may this run store the text of the pages it reads in their source entries? Stored text lets the claims gate read the page, and it is a copy of someone else's page in the vault. Pass the answer as `args.storeText`. With no user to ask (a subagent, a headless run), pass `false`.

## 2. Run the workflow

Use the Workflow tool with the reference script below, adapted to the question. Pass absolute paths and the run key via `args` — never rely on env vars inside the script. A returned object that matches a schema is not evidence that anything was captured or checked: ids come from the capture output, and section 4 checks them.

A run starts two agents plus one per lane.

| Phase | Does |
|---|---|
| Recon | Map existing vault coverage, gaps and open questions |
| Research | One agent per lane (official docs, release notes, issue trackers, community): search, read up to two pages of the lane's own kind, and return each page's fields and up to eight claims, each with one whole sentence quoted exactly from the page. No writes |
| Write | One agent, one command at a time: capture each `source`; store its page text if the user agreed; check every quote with `verify --quotes`; judge each claim against the lines around its quote; search the stored text for a sentence that answers each question it would leave open, and add it as a quoted claim; walk the §2.6 four prompts; `capture --batch` the plan with `--operation-id`; `lint` |

A program, not an agent, confirms that each quoted sentence is on its page. A quote found is recorded on the source as a `quote-matched` row, which says the words are on the page and no more: the Write agent is the one reader that judges whether a claim says what its quote says there.

```javascript
export const meta = {
  name: 'research-orchestrate',
  description: 'Vault-conformant research: one reader per lane, quotes checked by a program, one writer',
  phases: [{ title: 'Recon' }, { title: 'Research' }, { title: 'Write' }],
}
// args: { question, cli, vault, today, runKey, storeText } — cli = absolute path to research-vault.mjs, vault absolute.
const CLI = `node "${args.cli}" `
const V = ` --vault "${args.vault}"`
const RUN = `${args.vault}/.research-tasks/${args.runKey}`
const NET = `RESEARCH_VAULT_ALLOW_NETWORK=1 `
const QUOTE = `Pass every value as one single-quoted shell argument, writing a single quote inside it as '\\''.`
const PAGES = { type: 'object', required: ['pages'], properties: { pages: { type: 'array', items: { type: 'object', required: ['url', 'title', 'domain', 'topics', 'authorityTier', 'authorityBasis', 'summary', 'claims'], properties: { url: { type: 'string' }, title: { type: 'string' }, domain: { type: 'string' }, topics: { type: 'string' }, authorityTier: { type: 'string' }, authorityBasis: { type: 'string' }, summary: { type: 'string' }, subjectName: { type: 'string' }, subjectVersion: { type: 'string' }, claims: { type: 'array', items: { type: 'object', required: ['claim', 'quote'], properties: { claim: { type: 'string' }, quote: { type: 'string' } } } } } } } } }
const WRITTEN = { type: 'object', required: ['status', 'lint'], properties: { status: { type: 'string', enum: ['complete', 'failed'] }, sources: { type: 'array', items: { type: 'object', required: ['i', 'status'], properties: { i: { type: 'integer' }, status: { type: 'string', enum: ['captured', 'reused', 'failed'] }, sourceId: { type: 'string' }, fill: { type: 'string' }, quotesChecked: { type: 'integer' }, quotesFound: { type: 'integer' }, reason: { type: 'string' } } } }, claimsJudged: { type: 'string' }, claimsAdded: { type: 'integer' }, created: { type: 'array', items: { type: 'string' } }, reused: { type: 'array', items: { type: 'string' } }, synthesisId: { type: 'string' }, lint: { type: 'string' }, recovery: { type: 'string' } } }

phase('Recon')
const recon = await agent(`Search the research vault for coverage of: ${args.question}. Read only. Run ${CLI}search with relevant --topic/--text facets and${V}, then for each source found run ${CLI}related <id> --depth 2 --direction in --rel sources,contributing_ids${V} so existing notes and syntheses count as coverage. Also list open question entries on the topic (${CLI}search --type question${V}) with their ids. Return the coverage, the gaps needing web research and those question ids.`, { phase: 'Recon' })

phase('Research')
const lanes = ['official documentation', 'release notes and changelogs', 'issue trackers and bug reports', 'community posts and practitioner writeups']
const researched = (await parallel(lanes.map(l => () =>
  agent(`Web-search ${l} for: ${args.question}. Known gaps: ${recon}. Pick up to two of the most authoritative URLs of that kind, fetch each with your fetch tool and read it; do NOT use curl, wget or any shell command to fetch or process a page. For a file on a code host give the address of the raw file. The official reference pages belong to the official documentation lane only; in any other lane return pages of your lane's own kind, or no page if there is none. Run no command that writes to the vault. Return one page object per URL: its url, a concise title specific to this page, domain and topics (comma-separated), authorityTier and authorityBasis, each a value from the matching list in ${args.vault}/taxonomy.json (domain, authority_tier, authority_basis), summary (the one load-bearing claim), subjectName and subjectVersion if the page is about one version of a tool; and claims: the claims on the page that bear on the question, eight at most. For each claim give claim (one sentence, in your words or the page's) and quote: one whole sentence (never a fragment) copied from the page EXACTLY, character for character, with no markup, that the claim rests on. The claim must say no more than its quote says. The quote will be checked by a program against the page text; a quote that is not on the page makes the claim unverified.`, { phase: 'Research', schema: PAGES, label: `lane:${l}` })
))).filter(Boolean).flatMap(r => r.pages)
// A page two lanes both read is kept once, with both lanes' claims.
const byUrl = new Map()
for (const p of researched) { const seen = byUrl.get(p.url); if (seen) seen.claims.push(...p.claims); else byUrl.set(p.url, { ...p, claims: [...p.claims] }) }
const pages = [...byUrl.values()]
if (!pages.length) { log('no page was returned, so there is nothing to write'); return { recon, pages: [], written: null, runDirectory: RUN } }
let n = 0
const numbered = pages.map((p, i) => ({ i, ...p, claims: p.claims.map(c => ({ n: n++, ...c })) }))
const FILL = args.storeText
  ? `2. Page text. The user has agreed that this run may store page text. For each source from step 1 run: ${NET}${CLI}capture --fill <sourceId> --ack-data-egress --json${V}   It prints one JSON object; keep its result (filled, kept, refused, version-floating, unreachable, no-text or too-large). Never pass --discard, --replace or --content-file.`
  : `2. Page text. The user has not agreed to store page text: run no capture --fill. The fill result of every source is "not stored".`

phase('Write')
const written = await agent(`You are the only writer to the vault right now. Run one command at a time, in this order. ${QUOTE}
1. Sources. For each page below, one after another, run:
${CLI}capture --type source --title <title> --url <url> --domain <domain> --topics <topics> --authority-tier <authorityTier> --authority-basis <authorityBasis> --summary <summary> [--subject-name <subjectName> --subject-version <subjectVersion>]${V}
Never pass --force. Read each result: "created <path>": status captured; the sourceId is the file name without .md. "duplicate of <id> (existing entry with same url ...)": the page is already in the vault; status reused, sourceId is that id. "duplicate of <id> (entry id ... already exists ...)": the TITLE collides with another page; do NOT use that id, make the title more specific and capture again. "blocked source": status failed with the message as reason; do not retry it. An error naming a field and its allowed values: use the closest allowed value and try once more; any other error, or a second failure: status failed.
${FILL}
3. Quotes. For each source from step 1 that is not failed: create the directory ${RUN}, write a file ${RUN}/quotes-<i>.json holding a JSON array of that page's claims as {"n": <n>, "quote": <quote>}, and run ${NET}${CLI}verify --id <sourceId> --quotes ${RUN}/quotes-<i>.json --by-id research-orchestrate --run ${args.runKey}${V}   It prints, per claim, whether the quote is on one line of the source's text (found), where (foundIn: body is the stored text, page is the page fetched now), every line it occurs on, and the lines around the first (context). It records each quote it finds on the source itself and adds nothing for a quote already recorded, so it is safe to run again and you run no other verify command. A claim is VERIFIED only if found is true AND, reading its context, the quote means there what the claim says: if the quote sits in a version-history row, a quoted comment or another section than the claim is about, or occurs on several lines with different subjects, or the claim says more than the quote, then either cut the claim down to what the quote says in that context or treat it as not verified. Keep a list of the claims you cut down or dropped, with the reason. A claim whose quote was not found or was refused is not verified. If NONE of a source's quotes was found, give that source the reason "text unusable"; do not change it, and never run a discard.
3b. Coverage, only for sources whose fill result is filled or kept. Before you plan, write down the questions you would otherwise leave open. For each, search the stored text of this run's sources for a sentence that answers it (for example grep -n -i <word> "${args.vault}/sources/<sourceId>.md"). Where one whole sentence on the page answers it, add a claim with that sentence as its quote, numbered on from the last n, check it with the same verify --quotes command and judge it by the same rule. Add eight claims at most. A claim added in this step appears in the synthesis and in any note ONLY as its exact quote inside quotation marks, introduced by naming the page; never restate it in your own words. A question stays open only if the stored text does not answer it.
4. Plan. Walk AGENTS.md §2.6 for: ${args.question}. Use only the verified claims as support for conclusions. Walk the four prompts: (1) notes distilling load-bearing sources, quoting the verified sentences, (2) questions for every unresolved ambiguity (including every claim that is not verified), (3) experiments only for an empirical run, (4) snippets for reusable fragments. Then ONE synthesis, written for a colleague who reads it once, cold, to decide what to do: the answer first, then what the pages say with each verified claim as a sentence, then the recommendation; summary one sentence; confidence. Its contributingIds name the notes and the source ids, and its body names the source ids it relies on. Sources already exist: reference them, do not recreate them. Every entry carries a body with real prose. An id is ${args.today}-<slug>; the slug is the title in lower case with every character other than a letter or digit turned into a break, the words a, an, the, of, to, in, on, for, and, or, with, is, are, be dropped, and the first six remaining words joined by hyphens. Writing rules, for every entry: (a) the title, the summary and the answer of the synthesis state only what a verified quote says; anything you infer is worded as an inference (for example "by inference from ...") or filed as a question, never stated as fact; (b) do not write only, nothing except, always, never or complete, and give no count of things (two exceptions, the one test, three limits), unless a quote says it; where a page gives exceptions to a rule, state them; (c) you checked quotes, not whole pages: say what is missing as "no checked quote says ...", never as "the pages do not say", "no page ..." or "the page is silent"; of a claim whose quote was not found say only that the quote offered did not match a line of the stored text, never that the text lacks the claim; (d) a statement about several people, pages or posts names the quotes it rests on (two repliers, not the repliers); give no reason (because ...) and no ranking (cheapest, best, most) that no quote states; (e) paste each quote exactly as it stands in PAGES, do not retype it; (f) contributingIds of the synthesis lists every entry id that its body names, questions and snippets included; (g) never write the run key in any entry's body. The plan is a JSON array of capture specs with camelCase keys (type, title, body, sources, contributingIds, topics, domain, summary, confidence, state, question, language, tested, synthesisBasis).
5. Persist. The plan files are ${RUN}/plan-1.json, plan-2.json, plan-3.json; plan-<k>.json is always captured with the operation id ${args.runKey}-plan-<k>. Never write over a plan file that exists. If none exists, write your plan to plan-1.json. Take the highest-numbered plan file that exists and run ${CLI}capture --batch "${RUN}/plan-<k>.json" --operation-id ${args.runKey}-plan-<k>${V}. It prints one JSON object, on exit 1 too. Read it in this order:
- errors is empty and operation.phase is complete: done.
- an error has code LOCK_BUSY: another capture holds the lock, or one died holding it. Stop with status failed and recovery set to the lock path the message names.
- an error has code RECEIPT_IO or INPUT_CHANGED: stop with status failed and recovery set to the error text and the path ${args.vault}/.capture-operations/<operation id>.json.
- recoveryStateCreated is true: entries may already be written. Do not change the plan. Run the identical command once more. If it is still not complete, stop with status failed and recovery set to that exact command and the path ${args.vault}/.capture-operations/<operation id>.json.
- otherwise this call wrote nothing: correct every entry the errors name (each has an index; an entry that names a failed entry is reported too), save the corrected plan as the next file and run that one. Three plan files at most; after plan-3.json fails stop with status failed and the last errors as recovery.
6. Lint. Run ${CLI}lint${V} and keep every line that names an entry this run created.
Return status, sources (one row per page with its i, status, sourceId, fill result, quotesChecked and quotesFound for that source, and a reason where one applies), claimsJudged (one line per claim you cut down or dropped, with its n and the reason, joined into one string), claimsAdded (the number of claims added in step 3b), created (ids from the capture output's created rows), reused (ids from its skipped rows), synthesisId and lint.
PAGES: ${JSON.stringify(numbered)}`, { phase: 'Write', schema: WRITTEN, label: 'writer' })
return { recon, pages: numbered.map(p => ({ i: p.i, url: p.url, claims: p.claims.length })), written, runDirectory: RUN }
```

The script writes nothing itself and takes no id from a worker's memory: source ids come from the Write agent's capture output and are checked again when the plan is captured, which refuses a reference to an id that is not in the vault. A returned id is still only as good as the agent that copied it, so section 4 starts by checking them. A source the result marks "text unusable" holds a text in which none of its quotes was found: the text or the quotes may be at fault, so a person looks before anything is discarded (`capture --fill <id> --discard` is for a person to run).

## 3. Degraded mode and recovery

With no Workflow tool, run the same three steps inline and sequentially, as the only writer: vault search → web search and fetch, keeping for each page up to eight claims with one whole quoted sentence each → then the Write step's numbered steps as written in §2, with the same commands: one `capture --type source` per kept URL, `capture --fill` only if the user agreed, `verify --id <source> --quotes <file> --by-id research-orchestrate` for each source, the judging of each claim against the lines around its quote, the coverage step over stored text, the §2.6 plan under the writing rules, `capture --batch` with `--operation-id <run key>-plan-1` under the Persist rules, and `lint`. Only the parallelism is lost.

To resume an interrupted run, use its run key and its plan files: take the highest-numbered plan file that exists and never write a new plan over an existing file.

- **`LOCK_BUSY`** (check this first; the report can carry `recoveryStateCreated` true as well): another `--operation-id` capture holds `<vault>/.capture-operations/writer.lock`, or one died holding it. Read `owner.json` in that directory if it is there and confirm that process is gone; only then remove the lock directory and run the original command again. Never remove a lock because it is old.
- **Capture stopped part-way** (`recoveryStateCreated` true, or the receipt `<vault>/.capture-operations/<operation id>.json` exists and its `phase` is not `complete`): run the same command again with the same plan file, the same operation id and the same flags. Do not correct the plan under that id.
- **Capture refused the plan** (`recoveryStateCreated` false and no receipt for that operation id): correct the plan and capture it as the next file under the next operation id.
- **Sources, fills and quote checks** are safe to run again with the same values: a URL already in the vault under the same subject version comes back as a duplicate with its id (the same URL with another subject version, or with none where one was recorded, is captured as a new entry), a fill of a source that already holds text answers `kept`, and `verify --quotes` adds no row for a quote whose hash is already on the source.

If `WARN_SYNTHESIS_NO_NOTE_COVERAGE` or `WARN_SYNTHESIS_MONOLITHIC` fires after persistence, either decompose further or declare `synthesis_basis: primary-rollup`, only if it honestly is a factual rollup. To decompose, capture the added notes as a new plan under a new operation id, then edit the existing synthesis in place with research-authoring; never capture a changed synthesis again under its id. Keep the run's directory under `.research-tasks` until the user asks for cleanup. The lock covers `--operation-id` captures only; nothing here protects against another writer editing the same entries, so stop for review if an entry changed under you.

## 4. Close out

These are the controller's completion checks. Keep four results apart when you report: what the evidence supports, what was persisted, the lint result, and the claims verdict.

1. Confirm each id the workflow returned is a file in the vault, then run `lint` with the explicit vault — clean, or explain every warning.
2. Run the `research-claims-gate` skill on the synthesis entry file (evidence derives from its `contributing_ids` and `sources`; that skill lists the sources behind the notes and asks before it stores page text for those that hold none; when this run stored page text, its step 1b can cut the first round's evidence to a packet with this run's key), then present it to the user the way you would tell a colleague: the answer, why, how confident, and what is still open (question ids).
3. Only after the gate records `PASS` or `MERIT`, close each question the synthesis actually resolves: `verify --id <question> --answered-by <synthesis id>`. If the gate does not pass, show its verdict and leave the questions open. List the ids created and reused.
4. Offline or fetch-blocked? Do not fabricate: answer from the vault, record what could not be verified as open `question` entries, and say so.

## Anti-patterns (from ORCHESTRATOR-INTEGRATION.md)

Monolithic report files; source→synthesis with no notes (unless a declared `primary-rollup`); "I don't know" as prose instead of a `question`; reusable fragments inline instead of `snippets/`; stub notes written only to silence the lint.

Keep the normal final answer format. Show a replay command or a resume instruction only when work failed or is unfinished; a successful run needs no receipt dump.
