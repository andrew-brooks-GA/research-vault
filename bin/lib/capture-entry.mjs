// Entry preparation and skeleton loading shared by legacy capture and capture-operation.mjs.
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readFileSync, existsSync } from 'node:fs';
import { loadSchema, fieldOrder } from './schema.mjs';
import { makeId, normalizeUrl, normalizeUrlSafe, verKey } from './ids.mjs';
import { sha256Tagged } from './hash.mjs';
import { buildManifest } from './manifest.mjs';
import { TYPE_FOLDER } from './fsutil.mjs';
import { assertControlledValues } from './validate.mjs';
import { csvList } from './args.ts';
import { loadBlocklist, matchBlock } from './blocklist.mjs';
import { screenText } from './screen.ts';

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

function loadSkeleton(repoRoot, type) {
  try { return readFileSync(join(repoRoot, 'vault-template', 'meta', 'entry-skeletons', `${type}.md`), 'utf8').trimEnd(); }
  catch { return ''; }
}

export function prepareEntry(vaultPath, opts, ctx = {}) {
  // JSON plans share the CLI's scalar semantics, including numeric versions and identities.
  opts = { ...opts };
  for (const key of ['title', 'type', 'now', 'url', 'volatility', 'byId', 'sourceType', 'subjectName', 'subjectVersion',
    'series', 'authorityTier', 'authorityBasis', 'capturedVia', 'sourceAuthor', 'summary', 'confidence',
    'question', 'synthesisBasis', 'language', 'provider', 'modelId', 'dateRun', 'task', 'outcome', 'state', 'answerSummary']) {
    if (opts[key] != null) opts[key] = String(opts[key]);
  }
  const repoRoot = opts.repoRoot || REPO_ROOT;
  const schema = loadSchema(repoRoot, { vaultPath });
  const now = opts.now || new Date().toISOString().slice(0, 10);
  const folder = Object.hasOwn(TYPE_FOLDER, opts.type) ? TYPE_FOLDER[opts.type] : null;
  if (!folder) throw new Error(`invalid type: ${opts.type}`);
  if (opts.storeBody && !opts.ackDataEgress)
    throw new Error('--store-body requires --ack-data-egress (storing source text is a data-egress / copyright surface)');
  if (!opts.title) throw new Error('title required');
  if (opts.type === 'source' && !opts.url) throw new Error('source requires url');
  // The source blocklist (spec 32): refused before the dedup check; --force records the override. The
  // refusal shows the row's fields through screenText (S-11): one line each, no hidden characters.
  const hit = opts.type === 'source' ? matchBlock(loadBlocklist(vaultPath), opts.url) : null;
  if (hit && !opts.force) throw new Error(`blocked source: ${screenText(hit.pattern)} (${screenText(hit.scope)}): ${screenText(hit.reason)}; --force captures anyway`);
  if (opts.type === 'note' && !(opts.sources && String(opts.sources).length)) throw new Error('note requires sources');
  if (opts.type === 'synthesis' && !(opts.contributingIds && String(opts.contributingIds).length)) throw new Error('synthesis requires contributingIds');

  const pending = ctx.pending || [];
  let manifestEntries = ctx.manifestEntries;
  const entries = () => (manifestEntries ??= buildManifest(vaultPath).entries);
  const hashInput = opts.contentBytes ?? (opts.content || null);
  const newHash = hashInput != null ? sha256Tagged(hashInput) : (opts.contentHash || null);
  if (!ctx.ignoreExisting && opts.type === 'source' && opts.url) {
    const normUrl = normalizeUrl(opts.url);
    // Issue 72 item 7: the version this capture stores; with no subject name it stores none (line 80).
    const version = verKey(opts.subjectName ? opts.subjectVersion : null);
    const existing = entries();
    const candidates = [...existing, ...pending.map(p => ({ id: p.id, source_url: normalizeUrlSafe(p.data.source_url), subject: p.data.subject, content_hash: p.data.content_hash }))];
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
  // Ids are vault-wide: a title that slugs to an id already used in another folder collides too.
  const taken = Object.values(TYPE_FOLDER).find(f => existsSync(join(vaultPath, f, `${id}.md`)));
  if (!ctx.ignoreExisting && (taken || pending.some(p => p.id === id))) {
    // Issue 72 item 7: a source gets here only at a URL and version that no entry holds, and an entry in another folder
    // is of another type, so the id belongs to another entry: an error, not a duplicate to skip.
    const where = taken || pending.find(p => p.id === id).folder;
    if (opts.type === 'source' || where !== folder) throw new Error(`id taken: entry id ${id} already exists in ${where}/ and is another entry; give this entry a more specific title`);
    return { dedup: { id, ambiguous: false, reason: `entry id ${id} already exists${taken ? ` in ${taken}/` : ''} (supersede via verify, do not overwrite)` } };
  }
  const data = {
    title: opts.title, type: opts.type, created: now,
    domain: opts.domain ? csvList(opts.domain) : ['software-engineering'],
    stage: schema.taxonomy.stage_by_folder[folder].default,
    topics: csvList(opts.topics).map(t => Object.hasOwn(schema.taxonomy.topic_aliases, t) ? schema.taxonomy.topic_aliases[t] : t),
    status: 'active', related: csvList(opts.related),
    volatility: opts.volatility || 'slow',
    verifications: [{ date: now, by_type: 'agent', by_id: opts.byId || '', method: 'captured', result: 'confirmed', notes: hit ? `captured with --force past the blocklist: ${hit.pattern} (${hit.scope}): ${hit.reason}` : '' }],
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
    if (opts.sourceAuthor) data.source_author = opts.sourceAuthor;
    if (opts.summary) data.summary = opts.summary;
  } else if (opts.type === 'note') {
    data.sources = csvList(opts.sources);
    data.confidence = opts.confidence || 'medium';
    if (opts.summary) data.summary = opts.summary;
  } else if (opts.type === 'synthesis') {
    data.contributing_ids = csvList(opts.contributingIds);
    if (opts.question) data.question = opts.question;
    if (opts.synthesisBasis) data.synthesis_basis = opts.synthesisBasis;
    if (opts.summary) data.summary = opts.summary;
    if (opts.confidence) data.confidence = opts.confidence; // no default: an unstated synthesis confidence stays visible
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
    if (opts.answerSummary) data.answer_summary = opts.answerSummary;
  }
  assertControlledValues(data, schema);
  const order = fieldOrder(schema, opts.type);
  let body;
  if (opts.body) {
    if (opts.type === 'source') throw new Error('source bodies are gated: use --store-body with --ack-data-egress');
    body = `# ${opts.title}\n\n${String(opts.body).trim()}\n`;
  } else {
    const skel = opts.scaffold ? loadSkeleton(repoRoot, opts.type) : '';
    body = skel ? `# ${opts.title}\n\n${skel}\n` : `# ${opts.title}\n`;
    if (opts.storeBody && opts.content) body += `\n${opts.content}\n`;
  }
  // Each edge must name a vault entry or an earlier item of the batch; with ignoreExisting the caller checks its own.
  if (!ctx.ignoreExisting) {
    const unresolved = [...(data.sources || []), ...(data.contributing_ids || []), ...data.related]
      .filter(ref => !entries().some(e => e.id === ref) && !pending.some(p => p.id === ref));
    if (unresolved.length) throw Object.assign(new Error(`unresolved reference: ${unresolved[0]}`), { unresolved });
  }
  return { id, path, folder, data, body, order, dedup: null };
}
