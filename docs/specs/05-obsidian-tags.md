# 05 — Tags on Obsidian stubs

## Problem

The derived `_obsidian/` view gives a graph, but every node looks the same. Obsidian's graph view colours and filters by search query, and search matches frontmatter `tags:` lists including nested tags (`tag:#freshness/stale` matches). Verified against the official help, vault ids `2026-10-12-obsidian-graph-view-help` and `2026-10-12-obsidian-tags-help-nested-tags-frontmatter`.

## Change

### Stub frontmatter

`entryNote(manifest, e, { schema, now })` emits, before the `# title` line:

```yaml
---
tags:
  - type/source
  - status/active
  - domain/systems-infrastructure
  - volatility/fast
  - freshness/stale
  - topic/kubernetes
  - topic/vcluster
---
```

- `type/<type>`, `status/<status>`: always.
- `domain/<d>`: one per domain.
- `volatility/<v>`: when present.
- `freshness/<fresh|stale|unassessed>`: from `staleness(e, schema, now)`: `false` → fresh, object → stale (includes the `always re-check` case for `volatile`), `null` → unassessed.
- `topic/<t>`: one per topic after normalisation.

### Tag normalisation

Obsidian tags allow letters, digits, `_`, `-`, `/` and no spaces. Controlled facets are already safe. For topics, the conservative ASCII rule: lowercase; keep only `[a-z0-9_-]`; replace every run of anything else (spaces, punctuation, `/`, non-ASCII) with `-`; trim leading and trailing `-`; skip if the result is empty; deduplicate after normalisation. No transliteration. Tag order: `type`, `status`, `domain` entries in declared order, `volatility`, `freshness`, then `topic` entries sorted.

### Plumbing

- `obsidianView(vaultPath, outDir = '_obsidian', { now } = {})`: optional third argument, `now` a `Date` (default `new Date()`), preserving existing calls. It loads the schema once (`loadSchema(REPO_ROOT, { vaultPath })`, same pattern as `stale.mjs`) and passes `{ schema, now }` to `entryNote`.
- `staleness` subtracts dates numerically, so `now` must be a `Date`, never an ISO string (a string yields `NaN` and silently marks everything fresh). The display date is `now.toISOString().slice(0, 10)`.
- The existing "_Derived Obsidian view_" line gains "freshness as of `<date>`; regenerate to refresh".

## Tests (`test/obsidian.test.mjs`)

Pin `now` as a `Date` in every case.

- Stub starts with `---\ntags:` and contains `type/source` and `freshness/fresh` for the fixture source verified in-window.
- An ordinary `fast` entry verified 200 days ago gets `freshness/stale` (this is the case that catches a string `now`).
- A `volatile` entry gets `freshness/stale`; an entry without `volatility` gets `freshness/unassessed`.
- Topics: `C++ Build Tools` → `topic/c-build-tools`; `a/b` → `topic/a-b`; `snake_case-ok` preserved; `Kubernetes` and `kubernetes!` collapse to one `topic/kubernetes`; `???` is skipped; `café` → `topic/caf`.
- Existing byte-identical canonical test unchanged.

## Docs

`vault-template/meta/obsidian-view.md`, new section "Graph groups":

```
Open the graph view's settings (the cog) → Groups → New group. Suggested:
  tag:#freshness/stale        red
  tag:#type/synthesis         blue
  tag:#type/question          yellow
Filter the whole graph with the same syntax, e.g. tag:#domain/security.
Freshness tags are a snapshot from the last `research-vault obsidian` run.
Obsidian can draw link arrows, but each stub also lists its backlinks as
wikilinks, so every backlink-forming relation appears as a link in both
directions (only `superseded_by` stays one-way). The arrows therefore do not
reflect stored-reference direction or relation type. For that use
`research-vault related --format mermaid`.
```

README: one sentence under the Obsidian screenshot.

## Review notes applied

Codex: topic charset normalisation (done); shared schema and date, preserve unassessed (done); snapshot caveat (done); edit the template, not a generated copy (done); Obsidian graph is not a faithful typed digraph, say so and point at mermaid (done).
