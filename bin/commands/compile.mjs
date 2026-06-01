import { join } from 'node:path';
import { writeFileSync, mkdirSync } from 'node:fs';
import { buildManifest } from '../lib/manifest.mjs';
import { rootIndex, folderIndex, FOLDER } from '../lib/indexview.mjs';
import { resolveVault } from '../lib/resolve.mjs';

export function compileVault(vaultPath) {
  const m = buildManifest(vaultPath);
  const out = join(vaultPath, '_index');
  mkdirSync(out, { recursive: true });
  writeFileSync(join(out, 'INDEX.md'), rootIndex(m), 'utf8');
  for (const type of Object.keys(FOLDER)) writeFileSync(join(out, `${FOLDER[type]}.md`), folderIndex(m, type), 'utf8');
  return { entries: m.entries.length };
}

export async function run(args) {
  const { path: vaultPath } = resolveVault({ flag: args.vault ?? null });
  if (args.stdout) { process.stdout.write(rootIndex(buildManifest(vaultPath))); return 0; }
  const r = compileVault(vaultPath);
  process.stdout.write(`compiled index for ${r.entries} entries → _index/\n`);
  return 0;
}
