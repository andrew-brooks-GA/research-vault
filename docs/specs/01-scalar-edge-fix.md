# 01 — Scalar edge fields are iterated as strings

## Problem

`bin/lib/manifest.mjs` builds backlinks with

```js
for (const f of EDGE_FIELDS) for (const target of (data[f] || [])) { ... }
```

`source_id` (snippet) and `prompt_id` (experiment) are scalars, so a value like `2026-01-01-a` is iterated character by character. Reproduced on a fixture: backlinks gain keys `0`, `1`, `2`, `6`, `-`, `a` and the real source never receives the snippet as a backlink. Consequences: `related <source>` and the Obsidian stub omit the snippet; `advise` can report the referenced source or prompt as an orphan when it has no other links. Lint does not catch it because its dangling-ref check already normalises scalars.

## Change

```js
for (const f of EDGE_FIELDS) for (const target of [].concat(data[f] ?? [])) {
  if (!target) continue;               // skip '' / null
  ...
}
```

The existing `includes` guard already deduplicates a referencing id both within a field and across fields; that stays.

## Tests (`test/manifest.test.mjs`)

Build a temp vault using full date-prefixed ids: a source `2026-01-01-s`; a snippet `2026-01-02-p` with `source_id: 2026-01-01-s`; an experiment `2026-01-03-e` with `prompt_id: 2026-01-02-p`; a note `2026-01-04-n` with `sources: [2026-01-01-s, 2026-01-01-s]` and `related: [2026-01-01-s]`. Assert the exact backlink map:

```json
{ "2026-01-01-s": ["2026-01-02-p", "2026-01-04-n"], "2026-01-02-p": ["2026-01-03-e"] }
```

Exact equality catches character keys, duplicates, and cross-field duplicates at once. Add one case: a snippet with `source_id: ""` adds no key.

## Upgrade note (CHANGELOG)

Vaults with a populated `source_id` or `prompt_id` get a different manifest; `lint --check` reports `MANIFEST_STALE` until `lint` runs once. No entry files change, no golden change.

## Out of scope

Forward-edge exposure in `related`/`obsidian` (spec 02).
