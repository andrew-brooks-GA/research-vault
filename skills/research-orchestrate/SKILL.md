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
- Make a run key now, new for every run and reused only to resume that run: letters, digits, `-` and `_`, for example `2026-11-14-apf-k3`. It names the run's plan files and capture operations.
- Today's date for `args.today` is the UTC date, `YYYY-MM-DD`: the CLI dates entries in UTC, and the Plan step builds ids from it.

You, the session running this skill, are the controller: workers search, fetch and judge, and return what they found without writing an entry; only the Seed and Persist steps write entries to the vault, each one command at a time. Two captures at once on one vault collide.

## 1. Clarify, then check the vault first

1. If the question is underspecified (no version, environment, or success criterion), ask 2–3 narrowing questions before researching.
2. Search the vault (`search --topic`, `--text`, `--body`). If fresh entries (per §2 of research-vault-usage) already cover the question, answer from the vault and stop. If coverage is partial, note the gap — it becomes a `question` entry or the workflow's focus.

## 2. Run the workflow

Use the Workflow tool with the reference script below, adapted to the question. Pass absolute paths and the run key via `args` — never rely on env vars inside the script. A returned object that matches a schema is not evidence that anything was captured or verified: ids come from the capture output, and section 4 checks them.

| Phase | Does |
|---|---|
| Recon | Map existing vault coverage, gaps and open questions |
| Sweep | Parallel multi-modal search: official docs, release notes, issue trackers, community |
| Fetch+Seed | Fetch in parallel with no writes; then one agent captures each `source` eagerly, one CLI call per source, and returns the id the CLI gave |
| Verify | Adversarial check of each source's load-bearing claims — fetched, not recalled; tool-bearing claims also probed per `meta/prompt-templates/probe-tool.md` when a manifest exists. No writes |
| Plan | Walk the §2.6 four prompts; emit the batch plan JSON (notes, questions, snippets, experiments, synthesis) |
| Persist | One agent: record the confirmed verifications, `capture --batch` the plan with `--operation-id`, then `lint` |

```javascript
export const meta = {
  name: 'research-orchestrate',
  description: 'Vault-conformant research: fan-out, serial source capture, batched distillation',
  phases: [
    { title: 'Recon' }, { title: 'Sweep' }, { title: 'Fetch+Seed' },
    { title: 'Verify' }, { title: 'Plan' }, { title: 'Persist' },
  ],
}
// args: { question, cli, vault, today, runKey } — cli = absolute path to research-vault.mjs, vault absolute.
const CLI = `node "${args.cli}" `
const V = ` --vault "${args.vault}"`
const RUN = `${args.vault}/.research-tasks/${args.runKey}`
const QUOTE = `Pass every value as one single-quoted shell argument, writing a single quote inside it as '\\''.`
const URLS = { type: 'object', required: ['urls'], properties: { urls: { type: 'array', items: { type: 'object', required: ['url', 'why'], properties: { url: { type: 'string' }, why: { type: 'string' } } } } } }
const PROPOSAL = { type: 'object', required: ['url', 'title', 'domain', 'topics', 'authorityTier', 'authorityBasis', 'summary', 'claims'], properties: { url: { type: 'string' }, title: { type: 'string' }, domain: { type: 'string' }, topics: { type: 'string' }, authorityTier: { type: 'string' }, authorityBasis: { type: 'string' }, summary: { type: 'string' }, subjectName: { type: 'string' }, subjectVersion: { type: 'string' }, claims: { type: 'array', items: { type: 'string' } }, snippets: { type: 'array', items: { type: 'string' } } } }
const SEEDED = { type: 'object', required: ['sources'], properties: { sources: { type: 'array', items: { type: 'object', required: ['i', 'status'], properties: { i: { type: 'integer' }, url: { type: 'string' }, status: { type: 'string', enum: ['captured', 'reused', 'failed'] }, sourceId: { type: 'string' }, reason: { type: 'string' } } } } } }
const VERDICTS = { type: 'object', required: ['verdicts'], properties: { verdicts: { type: 'array', items: { type: 'object', required: ['n', 'verified'], properties: { n: { type: 'integer' }, verified: { type: 'boolean' }, method: { type: 'string', enum: ['refetched-source', 'cross-referenced', 'tool-probe'] }, observation: { type: 'string' } } } } } }
const PLAN = { type: 'object', required: ['planJson'], properties: { planJson: { type: 'string' } } }
const PERSISTED = { type: 'object', required: ['status', 'lint'], properties: { status: { type: 'string', enum: ['complete', 'failed'] }, created: { type: 'array', items: { type: 'string' } }, reused: { type: 'array', items: { type: 'string' } }, synthesisId: { type: 'string' }, verificationsRecorded: { type: 'array', items: { type: 'string' } }, lint: { type: 'string' }, recovery: { type: 'string' } } }

phase('Recon')
const recon = await agent(`Search the research vault for coverage of: ${args.question}. Read only. Run ${CLI}search with relevant --topic/--text facets and${V}, then for each source found run ${CLI}related <id> --depth 2 --direction in --rel sources,contributing_ids${V} so existing notes and syntheses count as coverage. Also list open question entries on the topic (${CLI}search --type question${V}) with their ids. Return the coverage, the gaps needing web research and those question ids.`, { phase: 'Recon' })

phase('Sweep')
const lanes = ['official documentation', 'release notes and changelogs', 'issue trackers and bug reports', 'community posts and practitioner writeups']
const swept = (await parallel(lanes.map(l => () =>
  agent(`Web-search ${l} for: ${args.question}. Known gaps: ${recon}. Return the 2-4 most authoritative URLs. Run no command that writes to the vault.`, { phase: 'Sweep', schema: URLS, label: `sweep:${l}` })
))).filter(Boolean).flatMap(r => r.urls)
const found = [...new Map(swept.map(u => [u.url, u])).values()]

phase('Fetch+Seed')
const fetched = await parallel(found.map((u, i) => () =>
  agent(`Fetch ${u.url} (relevant to: ${u.why}) and read it. Do NOT run capture, verify or any command that writes to the vault. Return what a source entry for this page needs: its url exactly as given, a concise title specific to this page, domain and topics (comma-separated), authorityTier and authorityBasis, each a value from the matching list in ${args.vault}/taxonomy.json (domain, authority_tier, authority_basis), summary (the one load-bearing claim), subjectName and subjectVersion if the page is about one version of a tool; and claims: the claims on the page that bear most on: ${args.question}, five at most, one sentence each, as the page states it.`, { phase: 'Fetch+Seed', schema: PROPOSAL, label: `fetch:${i}` })
))
const proposals = fetched.filter(Boolean)
if (proposals.length < found.length) log(`${found.length - proposals.length} of ${found.length} fetches returned nothing; those URLs are not in this run`)
const seeded = proposals.length ? await agent(`You are the only writer to the vault right now. For each source below, one after another and never two at once, run:
${CLI}capture --type source --title <title> --url <url> --domain <domain> --topics <topics> --authority-tier <authorityTier> --authority-basis <authorityBasis> --summary <summary> [--subject-name <subjectName> --subject-version <subjectVersion>]${V}
${QUOTE} Use the values as given. Never pass --force.
Read each result:
- "created <path>": status captured; sourceId is the file name without .md.
- "duplicate of <id> (existing entry with same url ...)": the page is already in the vault. Status reused; sourceId is that id.
- "duplicate of <id> (entry id ... already exists ...)": the TITLE collides with a different page. Do NOT use that id. Make the title more specific to this page and capture again.
- "blocked source: ...": the vault's owner has blocked this URL. Status failed with the message as reason; do not retry it.
- an error naming a field and its allowed values: use the closest allowed value and try once more; any other error, or a second failure: status failed with the message as reason.
Return one row per source below, with its i.
SOURCES: ${JSON.stringify(proposals.map(({ claims, snippets, ...spec }, i) => ({ i, ...spec })))}`, { phase: 'Fetch+Seed', schema: SEEDED, label: 'seed' }) : { sources: [] }
// Rows are matched by position, not by url: an agent may hand a url back in another spelling.
const idByUrl = Object.fromEntries((seeded?.sources || []).filter(s => s.sourceId && s.status !== 'failed' && proposals[s.i]).map(s => [proposals[s.i].url, s.sourceId]))
const seededClaims = proposals.filter(p => idByUrl[p.url]).map(p => ({ sourceId: idByUrl[p.url], url: p.url, claims: p.claims, snippets: p.snippets || [] }))
const unseeded = proposals.filter(p => !idByUrl[p.url]).map(p => p.url)
if (unseeded.length) log(`not captured, so their claims are not verified or cited: ${unseeded.join(', ')}`)
if (!seededClaims.length) {
  log('no source was captured, so there is nothing to verify, plan or persist')
  return { recon, sources: seeded?.sources || [], unseeded, verdicts: [], persisted: null, runDirectory: RUN }
}

phase('Verify')
let n = 0
const claims = seededClaims.flatMap(s => s.claims.map(claim => ({ n: n++, claim, url: s.url, sourceId: s.sourceId })))
const judged = (await parallel(seededClaims.map((s, i) => () =>
  agent(`Adversarially verify each numbered claim below against the live source ${s.url} (re-fetch it; model recall is NOT verification). If a claim concerns a tool with a manifest under ${args.vault}/meta/probe-manifests/, also run the matching read-only probe command from ${args.vault}/meta/prompt-templates/probe-tool.md and give its output as the observation, with method tool-probe; capture nothing. Default verified=false if uncertain. Do NOT run capture, verify or any command that writes to the vault. Return one verdict per claim: its n, verified, the method, and observation: the sentence or output you saw, in one line.
CLAIMS: ${JSON.stringify(claims.filter(k => k.sourceId === s.sourceId).map(({ n, claim }) => ({ n, claim })))}`, { phase: 'Verify', schema: VERDICTS, label: `verify:${i}` })
))).filter(Boolean).flatMap(r => r.verdicts)
// A claim with no verdict, or a verdict with no method or observation, is not verified.
const verdicts = claims.map(k => { const v = judged.find(j => j.n === k.n); return { ...k, verified: !!(v && v.verified && v.method && v.observation), method: v?.method, observation: v?.observation } })

phase('Plan')
const plan = await agent(`You are walking AGENTS.md §2.6 for: ${args.question}.
Verdicts on the claims (only verified=true supports a conclusion): ${JSON.stringify(verdicts)}. Sources in the vault with the claims read from them: ${JSON.stringify(seededClaims)}. Sources that could not be captured: ${JSON.stringify(unseeded)}.
Walk the four prompts: (1) notes distilling load-bearing sources, (2) questions for every unresolved ambiguity (including every unverified claim), (3) experiments for any empirical run cited as evidence, (4) snippets for reusable fragments. Then ONE synthesis (cross-source claims + recommendation, with summary and confidence) whose contributingIds reference the notes (and other entries) by their deterministic ids (${args.today}-<slug>; the slug is the title in lower case with every character other than a letter or digit turned into a break, the words a, an, the, of, to, in, on, for, and, or, with, is, are, be dropped, and the first six remaining words joined by hyphens). Sources already exist in the vault — reference, do not recreate.
Every entry MUST carry a body field with real prose. Notes: load-bearing claims + caveats + how-I'd-use. Snippets: usage context + fenced code block + caveats. Questions: why it matters + what would answer it. Synthesis: written for a colleague who reads it once, cold, to decide what to do: the answer first, then the reasoning in paragraphs with each checked claim (research-vault-usage §4) as a sentence, then the recommendation; detail stays in the notes. summary stays ONE sentence — the substance lives in body. Return planJson: a JSON array string for capture --batch using camelCase capture opts keys (type, title, body, sources, contributingIds, topics, summary, confidence, state, question, language, tested, synthesisBasis...).`, { phase: 'Plan', schema: PLAN })

phase('Persist')
const persisted = plan ? await agent(`You are the only writer to the vault right now. Run one command at a time, in this order.
1. Verifications. For each verdict below with verified true: its marker is research-run:${args.runKey}:claim:<n>: with the colon after the number. If the file ${args.vault}/sources/<sourceId>.md already contains that marker, skip it. Otherwise run ${CLI}verify --id <sourceId> --method <method> --result confirmed --by-id research-orchestrate --notes <marker, a space, then the observation>${V}. ${QUOTE} Record nothing for a verdict with verified false.
2. The plan. The plan files are ${RUN}/plan-1.json, plan-2.json, plan-3.json; plan-<k>.json is always captured with the operation id ${args.runKey}-plan-<k>. Never write over a plan file that exists. If none exists, create the directory and write the PLAN below to plan-1.json unchanged. Take the highest-numbered plan file that exists and run ${CLI}capture --batch "${RUN}/plan-<k>.json" --operation-id ${args.runKey}-plan-<k>${V}. It prints one JSON object, on exit 1 too. Read it in this order:
- errors is empty and operation.phase is complete: done.
- an error has code LOCK_BUSY: another capture holds the lock, or one died holding it. Stop with status failed and recovery set to the lock path the message names.
- an error has code RECEIPT_IO or INPUT_CHANGED: stop with status failed and recovery set to the error text and the path ${args.vault}/.capture-operations/<operation id>.json.
- recoveryStateCreated is true: entries may already be written. Do not change the plan. Run the identical command once more. If it is still not complete, stop with status failed and recovery set to that exact command and the path ${args.vault}/.capture-operations/<operation id>.json.
- otherwise this call wrote nothing: correct every entry the errors name (each has an index; an entry that names a failed entry is reported too), save the corrected plan as the next file and run that one. Three plan files at most; after plan-3.json fails stop with status failed and the last errors as recovery.
3. Lint. Run ${CLI}lint${V} and keep every line that names an entry this run created.
Return status, created (ids from the capture output's created rows), reused (ids from its skipped rows), synthesisId, verificationsRecorded (the markers written or found already present), and lint.
VERDICTS: ${JSON.stringify(verdicts)}
PLAN: ${plan.planJson}`, { phase: 'Persist', schema: PERSISTED, label: 'persist' }) : null
return { recon, sources: seeded?.sources || [], unseeded, verdicts, persisted, runDirectory: RUN }
```

The script writes nothing itself and takes no id from a worker's memory: source ids come from the Seed agent's capture output and are checked again when the plan is captured, which refuses a reference to an id that is not in the vault. A returned id is still only as good as the agent that copied it, so section 4 starts by checking them.

## 3. Degraded mode and recovery

With no Workflow tool, run the same lifecycle inline and sequentially, as the only writer: vault search → web search and fetch → one `capture --type source` per kept URL, reading each result as the Seed step does → verification of each load-bearing claim, recorded with the marker and `--by-id` as the Persist step does → walk §2.6 → write the plan to `<vault>/.research-tasks/<run key>/plan-1.json` → `capture --batch` it with `--operation-id <run key>-plan-1` under the Persist step's rules → `lint`. Only the parallelism is lost. Write the synthesis body as the Plan step in §2 describes.

To resume an interrupted run, use its run key and its plan files; never write a new plan over an existing file.

- **`LOCK_BUSY`** (check this first; the report can carry `recoveryStateCreated` true as well): another `--operation-id` capture holds `<vault>/.capture-operations/writer.lock`, or one died holding it. Read `owner.json` in that directory if it is there and confirm that process is gone; only then remove the lock directory and run the original command again. Never remove a lock because it is old.
- **Capture stopped part-way** (`recoveryStateCreated` true, or the receipt `<vault>/.capture-operations/<operation id>.json` exists and its `phase` is not `complete`): run the same command again with the same plan file, the same operation id and the same flags. Do not correct the plan under that id.
- **Capture refused the plan** (`recoveryStateCreated` false and no receipt for that operation id): correct the plan and capture it as the next file under the next operation id.
- **Sources and verifications** are safe to run again with the same values: a URL already in the vault under the same subject version comes back as a duplicate with its id (the same URL with another subject version, or with none where one was recorded, is captured as a new entry), and a verification whose marker is already on the source is skipped (the marker ends with a colon, so claim 1 is not mistaken for claim 10).

If `WARN_SYNTHESIS_NO_NOTE_COVERAGE` or `WARN_SYNTHESIS_MONOLITHIC` fires after persistence, either decompose further or declare `synthesis_basis: primary-rollup`, only if it honestly is a factual rollup. To decompose, capture the added notes as a new plan under a new operation id, then edit the existing synthesis in place with research-authoring; never capture a changed synthesis again under its id. Keep the run's directory under `.research-tasks` until the user asks for cleanup. The lock covers `--operation-id` captures only; nothing here protects against another writer editing the same entries, so stop for review if an entry changed under you.

## 4. Close out

These are the controller's completion checks. Keep four results apart when you report: what the evidence supports, what was persisted, the lint result, and the claims verdict.

1. Confirm each id the workflow returned is a file in the vault, then run `lint` with the explicit vault — clean, or explain every warning.
2. Run the `research-claims-gate` skill on the synthesis entry file (evidence derives from its `contributing_ids` and `sources`), then present it to the user the way you would tell a colleague: the answer, why, how confident, and what is still open (question ids).
3. Only after the gate records `PASS` or `MERIT`, close each question the synthesis actually resolves: `verify --id <question> --answered-by <synthesis id>`. If the gate does not pass, show its verdict and leave the questions open. List the ids created and reused.
4. Offline or fetch-blocked? Do not fabricate: answer from the vault, record what could not be verified as open `question` entries, and say so.

## Anti-patterns (from ORCHESTRATOR-INTEGRATION.md)

Monolithic report files; source→synthesis with no notes (unless a declared `primary-rollup`); "I don't know" as prose instead of a `question`; reusable fragments inline instead of `snippets/`; stub notes written only to silence the lint.

Keep the normal final answer format. Show a replay command or a resume instruction only when work failed or is unfinished; a successful run needs no receipt dump.
