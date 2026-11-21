import { join } from 'node:path';
import { writeFileSync, mkdirSync } from 'node:fs';
import { buildManifest } from '../lib/manifest.mjs';
import { rootIndex, folderIndex, FOLDER } from '../lib/indexview.mjs';
import { resolveVault } from '../lib/resolve.mjs';
import { assertInsideVault } from '../lib/containment.mjs';

export function compileVault(vaultPath) {
  const m = buildManifest(vaultPath);
  const out = join(vaultPath, '_index');
  assertInsideVault(vaultPath, out);
  mkdirSync(out, { recursive: true });
  const write = (name, text) => {
    const path = join(out, name);
    assertInsideVault(vaultPath, path);
    writeFileSync(path, text, 'utf8');
  };
  write('INDEX.md', rootIndex(m));
  for (const type of Object.keys(FOLDER)) write(`${FOLDER[type]}.md`, folderIndex(m, type));
  return { entries: m.entries.length };
}

export async function run(args) {
  const { path: vaultPath } = resolveVault({ flag: args.vault ?? null });
  if (args.stdout) { process.stdout.write(rootIndex(buildManifest(vaultPath))); return 0; }
  const r = compileVault(vaultPath);
  process.stdout.write(`compiled index for ${r.entries} entries → _index/\n`);
  return 0;
}
