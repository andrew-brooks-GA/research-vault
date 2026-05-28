export function generateAgentsMd(schema) {
  const t = schema.taxonomy;
  const vols = Object.entries(t.volatility)
    .map(([k, v]) => `| \`${k}\` | ${v.description} | ${v.refresh_after_days === 0 ? 'always re-check' : v.refresh_after_days + ' days'} |`)
    .join('\n');
  const stages = Object.entries(t.stage_by_folder)
    .map(([f, e]) => `| \`${f}/\` | ${e.allowed.join(', ')} | ${e.default} |`).join('\n');
  const types = Object.entries(t.artifact_purpose)
    .map(([f, p]) => `- \`${f}/\` — ${p}`).join('\n');
  return `# Research Vault — Agent Instructions

Canonical instructions for any agent (Claude, Codex, Gemini, …) reading or writing this vault. Generated from \`schema/\`; do not hand-edit.

## 1. Purpose
A type-organized cache of research artifacts. Markdown + YAML frontmatter; folders partition by artifact type. Treat the vault as a cache, not a source of truth — apply freshness rules in \`meta/freshness-policy.md\` before citing.

## 2. Artifact types (what goes in each folder)
${types}

Lifecycle: capture into \`sources/\` → distill into \`notes/\` → combine into \`synthesis/\`. \`snippets/\`, \`experiments/\`, and \`questions/\` are standalone. Distillation (source → note → synthesis) is always a deliberate step — nothing auto-promotes.

## 2.5 When each type is mandatory
The taxonomy is not a buffet. Each type has a specific trigger; producing only \`sources/\` and \`synthesis/\` while skipping the middle is the dominant failure mode.

- **\`source\`**: every external URL whose content informs a durable conclusion.
- **\`note\`**: any source used for **interpretation, recommendation, conflict resolution, prioritization, or reuse**. One note can cover several sources — the rule is "load-bearing sources must be covered by at least one contributing note," not "one note per source." A synthesis may skip notes only for **primary-source factual rollups** (release-note matrices, version diffs, standards summaries); in that case the synthesis MUST declare \`synthesis_basis: primary-rollup\`.
- **\`question\`**: any unresolved ambiguity that affects a claim, recommendation, confidence level, or future retrieval. "I don't know" is a \`question\` entry, not a parenthetical in prose. Do not park trivia.
- **\`experiment\`**: any tool/model/empirical run whose output is **evidence** for a claim. Routine \`rg\`/\`ls\`/source-reading does not qualify; an actual reproduction, benchmark, or model eval does.
- **\`snippet\`**: any reusable code/config block intended for copy/reuse. Not illustrative-only material embedded in synthesis prose.

## 2.6 Pre-synthesis checkpoint
Before drafting a \`synthesis\`, produce a **capture plan** covering:

1. **Notes to write** — one per load-bearing source unless \`synthesis_basis: primary-rollup\`. Multi-source notes are encouraged.
2. **Questions opened or answered** during the work — capture them now, while context is fresh.
3. **Experiments to log** — any empirical run whose result you'll cite.
4. **Snippets to extract** — reusable fragments that would otherwise get buried in synthesis prose.

Capture each as its own entry, then write the synthesis referencing them via \`contributing_ids\`. **Reports are views, not artifacts** — never let a single long markdown file be the only durable output.

## 2.7 Compose contract (for orchestrators)
Any skill performing research that produces durable conclusions MUST decompose its output into vault entries per §2.5–2.6. Lifecycle boundary:

- \`research-vault-usage\` (skill) — owns retrieval, freshness checks, and **pre-synthesis artifact planning**.
- \`research-capture\` (skill + CLI) — owns persistence once artifact types are chosen.
- **Orchestrators** — own running the capture plan from §2.6 before invoking synthesis capture.

A monolithic report markdown file with no atomic entries is **non-conforming**, regardless of how good the prose is. See \`docs/ORCHESTRATOR-INTEGRATION.md\` (in the plugin repo) for the worked example.

## 3. Domains
Broad research areas (controlled). Specific tech (e.g. kubernetes, vcluster, istio) goes in freeform \`topics:\`, never here.
${t.domain.map(d => `- ${d}`).join('\n')}

## 4. Derived fields (NEVER stored)
- \`id\` ← filename without \`.md\`
- \`last_verified\` ← max(verifications[].date), computed at read time
- \`folder\` ← parent directory

## 5. Reference resolution
All intra-vault references are stored as **ids**, never paths. Resolve an id by glob \`**/<id>.md\`. Paths allowed only in \`attachments:\`.

## 6. Folder ↔ stage
| Folder | Allowed stage | Default |
|---|---|---|
${stages}

## 7. Freshness
| volatility | covers | refresh window |
|---|---|---|
${vols}

Before citing: compute \`last_verified\` and compare to the window. **Offline mode:** only \`inferred-stable\` (volatility=stable + durable source) and \`human-spot-check\` (with explicit user confirmation) are valid; prefix stale-window answers with \`"unverified-offline"\` + id.

## 8. Versioned resources and source authority
Use optional \`subject: {name, version}\` + \`series:\` for version-bearing sources. A new product version is a NEW entry sharing the same \`series\` — **not** a supersession. Supersede only when an entry is wrong/obsolete. Cite the version for version-bearing entries.

Source entries may also set \`authority_tier\` (\`primary\`/\`secondary\`/\`tertiary\`) and \`authority_basis\` (e.g. \`official-docs\`, \`spec\`, \`source-code\`, \`release-notes\`, \`vendor-blog\`, \`benchmark\`). These are **defaults** — authority is ultimately *claim-relative*. A vendor docs page is primary for API behavior but weak for production tradeoffs; cite \`authority_basis\` when authority matters for a contested claim. When sources conflict, prefer higher-tier sources for the type of claim being made.

## 9. Authoring
Filename \`<YYYY-MM-DD>-<slug>.md\` IS the id; never rename or delete — supersede. Controlled values from \`taxonomy.json\` (a verbatim copy of the plugin's schema); freeform tags in \`topics:\`. Retrieval: read \`.vault-manifest.json\` (one row per entry + computed backlinks) or glob/grep the folders — both cover the full set.

## 10. Loader precedence
This file is authoritative for vault content over any home-directory agent config.
`;
}
