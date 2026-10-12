# 07 — Graph playbook in the generated AGENTS.md and the skills

## Problem

Agents are told the graph exists (§5.1, spec 06) but not which question maps to which command, how deep to go, or how to plan a traversal. The one recipe that exists (`research-vault-usage` §1: `related --depth 2 --direction out`) is incomplete: `--direction in` at the default depth 1 misses the syntheses that depend on a source two hops away, and nothing says that a node's own `last_verified` cannot establish transitive freshness. The literature is consistent that interface clarity, not algorithmic cleverness, is what an agent needs from a small authored graph: a schema given up front, non-overlapping tools with explicit "use when", a plan before traversal, deliberate start nodes (vault notes `2026-10-12-agents-consume-graphs-through-three-primitives`, `2026-10-12-graph-retrieval-beats-flat-only-multi`).

The deployed vault's `AGENTS.md` also predates spec 06 (no §5.1); that is an operational `init --refresh-docs`, not code.

## Change

### `bin/lib/agentsmd.mjs`: new §5.2 "Asking the graph"

Generated after the §5.1 table. Content, verbatim intent:

| you want to know | run | notes |
|---|---|---|
| what the vault says about X | `search --text X` (summaries) or `--body X` | single-fact lookup stops here; do not traverse |
| what evidence a note/synthesis Y rests on | `related Y --depth 2 --direction out --rel sources,contributing_ids` | the evidence chain; read `nodes[]` before any body |
| what depends on source Z (blast radius if Z is stale or wrong) | `related Z --depth 2 --direction in --rel sources,contributing_ids` | depth 2 reaches syntheses through their notes |
| which notes already cite source Z (conflict candidates before writing a new note) | `related Z --depth 1 --direction in --rel sources` | compare claims and `subject.version`, not just summaries |
| what replaced W | the `superseded_by` field on W's row (`search --json`, `related` nodes) | never cite a superseded entry |
| whether Y is current | `advise` → `staleEvidence` | Y's own `last_verified` says nothing about its evidence |
| everything near Y regardless of relation | `related Y` (defaults: depth 1, both directions, all rels) | exploration only |

Rules under the table:

- **Route first.** Single-fact questions use `search` only. Traverse for provenance, dependency, supersession and multi-hop questions. (Graph retrieval helps multi-hop and hurts nothing else only when it is not used for lookups.)
- **Plan, then run.** Pick start nodes from `search` hits deliberately, state which hops you intend and why, run them, then read bodies last. Do not wander hop by hop. No numeric call cap is imposed; the plan bounds the work.
- **Relation meanings.** `sources`: a note's evidence. `contributing_ids`: what a synthesis was built from (notes, and other entries). `source_id`: the source a snippet was taken from. `prompt_id`: the snippet an experiment ran. `contributing`: evidence toward a question's answer. `related`: connectivity, not evidence. `superseded_by`: replacement; never evidence.

### Skills

- `skills/research-vault-usage/SKILL.md` §1: replace the one-line recipe with a pointer to AGENTS.md §5.2 and the two evidence recipes (out and in, both depth 2 with `--rel`).
- `skills/research-orchestrate/SKILL.md` Recon phase: after `search`, run `related <source> --depth 2 --direction in --rel sources,contributing_ids` on the sources found, so existing notes and syntheses are reported as coverage rather than rediscovered.
- `skills/research-capture/SKILL.md`: conflict-review rule. Before writing a note that cites source Z, run `related Z --depth 1 --direction in --rel sources`; for each returned note compare its claims and `subject.version` with yours. Summaries alone do not establish a contradiction; they trigger reading the claims. If the claims conflict, capture a `question` naming both notes and add each to the other's `related`. Pairwise only.

### Docs

- `schema/AGENTS.golden.md` regenerated against the merged generator (README rule).
- CHANGELOG "Upgrading an existing vault": run `init --refresh-docs`.

## Tests

- Golden drift test already covers the generator; regenerate the golden.
- No new runtime behaviour.

## Non-goals

Vault statistics in AGENTS.md (they go stale); a call budget number; any new command.
