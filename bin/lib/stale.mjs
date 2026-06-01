import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadSchema } from './schema.mjs';
import { buildManifest } from './manifest.mjs';

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

export function listStale(vaultPath, opts = {}) {
  const schema = loadSchema(opts.repoRoot || REPO_ROOT);
  const now = new Date(opts.now || new Date().toISOString().slice(0, 10));
  const out = [];
  for (const e of buildManifest(vaultPath).entries) {
    const win = schema.taxonomy.volatility[e.volatility]?.refresh_after_days;
    if (win === undefined) continue;
    if (win === 0) { out.push({ id: e.id, volatility: e.volatility, reason: 'always re-check' }); continue; }
    const last = e.last_verified ? new Date(e.last_verified) : null;
    const ageDays = last ? (now - last) / 86400000 : Infinity;
    if (ageDays > win) out.push({ id: e.id, volatility: e.volatility, ageDays: Math.round(ageDays) });
  }
  return out;
}
