// S-11: the one screen for text from entries, the blocklist and fetched pages before an agent reads it
// (the pre-web hook, the text output of `search`, `related --format mermaid`, `verify --quotes` and
// `--stale`, `check`, `capture`'s blocklist refusal and text lines, lint's messages, `manifest
// --topics` and `--rebuild`'s dangling edges, `teach path candidates`, `advise`, `gate evidence` and
// the post-edit hook's code-row reason), so a value cannot forge a line of its own or hide text.
// JSON output is not screened: it is data, and JSON.stringify escapes it.
// Line breaks become a space; controls, format characters (zero-width, bidi, tag characters,
// interlinear annotation) and every other default-ignorable code point (variation selectors, soft
// hyphen, Hangul fillers) are removed.
const BREAK_RE = /[\t\n\v\f\r\u0085\u2028\u2029]/g;
const HIDDEN_RE = /[\p{Cc}\p{Cf}\p{Default_Ignorable_Code_Point}]/gu;
export const SCREEN_MAX: 300 = 300;

// One line, at most `max` characters (code points); a cut value ends with `\u2026`.
export function screenText(value: unknown, max: number = SCREEN_MAX): string {
  const s = String(value).replace(BREAK_RE, ' ').replace(HIDDEN_RE, '').replace(/ {2,}/g, ' ').trim();
  const chars = [...s];
  return chars.length > max ? chars.slice(0, max - 1).join('').trimEnd() + '\u2026' : s;
}
