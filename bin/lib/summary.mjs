import { buildManifest } from './manifest.mjs';
import { listStale } from './stale.mjs';

export function vaultSummary(vaultPath, opts = {}) {
  const entries = buildManifest(vaultPath).entries;
  const stale = listStale(vaultPath, opts);
  return `${entries.length} entries; ${stale.length} stale`;
}
