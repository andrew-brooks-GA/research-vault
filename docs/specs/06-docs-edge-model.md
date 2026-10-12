# 06 — Edge model in the docs, and the `last_verified` definition

## Problems

1. Agents learn the vault's shape from AGENTS.md, which describes the lifecycle in prose and never lists the reference fields or their direction. The README draws the lifecycle (source → note → synthesis) but not the stored references, which run the other way.
2. AGENTS.md §4, `meta/freshness-policy.md` §3, and `skills/research-vault-usage/SKILL.md` §2 define `last_verified` as `max(verifications[].date)`. The code (`lastVerified` in `manifest.mjs`) counts only verifications whose result is `confirmed` or `changed-trivially`. An agent that follows the docs computes a different freshness than the tool.

## Change

### Schema: doc-only intended targets

In `schema/frontmatter.schema.json`:

```json
"edge_fields": {
  "backlink": ["related","contributing_ids","sources","source_id","prompt_id","contributing"],
  "reference_only": ["superseded_by"],
  "intended_targets": {
    "sources": "source", "contributing_ids": "note, source, experiment, question, snippet",
    "source_id": "source", "prompt_id": "snippet", "contributing": "any",
    "related": "any", "superseded_by": "same type"
  }
}
```

Values are comma-separated so they drop straight into a Markdown table cell (no `|`). Documentation only: lint and capture do not read it (enforcement is the open question `2026-10-12-should-schema-declare-edge-targets-per`). The test in `test/schema.test.mjs` asserts every edge field has an `intended_targets` entry and vice versa, so the table can never be incomplete.

### AGENTS.md: generated §5.1

`generateAgentsMd` adds after §5:

```
### 5.1 Reference fields (the vault graph)
| field | intended on | intended target | forms backlink |
|---|---|---|---|
| `sources` | note | source | yes |
| `contributing_ids` | synthesis | note, source, experiment, question, snippet | yes |
| `source_id` | snippet | source | yes |
| `prompt_id` | experiment | snippet | yes |
| `contributing` | question | any | yes |
| `related` | any | any | yes |
| `superseded_by` | any | same type | no (reference only) |

A reference points from the declaring entry to the referenced entry. For the evidence relations (`sources`, `contributing_ids`) that is the reverse of the lifecycle flow (source → note → synthesis); `related` is association and `superseded_by` is replacement, not evidence. "Intended" columns are documentation: lint checks that every reference resolves, not its type. `.vault-manifest.json` lists every reference as a typed edge (`edges[]`) and the backlink-forming ones inverted (`backlinks`).
```

"intended on" is computed from `by_type` (the type whose field list contains the field) or `any` for fields in `common`. "intended target" and "forms backlink" come from the schema. Regenerate `schema/AGENTS.golden.md`. This spec depends on 02, which introduces `edges[]`.

### `last_verified` wording

Replace in AGENTS.md §4 (generator), `vault-template/meta/freshness-policy.md` §3, `skills/research-vault-usage/SKILL.md` §2:

> `last_verified` ← the latest `verifications[].date` whose `result` is `confirmed` or `changed-trivially`; `outdated`, `unreachable`, and `inconclusive` do not reset the clock, and an entry with no confirming verification has no `last_verified` (null).

### README

Under "How it's organized", after the lifecycle diagram, add the stored-reference diagram (vault snippet `2026-10-12-research-vault-entry-type-edge-model`) with one sentence: "Arrows are stored references, pointing from the declaring entry to the referenced one; for `sources` and `contributing_ids` that is the reverse of the distillation flow above." Hand-maintained; it mirrors the AGENTS table and is not drift-checked.

## Tests

- `test/agentsmd.test.mjs` golden comparison covers §5.1 and the §4 wording.
- `test/schema.test.mjs`: every field in `edge_fields.backlink ∪ reference_only` has an `intended_targets` entry, and vice versa.
- `test/lint.test.mjs`: a note whose `sources` names a question still lints clean (regression guard for the doc-only promise).

## Upgrade note

`init --refresh-docs` rewrites AGENTS.md and taxonomy.json only (`bin/commands/init.mjs:44-53`, by design; `meta/` is never touched). CHANGELOG therefore says: run `init --refresh-docs` for AGENTS.md, and hand-replace the `last_verified` sentence in `meta/freshness-policy.md` §3 with the text above. Do not widen `--refresh-docs`.

## Review notes applied

Codex: separate stored-reference direction from lifecycle flow (done, both diagrams kept distinct); a table over an enforced ontology (done); do not claim the README copy cannot drift (done); fix the `last_verified` discrepancy (done).
