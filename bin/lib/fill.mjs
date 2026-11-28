import { join, basename, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { existsSync, readFileSync } from 'node:fs';
import { readEntry, writeEntry, TYPE_FOLDER } from './fsutil.mjs';
import { loadSchema, fieldOrder } from './schema.mjs';
import { buildManifest, writeManifest } from './manifest.mjs';
import { blockedSourceMessage, loadBlocklist, matchBlock, sourceBlockCheck, SOURCE_BLOCKED } from './blocklist.mjs';
import { fetchSource, rawFileUrl } from './fetchsource.mjs';
import { extractText } from './extract.ts';
import { bodyText, MIN_BODY_CHARS } from './gate.mjs';
import { sha256Tagged } from './hash.ts';

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
export const FILL_MAX_BYTES = 300000;
export const FLOATING = new Set(['latest', 'master', 'main', 'stable', 'current', 'head', 'nightly', 'dev', 'trunk']);
const FILE_TYPES = /\.(html?|txt|md)$/i;
const isFill = v => /^filled(-from-file)?:/.test(v.notes || '');

// The hash an entry carried before the fill that `row` records; a saved-file fill never touched it.
function hashBefore(data, row) {
  const was = /^filled: [^,]*, \d+ bytes of text, content_hash was ([^,\s]+)/.exec(row.notes)?.[1];
  if (was === 'none') delete data.content_hash;
  else if (was) data.content_hash = was;
}

// Page text for a source that holds none (spec 52 points 2, 3, 6 and 7). One result per call;
// only `filled` and `discarded` change the entry.
export async function fillSource(vaultPath, id, opts = {}) {
  buildManifest(vaultPath);
  const path = join(vaultPath, TYPE_FOLDER.source, `${id}.md`);
  const refused = reason => ({ id, result: 'refused', reason });
  // The id comes from the command line and is joined into a path: an entry id and nothing else.
  if (!/^[a-z0-9][a-z0-9-]*$/.test(String(id)) || !existsSync(path)) return refused('not a source entry of this vault');
  const e = readEntry(path);
  if (e.data.type !== 'source') return refused('not a source entry of this vault');
  if (e.data.status !== 'active') return refused('not active');
  const now = opts.now || new Date().toISOString().slice(0, 10);
  const rows = e.data.verifications || [];
  const lastFill = rows.findLast(v => isFill(v) || (v.notes || '').startsWith('discarded:'));
  const row = (method, notes) => ({ date: now, by_type: opts.byId ? 'agent' : 'human', by_id: opts.byId || '', method, result: 'inconclusive', notes });
  const write = (body, added) => {
    e.data.verifications = [...rows, added];
    writeEntry(path, e.data, body, fieldOrder(loadSchema(opts.repoRoot || REPO_ROOT, { vaultPath }), 'source'));
    writeManifest(vaultPath);
  };

  if (opts.discard) {
    if (!lastFill || !isFill(lastFill)) return refused('no fill wrote this body');
    hashBefore(e.data, lastFill);
    write(`# ${e.data.title}\n`, row('human-spot-check', `discarded: ${now}, the text of the fill of ${lastFill.date}`));
    return { id, result: 'discarded' };
  }
  if (bodyText(e.body).length >= MIN_BODY_CHARS) {
    if (!opts.replace) return { id, result: 'kept' };
    if (!rows.length || !isFill(rows.at(-1))) return refused('--replace: the newest verification row is not a fill\'s');
    if (!opts.contentFile) hashBefore(e.data, rows.at(-1)); // a saved-file fill leaves content_hash as it is
  }
  if (!opts.ackDataEgress) throw new Error('--fill requires --ack-data-egress (storing source text is a data-egress / copyright surface)');

  const blocklist = loadBlocklist(vaultPath);
  const blocked = url => { const hit = matchBlock(blocklist, url); return hit && refused(blockedSourceMessage(hit)); };
  const block = blocked(e.data.source_url) || blocked(rawFileUrl(e.data.source_url));
  if (block) return block;

  let text, added, fetchedFrom;
  if (opts.contentFile) {
    if (!FILE_TYPES.test(opts.contentFile)) return refused('--content-file takes a .html, .htm, .txt or .md file');
    const bytes = readFileSync(opts.contentFile);
    text = extractText(bytes, opts.contentFile);
    added = n => row('human-spot-check', `filled-from-file: ${basename(opts.contentFile)}, ${sha256Tagged(bytes)}, ${n} bytes of text`);
  } else {
    let u;
    try { u = new URL(e.data.source_url); } catch { return refused('no fetchable source_url'); }
    if (u.protocol !== 'https:') return refused('source_url is not https');
    if (e.data.subject?.version && u.pathname.toLowerCase().split('/').some(seg => FLOATING.has(seg)))
      return { id, result: 'version-floating' };
    const fetch = opts.fetch || (opts.allowNetwork ? fetchSource : null);
    if (!fetch) throw new Error('network access is off: set RESEARCH_VAULT_ALLOW_NETWORK=1 to fill a source');
    let r;
    try { r = await fetch(e.data.source_url, { checkUrl: sourceBlockCheck(blocklist) }); }
    catch (err) {
      if (err.code === SOURCE_BLOCKED) return refused(err.message);
      return { id, result: 'unreachable', reason: err.message };
    }
    if (r.status >= 400) return { id, result: 'unreachable', reason: `http ${r.status}` };
    const read = r.url || e.data.source_url;
    if (read !== e.data.source_url) {
      fetchedFrom = read;
      const finalBlock = blocked(read);
      if (finalBlock) return finalBlock;
    }
    text = extractText(r.body, new URL(read).pathname);
    const was = e.data.content_hash || 'none';
    added = n => { e.data.content_hash = r.hash; return row('refetched-source', `filled: ${now}, ${n} bytes of text, content_hash was ${was}${fetchedFrom ? `, read from ${fetchedFrom}` : ''}`); };
  }
  text = (text ?? '').trim();
  if (text.length < MIN_BODY_CHARS) return { id, result: 'no-text' };
  const textBytes = Buffer.byteLength(text);
  if (textBytes > FILL_MAX_BYTES) return { id, result: 'too-large', textBytes };
  const newRow = added(textBytes);
  e.data.updated = now;
  write(`# ${e.data.title}\n\n${text}\n`, newRow);
  return { id, result: 'filled', textBytes, ...(fetchedFrom ? { fetchedFrom } : {}) };
}
