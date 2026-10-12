import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { advise } from '../lib/advise.mjs';
import { resolveVault } from '../lib/resolve.mjs';

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

export async function run(args) {
  const { path: vaultPath } = resolveVault({ flag: args.vault ?? null });
  const r = advise(vaultPath, REPO_ROOT);
  if (args.json) { process.stdout.write(JSON.stringify(r, null, 2) + '\n'); return 0; }
  const section = (label, ids) => process.stdout.write(`${label} (${ids.length}): ${ids.length ? ids.join(', ') : '—'}\n`);
  process.stdout.write(`stale (${r.stale.length}): ${r.stale.length ? r.stale.map(s => s.id).join(', ') : '—'}\n`);
  process.stdout.write(`stale evidence (${r.staleEvidence.length})\n`);
  const w = Math.max(0, ...r.staleEvidence.map(d => d.id.length));
  for (const d of r.staleEvidence) for (const v of d.via) process.stdout.write(`  ${d.id.padEnd(w)} <- ${v.reason} ${v.id}  via ${v.path.join(' -> ')}\n`);
  section('orphans', r.orphans);
  section('sources without notes', r.sourcesWithoutNotes);
  section('unverified sources (captured, never independently checked)', r.unverifiedSources);
  section('notes/synthesis without a summary', r.missingSummaries);
  section('stub bodies (scaffold or empty, no prose)', r.stubBodies);
  section('aliasable topics', r.aliasable);
  section('quote residue (baked-in \\" — see upgrade notes)', r.quoteResidue);
  return 0;
}
