import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildManifest } from '../lib/manifest.mjs';
import { traverse } from '../lib/graph.mjs';
import { loadSchema } from '../lib/schema.mjs';
import { resolveVault } from '../lib/resolve.mjs';

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const DIRECTIONS = ['out', 'in', 'both'];
const USAGE = 'usage: related <id> [--depth N] [--direction out|in|both] [--rel a,b] [--format mermaid]';

export function relatedTo(vaultPath, id, { depth = 1, direction = 'both', rels = null } = {}) {
  const m = buildManifest(vaultPath);
  const rows = new Map(m.entries.map(r => [r.id, r]));
  if (!rows.has(id)) throw new Error(`not found: ${id}`);
  // Depth-1 unfiltered compatibility arrays; --depth/--direction/--rel do not affect them.
  const forward = [...new Set(m.edges.filter(x => x.from === id).map(x => x.to))].sort();
  const t = traverse(m, id, { depth, direction, rels });
  const nodes = t.nodes.map(n => {
    const r = rows.get(n.id);
    return r ? { id: n.id, distance: n.distance, type: r.type, title: r.title, status: r.status, volatility: r.volatility, last_verified: r.last_verified } : n;
  });
  return { id, depth, direction, forward, backlinks: m.backlinks[id] || [], nodes, edges: t.edges };
}

export async function run(args) {
  const fail = msg => { process.stderr.write(`${msg}\n${USAGE}\n`); return 2; };
  const opts = {};
  if ('depth' in args) {
    opts.depth = Number(args.depth);
    if (!Number.isInteger(opts.depth) || opts.depth < 1) return fail('--depth must be an integer >= 1');
  }
  if ('direction' in args) {
    opts.direction = args.direction;
    if (!DIRECTIONS.includes(opts.direction)) return fail(`--direction must be one of ${DIRECTIONS.join('|')}`);
  }
  if ('rel' in args) {
    const { backlink, reference_only } = loadSchema(REPO_ROOT).fields.edge_fields;
    const known = [...backlink, ...reference_only];
    opts.rels = (args.rel ?? '').split(',').map(s => s.trim()).filter(Boolean);
    const bad = opts.rels.filter(r => !known.includes(r));
    if (!opts.rels.length || bad.length) return fail(`--rel must name relations from: ${known.join(', ')}`);
  }
  const { path: vaultPath } = resolveVault({ flag: args.vault ?? null });
  const id = args._[1];
  const r = relatedTo(vaultPath, id, opts);
  if (args.format === 'mermaid') {
    const lines = ['graph TD', ...(r.edges.length ? r.edges.map(e => `  ${e.from} -->|${e.rel}| ${e.to}`) : [`  ${id}`])];
    process.stdout.write(lines.join('\n') + '\n');
  } else process.stdout.write(JSON.stringify(r, null, 2) + '\n');
  return 0;
}
