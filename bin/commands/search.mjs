import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadSchema } from '../lib/schema.mjs';
import { buildManifest } from '../lib/manifest.mjs';
import { walkEntries, readEntry } from '../lib/fsutil.mjs';
import { resolveVault } from '../lib/resolve.mjs';
import { staleness } from '../lib/stale.mjs';
import { appendUsage } from '../lib/usagelog.mjs';
import { loadProjectConfig } from '../lib/projectconfig.mjs';

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

// The in-memory filters (type, domain, series, topic through the aliases, text over title, topics and
// summary) over manifest rows; shared with `teach path candidates`, which runs them over one manifest.
export function matchRows(rows, q, aliases = {}) {
  const expand = t => aliases[t] || t;
  if (q.type) rows = rows.filter(e => e.type === q.type);
  if (q.domain) rows = rows.filter(e => e.domain.includes(q.domain));
  if (q.series) rows = rows.filter(e => e.series === q.series);
  if (q.topic) { const want = expand(q.topic); rows = rows.filter(e => e.topics.map(expand).includes(want)); }
  if (q.text) { const t = q.text.toLowerCase(); rows = rows.filter(e => (e.title || '').toLowerCase().includes(t) || e.topics.join(' ').toLowerCase().includes(t) || (e.summary || '').toLowerCase().includes(t)); }
  return rows;
}

export const SORTS = ['authority', 'fresh'];

// Spec 23: `authority` orders by the taxonomy's tier array, untiered rows last; `fresh` orders fresh, stale,
// not assessable. Ties keep their incoming (manifest) order. Pure: a new array, no file read.
export function sortRows(rows, by, schema, now) {
  if (!SORTS.includes(by)) throw new Error(`--sort must be ${SORTS.join(' or ')}`);
  const tiers = schema.taxonomy.authority_tier;
  const key = by === 'authority'
    ? e => { const i = tiers.indexOf(e.authority_tier); return i < 0 ? tiers.length : i; }
    : e => { const s = staleness(e, schema, now); return s === false ? 0 : s === null ? 2 : 1; };
  return [...rows].sort((a, b) => key(a) - key(b));
}

// The text line's suffix: the tier or `no tier`, then `fresh` or `stale` when the volatility window is known.
export function annotate(e, schema, now) {
  const s = staleness(e, schema, now);
  return `(${e.authority_tier || 'no tier'}${s === null ? '' : s === false ? ', fresh' : ', stale'})`;
}

export function searchVault(vaultPath, q, repoRoot = REPO_ROOT) {
  const schema = loadSchema(repoRoot, { vaultPath });
  let rows = buildManifest(vaultPath).entries;
  // Validity gate: superseded entries are retired from search; traversal (`related`) still sees them.
  if (!q.includeSuperseded) rows = rows.filter(e => e.status !== 'superseded');
  rows = matchRows(rows, q, schema.taxonomy.topic_aliases);
  if (q.body) {
    const needle = q.body.toLowerCase();
    const bodyById = new Map();
    for (const abs of walkEntries(vaultPath)) { const e = readEntry(abs); bodyById.set(e.id, (e.body || '').toLowerCase()); }
    rows = rows.filter(e => (bodyById.get(e.id) || '').includes(needle));
  }
  if (q.sort !== undefined) rows = sortRows(rows, q.sort, schema, new Date(q.now || new Date().toISOString().slice(0, 10)));
  return rows;
}

export async function run(args) {
  const { path: vaultPath } = resolveVault({ flag: args.vault ?? null });
  const now = args.now || new Date().toISOString().slice(0, 10);
  const rows = searchVault(vaultPath, { type: args.type, domain: args.domain, topic: args.topic, series: args.series, text: args.text, body: args.body, includeSuperseded: !!args['include-superseded'], sort: args.sort, now });
  // The usage log (spec 29): the facets and the ids returned; --text only behind usage.text.
  try {
    const cfg = loadProjectConfig(process.cwd(), { schema: loadSchema(REPO_ROOT) })?.config;
    appendUsage(vaultPath, { kind: 'queried', via: 'search', type: args.type, topic: args.topic, outcome: rows.length ? 'hits' : 'no-match', ids: rows.map(e => e.id), text: cfg?.usage?.text === true && args.text ? args.text : undefined });
  } catch { /* the log never changes the answer */ }
  if (args.json) process.stdout.write(JSON.stringify(rows, null, 2) + '\n');
  else {
    const schema = loadSchema(REPO_ROOT);
    rows.forEach(e => process.stdout.write(`${e.id}  [${e.type}]  ${e.title}  ${annotate(e, schema, new Date(now))}${e.status === 'superseded' ? ` (superseded by ${e.superseded_by})` : ''}\n`));
  }
  return 0;
}
