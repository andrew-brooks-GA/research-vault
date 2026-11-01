import { buildManifest, writeManifest, danglingEdges } from '../lib/manifest.mjs';
import { resolveVault } from '../lib/resolve.mjs';

export async function run(args) {
  const { path: vaultPath } = resolveVault({ flag: args.vault ?? null });
  const m = buildManifest(vaultPath);
  if (args.rebuild) {
    const dangling = danglingEdges(m);
    if (dangling.length) process.stderr.write([`manifest: ${dangling.length} dangling edge(s)`, ...dangling.map((e) => `  ${e.from} --${e.rel}--> ${e.to}`)].join('\n') + '\n');
    writeManifest(vaultPath, m);
    process.stdout.write(`manifest: ${m.entries.length} entries\n`);
  }
  // `--topics` takes no value (`topics` cannot be a BOOL flag: capture --topics takes a list), so the
  // key is present and args.topics is undefined. The vocabulary search sees by default: no superseded.
  if ('topics' in args && args.topics === undefined) {
    const counts = new Map();
    for (const e of m.entries) if (e.status !== 'superseded') for (const t of e.topics) counts.set(t, (counts.get(t) ?? 0) + 1);
    process.stdout.write([...counts].sort(([a], [b]) => a.localeCompare(b)).map(([t, n]) => `${t} ${n}\n`).join(''));
  } else if (!args.rebuild) process.stdout.write(JSON.stringify(m, null, 2) + '\n');
  return 0;
}
