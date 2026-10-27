import { buildManifest, writeManifest } from '../lib/manifest.mjs';
import { resolveVault } from '../lib/resolve.mjs';

export async function run(args) {
  const { path: vaultPath } = resolveVault({ flag: args.vault ?? null });
  const m = buildManifest(vaultPath);
  if (args.rebuild) { writeManifest(vaultPath, m); process.stdout.write(`manifest: ${m.entries.length} entries\n`); }
  else process.stdout.write(JSON.stringify(m, null, 2) + '\n');
  return 0;
}
