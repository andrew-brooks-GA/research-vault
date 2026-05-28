import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { writeFileSync, mkdirSync } from 'node:fs';
import { loadSchema, fieldOrder } from '../lib/schema.mjs';
import { makeId, normalizeUrl, sha256 } from '../lib/ids.mjs';
import { buildManifest } from '../lib/manifest.mjs';
import { writeEntry } from '../lib/fsutil.mjs';
import { resolveVault } from '../lib/resolve.mjs';

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const TYPE_FOLDER = { source:'sources', note:'notes', synthesis:'synthesis', snippet:'snippets', experiment:'experiments', question:'questions' };

export function captureEntry(vaultPath, opts) {
  const repoRoot = opts.repoRoot || REPO_ROOT;
  const schema = loadSchema(repoRoot);
  const now = opts.now || new Date().toISOString().slice(0, 10);
  const folder = TYPE_FOLDER[opts.type];
  if (!folder) throw new Error(`invalid type: ${opts.type}`);

  const newHash = opts.content ? sha256(opts.content) : (opts.contentHash || null);
  if (opts.type === 'source' && opts.url) {
    const normUrl = normalizeUrl(opts.url);
    const version = opts.subjectVersion || null;
    for (const e of buildManifest(vaultPath).entries) {
      if (e.source_url === normUrl && (e.subject?.version || null) === version) {
        if (newHash && e.content_hash && newHash !== e.content_hash) {
          // §4.2 tripwire: same url+version but content changed → ambiguous (edit / new version / supersede)
          return { dedup: { id: e.id, ambiguous: true, reason: 'content changed at same url+version — verify (edit / new version / supersede)' } };
        }
        return { dedup: { id: e.id, ambiguous: false, reason: `existing entry with same url${version ? ' + version' : ''}` } };
      }
    }
  }

  const id = makeId(now, opts.title);
  const data = {
    title: opts.title, type: opts.type, created: now,
    domain: opts.domain ? opts.domain.split(',') : ['software-engineering'],
    stage: schema.taxonomy.stage_by_folder[folder].default,
    topics: (opts.topics ? opts.topics.split(',') : []).map(t => schema.taxonomy.topic_aliases[t] || t),
    status: 'active', related: opts.related ? opts.related.split(',') : [],
    volatility: opts.volatility || 'slow',
    verifications: [{ date: now, by_type: 'agent', by_id: opts.byId || '', method: 'existence-check', result: 'confirmed', notes: '' }],
  };
  if (opts.type === 'source') {
    data.source_type = opts.sourceType || 'article';
    data.source_url = opts.url || '';
    if (newHash) data.content_hash = newHash;
    if (opts.subjectName) data.subject = { name: opts.subjectName, version: opts.subjectVersion || '' };
    if (opts.series) data.series = opts.series;
    if (opts.authorityTier) data.authority_tier = opts.authorityTier;
    if (opts.authorityBasis) data.authority_basis = opts.authorityBasis;
  } else if (opts.type === 'note') {
    data.sources = opts.sources ? opts.sources.split(',') : [];
    data.confidence = opts.confidence || 'medium';
  } else if (opts.type === 'synthesis') {
    data.contributing_ids = opts.contributingIds ? opts.contributingIds.split(',') : [];
    if (opts.question) data.question = opts.question;
    if (opts.synthesisBasis) data.synthesis_basis = opts.synthesisBasis;
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
  const order = fieldOrder(schema, opts.type);
  mkdirSync(join(vaultPath, folder), { recursive: true });
  const path = join(vaultPath, folder, `${id}.md`);
  writeEntry(path, data, `# ${opts.title}\n`, order);
  writeFileSync(join(vaultPath, '.vault-manifest.json'), JSON.stringify(buildManifest(vaultPath), null, 2), 'utf8');
  return { id, path, dedup: null };
}

export async function run(args) {
  const { path: vaultPath } = resolveVault({ flag: args.vault ?? null });
  const r = captureEntry(vaultPath, {
    type: args.type, title: args.title, url: args.url, sourceType: args['source-type'],
    subjectName: args['subject-name'], subjectVersion: args['subject-version'], series: args.series,
    domain: args.domain, topics: args.topics, related: args.related, volatility: args.volatility,
    content: args.content, contentHash: args['content-hash'],
    sources: args.sources, confidence: args.confidence,
    contributingIds: args['contributing-ids'], question: args.question,
    synthesisBasis: args['synthesis-basis'],
    authorityTier: args['authority-tier'], authorityBasis: args['authority-basis'],
    language: args.language, tested: args.tested,
    provider: args.provider, modelId: args['model-id'], dateRun: args['date-run'], task: args.task, outcome: args.outcome, state: args.state,
  });
  if (r.dedup) {
    const how = r.dedup.ambiguous ? 'ambiguous' : 'duplicate';
    process.stdout.write(`${how} of ${r.dedup.id} (${r.dedup.reason}); run verify instead.\n`);
    return 1;
  }
  process.stdout.write(`created ${r.path}\n`);
  return 0;
}
