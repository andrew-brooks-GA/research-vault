import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { writeFileSync, mkdirSync, readFileSync, existsSync } from 'node:fs';
import { loadSchema, fieldOrder } from '../lib/schema.mjs';
import { makeId, normalizeUrl, sha256 } from '../lib/ids.mjs';
import { buildManifest } from '../lib/manifest.mjs';
import { writeEntry } from '../lib/fsutil.mjs';
import { resolveVault } from '../lib/resolve.mjs';
import { assertControlledValues } from '../lib/validate.mjs';

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const TYPE_FOLDER = { source:'sources', note:'notes', synthesis:'synthesis', snippet:'snippets', experiment:'experiments', question:'questions' };
const verKey = v => (v == null || v === '') ? null : String(v);

function loadSkeleton(repoRoot, type) {
  try { return readFileSync(join(repoRoot, 'vault-template', 'meta', 'entry-skeletons', `${type}.md`), 'utf8').trimEnd(); }
  catch { return ''; }
}

export function prepareEntry(vaultPath, opts, ctx = {}) {
  const repoRoot = opts.repoRoot || REPO_ROOT;
  const schema = loadSchema(repoRoot);
  const now = opts.now || new Date().toISOString().slice(0, 10);
  const folder = TYPE_FOLDER[opts.type];
  if (!folder) throw new Error(`invalid type: ${opts.type}`);
  if (opts.storeBody && !opts.ackDataEgress)
    throw new Error('--store-body requires --ack-data-egress (storing source text is a data-egress / copyright surface)');

  const pending = ctx.pending || [];
  const hashInput = opts.contentBytes ?? (opts.content || null);
  const newHash = hashInput != null ? sha256(hashInput) : (opts.contentHash || null);
  if (opts.type === 'source' && opts.url) {
    const normUrl = normalizeUrl(opts.url);
    const version = verKey(opts.subjectVersion);
    const existing = ctx.manifestEntries || buildManifest(vaultPath).entries;
    const candidates = [...existing, ...pending.map(p => ({ id: p.id, source_url: p.data.source_url, subject: p.data.subject, content_hash: p.data.content_hash }))];
    for (const e of candidates) {
      if (e.source_url === normUrl && verKey(e.subject?.version) === version) {
        if (newHash && e.content_hash && newHash !== e.content_hash) {
          // §4.2 tripwire: same url+version but content changed → ambiguous (edit / new version / supersede)
          return { dedup: { id: e.id, ambiguous: true, reason: 'content changed at same url+version — verify (edit / new version / supersede)' } };
        }
        return { dedup: { id: e.id, ambiguous: false, reason: `existing entry with same url${version ? ' + version' : ''}` } };
      }
    }
  }

  const id = makeId(now, opts.title);
  const path = join(vaultPath, folder, `${id}.md`);
  if (existsSync(path) || pending.some(p => p.id === id))
    return { dedup: { id, ambiguous: false, reason: `entry id ${id} already exists (supersede via verify, do not overwrite)` } };
  const data = {
    title: opts.title, type: opts.type, created: now,
    domain: opts.domain ? opts.domain.split(',') : ['software-engineering'],
    stage: schema.taxonomy.stage_by_folder[folder].default,
    topics: (opts.topics ? opts.topics.split(',') : []).map(t => schema.taxonomy.topic_aliases[t] || t),
    status: 'active', related: opts.related ? opts.related.split(',') : [],
    volatility: opts.volatility || 'slow',
    verifications: [{ date: now, by_type: 'agent', by_id: opts.byId || '', method: 'captured', result: 'confirmed', notes: '' }],
  };
  if (opts.type === 'source') {
    data.source_type = opts.sourceType || 'article';
    data.source_url = opts.url || '';
    if (newHash) data.content_hash = newHash;
    if (opts.subjectName) data.subject = { name: opts.subjectName, version: opts.subjectVersion || '' };
    if (opts.series) data.series = opts.series;
    if (opts.authorityTier) data.authority_tier = opts.authorityTier;
    if (opts.authorityBasis) data.authority_basis = opts.authorityBasis;
    if (opts.capturedVia) data.captured_via = opts.capturedVia;
  } else if (opts.type === 'note') {
    data.sources = opts.sources ? opts.sources.split(',') : [];
    data.confidence = opts.confidence || 'medium';
    if (opts.summary) data.summary = opts.summary;
  } else if (opts.type === 'synthesis') {
    data.contributing_ids = opts.contributingIds ? opts.contributingIds.split(',') : [];
    if (opts.question) data.question = opts.question;
    if (opts.synthesisBasis) data.synthesis_basis = opts.synthesisBasis;
    if (opts.summary) data.summary = opts.summary;
  } else if (opts.type === 'snippet') {
    data.language = opts.language || 'text';
    data.tested = opts.tested === true || opts.tested === 'true';
  } else if (opts.type === 'experiment') {
    data.provider = opts.provider || 'unknown';
    data.model_id = opts.modelId || 'unknown';
    data.date_run = opts.dateRun || now;
    data.task = opts.task || opts.title;
    data.outcome = opts.outcome || 'inconclusive';
  } else if (opts.type === 'question') {
    data.question = opts.question || opts.title;
    data.state = opts.state || 'open';
  }
  assertControlledValues(data, schema);
  const order = fieldOrder(schema, opts.type);
  const skel = opts.scaffold ? loadSkeleton(repoRoot, opts.type) : '';
  let body = skel ? `# ${opts.title}\n\n${skel}\n` : `# ${opts.title}\n`;
  if (opts.storeBody && opts.content) body += `\n${opts.content}\n`;
  return { id, path, folder, data, body, order, dedup: null };
}

export function captureEntry(vaultPath, opts) {
  const prep = prepareEntry(vaultPath, opts);
  if (prep.dedup) return { dedup: prep.dedup };
  mkdirSync(join(vaultPath, prep.folder), { recursive: true });
  writeEntry(prep.path, prep.data, prep.body, prep.order);
  writeFileSync(join(vaultPath, '.vault-manifest.json'), JSON.stringify(buildManifest(vaultPath), null, 2), 'utf8');
  return { id: prep.id, path: prep.path, dedup: null };
}

const csv = v => Array.isArray(v) ? v.join(',') : v;

function specToOpts(spec, cliOpts) {
  const cfBuf = spec.contentFile ? readFileSync(spec.contentFile) : null;
  return {
    ...spec,
    domain: csv(spec.domain), topics: csv(spec.topics), related: csv(spec.related),
    sources: csv(spec.sources), contributingIds: csv(spec.contributingIds),
    content: cfBuf ? cfBuf.toString('utf8') : spec.content, contentBytes: cfBuf,
    ackDataEgress: !!cliOpts.ackDataEgress, now: cliOpts.now, repoRoot: cliOpts.repoRoot,
  };
}

export function runBatch(vaultPath, planPath, cliOpts = {}) {
  let plan;
  try { plan = JSON.parse(readFileSync(planPath, 'utf8')); }
  catch (e) { return { errors: [{ index: -1, error: `cannot read plan: ${e.message}` }], created: [], skipped: [] }; }
  if (!Array.isArray(plan) || plan.length === 0)
    return { errors: [{ index: -1, error: 'plan must be a non-empty JSON array' }], created: [], skipped: [] };

  const manifestEntries = buildManifest(vaultPath).entries;
  const knownIds = new Set(manifestEntries.map(e => e.id));
  const errors = [], skipped = [], pending = [];
  plan.forEach((spec, index) => {
    if (spec.type === 'note' && !csv(spec.sources)) { errors.push({ index, error: 'note requires sources' }); return; }
    if (spec.type === 'synthesis' && !csv(spec.contributingIds)) { errors.push({ index, error: 'synthesis requires contributingIds' }); return; }
    try {
      const prep = prepareEntry(vaultPath, specToOpts(spec, cliOpts), { manifestEntries, pending });
      if (prep.dedup) {
        if (prep.dedup.ambiguous) errors.push({ index, error: `${prep.dedup.reason} (existing: ${prep.dedup.id})` });
        else skipped.push({ index, id: prep.dedup.id, reason: prep.dedup.reason });
        return;
      }
      const refs = [...(prep.data.sources || []), ...(prep.data.contributing_ids || []), ...(prep.data.related || [])];
      for (const ref of refs) {
        if (!knownIds.has(ref) && !pending.some(p => p.id === ref))
          errors.push({ index, error: `unresolved reference: ${ref}` });
      }
      pending.push(prep);
    } catch (e) { errors.push({ index, error: e.message }); }
  });
  if (errors.length) return { errors, created: [], skipped };

  for (const prep of pending) {
    mkdirSync(join(vaultPath, prep.folder), { recursive: true });
    writeEntry(prep.path, prep.data, prep.body, prep.order);
  }
  writeFileSync(join(vaultPath, '.vault-manifest.json'), JSON.stringify(buildManifest(vaultPath), null, 2), 'utf8');
  return { errors: [], created: pending.map(p => ({ id: p.id, path: p.path })), skipped };
}

export async function run(args) {
  const { path: vaultPath } = resolveVault({ flag: args.vault ?? null });
  const cfBuf = args['content-file'] ? readFileSync(args['content-file']) : null;
  const r = captureEntry(vaultPath, {
    type: args.type, title: args.title, url: args.url, sourceType: args['source-type'],
    subjectName: args['subject-name'], subjectVersion: args['subject-version'], series: args.series,
    domain: args.domain, topics: args.topics, related: args.related, volatility: args.volatility,
    content: cfBuf ? cfBuf.toString('utf8') : args.content, contentBytes: cfBuf, contentHash: args['content-hash'],
    capturedVia: args['captured-via'], storeBody: !!args['store-body'], ackDataEgress: !!args['ack-data-egress'],
    sources: args.sources, confidence: args.confidence, summary: args.summary,
    contributingIds: args['contributing-ids'], question: args.question,
    synthesisBasis: args['synthesis-basis'],
    authorityTier: args['authority-tier'], authorityBasis: args['authority-basis'],
    language: args.language, tested: args.tested,
    provider: args.provider, modelId: args['model-id'], dateRun: args['date-run'], task: args.task, outcome: args.outcome, state: args.state,
    scaffold: !!args.scaffold,
  });
  if (r.dedup) {
    const how = r.dedup.ambiguous ? 'ambiguous' : 'duplicate';
    process.stdout.write(`${how} of ${r.dedup.id} (${r.dedup.reason}); run verify instead.\n`);
    return 1;
  }
  process.stdout.write(`created ${r.path}\n`);
  return 0;
}
