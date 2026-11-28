import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { advise, OPEN_QUESTION_DAYS } from '../lib/advise.mjs';
import { resolveVault } from '../lib/resolve.mjs';
import { screenText } from '../lib/screen.ts';

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

export async function run(args) {
  const { path: vaultPath } = resolveVault({ flag: args.vault ?? null });
  const r = advise(vaultPath, REPO_ROOT);
  if (args.json) { process.stdout.write(JSON.stringify(r, null, 2) + '\n'); return 0; }
  // Text lines: each value from an entry or the usage log passes screenText (S-11); --json is data.
  const t = v => screenText(v);
  const section = (label, ids) => process.stdout.write(`${label} (${ids.length}): ${ids.length ? ids.map(t).join(', ') : '\u2014'}\n`);
  process.stdout.write(`stale (${r.stale.length}): ${r.stale.length ? r.stale.map(s => t(s.id)).join(', ') : '\u2014'}\n`);
  process.stdout.write(`stale evidence (${r.staleEvidence.length})\n`);
  const w = Math.max(0, ...r.staleEvidence.map(d => t(d.id).length));
  for (const d of r.staleEvidence) for (const v of d.via) process.stdout.write(`  ${t(d.id).padEnd(w)} <- ${v.reason} ${t(v.id)}  via ${v.path.map(t).join(' -> ')}\n`);
  section('orphans', r.orphans);
  section('sources without notes', r.sourcesWithoutNotes);
  section('unverified sources (captured, never independently checked)', r.unverifiedSources);
  section('notes/synthesis without a summary', r.missingSummaries);
  section('stub bodies (scaffold or empty, no prose)', r.stubBodies);
  section('aliasable topics', r.aliasable);
  section('quote residue (baked-in \\" — see upgrade notes)', r.quoteResidue);
  process.stdout.write(`open questions over ${OPEN_QUESTION_DAYS} days (${r.openQuestions.length}): ${r.openQuestions.length ? r.openQuestions.map(q => `${t(q.id)} (${t(q.state)}, ${q.ageDays}d)`).join(', ') : '\u2014'}\n`);
  process.stdout.write(`supersede suspects (${r.supersedeSuspects.length}): ${r.supersedeSuspects.length ? r.supersedeSuspects.map(p => `${t(p.older)} -> ${t(p.newer)} (${p.by})`).join(', ') : '\u2014'}\n`);
  process.stdout.write(`near duplicates (${r.nearDuplicates.length}): ${r.nearDuplicates.length ? r.nearDuplicates.map(p => `${t(p.older)} -> ${t(p.newer)} (${p.by})`).join(', ') : '\u2014'}\n`);
  const u = r.usage, topics = Object.entries(u.topics);
  process.stdout.write(`usage (${u.entries.length}): ${u.entries.length ? u.entries.map(e => `${t(e.id)} (surfaced ${e.surfaced}, cited ${e.cited})`).join(', ') : '\u2014'}\n`);
  process.stdout.write(`topics queried (${topics.length}): ${topics.length ? topics.map(([k, c]) => `${t(k)} (${c.queried} queried, ${c.noMatch} no-match)`).join(', ') : '\u2014'}\n`);
  section('cold sources under a queried topic', u.cold.queried);
  section('cold sources never queried', u.cold.unqueried);
  return 0;
}
