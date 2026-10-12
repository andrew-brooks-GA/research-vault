# 03 — Bounded traversal for `related`

## Problem

`related` is one hop. Walking an evidence chain (synthesis → notes → sources) or a blast radius (source → notes → syntheses) takes one CLI call per hop and the agent stitches the results. The literature's one clear agent benefit of a graph is exactly this multi-hop walk.

## Change

### Shared helper: `bin/lib/graph.mjs` (new)

```js
export function traverse(manifest, startId, { depth = 1, direction = 'both', rels = null } = {})
// -> { nodes: [{ id, distance, missing? }], edges: [{ from, rel, to }], parents: { [id]: previousId } }
```

- `direction`: `out` follows edges where `from === current`; `in` follows `to === current`; `both` follows either.
- `rels`: optional array; when set, only edges whose `rel` is in it are followed and returned.
- BFS with a visited set; cycles terminate; `distance` is BFS distance from `startId`, which is included at distance 0.
- Determinism: candidate edges are taken in manifest order (already sorted by `(from, rel, to)`), so first discovery is deterministic and `parents[id]` is a fixed shortest-path predecessor. `nodes` sorted by `(distance, id)`; `edges` keep manifest order.
- `edges` in the result = every manifest edge passing the `rels` filter whose two endpoints are both reached (induced subgraph). This contains every predecessor edge plus any cross edges between reached nodes, so mermaid renders the complete picture.
- An id with no manifest row (dangling, possible on an unlinted vault) is still a node, with `missing: true` and no further expansion.

Spec 04 reuses this helper; `related` is its first consumer.

### CLI

```
related <id> [--depth N] [--direction out|in|both] [--rel a,b] [--format mermaid]
```

Defaults: `--depth 1 --direction both`, all relations.

Validation (usage message to stderr, exit 2): `--depth` missing a value, non-integer, or < 1; `--direction` not one of the three; `--rel` empty or naming a relation not in the schema's edge fields. Note `args.mjs` stores a bare `--depth` as `undefined`, so check `'depth' in args` before defaulting.

JSON output:

```json
{ "id": "...", "depth": 2, "direction": "both",
  "forward": [...], "backlinks": [...],
  "nodes": [{ "id", "distance", "type", "title", "status", "volatility", "last_verified" }],
  "edges": [{ "from", "rel", "to" }] }
```

- `forward` and `backlinks` are the depth-1, unfiltered compatibility arrays (spec 02 semantics); `--depth`, `--direction`, `--rel` do not affect them.
- Node fields beyond `id`/`distance` come from the manifest row; a dangling id has `missing: true` instead.
- Mermaid: `graph TD`, one `a -->|rel| b` line per result edge; if there are no edges, emit the root id alone so an isolated entry still renders a node.

### Compatibility (stated, not pretended away)

At the defaults the reached set is `forward ∪ backlinks ∪ {entries that name this id in superseded_by}`. The last term is new: `superseded_by` forms no backlink by policy, but `both` traversal follows it, so querying a superseding entry now reaches the entry it replaced. `nodes` also includes the root at distance 0. Release notes say so.

## Tests (`test/related.test.mjs`)

Two fixtures, built in temp vaults with full date-prefixed ids.

Chain (no cycle): source `S`, note `N` (sources: [S]), synthesis `Y` (contributing_ids: [N]), question `Q` (contributing: [Y]), snippet `P` (source_id: S), and `O` with `superseded_by: Y`.

- depth 1, both, from `S`: non-root nodes = {N, P}; `forward` = []; `backlinks` = [N, P].
- depth 2, `in`, from `S`: Y at distance 2 with `parents[Y] === N`.
- depth 3, `out`, from `Q`: Y 1, N 2, S 3.
- `--rel sources,contributing_ids` depth 5 `out` from `Y`: reaches N and S, not Q.
- depth 1, both, from `Y`: reaches O (incoming `superseded_by`) although `backlinks` of Y does not list O.
- Induced edges: depth 2 `in` from `S` with `Y related N` added to the fixture returns the `related` edge between the two reached nodes.
- Mermaid from `N` depth 1 contains `N -->|sources| S`; mermaid from an isolated entry contains its id and no arrows.

Cycle: `A related B`, `B related A`, plus `A sources C`.

- depth 5 both from `A`: A once at distance 0, B at 1, C at 1; terminates.

Dangling: manifest built on a vault where `N` names a missing source: node has `missing: true`, no crash.

CLI (`run(args)` return code): `--depth 0`, `--depth 1.5`, `--depth -1`, bare `--depth`, `--direction sideways`, `--rel nope`, `--rel ""` each return 2.

## Docs

- `commands/research-related.md`: argument hint `[id] [--depth N] [--direction out|in|both] [--rel a,b]`, one sentence on evidence chains.
- README commands table, `related` row.
- `skills/research-vault-usage/SKILL.md` §1: "`related --depth 2 --direction out <synthesis>` returns the evidence chain; `--direction in <source>` returns what depends on it".
- CHANGELOG: default membership expansion and mermaid labels.
- AGENTS.md: no change.

## Review notes applied

Codex round 1: default direction both; define output edges; distances and predecessors; relation filter; validate depth; terminate cycles. Round 2: compatibility claim corrected (incoming `superseded_by` and the root are additions); chain and cycle fixtures separated so distances are right; `--rel`/`--direction` leave the compatibility arrays alone; invalid direction, unknown rel, and bare `--depth` handled; deterministic ordering and tie-break; isolated-root mermaid; dangling and induced-edge tests added; exit codes asserted.
