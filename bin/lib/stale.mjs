import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadSchema } from './schema.mjs';
import { buildManifest } from './manifest.mjs';

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

// null = volatility unknown/absent, not assessable; false = fresh; object = stale
// (with `reason` for always-re-check volatility, `ageDays` otherwise).
export function staleness(entry, schema, now) {
  const win = schema.taxonomy.volatility[entry.volatility]?.refresh_after_days;
  if (win === undefined) return null;
  if (win === 0) return { reason: 'always re-check' };
  const last = entry.last_verified ? new Date(entry.last_verified) : null;
  const ageDays = last ? (now - last) / 86400000 : Infinity;
  return ageDays > win ? { ageDays: Math.round(ageDays) } : false;
}

export function listStale(vaultPath, opts = {}) {
  const schema = loadSchema(opts.repoRoot || REPO_ROOT);
  const now = new Date(opts.now || new Date().toISOString().slice(0, 10));
  const out = [];
  for (const e of buildManifest(vaultPath).entries) {
    const s = staleness(e, schema, now);
    if (s) out.push({ id: e.id, volatility: e.volatility, ...s });
  }
  return out;
}
