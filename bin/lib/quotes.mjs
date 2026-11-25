import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { readEntry, writeEntry, TYPE_FOLDER } from './fsutil.mjs';
import { loadSchema, fieldOrder } from './schema.mjs';
import { buildManifest, writeManifest } from './manifest.mjs';
import { loadBlocklist, matchBlock } from './blocklist.mjs';
import { fetchSource, rawFileUrl } from './fetchsource.mjs';
import { extractText } from './extract.mjs';
import { bodyText, MIN_BODY_CHARS } from './gate.mjs';
import { RUN_KEY } from './packet.mjs';
import { screenText } from './screen.mjs';

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const h8 = s => createHash('sha256').update(s).digest('hex').slice(0, 8);
// The only differences a match ignores: white space, quote marks, dash forms and code marks. A lane
// that read a raw Markdown file quotes `flag` with its backticks; the text stored for that file has
// none (spec 52 stores Markdown as a reader sees it), and a rendered page has none either.
const soft = s => String(s).replace(/`/g, '').replace(/[‘’]/g, "'").replace(/[“”]/g, '"').replace(/[–—]/g, '-').replace(/\s+/g, ' ').trim();
// A quote may run over adjacent lines with no blank line between them, joined by one space, so a
// sentence that a hard-wrapped file breaks over lines is found (issue 77). A hit is [first line, last line].
// Each line is tried with only as many of the next lines as the quote needs.
const hitsIn = (lines, q) => lines.flatMap((l, i) => {
  let t = l, j = i;
  while (l && lines[j + 1] && t.length < l.length + q.length) t += ' ' + lines[++j];
  const x = t.indexOf(q);
  if (x < 0 || x >= l.length) return [];
  let end = l.length, k = i;
  while (end < x + q.length) end += 1 + lines[++k].length;
  return [[i + 1, k + 1]];
});
// Page text reaches the agent here: screenText makes it one line with no hidden characters (S-11).
const around = (lines, at, to = at) => screenText(lines.slice(Math.max(0, at - 3), to + 2).filter(l => l.trim()).join(' / '), 900);

// Is each quote on one line of a source's text, or over adjacent lines with no blank line between
// them (spec 53 point 3; issue 77)? A quote found adds one
// `quote-matched` row. Note form, stated once: `<quote hash 8> L<body line>@<body hash 8>[ <run key>]: <quote>`
// for a quote found in the stored body (the line counts lines of the entry's body), and
// `<quote hash 8>: <quote>` for one found on the fetched page (spec 54 item 5). The body and
// `content_hash` are never changed.
export async function checkQuotes(vaultPath, id, quotes, opts = {}) {
  buildManifest(vaultPath);
  const path = join(vaultPath, TYPE_FOLDER.source, `${id}.md`);
  if (!/^[a-z0-9][a-z0-9-]*$/.test(String(id)) || !existsSync(path)) throw new Error(`not a source entry of this vault: ${id}`);
  const e = readEntry(path);
  if (e.data.type !== 'source') throw new Error(`not a source entry of this vault: ${id}`);
  if (!Array.isArray(quotes)) throw new Error('--quotes takes a file holding a JSON array of quotes');
  // A run's key in a body row lets `gate evidence --packet` tell this run's quotes from another's.
  if (opts.runKey != null && !RUN_KEY.test(String(opts.runKey))) throw new Error('--run takes a run key: run- and six or more letters or digits');
  const now = opts.now || new Date().toISOString().slice(0, 10);
  const stored = bodyText(e.body).length >= MIN_BODY_CHARS;
  const bodyLines = e.body.split('\n');
  const softBody = bodyLines.map(soft);
  const bodyHash = h8(e.body);
  const fetch = opts.fetch || (opts.allowNetwork ? fetchSource : null);
  if (!stored && !fetch) throw new Error('network access is off: this source holds no stored text, so set RESEARCH_VAULT_ALLOW_NETWORK=1 to check quotes against its page');

  let page; // fetched at most once: { lines, soft } or { error }
  const readPage = async () => {
    if (page) return page;
    const blocklist = loadBlocklist(vaultPath);
    const hit = matchBlock(blocklist, e.data.source_url) || matchBlock(blocklist, rawFileUrl(e.data.source_url));
    let u;
    try { u = new URL(e.data.source_url); } catch { return (page = { error: 'no fetchable source_url' }); }
    if (hit) return (page = { error: `blocked source: ${screenText(hit.pattern)}` });
    if (u.protocol !== 'https:') return (page = { error: 'source_url is not https' });
    let r;
    try { r = await fetch(e.data.source_url, {}); } catch (err) { return (page = { error: `page unreachable: ${screenText(err.message)}` }); }
    if (r.status >= 400) return (page = { error: `page unreachable: http ${r.status}` });
    const text = extractText(r.body, new URL(r.url || e.data.source_url).pathname);
    if (text == null) return (page = { error: 'the page gave no text' });
    const lines = text.split('\n');
    return (page = { lines, soft: lines.map(soft) });
  };

  const rows = e.data.verifications || [];
  const have = new Set(rows.filter(v => v.method === 'quote-matched').map(v => /^[0-9a-f]{8}/.exec(v.notes || '')?.[0]));
  const added = [];
  const out = [];
  for (const item of quotes) {
    const quote = soft(item && typeof item === 'object' ? item.quote : item);
    const base = item && typeof item === 'object' && 'n' in item ? { n: item.n } : {};
    const words = quote ? quote.split(' ').length : 0;
    if (words < 4 || quote.length < 20) { out.push({ ...base, found: false, refused: true, reason: `a quote is one whole sentence of four words and twenty characters or more; this one has ${words} words and ${quote.length} characters` }); continue; }
    let hits = stored ? hitsIn(softBody, quote) : [];
    let foundIn = 'body', src = bodyLines, reason = 'not on one line or over adjacent lines of the stored text';
    if (!hits.length && fetch) {
      const p = await readPage();
      if (p.error) reason = stored ? `${reason}; ${p.error}` : p.error;
      else { hits = hitsIn(p.soft, quote); foundIn = 'page'; src = p.lines; reason = stored ? 'not on one line or over adjacent lines of the stored text or of the fetched page' : 'not on one line or over adjacent lines of the fetched page'; }
    }
    if (!hits.length) { out.push({ ...base, found: false, reason }); continue; }
    const lines = hits.map(h => h[0]);
    const qh = h8(quote);
    const rowAdded = !have.has(qh);
    if (rowAdded) {
      have.add(qh);
      added.push({ date: now, by_type: opts.byId ? 'agent' : 'human', by_id: opts.byId || '', method: 'quote-matched',
        result: foundIn === 'body' ? 'inconclusive' : 'confirmed',
        notes: `${qh}${foundIn === 'body' ? ` L${lines[0]}@${bodyHash}${opts.runKey ? ` ${opts.runKey}` : ''}` : ''}: ${quote.slice(0, 300)}` });
    }
    out.push({ ...base, found: true, foundIn, lines, occurrences: lines.length, rowAdded, context: around(src, hits[0][0], hits[0][1]) });
  }
  if (added.length) {
    e.data.verifications = [...rows, ...added];
    // Only a quote found on the page as fetched now says the page still reads so.
    if (added.some(r => r.result === 'confirmed')) e.data.updated = now;
    writeEntry(path, e.data, e.body, fieldOrder(loadSchema(opts.repoRoot || REPO_ROOT, { vaultPath }), 'source'));
    writeManifest(vaultPath);
  }
  return out;
}
