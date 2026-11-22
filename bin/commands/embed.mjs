import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolveVault } from '../lib/resolve.mjs';
import { loadSchema } from '../lib/schema.mjs';
import { loadProjectConfig } from '../lib/projectconfig.mjs';
import { buildExport } from '../lib/exportjsonl.mjs';
import { buildManifest } from '../lib/manifest.mjs';
import { TYPE_FOLDER } from '../lib/fsutil.mjs';
import { EMBEDDING_REQUEST_FAILED, INDEX, embeddingDestination, embedTexts } from '../lib/embed.mjs';
import { assertInsideVault } from '../lib/containment.mjs';

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const BATCH = 64;

// Check before resolving the vault and collecting text. embedTexts checks again at the request.
export function embeddingGate(name, args) {
  const cfg = loadProjectConfig(args.cwd ?? process.cwd(), { schema: loadSchema(REPO_ROOT) })?.config?.embedding;
  if (!cfg) { process.stderr.write(`${name} refused: no embedding endpoint in .research-vault.json\n`); return null; }
  const { display, refusal } = embeddingDestination(cfg.url);
  if (process.env.RESEARCH_VAULT_ALLOW_NETWORK !== '1') { process.stderr.write(`${name} refused: set RESEARCH_VAULT_ALLOW_NETWORK=1 to send text to ${display}\n`); return null; }
  if (!args['ack-data-egress']) { process.stderr.write(`${name} refused: --ack-data-egress is required (the text leaves this process for ${display})\n`); return null; }
  if (refusal) { process.stderr.write(`${name} refused: ${refusal}\n`); return null; }
  return { cfg, display };
}

export async function run(args) {
  const gate = embeddingGate('embed', args);
  if (!gate) return 1;
  const { cfg, display } = gate;
  const { path: vaultPath } = resolveVault({ flag: args.vault ?? null });
  const superseded = new Set(buildManifest(vaultPath).entries.filter(e => e.status === 'superseded').map(e => e.id));
  const windows = buildExport(vaultPath, { scope: Object.keys(TYPE_FOLDER), includeBodies: true, ackDataEgress: true, chunk: cfg.chunk ?? 800, overlap: cfg.overlap ?? 100 }).filter(r => !superseded.has(r.meta.id));
  const entries = new Set(windows.map(w => w.meta.id)).size;
  const fetch = typeof args.fetch === 'function' ? args.fetch : undefined;
  const lines = [];
  if (windows.length) process.stderr.write(`embed: sending ${windows.length} windows of ${entries} entries to ${display}\n`);
  try {
    for (let i = 0; i < windows.length; i += BATCH) {
      const batch = windows.slice(i, i + BATCH);
      const vectors = await embedTexts(cfg, batch.map(w => w.output), { fetch });
      batch.forEach((w, j) => lines.push(JSON.stringify({ id: w.meta.id, chunk: w.meta.chunk, text: w.output, vector: vectors[j] })));
    }
  } catch (e) {
    if (e?.code !== EMBEDDING_REQUEST_FAILED) throw e;
    process.stderr.write(`embed refused: ${e.message}\n`);
    return 1;
  }
  const header = { url: cfg.url, model: cfg.model ?? null, dimensions: lines.length ? JSON.parse(lines[0]).vector.length : 0, chunk: cfg.chunk ?? 800, overlap: cfg.overlap ?? 100, built: new Date().toISOString() };
  const path = join(vaultPath, INDEX);
  const dir = dirname(path);
  const text = [JSON.stringify(header), ...lines].join('\n') + '\n';
  assertInsideVault(vaultPath, dir);
  mkdirSync(dir, { recursive: true });
  assertInsideVault(vaultPath, path);
  writeFileSync(path, text);
  process.stdout.write(`embedded ${lines.length} windows of ${entries} entries into ${INDEX}\n`);
  return 0;
}
