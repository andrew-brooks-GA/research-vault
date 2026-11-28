import { join, dirname, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkdirSync, readFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { assertInsideVault } from '../lib/containment.ts';
import { loadSchema } from '../lib/schema.ts';
import { buildManifest, writeManifest } from '../lib/manifest.ts';
import { writeEntry } from '../lib/fsutil.ts';
import { resolveVault, reportFallback } from '../lib/resolve.mjs';
import { loadProjectConfig } from '../lib/projectconfig.ts';
import { fetchSource } from '../lib/fetchsource.ts';
import { blockedSourceMessage, loadBlocklist, sourceBlockCheck, SOURCE_BLOCKED } from '../lib/blocklist.ts';
import { parseFrontmatter } from '../lib/frontmatter.ts';
import { prepareEntry } from '../lib/capture-entry.mjs';
import { captureOperation } from '../lib/capture-operation.mjs';
import { extractText } from '../lib/extract.ts';
import { fillSource } from '../lib/fill.mjs';
import { screenText } from '../lib/screen.ts';

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

export function captureEntry(vaultPath, opts) {
  const prep = prepareEntry(vaultPath, opts);
  if (prep.dedup) return { dedup: prep.dedup };
  const folder = join(vaultPath, prep.folder);
  assertInsideVault(vaultPath, folder);
  mkdirSync(folder, { recursive: true });
  try {
    writeEntry(prep.path, prep.data, prep.body, prep.order, vaultPath, { exclusive: true });
  } catch (e) {
    if (e.code !== 'EEXIST') throw e;
    // Reuse the ordinary duplicate/id-taken classification after losing publication.
    const raced = prepareEntry(vaultPath, { ...opts, now: prep.data.created });
    if (raced.dedup) return { dedup: raced.dedup };
    throw e;
  }
  writeManifest(vaultPath);
  return { id: prep.id, path: prep.path, dedup: null };
}

const csv = v => Array.isArray(v) ? v.join(',') : v;

function specToOpts(spec, cliOpts) {
  const cfBuf = spec.contentFile ? readFileSync(spec.contentFile) : null;
  return {
    ...spec,
    domain: csv(spec.domain), topics: csv(spec.topics), related: csv(spec.related),
    sources: csv(spec.sources), contributingIds: csv(spec.contributingIds),
    content: cfBuf ? cfBuf.toString('utf8') : spec.content, contentBytes: cfBuf ?? spec.contentBytes,
    ackDataEgress: !!cliOpts.ackDataEgress, now: cliOpts.now, repoRoot: cliOpts.repoRoot,
    force: false, // a plan cannot force past the blocklist (spec 32)
  };
}


// Bulk ingest (spec 31): a URL list (one per line, `#` comments) fetched through the refresh fetcher,
// or a directory of Markdown files, each turned into a source spec for the same validate-then-write
// loop as a JSON plan. A failed item leaves a hole in `specs` so indexes stay those of the input.
const NETWORK_OFF = 'network access is off: set RESEARCH_VAULT_ALLOW_NETWORK=1 to ingest a URL list';
const titleOf = (html, fallback) => (/<title[^>]*>([^<]*)<\/title>/i.exec(html)?.[1] || '').replace(/\s+/g, ' ').trim() || fallback;

function mdSpec(dir, name, storeBody) {
  const bytes = readFileSync(join(dir, name));
  const text = bytes.toString('utf8');
  let fm = {};
  if (text.startsWith('---')) { try { fm = parseFrontmatter(text).data; } catch { /* no frontmatter: the first link and heading */ } }
  const url = fm.source_url || fm.url || /\]\((https?:\/\/[^)\s]+)\)/.exec(text)?.[1];
  if (!url) throw new Error(`no source URL: ${name}`);
  const title = fm.title || /^# (.+)$/m.exec(text)?.[1].trim() || basename(name, '.md');
  return { type: 'source', title, url, contentBytes: bytes, content: text, storeBody, sourceAuthor: fm.author || fm.source_author };
}

export async function ingest(vaultPath, path, cliOpts = {}) {
  const specs = [], errors = [];
  if (statSync(path).isDirectory()) {
    readdirSync(path).filter(n => n.endsWith('.md')).sort().forEach((name, index) => {
      try { specs[index] = mdSpec(path, name, cliOpts.storeBody); } catch (e) { errors.push({ index, error: e.message }); }
    });
  } else {
    const fetch = cliOpts.fetch || (cliOpts.allowNetwork ? fetchSource : null);
    if (!fetch) return { errors: [{ index: -1, error: NETWORK_OFF }], created: [], skipped: [] };
    const urls = readFileSync(path, 'utf8').split('\n').map(l => l.trim()).filter(l => l && !l.startsWith('#'));
    let checkUrl;
    try { checkUrl = sourceBlockCheck(loadBlocklist(vaultPath)); }
    catch (e) { return { errors: urls.map((_, index) => ({ index, error: e.message })), created: [], skipped: [] }; }
    for (const [index, url] of urls.entries()) {
      try {
        const { status, body, url: read } = await fetch(url, { checkUrl });
        if (status >= 400) throw new Error(`http ${status}`);
        // The body stored is the page's text, by the extractor `capture --fill` uses (spec 52); the hash is the bytes'.
        const content = cliOpts.storeBody ? extractText(body, new URL(read || url).pathname) ?? '' : '';
        specs[index] = { type: 'source', title: titleOf(body.toString('utf8'), url), url, contentBytes: body, content, storeBody: cliOpts.storeBody };
      } catch (e) {
        const error = e.code === SOURCE_BLOCKED
          ? `${blockedSourceMessage(e.block, screenText)}; --force captures anyway`
          : `fetch failed: ${e.message}`;
        errors.push({ index, error });
      }
    }
  }
  return runSpecs(vaultPath, specs, cliOpts, errors);
}

export function runBatch(vaultPath, planPath, cliOpts = {}) {
  let plan;
  try { plan = JSON.parse(readFileSync(planPath, 'utf8')); }
  catch (e) { return { errors: [{ index: -1, error: `cannot read plan: ${e.message}` }], created: [], skipped: [] }; }
  if (!Array.isArray(plan) || plan.length === 0)
    return { errors: [{ index: -1, error: 'plan must be a non-empty JSON array' }], created: [], skipped: [] };
  return runSpecs(vaultPath, plan, cliOpts);
}

// Validate every spec, then write; `cliOpts.continue` writes the specs that validated when others failed.
function runSpecs(vaultPath, plan, cliOpts, errors = []) {
  const manifestEntries = buildManifest(vaultPath).entries;
  const skipped = [], pending = [];
  plan.forEach((spec, index) => {
    try {
      const prep = prepareEntry(vaultPath, specToOpts(spec, cliOpts), { manifestEntries, pending });
      if (prep.dedup) {
        if (prep.dedup.ambiguous) errors.push({ index, error: `${prep.dedup.reason} (existing: ${prep.dedup.id})` });
        else skipped.push({ index, id: prep.dedup.id, reason: prep.dedup.reason });
        return;
      }
      pending.push({ ...prep, index });
    } catch (e) {
      // prepareEntry names every unresolved reference; the batch keeps one error line per reference.
      for (const ref of e.unresolved || [null]) errors.push({ index, error: ref ? `unresolved reference: ${ref}` : e.message });
    }
  });
  if (errors.length && !cliOpts.continue) return { errors, created: [], skipped };

  const created = [];
  let failing = null;
  try {
    for (const prep of pending) {
      failing = prep;
      const folder = join(vaultPath, prep.folder);
      assertInsideVault(vaultPath, folder);
      mkdirSync(folder, { recursive: true });
      try {
        writeEntry(prep.path, prep.data, prep.body, prep.order, vaultPath, { exclusive: true });
      } catch (e) {
        if (e.code !== 'EEXIST') throw e;
        try {
          const raced = prepareEntry(vaultPath, { ...specToOpts(plan[prep.index], cliOpts), now: prep.data.created });
          if (!raced.dedup) throw e;
          if (raced.dedup.ambiguous) throw new Error(`${raced.dedup.reason} (existing: ${raced.dedup.id})`);
          skipped.push({ index: prep.index, id: raced.dedup.id, reason: raced.dedup.reason });
        } catch (error) {
          errors.push({ index: prep.index, error: error.message });
          if (!cliOpts.continue) break;
        }
        continue;
      }
      created.push({ id: prep.id, path: prep.path });
    }
  } catch (e) {
    return { errors: [{ index: -1, error: `write failed at ${failing ? failing.path : '?'}: ${e.message}` }], created, skipped };
  } finally {
    if (created.length) writeManifest(vaultPath);
  }
  return { errors, created, skipped };
}

function captureDefaults(cwd) {
  try {
    const hit = loadProjectConfig(cwd, { schema: loadSchema(REPO_ROOT) });
    return hit ? (hit.config.defaults || {}) : {};
  } catch (e) {
    process.stderr.write(`research-vault: capture defaults ignored: ${e.message}\n`);
    return {};
  }
}

export async function run(args) {
  if (Object.hasOwn(args, 'operation-id')) {
    const invalid = !/^[A-Za-z0-9_-]{1,128}$/.test(args['operation-id'] || '') ||
      !args.batch || !args.batch.endsWith('.json') || args.continue || args['store-body'] ||
      (existsSync(args.batch) && statSync(args.batch).isDirectory());
    if (invalid) {
      process.stdout.write(JSON.stringify({ created: [], skipped: [], errors: [{ code: 'INPUT_INVALID', index: -1, retryable: false, error: 'operation-id requires a JSON-array --batch plan; ingest, --store-body and --continue are not supported' }], recoveryStateCreated: false }) + '\n');
      return 2;
    }
    const selected = resolveVault({ flag: args.vault ?? null, cwd: args.cwd ?? process.cwd() });
    const result = captureOperation(selected.path, args.batch, args['operation-id'], { ackDataEgress: !!args['ack-data-egress'] });
    process.stdout.write(JSON.stringify(result, null, 2) + '\n');
    return result.errors.length || result.operation?.phase !== 'complete' ? 1 : 0;
  }
  const cwd = args.cwd ?? process.cwd();
  const resolved = resolveVault({ flag: args.vault ?? null, cwd });
  const vaultPath = resolved.path;
  reportFallback(resolved);
  if (args.batch) {
    const o = { ackDataEgress: !!args['ack-data-egress'], storeBody: !!args['store-body'], continue: !!args.continue, allowNetwork: process.env.RESEARCH_VAULT_ALLOW_NETWORK === '1', fetch: typeof args.fetch === 'function' ? args.fetch : undefined };
    const r = (existsSync(args.batch) && statSync(args.batch).isDirectory()) || !args.batch.endsWith('.json') ? await ingest(vaultPath, args.batch, o) : runBatch(vaultPath, args.batch, o);
    process.stdout.write(JSON.stringify(r, null, 2) + '\n');
    return r.errors.length ? 1 : 0;
  }
  if (args.fill) {
    const r = await fillSource(vaultPath, args.fill, {
      ackDataEgress: !!args['ack-data-egress'], replace: !!args.replace, discard: !!args.discard, contentFile: args['content-file'],
      byId: args['by-id'], allowNetwork: process.env.RESEARCH_VAULT_ALLOW_NETWORK === '1', fetch: typeof args.fetch === 'function' ? args.fetch : undefined,
    });
    // The text line's reason can quote a blocklist row; it passes screenText (S-11). --json is data.
    process.stdout.write(args.json ? JSON.stringify(r) + '\n' : `${r.result}  ${r.id}${r.reason ? `  (${screenText(r.reason)})` : ''}${r.fetchedFrom ? `  (read from ${r.fetchedFrom})` : ''}\n`);
    return ['filled', 'kept', 'discarded'].includes(r.result) ? 0 : 1;
  }
  const defaults = captureDefaults(cwd);
  const cfBuf = args['content-file'] ? readFileSync(args['content-file']) : null;
  const r = captureEntry(vaultPath, {
    type: args.type, title: args.title, url: args.url, sourceType: args['source-type'],
    subjectName: args['subject-name'], subjectVersion: args['subject-version'], series: args.series,
    domain: args.domain ?? defaults.domain,
    topics: args.topics ?? (defaults.topics && defaults.topics.length ? defaults.topics.join(',') : undefined),
    related: args.related, byId: args['by-id'], volatility: args.volatility ?? defaults.volatility,
    content: cfBuf ? cfBuf.toString('utf8') : args.content, contentBytes: cfBuf, contentHash: args['content-hash'],
    capturedVia: args['captured-via'], storeBody: !!args['store-body'], ackDataEgress: !!args['ack-data-egress'],
    sources: args.sources, confidence: args.confidence, summary: args.summary,
    contributingIds: args['contributing-ids'], question: args.question,
    synthesisBasis: args['synthesis-basis'],
    authorityTier: args['authority-tier'], authorityBasis: args['authority-basis'],
    language: args.language, tested: args.tested,
    provider: args.provider, modelId: args['model-id'], dateRun: args['date-run'], task: args.task, outcome: args.outcome, state: args.state, answerSummary: args['answer-summary'],
    scaffold: !!args.scaffold, force: !!args.force,
    body: args['body-file'] ? readFileSync(args['body-file'], 'utf8') : undefined,
  });
  if (r.dedup) {
    const how = r.dedup.ambiguous ? 'ambiguous' : 'duplicate';
    // The existing entry's id comes from its file name and passes screenText (S-11).
    process.stdout.write(`${how} of ${screenText(r.dedup.id)} (${r.dedup.reason}); run verify instead.\n`);
    return 1;
  }
  process.stdout.write(`created ${r.path}\n`);
  return 0;
}
