# 04 — Stale evidence dependencies in `advise`

## Problem

Freshness is per entry. A synthesis verified last week that rests on a `fast` source last verified seven months ago is reported fresh. That is the silent staleness the project exists to prevent, one hop removed.

## Change

### Dependency relations

```js
// bin/lib/graph.mjs
export const DEPENDENCY_RELS = ['sources', 'contributing_ids'];
```

Only these express "this entry's claims rest on that entry". `related` is association, `superseded_by` is replacement, `source_id`/`prompt_id`/`contributing` are provenance for standalone types and are not followed in v1 (revisit if a case appears).

### New `advise` section

```json
"staleEvidence": [
  { "id": "<note or synthesis>",
    "via": [ { "id": "<reached dependency>", "reason": "stale" | "superseded",
               "path": ["<id>", "...", "<reached dependency>"] } ] }
]
```

- For every `note` and `synthesis` row with `status: active`: `traverse(m, id, { direction: 'out', depth: Infinity, rels: DEPENDENCY_RELS })` (spec 03 helper).
- A reached node of any type, including an intermediate note, is reported with exactly one `reason`:
  - `superseded` if `row.status === 'superseded'` (takes precedence; a superseded entry is reported even when its volatility is unknown or it is also stale);
  - else `stale` if `staleness(row, schema, now)` is truthy;
  - else not reported. Unknown volatility (`staleness` returns null) suppresses only the stale assessment, consistent with `listStale`.
- A reached id with no manifest row (`missing: true` from `traverse`) is skipped here; dangling references are lint's job.
- `path` is the shortest BFS path from the dependent to the reached node, rebuilt by walking `parents` from the result of `traverse` (spec 03 defines `parents` and its deterministic tie-break).
- The dependent's own staleness is not reported here (it is already in `stale`). Dependents with `status: superseded` are skipped.
- One clock, one manifest: `advise(vaultPath, repoRoot, { now } = {})` normalises `now` to a `Date` once and passes it to both `listStale` and this check, so direct and dependency freshness never disagree. Freshness per reached row is assessed once and reused across dependents.

### Plumbing

- `listStale(vaultPath, opts)` accepts `opts.manifest` (skip the rebuild) alongside its existing `opts.now`.
- `bin/commands/advise.mjs` text renderer gains a section (JSON output already serialises the whole object):

  ```
  stale evidence (2)
    2026-02-01-note <- stale 2026-01-01-src  via 2026-02-01-note -> 2026-01-01-src
    2026-03-01-syn  <- stale 2026-01-01-src  via 2026-03-01-syn -> 2026-02-01-note -> 2026-01-01-src
  ```

- Output ordering: dependents by id, `via` by reached id.

## Tests (`test/advise.test.mjs`)

Temp vault with `now` pinned:

- source `s` (`fast`, verified 200 days ago) ← note `n` (fresh) ← synthesis `y` (fresh): `staleEvidence` contains `y` with path `[y, n, s]` and `n` with path `[n, s]`.
- Stale intermediate: `n` itself stale and `s` fresh: `y` reported via `n`, path `[y, n]`.
- `y` also `related` to a stale source `r`: `r` does not appear under `y`.
- note `m` with `status: superseded` ← synthesis `z`: `z` reported with reason `superseded`; same when `m` is also past its window (precedence) and when `m` has no `volatility`.
- source with no `volatility` and `status: active` upstream of a note: nothing reported.
- A synthesis with `status: superseded` depending on a stale source: not listed as a dependent.
- Cycle `a contributing_ids b`, `b contributing_ids a`, both fresh, `a sources s` stale: `a` reported once via `s`; `a` never appears in its own `via`.
- Dangling: note naming a missing source: nothing reported for that edge, no crash.
- Equal-length paths: `y` has `contributing_ids: [2026-01-02-n1, 2026-01-02-n2]` and both notes have `sources: [s]`; the reported path goes through `2026-01-02-n1`. This holds because both first hops share the same `rel`, so the `(from, rel, to)` edge order of spec 03 reduces to id order; with mixed relations the tie-break is by relation name first.
- Text CLI output contains the `stale evidence (` header and the `via` chain.
- Pinned `now` passed to `advise` produces the same `stale` list as `listStale(vaultPath, { now })`.

## Docs

- `skills/research-librarian/SKILL.md`: ninth section "stale evidence — notes/syntheses whose dependencies (`sources`/`contributing_ids`, transitively) are past their window or superseded; the dependent's own `last_verified` is not rewritten".
- `commands/research-advise.md`: list the new section.
- AGENTS.md §7, one sentence after the freshness table: "A note or synthesis is only as fresh as its evidence: before citing one, check that its `sources`/`contributing_ids` chain is within window (`advise` lists violations as `staleEvidence`)." Regenerate golden.
- `vault-template/meta/freshness-policy.md` §3: same sentence. No command refreshes `meta/` in existing vaults; the CHANGELOG prints the sentence for hand-editing. AGENTS.md reaches existing vaults via `init --refresh-docs`.

## Explicitly not in v1

- No volatility cap on propagation (vault question `2026-10-12-should-transitive-staleness-capped-by-dependent`): report everything, observe dismissal rate first.
- No change to `check --check` (vault question `2026-10-12-should-check-gate-transitive-staleness-cited`). A later opt-in `--dependencies` flag is the likely shape.
- No new lint warning. Advisory only.

## Review notes applied

Codex: restrict to evidence relations (done); report paths not endpoints (done); count stale intermediates (done); single manifest and fixed date (done); separate direct from dependency freshness (done); define superseded handling (done).
