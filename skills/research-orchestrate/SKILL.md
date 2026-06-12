---
name: research-orchestrate
description: Use when entering a fresh research task — a question that needs new external research, not yet at retrieval/citation/capture — and a research vault resolves (via .research-vault.json, $RESEARCH_VAULT_PATH, or the OS default). Owns the end-to-end research workflow — vault-first lookup, web fan-out, eager source capture, the §2.6 capture plan, and a lint-gated synthesis — and supersedes generic deep-research skills in vault-bound contexts. For retrieval/citation from the vault use research-vault-usage; for single-entry persistence use research-capture.
---
# Orchestrating research into the vault

The reference implementation of `docs/ORCHESTRATOR-INTEGRATION.md`. Durable conclusions land as atomic vault entries — sources, notes, questions, snippets, experiments, synthesis — never as a monolithic report. Reports are views; the vault is the system of record.

## 0. Resolve paths once

- CLI: `node "${CLAUDE_PLUGIN_ROOT}/bin/research-vault.mjs"`. Resolve `${CLAUDE_PLUGIN_ROOT}` to an absolute path now — workflow subagents do not inherit it.
- Vault path: from `research-vault search --json` output or the resolution chain in the vault's `AGENTS.md`.

## 1. Clarify, then check the vault first

1. If the question is underspecified (no version, environment, or success criterion), ask 2–3 narrowing questions before researching.
2. Search the vault (`search --topic`, `--text`, `--body`). If fresh entries (per §2 of research-vault-usage) already cover the question, answer from the vault and stop. If coverage is partial, note the gap — it becomes a `question` entry or the workflow's focus.

## 2. Run the workflow

Use the Workflow tool with the reference script below, adapted to the question. Pass absolute paths via `args` — never rely on env vars inside the script. Every stage hands off schema-validated structured output; a stage cannot silently skip capture.

| Phase | Does |
|---|---|
| Recon | Map existing vault coverage and gaps |
| Sweep | Parallel multi-modal search: official docs, release notes, issue trackers, community |
| Fetch+Seed | Per URL: fetch, capture a `source` eagerly via the CLI, return a structured extraction |
| Verify | Adversarial check of load-bearing claims — fetched, not recalled |
| Plan | Walk the §2.6 four prompts; emit the batch plan JSON (notes, questions, snippets, experiments, synthesis) |
| Persist+Gate | `capture --batch` the plan, then `lint`; decompose further if a `WARN_SYNTHESIS_*` fires |

```javascript
export const meta = {
  name: 'research-orchestrate',
  description: 'Vault-conformant research: fan-out, eager source capture, batched distillation',
  phases: [
    { title: 'Recon' }, { title: 'Sweep' }, { title: 'Fetch+Seed' },
    { title: 'Verify' }, { title: 'Plan' }, { title: 'Persist+Gate' },
  ],
}
// args: { question, cli, vault, today }  — cli = absolute path to research-vault.mjs
const CLI = `node "${args.cli}" `;
const URLS = { type: 'object', required: ['urls'], properties: { urls: { type: 'array', items: { type: 'object', required: ['url', 'why'], properties: { url: { type: 'string' }, why: { type: 'string' } } } } } };
const EXTRACT = { type: 'object', required: ['sourceId', 'claims'], properties: { sourceId: { type: 'string' }, claims: { type: 'array', items: { type: 'string' } }, snippets: { type: 'array', items: { type: 'string' } } } };
const VERDICT = { type: 'object', required: ['claim', 'verified'], properties: { claim: { type: 'string' }, verified: { type: 'boolean' }, note: { type: 'string' } } };
const PLAN = { type: 'object', required: ['planJson'], properties: { planJson: { type: 'string' } } };

phase('Recon')
const recon = await agent(`Search the research vault for coverage of: ${args.question}. Run ${CLI}search with relevant --topic/--text facets. Return gaps needing web research.`, { phase: 'Recon' })

phase('Sweep')
const lanes = ['official documentation', 'release notes and changelogs', 'issue trackers and bug reports', 'community posts and practitioner writeups']
const found = (await parallel(lanes.map(l => () =>
  agent(`Web-search ${l} for: ${args.question}. Known gaps: ${recon}. Return the 2-4 most authoritative URLs.`, { phase: 'Sweep', schema: URLS })
))).filter(Boolean).flatMap(r => r.urls)

const extractions = (await pipeline(found,
  (u, _, i) => agent(`Fetch ${u.url} (relevant to: ${u.why}). Then capture it eagerly: ${CLI}capture --type source --title "<concise title>" --url "${u.url}" --domain <domain> --topics <topics> --authority-tier <tier> --authority-basis <basis> [--subject-name/--subject-version if version-bearing]. If it reports a duplicate, reuse the existing id. Return the source id and the claims relevant to: ${args.question}.`, { phase: 'Fetch+Seed', schema: EXTRACT, label: `fetch:${i}` })
)).filter(Boolean)

phase('Verify')
const claims = extractions.flatMap(e => e.claims.map(c => ({ c, sid: e.sourceId })))
const verdicts = (await parallel(claims.map(k => () =>
  agent(`Adversarially verify against the live source (re-fetch; model recall is NOT verification): "${k.c}" from vault source ${k.sid}. Default verified=false if uncertain. If verified=true, record it: ${CLI}verify --id ${k.sid} --method refetched-source --result confirmed --notes "orchestrator Verify phase".`, { phase: 'Verify', schema: VERDICT })
))).filter(Boolean)

phase('Plan')
const plan = await agent(`You are walking AGENTS.md §2.6 for: ${args.question}.
Verified claims: ${JSON.stringify(verdicts)}. Source extractions: ${JSON.stringify(extractions)}.
Walk the four prompts: (1) notes distilling load-bearing sources, (2) questions for every unresolved ambiguity (including every unverified claim), (3) experiments for any empirical run cited as evidence, (4) snippets for reusable fragments. Then ONE short synthesis (cross-source claims + recommendation, with summary and confidence) whose contributingIds reference the notes (and other entries) by their deterministic ids (${args.today}-<slug>). Sources already exist in the vault — reference, do not recreate.
Return planJson: a JSON array for capture --batch using camelCase capture opts keys.`, { phase: 'Plan', schema: PLAN })

phase('Persist+Gate')
const result = await agent(`Write this JSON to a temp file and run: ${CLI}capture --batch <file>. If it returns errors, fix the plan per the per-entry report and retry (max 3 attempts). Then run ${CLI}lint. If WARN_SYNTHESIS_NO_NOTE_COVERAGE or WARN_SYNTHESIS_MONOLITHIC fires, either decompose further (more notes) and re-batch, or declare synthesis_basis: primary-rollup only if honestly a factual rollup. Return the final created/skipped ids and lint status.
PLAN: ${plan.planJson}`, { phase: 'Persist+Gate' })
return { recon, created: result }
```

## 3. Degraded mode (no Workflow tool)

Run the same lifecycle inline and sequentially: vault search → web search/fetch with an eager `capture --type source` per kept URL → walk §2.6 → write the batch plan JSON → `capture --batch` → `lint`. Conformance comes from the same checklist and the same atomic batch call; only the parallelism is lost.

## 4. Close out

1. Run `research-vault lint` — clean, or explain every warning.
2. Present the synthesis (short: claims + recommendation, `confidence`, open `question` ids).
3. List every entry created (from the batch JSON result) and anything skipped as a duplicate.
4. Offline or fetch-blocked? Do not fabricate: answer from the vault, record what could not be verified as open `question` entries, and say so.

## Anti-patterns (from ORCHESTRATOR-INTEGRATION.md)

Monolithic report files; source→synthesis with no notes (unless a declared `primary-rollup`); "I don't know" as prose instead of a `question`; reusable fragments inline instead of `snippets/`; stub notes written only to silence the lint.
