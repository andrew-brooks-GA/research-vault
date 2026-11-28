import { buildManifest, writeManifest, danglingEdges } from '../lib/manifest.mjs';
import { resolveVault } from '../lib/resolve.mjs';
import { screenText } from '../lib/screen.ts';

export async function run(args) {
  const { path: vaultPath } = resolveVault({ flag: args.vault ?? null });
  const m = buildManifest(vaultPath);
  if (args.rebuild) {
    const dangling = danglingEdges(m);
    // Ids from file names and entry fields pass screenText (S-11): one line per edge. The JSON is data.
    if (dangling.length) process.stderr.write([`manifest: ${dangling.length} dangling edge(s)`, ...dangling.map((e) => `  ${screenText(e.from)} --${e.rel}--> ${screenText(e.to)}`)].join('\n') + '\n');
    writeManifest(vaultPath, m);
    process.stdout.write(`manifest: ${m.entries.length} entries\n`);
  }
  // `--topics` takes no value here (a boolean in manifest's table, args.ts; capture --topics takes a list).
  // The vocabulary search sees by default: no superseded. Each topic passes screenText (S-11).
  if (args.topics === true) {
    const counts = new Map();
    for (const e of m.entries) if (e.status !== 'superseded') for (const t of e.topics) counts.set(t, (counts.get(t) ?? 0) + 1);
    process.stdout.write([...counts].sort(([a], [b]) => a.localeCompare(b)).map(([t, n]) => `${screenText(t)} ${n}\n`).join(''));
  } else if (!args.rebuild) process.stdout.write(JSON.stringify(m, null, 2) + '\n');
  return 0;
}
