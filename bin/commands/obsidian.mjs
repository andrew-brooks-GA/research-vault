import { join, resolve, dirname, relative, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { writeFileSync, mkdirSync, readFileSync } from 'node:fs';
import { buildManifest } from '../lib/manifest.mjs';
import { entryNote, codeNote, moc } from '../lib/obsidianview.mjs';
import { loadProjectConfig } from '../lib/projectconfig.mjs';
import { codeFiles, extractCodeLinks, langFor } from '../lib/codelinks.mjs';
import { resolveVault } from '../lib/resolve.mjs';
import { isInsideVault } from '../lib/containment.mjs';
import { ENTRY_FOLDERS } from '../lib/fsutil.mjs';
import { loadSchema } from '../lib/schema.mjs';

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

// The linked code files of the repo this vault lives in (spec 15 D7: the binding above the vault
// names it); none when the vault is unbound or the binding points at another vault.
function codeNotes(vaultPath, schema) {
  const hit = loadProjectConfig(vaultPath, { schema });
  if (!hit?.config.code) return [];
  const root = dirname(hit.path);
  if (resolve(root, hit.config.vault) !== resolve(vaultPath)) return [];
  return codeFiles(hit.config, root).flatMap((abs) => {
    const links = extractCodeLinks(readFileSync(abs, 'utf8'), langFor(extname(abs), hit.config));
    return links.length ? [{ file: relative(root, abs).replace(/\\/g, '/'), links }] : [];
  });
}

export function obsidianView(vaultPath, outDir = '_obsidian', { now = new Date() } = {}) {
  const out = join(vaultPath, outDir);
  if (!isInsideVault(vaultPath, out)) throw new Error(`obsidian refused: --out must be inside the vault (got ${outDir})`);
  if (resolve(out) === resolve(vaultPath)) throw new Error('obsidian refused: --out must not be the vault root');
  for (const f of ENTRY_FOLDERS) if (isInsideVault(join(vaultPath, f), out)) throw new Error(`obsidian refused: --out must not be inside canonical folder ${f}`);
  const m = buildManifest(vaultPath);
  const schema = loadSchema(REPO_ROOT, { vaultPath });
  mkdirSync(out, { recursive: true });
  for (const e of m.entries) writeFileSync(join(out, `${e.id}.md`), entryNote(m, e, { schema, now }), 'utf8');
  const code = codeNotes(vaultPath, schema);
  for (const c of code) {
    const p = join(out, 'code', `${c.file}.md`);
    mkdirSync(dirname(p), { recursive: true });
    writeFileSync(p, codeNote(c.file, c.links), 'utf8');
  }
  writeFileSync(join(out, 'MOC.md'), moc(m, code), 'utf8');
  return { entries: m.entries.length, code: code.length, out: outDir };
}

export async function run(args) {
  const { path: vaultPath } = resolveVault({ flag: args.vault ?? null });
  const r = obsidianView(vaultPath, args.out || '_obsidian');
  process.stdout.write(`wrote Obsidian view for ${r.entries} entries${r.code ? ` and ${r.code} code file(s)` : ''} → ${r.out}/\n`);
  return 0;
}
