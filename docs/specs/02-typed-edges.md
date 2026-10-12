# 02 — Typed edges in the manifest

## Problem

Manifest rows carry only `related`, `contributing_ids`, `sources`. `related` and `obsidianview` compute forward links from those three, so `source_id`, `prompt_id`, `contributing`, and `superseded_by` are invisible from the referencing side (`related <snippet>` returns `forward: []`). `advise` has its own correct outgoing-edge check but pays a second full vault walk for it because the row is incomplete. Agents reading the manifest see that two entries are linked but not why.

## Change

### Manifest shape

Add a top-level `edges` array; derive `backlinks` from it. Rows are unchanged.

```json
{
  "generated": "2026-10-12",
  "entries": [ ...unchanged rows... ],
  "edges": [ { "from": "2026-01-02-b", "rel": "contributing_ids", "to": "2026-01-01-a" }, ... ],
  "backlinks": { "2026-01-01-a": ["2026-01-02-b"] }
}
```

- `rel` is the frontmatter field name. No synonym layer.
- Built from all seven fields in `edge_fields.backlink` + `edge_fields.reference_only`, scalar or array (spec 01 normalisation), empty values skipped.
- Sorted by `(from, rel, to)`, deduplicated on the triple (two different rels between the same pair are two edges).
- `backlinks[to]` = sorted unique `from` over edges whose `rel` is in `edge_fields.backlink`. Policy unchanged: `superseded_by` forms no backlink.

`manifest.mjs` exports nothing new; consumers filter `m.edges`.

### Consumers

- `bin/commands/related.mjs`: `forward` = sorted unique `to` over `edges.filter(e => e.from === id)` (all seven rels); `backlinks` = `m.backlinks[id]` (unchanged policy). JSON output gains `edges` = every manifest edge incident to the id in either direction, including an incoming `superseded_by` edge, which appears here but never in `backlinks`. `forward`/`backlinks` stay as id arrays. Two visible changes to `forward`: membership grows (four more fields) and order becomes sorted instead of field order. Mermaid output labels edges: `a -->|sources| b`.
- `bin/lib/obsidianview.mjs` `entryNote`: the Links section groups wikilinks under one `### <rel>` heading per rel present; a target referenced by two rels appears once under each heading. Backlinks section unchanged.
- `bin/lib/advise.mjs`: orphans = entries with no backlinks and no edge where `from === id` (any rel, including `superseded_by`, matching today's `idsWithOutgoingEdges`). Delete `idsWithOutgoingEdges`; this removes one of advise's extra vault walks (stub, unverified-source, and quote-residue detection still read files, and that is fine). `noteSources` unchanged.

## Tests

- `test/manifest.test.mjs`: temp vault exercising all seven fields; assert `edges` content and order; a duplicate reference collapses to one triple; two rels between the same pair give two edges and one backlink; `backlinks` excludes the `superseded_by` edge; existing "byte-identical except generated" test still passes.
- `test/obsidian.test.mjs`: the existing assertion that the fixture synthesis stub contains exactly one wikilink to its source (`test/obsidian.test.mjs:43`, the fixture names the source under both `related` and `contributing_ids`) is replaced: assert the source appears exactly once under `### related` and exactly once under `### contributing_ids`. Add: snippet stub contains `### source_id` and `[[<source>]]`.
- `test/advise.test.mjs`: a snippet whose only link is `source_id` is not an orphan, and neither is its source; an entry whose only outgoing link is `superseded_by` is not an orphan.
- `test/lint.test.mjs`: a manifest on disk that differs only in `edges` triggers `MANIFEST_STALE` (the current test corrupts `backlinks` only).
- New `test/related.test.mjs`: `related <snippet>` forward contains its source; `related <superseding entry>` has the incoming `superseded_by` edge in `edges` and not in `backlinks`; mermaid output contains `|source_id|`.

## Docs

- AGENTS.md §9 sentence: "read `.vault-manifest.json` (one row per entry, a typed `edges` list, and computed backlinks)". Regenerate `schema/AGENTS.golden.md`.
- README commands table, `related` row: "typed forward links + backlinks".
- `skills/research-vault-usage/SKILL.md` §1: mention `edges`.

## Upgrade note

`MANIFEST_STALE` on existing vaults until `lint` runs once. AGENTS.md wording needs `init --refresh-docs`. Regenerate `_obsidian/` to get the new Links layout. `related` forward output grows and is now sorted.

## Review notes applied

Codex: derive backlinks from backlink fields only (done); keep row fields (done); `superseded_by` exclusion is policy (kept); duplication claim was overstated, so this spec frames the `advise` change as removing a second walk, not fixing a bug.
