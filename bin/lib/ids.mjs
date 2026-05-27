import { createHash } from 'node:crypto';

const STOPWORDS = new Set(['a','an','the','of','to','in','on','for','and','or','with','is','are','be']);
const TRACKING = new Set(['utm_source','utm_medium','utm_campaign','utm_term','utm_content','ref','gclid','fbclid']);

export function slugify(title) {
  const words = String(title).toLowerCase()
    .replace(/[^a-z0-9\s-]/g, ' ')
    .split(/[\s-]+/).filter(Boolean)
    .filter(w => !STOPWORDS.has(w));
  return words.slice(0, 6).join('-');
}

export function makeId(date, title) { return `${date}-${slugify(title)}`; }

export function normalizeUrl(url) {
  const u = new URL(url);
  u.protocol = u.protocol.toLowerCase();
  u.hostname = u.hostname.toLowerCase();
  for (const k of [...u.searchParams.keys()]) if (TRACKING.has(k.toLowerCase())) u.searchParams.delete(k);
  let s = u.toString();
  s = s.replace(/\?$/, '').replace(/\/$/, '');
  return s;
}

export function sha256(text) { return 'sha256:' + createHash('sha256').update(text).digest('hex'); }
