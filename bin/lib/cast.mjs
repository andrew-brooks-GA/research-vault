// Issue 65 (spec 47 D2): an asciicast (v3, or v2, whose events have the same shape) read as text: the secret scan
// and the transcript. Pure; `teach cast` and `teach lint` call it.

// Spec 47 F3 and D1: the one player release a workspace may hold in assets/, by file name and sha256.
export const PLAYER_VERSION = '3.18.0';
export const PLAYER_FILES = {
  'asciinema-player.min.js': '752c9b528b664f5b16f27c68ba22fc7973d1d6063a1c3e4795a4c8015943acf6',
  'asciinema-player.css': '981fe7bc6042048b2a373b6da297f747e324e90a8b6264e833e3a92cec22dfb9',
};

// Token shapes the scan always looks for, by kind. ponytail: a handful of well-known prefixes, not a secret scanner;
// add a shape when a probe prints a kind of token not listed here.
export const TOKEN_SHAPES = {
  'aws-access-key': /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/,
  'github-token': /\b(?:gh[pousr]_[A-Za-z0-9]{36,}|github_pat_[A-Za-z0-9_]{22,})/,
  'slack-token': /\bxox[abpors]-[A-Za-z0-9-]{10,}/,
  jwt: /\beyJ[A-Za-z0-9_-]{8,}\.eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]+/,
  'private-key': /-----BEGIN [A-Z ]*PRIVATE KEY-----/,
};

// CSI and OSC sequences, and the charset designations tput sgr0 prints (ESC ( B).
const ESCAPES = /\x1b\[[0-?]*[ -/]*[@-~]|\x1b\][\s\S]*?(?:\x07|\x1b\\)|\x1b[()*+][0-9A-Za-z]/g;

// { header, events }, each event [time, code, data]; throws on a cast that does not parse.
export function parseCast(text) {
  const lines = text.split('\n').filter((l) => l.trim() && !l.startsWith('#'));
  const header = JSON.parse(lines[0] ?? '');
  if (![2, 3].includes(header?.version)) throw new Error(`asciicast version ${header?.version} (expected 2 or 3)`);
  const events = lines.slice(1).map((l, i) => {
    const e = JSON.parse(l);
    if (!Array.isArray(e) || typeof e[1] !== 'string' || typeof e[2] !== 'string') throw new Error(`event ${i} is not [time, code, data]`);
    return e;
  });
  return { header, events };
}

const strings = (v) => (typeof v === 'string' ? [v] : v && typeof v === 'object' ? Object.values(v).flatMap(strings) : []);

// Each needle found: { kind, at }, `at` the index (from 0) of the event where the match starts, or 'header'. `needles`
// are literal values; a hit on one has kind `needle N` (from 1), so a hit line never repeats the value. The o and i
// events are joined in order with escape sequences removed, so a token split across events or coloured is found.
export function scanCast(text, needles = []) {
  const { header, events } = parseCast(text);
  let joined = '';
  const starts = [];
  events.forEach(([, code, data], i) => {
    if (code !== 'o' && code !== 'i') return;
    starts.push([joined.length, i]);
    joined += data.replace(ESCAPES, '');
  });
  const heads = strings(header).map((s) => s.replace(ESCAPES, ''));
  const tests = [...Object.entries(TOKEN_SHAPES).map(([kind, re]) => [kind, (s) => re.exec(s)?.index ?? -1]),
    ...needles.map((n, i) => [`needle ${i + 1}`, (s) => s.indexOf(n)])];
  const hits = [];
  for (const [kind, find] of tests) {
    if (heads.some((s) => find(s) !== -1)) hits.push({ kind, at: 'header' });
    const pos = find(joined);
    if (pos !== -1) hits.push({ kind, at: starts.findLast(([s]) => s <= pos)[1] });
  }
  return hits;
}

// The output events as plain text for a <pre>: escape sequences removed, CRLF a line break, other control characters
// dropped. ponytail: a line overwritten after a bare CR shows both texts run together; render a terminal if that bites.
export function castTranscript(text) {
  return parseCast(text).events.filter((e) => e[1] === 'o').map((e) => e[2]).join('')
    .replace(ESCAPES, '').replace(/\r\n/g, '\n').replace(/[\x00-\x08\x0b-\x1f\x7f]/g, '');
}
