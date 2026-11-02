import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolveVault } from '../lib/resolve.mjs';
import { loadSchema } from '../lib/schema.mjs';
import { loadProjectConfig } from '../lib/projectconfig.mjs';
import { buildExport } from '../lib/exportjsonl.mjs';
import { buildManifest } from '../lib/manifest.mjs';
import { TYPE_FOLDER } from '../lib/fsutil.mjs';
import { INDEX, embedTexts } from '../lib/embed.mjs';

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const BATCH = 64;

// Spec 34: the two gates every embedding command shares, then the binding block; null when refused.
export function embeddingGate(name, args) {
  const cfg = loadProjectConfig(args.cwd ?? process.cwd(), { schema: loadSchema(REPO_ROOT) })?.config?.embedding;
  if (!cfg) { process.stderr.write(`${name} refused: no embedding endpoint in .research-vault.json\n`); return null; }
  if (process.env.RESEARCH_VAULT_ALLOW_NETWORK !== '1') { process.stderr.write(`${name} refused: set RESEARCH_VAULT_ALLOW_NETWORK=1 to send text to ${cfg.url}\n`); return null; }
  if (!args['ack-data-egress']) { process.stderr.write(`${name} refused: --ack-data-egress is required (the text leaves this process for ${cfg.url})\n`); return null; }
  return cfg;
}

export async function run(args) {
  const cfg = embeddingGate('embed', args);
  if (!cfg) return 1;
  const { path: vaultPath } = resolveVault({ flag: args.vault ?? null });
  const superseded = new Set(buildManifest(vaultPath).entries.filter(e => e.status === 'superseded').map(e => e.id));
  const windows = buildExport(vaultPath, { scope: Object.keys(TYPE_FOLDER), includeBodies: true, ackDataEgress: true, chunk: cfg.chunk ?? 800, overlap: cfg.overlap ?? 100 }).filter(r => !superseded.has(r.meta.id));
  const fetch = typeof args.fetch === 'function' ? args.fetch : undefined;
  const lines = [];
  for (let i = 0; i < windows.length; i += BATCH) {
    const batch = windows.slice(i, i + BATCH);
    const vectors = await embedTexts(cfg, batch.map(w => w.output), { fetch });
    batch.forEach((w, j) => lines.push(JSON.stringify({ id: w.meta.id, chunk: w.meta.chunk, text: w.output, vector: vectors[j] })));
  }
  const header = { url: cfg.url, model: cfg.model ?? null, dimensions: lines.length ? JSON.parse(lines[0]).vector.length : 0, chunk: cfg.chunk ?? 800, overlap: cfg.overlap ?? 100, built: new Date().toISOString() };
  mkdirSync(join(vaultPath, '_index'), { recursive: true });
  writeFileSync(join(vaultPath, INDEX), [JSON.stringify(header), ...lines].join('\n') + '\n');
  process.stdout.write(`embedded ${lines.length} windows of ${new Set(windows.map(w => w.meta.id)).size} entries into ${INDEX}\n`);
  return 0;
}
