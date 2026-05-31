import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadSchema } from '../lib/schema.mjs';
import { buildManifest } from '../lib/manifest.mjs';
import { walkEntries, readEntry } from '../lib/fsutil.mjs';
import { resolveVault } from '../lib/resolve.mjs';

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

export function searchVault(vaultPath, q, repoRoot = REPO_ROOT) {
  const schema = loadSchema(repoRoot);
  const aliases = schema.taxonomy.topic_aliases;
  const expand = t => aliases[t] || t;
  let rows = buildManifest(vaultPath).entries;
  if (q.type) rows = rows.filter(e => e.type === q.type);
  if (q.domain) rows = rows.filter(e => e.domain.includes(q.domain));
  if (q.series) rows = rows.filter(e => e.series === q.series);
  if (q.topic) { const want = expand(q.topic); rows = rows.filter(e => e.topics.map(expand).includes(want)); }
  if (q.text) { const t = q.text.toLowerCase(); rows = rows.filter(e => (e.title || '').toLowerCase().includes(t) || e.topics.join(' ').includes(t)); }
  if (q.body) {
    const needle = q.body.toLowerCase();
    const bodyById = new Map();
    for (const abs of walkEntries(vaultPath)) { const e = readEntry(abs); bodyById.set(e.id, (e.body || '').toLowerCase()); }
    rows = rows.filter(e => (bodyById.get(e.id) || '').includes(needle));
  }
  return rows;
}

export async function run(args) {
  const { path: vaultPath } = resolveVault({ flag: args.vault ?? null });
  const rows = searchVault(vaultPath, { type: args.type, domain: args.domain, topic: args.topic, series: args.series, text: args.text, body: args.body });
  if (args.json) process.stdout.write(JSON.stringify(rows, null, 2) + '\n');
  else rows.forEach(e => process.stdout.write(`${e.id}  [${e.type}]  ${e.title}\n`));
  return 0;
}
