import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { walkEntries, readEntry } from './fsutil.mjs';
import { lastVerified } from './manifest.mjs';
import { loadSchema } from './schema.mjs';
import { staleness } from './stale.mjs';

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const int = (v, name) => { const n = Number(v); if (!Number.isInteger(n)) throw new Error(`--${name} must be an integer`); return n; };

// Spec 33: one window per `chunk` characters stepping by `chunk - overlap`; a reader reassembles the
// text by appending each later window from offset `overlap`. An empty text is one empty window.
function windows(text, chunk, overlap) {
  const out = [];
  for (let start = 0; start === 0 || start < text.length; start += chunk - overlap) {
    const piece = text.slice(start, start + chunk);
    out.push({ start, end: start + piece.length, text: piece });
  }
  return out;
}

export function buildExport(vaultPath, opts = {}) {
  const scope = opts.scope && opts.scope.length ? opts.scope : ['question'];
  const includeBodies = !!opts.includeBodies;
  if (includeBodies && !opts.ackDataEgress)
    throw new Error('--include-bodies requires --ack-data-egress (exporting entry bodies is a data-egress / copyright surface)');
  const chunk = opts.chunk == null ? null : int(opts.chunk, 'chunk');
  const overlap = opts.overlap == null ? 0 : int(opts.overlap, 'overlap');
  if (chunk !== null && (chunk < 1 || overlap < 0 || overlap >= chunk)) throw new Error('--chunk must be at least 1 and --overlap at least 0 and below --chunk');
  const schema = opts.freshOnly || opts.minAuthority ? loadSchema(opts.repoRoot || REPO_ROOT, { vaultPath }) : null;
  const tiers = schema?.taxonomy.authority_tier ?? [];
  if (opts.minAuthority && !tiers.includes(opts.minAuthority)) throw new Error(`--min-authority must be one of ${tiers.join(', ')}`);
  const now = new Date(opts.now || new Date().toISOString().slice(0, 10));
  const records = [];
  for (const abs of walkEntries(vaultPath)) {
    const { id, data, body } = readEntry(abs);
    if (!scope.includes(data.type)) continue;
    const last = lastVerified(data.verifications);
    if (opts.freshOnly && (data.status === 'superseded' || staleness({ volatility: data.volatility, last_verified: last }, schema, now))) continue;
    if (opts.minAuthority && data.type === 'source' && data.authority_tier && tiers.indexOf(data.authority_tier) > tiers.indexOf(opts.minAuthority)) continue;
    const meta = { id, type: data.type, last_verified: last, topics: data.topics || [], authority_tier: data.authority_tier ?? null, volatility: data.volatility ?? null, source_url: data.source_url ?? null };
    if (data.type === 'question') {
      if (data.state === 'answered' && data.answer_summary && data.answer_summary.trim())
        records.push({ input: data.question, output: data.answer_summary, meta });
      continue;
    }
    records.push({ input: data.title || id, output: includeBodies ? body : (data.summary != null ? String(data.summary) : ''), meta });
  }
  records.sort((a, b) => a.meta.id.localeCompare(b.meta.id));
  if (chunk === null) return records;
  return records.flatMap(r => {
    const ws = windows(r.output, chunk, overlap);
    return ws.map((w, index) => ({ input: r.input, output: w.text, meta: { ...r.meta, chunk: { index, start: w.start, end: w.end, total: ws.length } } }));
  });
}

export function toJsonl(records) { return records.map(r => JSON.stringify(r)).join('\n') + (records.length ? '\n' : ''); }
