// Bounded BFS over the manifest's typed edges. Shared by `related` and advise's stale-evidence check.

// Only these rels mean "this entry's claims rest on that entry". `related` is association,
// `superseded_by` is replacement, source_id/prompt_id/contributing are provenance for standalone types.
export const DEPENDENCY_RELS = ['sources', 'contributing_ids'];

// direction: out = follow from===current, in = follow to===current, both = either.
// rels: optional allowlist of rels to follow and return.
// -> { nodes: [{ id, distance, missing? }] sorted by (distance, id),
//      edges: induced subgraph over reached nodes, in manifest order,
//      parents: { [id]: predecessor } — deterministic because candidate edges are scanned in
//      manifest order (sorted by from, rel, to) }
export function traverse(manifest, startId, { depth = 1, direction = 'both', rels = null } = {}) {
  const rows = new Set(manifest.entries.map(e => e.id));
  const edges = rels ? manifest.edges.filter(e => rels.includes(e.rel)) : manifest.edges;
  const incident = new Map();
  for (const e of edges) for (const id of new Set([e.from, e.to])) (incident.get(id) ?? incident.set(id, []).get(id)).push(e);
  const distance = new Map([[startId, 0]]);
  const parents = {};
  let frontier = [startId];
  for (let d = 1; d <= depth && frontier.length; d++) {
    const next = [];
    for (const cur of frontier) {
      if (!rows.has(cur)) continue; // dangling id: a node, never expanded
      for (const e of incident.get(cur) ?? []) {
        const nb = e.from === cur && direction !== 'in' ? e.to : e.to === cur && direction !== 'out' ? e.from : null;
        if (nb === null || distance.has(nb)) continue;
        distance.set(nb, d); parents[nb] = cur; next.push(nb);
      }
    }
    frontier = next;
  }
  const nodes = [...distance].map(([id, dist]) => rows.has(id) ? { id, distance: dist } : { id, distance: dist, missing: true })
    .sort((a, b) => a.distance - b.distance || a.id.localeCompare(b.id));
  return { nodes, edges: edges.filter(e => distance.has(e.from) && distance.has(e.to)), parents };
}
