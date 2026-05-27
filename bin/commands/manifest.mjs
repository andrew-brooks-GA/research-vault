import { join } from 'node:path';
import { writeFileSync } from 'node:fs';
import { buildManifest } from '../lib/manifest.mjs';
import { resolveVault } from '../lib/resolve.mjs';

export async function run(args) {
  const { path: vaultPath } = resolveVault({ flag: args.vault ?? null });
  const m = buildManifest(vaultPath);
  if (args.rebuild) { writeFileSync(join(vaultPath, '.vault-manifest.json'), JSON.stringify(m, null, 2), 'utf8'); process.stdout.write(`manifest: ${m.entries.length} entries\n`); }
  else process.stdout.write(JSON.stringify(m, null, 2) + '\n');
  return 0;
}
