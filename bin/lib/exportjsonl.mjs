import { walkEntries, readEntry } from './fsutil.mjs';

function lastVerified(data) { return (data.verifications || []).map(v => v.date).sort().pop() || null; }

export function buildExport(vaultPath, opts = {}) {
  const scope = opts.scope && opts.scope.length ? opts.scope : ['question'];
  const includeBodies = !!opts.includeBodies;
  if (includeBodies && !opts.ackDataEgress)
    throw new Error('--include-bodies requires --ack-data-egress (exporting entry bodies is a data-egress / copyright surface)');
  const records = [];
  for (const abs of walkEntries(vaultPath)) {
    const { id, data, body } = readEntry(abs);
    if (!scope.includes(data.type)) continue;
    const meta = { id, type: data.type, last_verified: lastVerified(data) };
    if (data.type === 'question') {
      if (data.state === 'answered' && data.answer_summary && data.answer_summary.trim())
        records.push({ input: data.question, output: data.answer_summary, meta });
      continue;
    }
    records.push({ input: data.title || id, output: includeBodies ? body : (data.summary != null ? String(data.summary) : ''), meta });
  }
  records.sort((a, b) => a.meta.id.localeCompare(b.meta.id));
  return records;
}

export function toJsonl(records) { return records.map(r => JSON.stringify(r)).join('\n') + (records.length ? '\n' : ''); }
