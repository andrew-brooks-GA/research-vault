import { buildManifest } from '../lib/manifest.ts';
import { compileVault, rootIndex } from '../lib/indexview.mjs';
import { resolveVault } from '../lib/resolve.mjs';

export { compileVault };

export async function run(args) {
  const { path: vaultPath } = resolveVault({ flag: args.vault ?? null });
  if (args.stdout) { process.stdout.write(rootIndex(buildManifest(vaultPath))); return 0; }
  const r = compileVault(vaultPath);
  process.stdout.write(`compiled index for ${r.entries} entries → _index/\n`);
  return 0;
}
