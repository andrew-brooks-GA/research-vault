// Bounded BFS over the manifest's typed edges. Shared by `related` and advise's stale-evidence check.

// Only these rels mean "this entry's claims rest on that entry". `related` is association,
// `superseded_by` is replacement, source_id/prompt_id/contributing are provenance for standalone types.
export const DEPENDENCY_RELS: string[] = ['sources', 'contributing_ids'];

type Entry = { id: string };
type Edge = { from: string; rel: string; to: string };
type Manifest = { entries: readonly Entry[]; edges: readonly Edge[] };
type TraverseOptions = { depth?: number; direction?: 'out' | 'in' | 'both'; rels?: readonly string[] | null };
type TraversalNode = { id: string; distance: number; missing?: true };
type TraversalResult = { nodes: TraversalNode[]; edges: Edge[]; parents: Record<string, string> };

// direction: out = follow from===current, in = follow to===current, both = either.
// rels: optional allowlist of rels to follow and return.
// -> { nodes: [{ id, distance, missing? }] sorted by (distance, id),
//      edges: induced subgraph over reached nodes, in manifest order,
//      parents: { [id]: predecessor } — deterministic because candidate edges are scanned in
//      manifest order (sorted by from, rel, to) }
export function traverse(manifest: Manifest, startId: string, { depth = 1, direction = 'both', rels = null }: TraverseOptions = {}): TraversalResult {
  const rows = new Set(manifest.entries.map((e: Entry) => e.id));
  const edges = rels ? manifest.edges.filter((e: Edge) => rels.includes(e.rel)) : manifest.edges;
  const incident = new Map<string, Edge[]>();
  for (const e of edges) for (const id of new Set([e.from, e.to])) {
    let bucket = incident.get(id);
    if (bucket === undefined) incident.set(id, bucket = []);
    bucket.push(e);
  }
  const distance = new Map([[startId, 0]]);
  const parents: Record<string, string> = {}; Object.setPrototypeOf(parents, null); // keyed by ids from entries (S-13)
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
  const nodes = [...distance].map<TraversalNode>(([id, dist]: [string, number]) => rows.has(id) ? { id, distance: dist } : { id, distance: dist, missing: true })
    .sort((a: TraversalNode, b: TraversalNode) => a.distance - b.distance || a.id.localeCompare(b.id));
  return { nodes, edges: edges.filter((e: Edge) => distance.has(e.from) && distance.has(e.to)), parents };
}
