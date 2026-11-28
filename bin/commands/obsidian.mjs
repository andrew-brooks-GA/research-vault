import { join, resolve, dirname, relative, extname, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { writeFileSync, mkdirSync, readFileSync, existsSync, lstatSync } from 'node:fs';
import { buildManifest } from '../lib/manifest.ts';
import { entryNote, codeNote, moc, graphSettings } from '../lib/obsidianview.mjs';
import { loadProjectConfig } from '../lib/projectconfig.ts';
import { codeFiles, extractCodeLinks, langFor } from '../lib/codelinks.mjs';
import { resolveVault } from '../lib/resolve.mjs';
import { assertInsideVault, escapePathControls, isInsideVault, mayBeInside, VAULT_PATH_OUTSIDE } from '../lib/containment.ts';
import { ENTRY_FOLDERS } from '../lib/fsutil.ts';
import { loadSchema } from '../lib/schema.ts';

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

function outputAtOwnPlace(vaultPath, out) {
  if (!isInsideVault(vaultPath, out, undefined, null)) return false;
  let path = resolve(vaultPath);
  for (const segment of relative(path, resolve(out)).split(sep)) {
    path = join(path, segment);
    try {
      const entry = lstatSync(path, { throwIfNoEntry: false });
      if (entry && (entry.isSymbolicLink() || !entry.isDirectory())) return false;
    } catch { return false; }
  }
  return true;
}

function assertInsideOutput(vaultPath, out, path) {
  try { assertInsideVault(out, path); }
  catch (err) {
    if (err.code !== VAULT_PATH_OUTSIDE) throw err;
    throw Object.assign(new Error(`${escapePathControls(relative(vaultPath, path))}: path is outside the output directory or cannot be resolved`), { code: VAULT_PATH_OUTSIDE });
  }
}

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
  if (!isInsideVault(vaultPath, out)) throw new Error(`obsidian refused: --out must be inside the vault (got ${escapePathControls(outDir)})`);
  if (resolve(out) === resolve(vaultPath)) throw new Error('obsidian refused: --out must not be the vault root');
  for (const f of ENTRY_FOLDERS) if (mayBeInside(join(vaultPath, f), out)) throw new Error(`obsidian refused: --out must not be inside canonical folder ${f}`);
  if (!outputAtOwnPlace(vaultPath, out)) throw Object.assign(new Error(`obsidian refused: --out must be a directory and must not be or pass through a link (got ${escapePathControls(outDir)})`), { code: VAULT_PATH_OUTSIDE });
  for (const f of ENTRY_FOLDERS) if (mayBeInside(out, join(vaultPath, f))) throw new Error(`obsidian refused: canonical folder ${f} must not be inside --out`);
  const m = buildManifest(vaultPath);
  const schema = loadSchema(REPO_ROOT, { vaultPath });
  assertInsideOutput(vaultPath, out, out);
  mkdirSync(out, { recursive: true });
  for (const e of m.entries) {
    const p = join(out, `${e.id}.md`);
    assertInsideOutput(vaultPath, out, p);
    writeFileSync(p, entryNote(m, e, { schema, now }), 'utf8');
  }
  const code = codeNotes(vaultPath, schema);
  for (const c of code) {
    const p = join(out, 'code', `${c.file}.md`);
    assertInsideOutput(vaultPath, out, dirname(p));
    mkdirSync(dirname(p), { recursive: true });
    assertInsideOutput(vaultPath, out, p);
    writeFileSync(p, codeNote(c.file, c.links), 'utf8');
  }
  assertInsideOutput(vaultPath, out, join(out, 'MOC.md'));
  writeFileSync(join(out, 'MOC.md'), moc(m, code), 'utf8');
  const graph = join(out, '.obsidian', 'graph.json');
  assertInsideOutput(vaultPath, out, graph);
  if (!existsSync(graph)) {
    assertInsideOutput(vaultPath, out, dirname(graph));
    mkdirSync(dirname(graph), { recursive: true });
    assertInsideOutput(vaultPath, out, graph);
    writeFileSync(graph, JSON.stringify(graphSettings(), null, 2) + '\n', 'utf8');
  }
  return { entries: m.entries.length, code: code.length, out: outDir };
}

export async function run(args) {
  const { path: vaultPath } = resolveVault({ flag: args.vault ?? null });
  const r = obsidianView(vaultPath, args.out || '_obsidian');
  process.stdout.write(`wrote Obsidian view for ${r.entries} entries${r.code ? ` and ${r.code} code file(s)` : ''} → ${r.out}/\n`);
  return 0;
}
