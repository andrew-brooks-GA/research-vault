import { writeFileSync } from 'node:fs';
import { buildExport, toJsonl } from '../lib/exportjsonl.mjs';
import { resolveVault } from '../lib/resolve.mjs';
import { isInsideVault } from '../lib/containment.mjs';

export async function run(args) {
  if (args.format && args.format !== 'jsonl') { process.stderr.write(`unsupported --format: ${args.format} (only jsonl)\n`); return 1; }
  const { path: vaultPath } = resolveVault({ flag: args.vault ?? null });
  let records;
  try {
    records = buildExport(vaultPath, {
      scope: args.scope ? args.scope.split(',') : null,
      includeBodies: !!args['include-bodies'],
      ackDataEgress: !!args['ack-data-egress'],
    });
  } catch (e) { process.stderr.write(`export refused: ${e.message}\n`); return 1; }
  const out = toJsonl(records);
  const bytes = Buffer.byteLength(out, 'utf8');
  const typeCounts = {};
  for (const r of records) typeCounts[r.meta.type] = (typeCounts[r.meta.type] || 0) + 1;
  if (args.out) {
    if (isInsideVault(vaultPath, args.out)) { process.stderr.write(`export refused: --out must be outside the vault (got ${args.out})\n`); return 1; }
    writeFileSync(args.out, out, 'utf8'); process.stdout.write(`wrote ${records.length} records (${bytes} bytes) to ${args.out} — ${JSON.stringify(typeCounts)}\n`);
  }
  else { process.stdout.write(out); process.stderr.write(`# ${records.length} records, ${bytes} bytes, ${JSON.stringify(typeCounts)}\n`); }
  return 0;
}
