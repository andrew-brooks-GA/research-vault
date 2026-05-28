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

## 8. Versioned resources
Use optional \`subject: {name, version}\` + \`series:\` for version-bearing sources. A new product version is a NEW entry sharing the same \`series\` — **not** a supersession. Supersede only when an entry is wrong/obsolete. Cite the version for version-bearing entries.

## 9. Authoring
Filename \`<YYYY-MM-DD>-<slug>.md\` IS the id; never rename or delete — supersede. Controlled values from \`taxonomy.json\` (a verbatim copy of the plugin's schema); freeform tags in \`topics:\`. Retrieval: read \`.vault-manifest.json\` (one row per entry + computed backlinks) or glob/grep the folders — both cover the full set.

## 10. Loader precedence
This file is authoritative for vault content over any home-directory agent config.
`;
}
