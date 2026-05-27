import { buildManifest } from '../lib/manifest.mjs';
import { resolveVault } from '../lib/resolve.mjs';

export function relatedTo(vaultPath, id) {
  const m = buildManifest(vaultPath);
  const e = m.entries.find(x => x.id === id);
  if (!e) throw new Error(`not found: ${id}`);
  return { id, forward: [...new Set([...e.related, ...e.contributing_ids, ...e.sources])], backlinks: m.backlinks[id] || [] };
}

export async function run(args) {
  const { path: vaultPath } = resolveVault({ flag: args.vault ?? null });
  const id = args._[1];
  const r = relatedTo(vaultPath, id);
  if (args.format === 'mermaid') {
    const lines = ['graph TD'];
    r.forward.forEach(t => lines.push(`  ${id} --> ${t}`));
    r.backlinks.forEach(s => lines.push(`  ${s} --> ${id}`));
    process.stdout.write(lines.join('\n') + '\n');
  } else process.stdout.write(JSON.stringify(r, null, 2) + '\n');
  return 0;
}
