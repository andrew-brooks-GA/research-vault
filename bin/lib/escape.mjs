// Escaping helpers for HTML and file values in printed lines.

// A file value in a printed line: an array or object is named, never walked, so a deeply nested value cannot
// overflow the stack; JSON.stringify escapes a quote, a backslash and U+0000 to U+001F, ESC_RE what it leaves raw.
const ESC_RE = /[\u007f-\u009f\u200e\u200f\u202a-\u202e\u2028\u2029\u2066-\u2069]/g;
export const show = (v) => (v !== null && typeof v === 'object' ? (Array.isArray(v) ? 'an array' : 'an object')
  : String(JSON.stringify(v)).replace(ESC_RE, (c) => `\\u${c.charCodeAt(0).toString(16).padStart(4, '0')}`));

export const escapeHtml = (s) => s.replace(/[&<>"]/g, (c) =>
  (c === '&' ? '&amp;' : c === '<' ? '&lt;' : c === '>' ? '&gt;' : '&quot;'));
