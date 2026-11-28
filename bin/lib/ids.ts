import { sha256Hex } from './hash.ts';

const STOPWORDS = new Set(['a','an','the','of','to','in','on','for','and','or','with','is','are','be']);
const TRACKING = new Set(['utm_source','utm_medium','utm_campaign','utm_term','utm_content','ref','gclid','fbclid']);

// `hashEmpty: false` gives the plain ASCII slug, possibly empty: the teach workspace key keeps it (R-57).
export function slugify(title: unknown, { hashEmpty = true }: { hashEmpty?: boolean | undefined } = {}): string {
  const words = String(title).toLowerCase()
    .replace(/[^a-z0-9\s-]/g, ' ')
    .split(/[\s-]+/).filter(Boolean)
    .filter((w: string) => !STOPWORDS.has(w));
  const slug = words.slice(0, 6).join('-');
  // R-57: a title with no ASCII word left (Japanese, all stopwords) gets `t-` and a hash of the title, so ids stay distinct.
  return slug || !hashEmpty ? slug : `t-${sha256Hex(String(title)).slice(0, 8)}`;
}

export function makeId(date: string, title: string): string { return `${date}-${slugify(title)}`; }

export function normalizeUrl(url: ConstructorParameters<typeof URL>[0]): string {
  const u = new URL(url);
  u.protocol = u.protocol.toLowerCase();
  u.hostname = u.hostname.toLowerCase();
  for (const k of [...u.searchParams.keys()]) if (TRACKING.has(k.toLowerCase())) u.searchParams.delete(k);
  let s = u.toString();
  s = s.replace(/\?$/, '').replace(/\/$/, '');
  return s;
}

// A hand-authored source_url can be un-parsable; keep the raw value rather than throw
// (callers like the manifest builder must not crash a whole run on one bad URL).
export function normalizeUrlSafe(url: unknown): unknown {
  if (!url) return null;
  try { return normalizeUrl(url); } catch { return url; }
}

// A subject version for comparison: absent and empty are the same, anything else is its string.
export const verKey = (v: unknown): string | null => (v == null || v === '') ? null : String(v);
