# Graph specs

Specs for exposing the typed graph a research vault already has. Background and evidence live in the vault synthesis `2026-10-12-graph-representations-research-vault-expose-existing`; the proposal was reviewed by Codex (`gpt-6-astra`) and these specs incorporate that review.

| # | Spec | Depends on | Size |
|---|---|---|---|
| 01 | [Scalar edge-field fix](01-scalar-edge-fix.md) | — | small |
| 02 | [Typed edges in the manifest](02-typed-edges.md) | 01 | small, net deletions |
| 03 | [Bounded traversal for `related`](03-related-traversal.md) | 02 | medium (validation + tests dominate) |
| 04 | [Stale evidence dependencies in `advise`](04-stale-evidence.md) | 03 | medium |
| 05 | [Tags on Obsidian stubs](05-obsidian-tags.md) | — (sequence after 01) | small |
| 06 | [Edge model in the docs and the `last_verified` fix](06-docs-edge-model.md) | 02 (documents `edges[]`) | docs + golden regen |

Round 2 (2026-10-12): what lets an agent use the graph it now has. Evidence is the vault synthesis `2026-10-12-agents-get-more-from-vault-graph` and its notes; the proposal was reviewed by Codex (`gpt-6-astra`, experiment `2026-10-12-codex-review-round-2-graph-proposal`) and these specs incorporate that review.

| # | Spec | Depends on | Size |
|---|---|---|---|
| 07 | [Graph playbook in AGENTS.md and the skills](07-graph-playbook.md) | 06 | docs + golden regen |
| 08 | [Node metadata in the manifest and traversal output](08-node-metadata.md) | 02 | small |
| 09 | [Superseded entries excluded from `search`](09-search-validity-gate.md) | 08 (exposes `superseded_by`) | small |
| 10 | [Paired evaluation protocol](10-paired-evaluation.md) | 07 | docs |

Suggested PRs: 07+08 (one golden regen), then 09, then 10. Nothing further ships until 10 has results.

Rejected this round, pending measurement under 10: output caps, hub demotion or any ranking in `related`; a `--between` shortest-path flag (`advise` already prints evidence paths); link suggestions and a `graph` health section in `advise` (health metrics are a one-off report for the evaluation, not a feature); archive candidates; a `capture --supersedes` flag (`verify --result outdated --superseded-by` exists).

Sizes are indicative, not budgets.

Suggested PRs: 01+02, then 03+04, then 05 and 06 independently after 02 has merged. 02, 04 and 06 all edit `bin/lib/agentsmd.mjs` and `schema/AGENTS.golden.md`; each PR regenerates the golden against the merged generator, never against its own branch alone.

## Upgrade guidance (every PR's CHANGELOG entry)

- A changed manifest shape: run `lint` once, or `lint --check` reports `MANIFEST_STALE` (the comparison covers every top-level field except `generated`).
- A changed AGENTS.md: run `init --refresh-docs` (rewrites AGENTS.md and taxonomy.json only).
- A changed `vault-template/meta/*` file: not refreshed by any command; the CHANGELOG gives the replacement text for hand-editing.

## Shared rules

- No new dependencies, no new runtime services, no schema fields that lint enforces (only one doc-only map in 06).
- Edges are never inferred. If the frontmatter does not declare it, it is not an edge.
- `backlinks` keeps its current policy: formed only by `edge_fields.backlink`; `superseded_by` stays reference-only.
- Every change that alters `.vault-manifest.json` content makes `lint --check` report `MANIFEST_STALE` on existing vaults until `lint` runs once. Each such spec says so in CHANGELOG under "Upgrading an existing vault".

## Non-goals (decided)

Graph database, embeddings, LLM entity extraction, MCP server, a code graph of the tool itself, a whole-vault render command, enforced edge target types, and changing `check --check` semantics. Round 2 adds, with evidence: personalized PageRank or path-scored ranking at the vault's density, Leiden communities and per-community LLM summaries, contradiction detection at ingest, in-place rewriting of older entries, and a world-time validity field for claims. Open questions on the last two are tracked as vault entries `2026-10-12-should-schema-declare-edge-targets-per` and `2026-10-12-should-check-gate-transitive-staleness-cited`.
