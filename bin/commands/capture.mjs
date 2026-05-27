import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { writeFileSync } from 'node:fs';
import { loadSchema, fieldOrder } from '../lib/schema.mjs';
import { makeId, normalizeUrl } from '../lib/ids.mjs';
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

  if (opts.type === 'source' && opts.url) {
    const normUrl = normalizeUrl(opts.url);
    const version = opts.subjectVersion || null;
    for (const e of buildManifest(vaultPath).entries) {
      if (e.source_url === normUrl) {
        const sameVersion = (e.subject?.version || null) === version;
        if (sameVersion) return { dedup: { id: e.id, reason: `existing entry with same url${version ? ' + version' : ''}` } };
      }
    }
  }

  const id = makeId(now, opts.title);
  const data = {
    title: opts.title, type: opts.type, created: now,
    domain: opts.domain ? opts.domain.split(',') : ['software-engineering'],
    stage: schema.taxonomy.stage_by_folder[folder].default,
    topics: opts.topics ? opts.topics.split(',') : [],
    status: 'active', related: opts.related ? opts.related.split(',') : [],
    volatility: opts.volatility || 'slow',
    verifications: [{ date: now, by_type: 'agent', by_id: opts.byId || '', method: 'existence-check', result: 'confirmed', notes: '' }],
  };
  if (opts.type === 'source') {
    data.source_type = opts.sourceType || 'article';
    data.source_url = opts.url || '';
    if (opts.subjectName) data.subject = { name: opts.subjectName, version: opts.subjectVersion || '' };
    if (opts.series) data.series = opts.series;
  }
  const order = fieldOrder(schema, opts.type);
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
  });
  if (r.dedup) { process.stdout.write(`duplicate of ${r.dedup.id} (${r.dedup.reason}); run verify instead.\n`); return 1; }
  process.stdout.write(`created ${r.path}\n`);
  return 0;
}
