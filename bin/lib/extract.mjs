import { gunzipSync } from 'node:zlib';

// Page text for a source's body (spec 52): one extractor for `capture --fill` and a URL-list ingest.
const BLOCK = 'p|div|section|article|header|footer|main|aside|nav|h[1-6]|li|ul|ol|dl|dt|dd|tr|table|thead|tbody|pre|blockquote|br|hr|figure|figcaption|details|summary|title';
const ENT = new Map(Object.entries({
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', rsquo: '’', lsquo: '‘', rdquo: '”', ldquo: '“',
  mdash: '—', ndash: '–', hellip: '…', middot: '·', bull: '•', copy: '©', reg: '®', trade: '™', laquo: '«', raquo: '»',
  times: '×', rarr: '→', larr: '←', deg: '°',
}));

const entities = s => s.replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (m, e) => {
  if (!e.startsWith('#')) return ENT.get(e.toLowerCase()) ?? m;
  const cp = e.charAt(1).toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
  return cp > 0 && cp <= 0x10ffff ? String.fromCodePoint(cp) : m;
});
const BLOCK_TAG = new RegExp(`<\\/?(?:${BLOCK})\\b[^<>]*>`, 'gi');
const SPAN = /<!--|<(script|style|template|svg|noscript)\b/gi;

// Comments and the elements whose content is not text. An unclosed one ends the text there.
// A loop, not one regex: every pattern here must stay linear on a hostile page of 5 MiB.
function dropSpans(html) {
  let out = '', at = 0, m;
  SPAN.lastIndex = 0;
  while ((m = SPAN.exec(html))) {
    out += html.slice(at, m.index);
    const close = m[1] ? new RegExp(`</${m[1]}\\s*>`, 'gi') : /-->/g;
    close.lastIndex = SPAN.lastIndex;
    if (!close.exec(html)) return out;
    at = SPAN.lastIndex = close.lastIndex;
  }
  return out + html.slice(at);
}

export function htmlToText(html) {
  const s = dropSpans(html);
  const fold = part => entities(part.replace(/\s+/g, ' ').replace(BLOCK_TAG, '\n').replace(/<\/(?:td|th)\s*>/gi, ' ').replace(/<[^<>]*>/g, ''))
    .split('\n').map(l => l.replace(/[ \t\u00a0]+/g, ' ').trim()).join('\n');
  // Line breaks in HTML source mean nothing outside pre: fold them, so a paragraph is one line of text. A pre keeps
  // its lines and indentation. Past the last </pre> there is no pre to find, so that tail is not searched for one.
  const last = s.toLowerCase().lastIndexOf('</pre');
  const end = last < 0 ? 0 : s.indexOf('>', last) + 1 || s.length;
  return (s.slice(0, end).split(/(<pre\b[\s\S]*?<\/pre\s*>)/gi).map((part, i) => i % 2
    ? `\n${entities(part.replace(/<[^<>]*>/g, '')).replace(/[ \t]+$/gm, '')}\n`
    : fold(part)).join('') + fold(s.slice(end))).replace(/\n{3,}/g, '\n\n').trim() + '\n';
}

// Markdown as a reader sees it: a link is its text; emphasis marks, code marks and backslash escapes go.
// ponytail: fenced code is not exempt, so `**kwargs` in a code block loses its stars; parse fences if quotes of code start missing.
export function mdToText(md) {
  const kept = [];
  return md.replace(/\\([^\w\s])/g, (_, c) => `\u0000${kept.push(c) - 1}\u0000`)
    .replace(/!?\[([^[\]\n]*)\]\([^()\n]*\)/g, '$1')
    .replace(/`+/g, '').replace(/\*+(?=\S)|(?<=\S)\*+/g, '')
    .replace(/(?<![A-Za-z0-9])_+(?=\S)|(?<=\S)_+(?![A-Za-z0-9])/g, '')
    .replace(/\u0000(\d+)\u0000/g, (_, i) => kept[i]);
}

const MAX_UNZIPPED = 16 * 1024 * 1024; // a gzip body past this is refused, not inflated

// The text of fetched or saved bytes, or null when they are binary. `path` ending in .md picks the Markdown rule.
export function extractText(bytes, path = '') {
  let buf = bytes;
  if (buf[0] === 0x1f && buf[1] === 0x8b) { try { buf = gunzipSync(buf, { maxOutputLength: MAX_UNZIPPED }); } catch { return null; } }
  if (buf.includes(0)) return null;
  const head = buf.subarray(0, 2048).toString('latin1').toLowerCase();
  if (/<!doctype html|<html[\s>]|<head[\s>]|<body[\s>]/.test(head)) {
    const charset = /<meta[^>]+charset=["']?([\w-]+)/.exec(head)?.[1];
    let html;
    try { html = new TextDecoder(charset || 'utf-8').decode(buf); } catch { html = buf.toString('utf8'); }
    return htmlToText(html);
  }
  const text = buf.toString('utf8');
  return /\.md$/i.test(path) ? mdToText(text) : text;
}
