# 08 — Node metadata in the manifest and traversal output

## Problem

A traversal result should let an agent decide without opening bodies (Neo4j MCP eval: compact structured outputs; Anthropic: identifiers in context, bodies just in time). Today `related` `nodes[]` carry `type/title/status/volatility/last_verified` and the manifest row carries `summary` for notes and syntheses only. Missing, though present in frontmatter: question `state`, note `confidence`, experiment `outcome`, source `authority_tier`/`authority_basis`, `stage`, `superseded_by`. Two fields the usage skill tells agents to set are not in the schema at all: `summary` on a source and `confidence` on a synthesis (`skills/research-vault-usage/SKILL.md` §4 says to assign a synthesis confidence; `schema/frontmatter.schema.json` `by_type.synthesis` has no such field; 0 of 33 syntheses in the reference vault carry one; `capture --type source --summary` is silently ignored, `bin/commands/capture.mjs:64-81`).

## Change

### Schema (`schema/frontmatter.schema.json`)

- `by_type.source` gains optional `summary` (one line: the load-bearing claim an agent should know before fetching).
- `by_type.synthesis` gains optional `confidence` (values from `taxonomy.confidence`).
- Nothing becomes required. No new lint rule; `WARN_MISSING_SUMMARY` stays scoped to note/synthesis.

### Capture (`bin/commands/capture.mjs`)

- `--summary` is persisted for `type: source`.
- `--confidence` is persisted for `type: synthesis` when given; no default (a note defaults to `medium` today; a synthesis without a stated confidence stays absent so the omission is visible).
- Batch plans inherit both through `specToOpts`.

### Manifest rows (`bin/lib/manifest.mjs`)

Rows gain, `null` when absent: `stage`, `state`, `confidence`, `outcome`, `authority_tier`, `authority_basis`, `superseded_by`. `subject` and `series` already exist. `edges[]` and `backlinks` unchanged.

### `related` output (`bin/commands/related.mjs`)

`nodes[]` gain `summary`, `stage`, `state`, `confidence`, `outcome`, `authority_tier`, `authority_basis`, `subject`, `series`, `superseded_by` from the row (`null` when absent). `forward`, `backlinks`, `edges`, Mermaid: unchanged. (`related` has no plain-text renderer; JSON and Mermaid only.)

`search --json` returns rows and inherits the new fields with no code change.

### Docs

- AGENTS.md §5.2 (spec 07) lists the new row fields and tells agents to read `nodes[]` before bodies.
- `research-orchestrate` Fetch+Seed passes `--summary "<one load-bearing claim>"` on source capture.

## Tests

- `test/manifest.test.mjs`: a fixture with every type; assert each new field and `null` defaults; the byte-identical-except-`generated` test still passes.
- `test/related.test.mjs`: node rows carry `summary` and `superseded_by`.
- `test/capture.test.mjs`: source `--summary` and synthesis `--confidence` are written; an invalid synthesis confidence fails validation.
- `test/lint.test.mjs`: a manifest on disk missing the new fields reports `MANIFEST_STALE`.

## Upgrading an existing vault

`lint --check` reports `MANIFEST_STALE` until `lint` rebuilds the manifest. No backfill of source summaries; they accrue at capture time.
