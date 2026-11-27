// research-teach lesson format: id patterns and HTML extractors shared by its readers.
export const LESSON_ID_RE = /^\d{4}-[a-z][a-z0-9-]*$/;
export const RECORD_ID_RE = /^\d{4}-[a-z][a-z0-9-]*$/;

const uniq = (xs) => [...new Set(xs)];

// HTML extraction (regex; lessons are static HTML written by the skill).
export function extractQuizJson(html) {
  for (const m of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)) {
    if (/\bdata-quiz\b/i.test(m[1]) && /\btype\s*=\s*["']application\/json["']/i.test(m[1])) return m[2];
  }
  return null;
}

export function extractCites(html) {
  return uniq([...html.matchAll(/\bdata-cite\s*=\s*(["'])(.*?)\1/g)].map((m) => m[2]));
}
