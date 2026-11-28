// Extract citations from a markdown document so a consumer repo can be checked
// against the vault. Two citation forms: external URLs (bare or inside a markdown
// link) and date-prefixed vault ids (the filename-is-id convention, e.g. in an
// Obsidian [[wikilink]] or inline). URLs and ids inside fenced code blocks and inline
// code spans are examples, not citations.
// Classify citations against the manifest's entries (checkCitations).
// Stdlib-only, no parsing dependency.
import { normalizeUrl } from './ids.ts';
import { staleness } from './stale.mjs';

// URLs stop at whitespace, closing paren/bracket/angle, and quotes — so the URL
// inside [label](url) is captured cleanly. Trailing sentence punctuation and a stray
// closing backtick are trimmed.
const URL_RE = /https?:\/\/[^\s)<>\]"']+/g;
// A vault id is `<YYYY-MM-DD>-<slug>` with a lowercase-alnum, hyphen-separated slug.
export const ID_RE = /\b\d{4}-\d{2}-\d{2}-[a-z0-9]+(?:-[a-z0-9]+)*\b/g;

// An inline code span: a run of backticks, content, and the same run again, on one line.
export const SPAN_RE = /(?<!`)(`+)(?!`)([^\n]*?[^`\n])\1(?!`)/g;
const FENCE_OPEN = /^ {0,3}(`{3,}|~{3,})/;
const FENCE_CLOSE = /^ {0,3}(`{3,}|~{3,})\s*$/;
// HTML code: a lesson's commands and output live in <pre> and <code> elements.
const HTML_CODE_RE = /<(pre|code)\b[^>]*>[\s\S]*?<\/\1\s*>/gi;
// A markdown image is a picture (a badge, a figure), not a citation of its URL; it is dropped, not skipped.
const IMAGE_RE = /!\[[^\]\n]*\]\([^)\s]+(?:\s+"[^"]*")?\)/g;

function trimTrailing(url) {
  return url.replace(/[.,;:`]+$/, '');
}

// Split text into prose and code (fenced blocks, then inline spans). An unclosed fence runs to the end.
function splitCode(text) {
  const prose = [];
  const code = [];
  let fence = null;
  text = text.replace(HTML_CODE_RE, (el) => { code.push(el); return ' '; }).replace(IMAGE_RE, ' ');
  for (const line of text.split('\n')) {
    if (fence) {
      code.push(line);
      prose.push('');
      const c = FENCE_CLOSE.exec(line);
      if (c && c[1][0] === fence[0] && c[1].length >= fence.length) fence = null;
      continue;
    }
    const m = FENCE_OPEN.exec(line);
    // A backtick fence's info string cannot contain a backtick; that line is an inline span.
    if (m && !(m[1][0] === '`' && line.slice(m[0].length).includes('`'))) {
      fence = m[1];
      code.push(line);
      prose.push('');
      continue;
    }
    prose.push(line);
  }
  const rest = prose.join('\n').replace(SPAN_RE, (span) => { code.push(span); return ' '; });
  return { prose: rest, code: code.join('\n') };
}

function extractAll(text) {
  const seen = new Set();
  const out = [];
  const push = (type, value) => {
    const key = `${type} ${value}`;
    if (seen.has(key)) return;
    seen.add(key);
    out.push({ type, value });
  };
  for (const m of text.matchAll(URL_RE)) push('url', trimTrailing(m[0]));
  for (const m of text.matchAll(ID_RE)) push('id', m[0]);
  return out;
}

// citations: found in prose. skipped: found only inside code, so a caller can surface them.
export function extractCitationsDetailed(text) {
  const { prose, code } = splitCode(text);
  const citations = extractAll(prose);
  const cited = new Set(citations.map((c) => `${c.type} ${c.value}`));
  const skipped = extractAll(code).filter((c) => !cited.has(`${c.type} ${c.value}`));
  return { citations, skipped };
}

export function extractCitations(text) {
  return extractCitationsDetailed(text).citations;
}

// Pure: classify each citation as ok | stale | uncovered against the manifest entries. A superseded
// entry is stale for prose as it is for code (spec 15 D3), with its replacement as the reason.
// An ok row whose entry is in `unverified` (ids of sources nobody checked independently) carries
// `unverified: true`: marked, never failed.
// A URL is keyed as capture keys it (normalizeUrl; the manifest stores source_url normalized). Its
// candidates are its entries that are not superseded, or all of them when every one is; the row is the
// best candidate's (ok before stale, then the latest id), and two or more active candidates are listed
// in `candidates`: reported, never failed.
export function checkCitations(citations, entries, schema, now, unverified = new Set()) {
  const byUrl = new Map();
  const byId = new Map();
  for (const e of entries) {
    if (e.source_url) byUrl.set(e.source_url, [...(byUrl.get(e.source_url) ?? []), e]);
    byId.set(e.id, e);
  }
  const rowFor = (c, entry) => {
    const row = { type: c.type, value: c.value, status: 'ok', id: entry.id, volatility: entry.volatility };
    if (entry.status === 'superseded') return { ...row, status: 'stale', reason: `superseded by ${entry.superseded_by}` };
    if (staleness(entry, schema, new Date(now))) return { ...row, status: 'stale' };
    return unverified.has(entry.id) ? { ...row, unverified: true } : row;
  };
  return citations.map((c) => {
    if (c.type !== 'url') {
      const entry = byId.get(c.value);
      return entry ? rowFor(c, entry) : { type: c.type, value: c.value, status: 'uncovered' };
    }
    let norm = null;
    try { norm = normalizeUrl(c.value); } catch { norm = null; }
    const all = (norm && byUrl.get(norm)) || [];
    if (!all.length) return { type: c.type, value: c.value, status: 'uncovered' };
    const active = all.filter((e) => e.status !== 'superseded');
    const rows = (active.length ? active : all).sort((a, b) => a.id.localeCompare(b.id)).map((e) => rowFor(c, e));
    const best = rows.findLast((r) => r.status === 'ok') ?? rows.at(-1);
    return active.length > 1 ? { ...best, candidates: rows.map((r) => r.id) } : best;
  });
}
