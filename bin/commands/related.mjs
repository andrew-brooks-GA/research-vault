import { buildManifest } from '../lib/manifest.mjs';
import { resolveVault } from '../lib/resolve.mjs';

export function relatedTo(vaultPath, id) {
  const m = buildManifest(vaultPath);
  const e = m.entries.find(x => x.id === id);
  if (!e) throw new Error(`not found: ${id}`);
  const edges = m.edges.filter(x => x.from === id || x.to === id);
  const forward = [...new Set(edges.filter(x => x.from === id).map(x => x.to))].sort();
  return { id, forward, backlinks: m.backlinks[id] || [], edges };
}

export async function run(args) {
  const { path: vaultPath } = resolveVault({ flag: args.vault ?? null });
  const id = args._[1];
  const r = relatedTo(vaultPath, id);
  if (args.format === 'mermaid') {
    const lines = ['graph TD', ...r.edges.map(e => `  ${e.from} -->|${e.rel}| ${e.to}`)];
    process.stdout.write(lines.join('\n') + '\n');
  } else process.stdout.write(JSON.stringify(r, null, 2) + '\n');
  return 0;
}
