import { join, resolve } from 'node:path';
import { writeFileSync, mkdirSync } from 'node:fs';
import { buildManifest } from '../lib/manifest.mjs';
import { entryNote, moc } from '../lib/obsidianview.mjs';
import { resolveVault } from '../lib/resolve.mjs';
import { isInsideVault } from '../lib/containment.mjs';
import { ENTRY_FOLDERS } from '../lib/fsutil.mjs';

export function obsidianView(vaultPath, outDir = '_obsidian') {
  const out = join(vaultPath, outDir);
  if (!isInsideVault(vaultPath, out)) throw new Error(`obsidian refused: --out must be inside the vault (got ${outDir})`);
  if (resolve(out) === resolve(vaultPath)) throw new Error('obsidian refused: --out must not be the vault root');
  for (const f of ENTRY_FOLDERS) if (isInsideVault(join(vaultPath, f), out)) throw new Error(`obsidian refused: --out must not be inside canonical folder ${f}`);
  const m = buildManifest(vaultPath);
  mkdirSync(out, { recursive: true });
  for (const e of m.entries) writeFileSync(join(out, `${e.id}.md`), entryNote(m, e), 'utf8');
  writeFileSync(join(out, 'MOC.md'), moc(m), 'utf8');
  return { entries: m.entries.length, out: outDir };
}

export async function run(args) {
  const { path: vaultPath } = resolveVault({ flag: args.vault ?? null });
  const r = obsidianView(vaultPath, args.out || '_obsidian');
  process.stdout.write(`wrote Obsidian view for ${r.entries} entries → ${r.out}/\n`);
  return 0;
}
