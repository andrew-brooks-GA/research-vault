import { join } from 'node:path';
import { writeFileSync, mkdirSync } from 'node:fs';
import { buildManifest } from '../lib/manifest.mjs';
import { entryNote, moc } from '../lib/obsidianview.mjs';
import { resolveVault } from '../lib/resolve.mjs';

export function obsidianView(vaultPath, outDir = '_obsidian') {
  const m = buildManifest(vaultPath);
  const out = join(vaultPath, outDir);
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
