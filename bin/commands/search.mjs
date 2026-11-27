import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadSchema } from '../lib/schema.mjs';
import { buildManifest, matchRows } from '../lib/manifest.mjs';
import { walkEntries, readEntry } from '../lib/fsutil.mjs';
import { resolveVault } from '../lib/resolve.mjs';
import { staleness } from '../lib/stale.mjs';
import { appendUsage, USAGE_LOG } from '../lib/usagelog.mjs';
import { VAULT_PATH_OUTSIDE } from '../lib/containment.mjs';
import { loadProjectConfig } from '../lib/projectconfig.mjs';
import { cosine, embeddingDestination, embeddingGate, embedTexts, readIndex } from '../lib/embed.mjs';
import { screenText } from '../lib/screen.mjs';

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

export { matchRows };

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
    for (const abs of walkEntries(vaultPath)) {
      const e = readEntry(abs, { folderChecked: true });
      bodyById.set(e.id, (e.body || '').toLowerCase());
    }
    rows = rows.filter(e => (bodyById.get(e.id) || '').includes(needle));
  }
  if (q.sort !== undefined) rows = sortRows(rows, q.sort, schema, new Date(q.now || new Date().toISOString().slice(0, 10)));
  return rows;
}

// Spec 34: the stale multiplier on a semantic score. ponytail: one constant; make it a binding key if vaults disagree.
export const STALE_WEIGHT = 0.8;

// Spec 34: rank the facet-filtered, non-superseded rows by the best cosine over their windows.
export async function semanticSearch(vaultPath, cfg, query, q, { fetch, repoRoot = REPO_ROOT } = {}) {
  const { display, refusal } = embeddingDestination(cfg.url);
  if (refusal) throw new Error(refusal);
  const index = readIndex(vaultPath);
  if (!index) throw new Error('no embedding index; run embed first');
  const schema = loadSchema(repoRoot, { vaultPath });
  const rows = matchRows(buildManifest(vaultPath).entries.filter(e => e.status !== 'superseded'), q, schema.taxonomy.topic_aliases);
  process.stderr.write(`search: sending the query to ${display}\n`);
  const [qv] = await embedTexts(cfg, [query], { fetch });
  const best = new Map();
  for (const r of index.rows) {
    const s = cosine(qv, r.vector);
    if (!best.has(r.id) || s > best.get(r.id).score) best.set(r.id, { score: s, chunk: r.chunk });
  }
  const now = new Date(q.now || new Date().toISOString().slice(0, 10));
  return rows.filter(e => best.has(e.id)).map(e => {
    const { score, chunk } = best.get(e.id);
    return { ...e, score: staleness(e, schema, now) ? score * STALE_WEIGHT : score, chunk };
  }).sort((a, b) => b.score - a.score).slice(0, Number(q.limit) || 10);
}

function warnUsageRefusal(error) {
  if (error?.code === VAULT_PATH_OUTSIDE) {
    process.stderr.write(`search: usage log was not written because it resolves outside the vault (${USAGE_LOG})\n`);
  }
}

export async function run(args) {
  const now = args.now || new Date().toISOString().slice(0, 10);
  if (args.semantic !== undefined) return runSemantic(args, now);
  const { path: vaultPath } = resolveVault({ flag: args.vault ?? null });
  const rows = searchVault(vaultPath, { type: args.type, domain: args.domain, topic: args.topic, series: args.series, text: args.text, body: args.body, includeSuperseded: !!args['include-superseded'], sort: args.sort, now });
  // The usage log (spec 29): the facets and the ids returned; --text only behind usage.text.
  try {
    const cfg = loadProjectConfig(args.cwd ?? process.cwd(), { schema: loadSchema(REPO_ROOT) })?.config;
    appendUsage(vaultPath, { kind: 'queried', via: 'search', type: args.type, topic: args.topic, outcome: rows.length ? 'hits' : 'no-match', ids: rows.map(e => e.id), text: cfg?.usage?.text === true && args.text ? args.text : undefined });
  } catch (e) { warnUsageRefusal(e); }
  // --json is data (JSON.stringify escapes it); a text line's values from entries pass screenText (S-11).
  if (args.json) process.stdout.write(JSON.stringify(rows, null, 2) + '\n');
  else {
    const schema = loadSchema(REPO_ROOT);
    rows.forEach(e => process.stdout.write(`${screenText(e.id)}  [${screenText(e.type)}]  ${screenText(e.title)}  ${screenText(annotate(e, schema, new Date(now)))}${e.status === 'superseded' ? ` (superseded by ${screenText(e.superseded_by)})` : ''}\n`));
  }
  return 0;
}

async function runSemantic(args, now) {
  for (const f of ['sort', 'text', 'body']) if (args[f] !== undefined) { process.stderr.write(`search refused: --semantic cannot be combined with --${f}\n`); return 1; }
  if (!args.semantic) { process.stderr.write('search refused: --semantic needs a query\n'); return 1; }
  const gate = embeddingGate('search', { cwd: args.cwd, 'ack-data-egress': !!args['ack-data-egress'] });
  if (!gate) return 1;
  const { path: vaultPath } = resolveVault({ flag: args.vault ?? null });
  let rows;
  try {
    rows = await semanticSearch(vaultPath, gate.cfg, args.semantic, { type: args.type, domain: args.domain, topic: args.topic, series: args.series, limit: args.limit, now }, { fetch: typeof args.fetch === 'function' ? args.fetch : undefined });
  } catch (e) { process.stderr.write(`search refused: ${e.message}\n`); return 1; }
  try {
    const usage = loadProjectConfig(args.cwd ?? process.cwd(), { schema: loadSchema(REPO_ROOT) })?.config?.usage;
    appendUsage(vaultPath, { kind: 'queried', via: 'search', semantic: true, type: args.type, topic: args.topic, outcome: rows.length ? 'hits' : 'no-match', ids: rows.map(e => e.id), text: usage?.text === true ? args.semantic : undefined });
  } catch (e) { warnUsageRefusal(e); }
  if (args.json) process.stdout.write(JSON.stringify(rows, null, 2) + '\n');
  else {
    const schema = loadSchema(REPO_ROOT);
    rows.forEach(e => process.stdout.write(`${screenText(e.id)}  [${screenText(e.type)}]  ${screenText(e.title)}  ${screenText(annotate(e, schema, new Date(now)))}  score ${e.score.toFixed(2)} #${e.chunk.index}\n`));
  }
  return 0;
}
