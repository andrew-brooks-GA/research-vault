import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadSchema } from './schema.mjs';
import { buildManifest } from './manifest.mjs';

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

// null = volatility unknown/absent, not assessable; false = fresh; object = stale
// (with `reason` for always-re-check volatility or no confirming verification, `ageDays` otherwise).
export function staleness(entry, schema, now) {
  const win = schema.taxonomy.volatility[entry.volatility]?.refresh_after_days;
  if (win === undefined) return null;
  if (win === 0) return { reason: 'always re-check' };
  if (!entry.last_verified) return { reason: 'never verified' };
  const ageDays = (now - new Date(entry.last_verified)) / 86400000;
  return ageDays > win ? { ageDays: Math.round(ageDays) } : false;
}

export function listStale(vaultPath, opts = {}) {
  const schema = loadSchema(opts.repoRoot || REPO_ROOT);
  const now = new Date(opts.now || new Date().toISOString().slice(0, 10));
  const out = [];
  for (const e of (opts.manifest || buildManifest(vaultPath)).entries) {
    const s = staleness(e, schema, now);
    if (s) out.push({ id: e.id, volatility: e.volatility, ...s });
  }
  return out;
}
