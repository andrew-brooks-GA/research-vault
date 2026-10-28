// Code links (spec 15): a vault entry id on a comment line of its own, optionally pinned to a
// declared dependency version (`<id>@<key>=<version>`), attached to the column-0 declaration
// below it. A language is data, `{ comment, decl }`: `comment` matches one whole comment line
// and captures its text in group 1; `decl` matches one column-0 declaration line and captures
// the symbol name in its first non-empty group. This module knows no language: the shipped rows
// are LANGS, a project supplies or overrides rows in `code.languages` of its binding, and
// langFor is the only way to turn an extension into a row.
//
// The unit of a linked declaration runs from its leading comment block to the line before the
// next column-0 declaration's own comment block, so a column-0 statement between two declarations
// belongs to the unit above it, and a file header contiguous with the citing comment is part of
// the first unit. Pin values are stripped before hashing, so moving a pin reopens nothing.
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { ID_RE } from './citations.mjs';
import { staleness } from './stale.mjs';
import { expandFiles } from './files.mjs';
import { isInsideVault } from './containment.mjs';

// ---- shipped language rows ----
// Each row is two regexes and nothing else (spec 15 D0): `comment` matches one whole comment line and
// captures its text, `decl` matches one column-0 declaration and captures the name in its first
// non-empty group. Not seen anywhere: an end-of-line comment after code, an indented declaration,
// an id inside a string, and a decorator or attribute line between the comment and the declaration
// (write the link below it). A project adds or overrides rows in code.languages.
const hashComment = /^\s*#(.*)$/;
// `//`, `///`, `//!`, and the `/*`, `/**` and ` *` lines of a block.
const slashComment = /^\s*(?:\/\/[/!]?|\/\*\*?|\*)(.*)$/;
const N = '[A-Za-z_$][\\w$]*';
// function/class/const/let/var/interface/type/enum at column 0, with export/default/async/abstract/declare
// prefixes, and the CommonJS `module.exports.X =` / `exports.X =` forms.
const jsDecl = new RegExp(`^(?:export\\s+(?:default\\s+)?)?(?:declare\\s+)?(?:async\\s+)?(?:abstract\\s+)?(?:function\\*?\\s+(${N})|class\\s+(${N})|(?:const|let|var)\\s+(${N})\\s*[=:]|interface\\s+(${N})|type\\s+(${N})\\s*[=<]|enum\\s+(${N})|namespace\\s+(${N}))|^(?:module\\.)?exports\\.(${N})\\s*=`);
const jsLike = { comment: slashComment, decl: jsDecl };
// A function definition with a return type (`static int f(`), `#define X`, and struct/enum/union/class/typedef.
const cDecl = /^#define\s+([A-Za-z_]\w*)|^(?:typedef\s+)?(?:struct|enum|union|class)\s+([A-Za-z_]\w*)|^(?!(?:if|for|while|switch|return|else)\b)(?:(?:static|inline|extern|const|unsigned|signed|virtual|constexpr|struct|enum)\s+)*[A-Za-z_][\w:<>]*[\s*&]+(?!(?:if|for|while|switch|return)\b)([A-Za-z_][\w:~]*)\s*\(/;
const cLike = { comment: slashComment, decl: cDecl };
export const LANGS = {
  '.lua': {
    // A whole-line short comment; the lookahead excludes a line that opens a long comment `--[[`.
    // Not seen: an end-of-line comment after code, an id inside a long comment or on an inner line
    // of one, and the inner lines of a long string `[[ ]]` look like ordinary lines.
    comment: /^\s*--(?!\[=*\[)(.*)$/,
    // `function a.b:c(`, `local function f(`, `local X =`, `ns.X =` at column 0; not `x == 1`,
    // `local a, b =` or a bare `local x`. A string literal on the line is not inspected.
    decl: /^(?:local\s+)?function\s+([A-Za-z_][\w.:]*)\s*\(|^(?:local\s+)?([A-Za-z_][\w.]*)\s*=(?!=)/,
  },
  '.js': jsLike, '.mjs': jsLike, '.cjs': jsLike, '.jsx': jsLike,
  '.ts': jsLike, '.mts': jsLike, '.cts': jsLike, '.tsx': jsLike,
  // `def f(`, `async def f(`, `class C`, `X = ` or `X: T = ` at column 0; a decorator above the def is not skipped.
  '.py': { comment: hashComment, decl: /^(?:async\s+)?def\s+([A-Za-z_]\w*)|^class\s+([A-Za-z_]\w*)|^([A-Za-z_]\w*)\s*(?::[^=]+)?=(?!=)/ },
  // `func f(`, `func (r *T) m(` (the method name, so two types' methods of one name share a symbol), type/var/const.
  '.go': { comment: slashComment, decl: /^func\s+(?:\([^)]*\)\s*)?([A-Za-z_]\w*)|^(?:type|var|const)\s+([A-Za-z_]\w*)/ },
  // fn/struct/enum/trait/type/const/static/mod/impl with pub, async, const, unsafe or extern prefixes; an
  // attribute line above the item is not skipped.
  '.rs': { comment: slashComment, decl: /^(?:pub(?:\([^)]*\))?\s+)?(?:(?:async|const|unsafe|extern\s+"[^"]*")\s+)*(?:fn|struct|enum|trait|type|const|static|mod|union|impl(?:<[^>]*>)?)\s+([A-Za-z_]\w*)/ },
  // `pub fn f(`, `export fn f(`, `const X =`, `var x =`.
  '.zig': { comment: slashComment, decl: /^(?:pub\s+)?(?:export\s+|extern\s+|inline\s+)?(?:fn\s+([A-Za-z_]\w*)|(?:const|var)\s+([A-Za-z_]\w*))/ },
  // `def f`, `def self.f`, `class C`, `module M`; a method name may end in ?, ! or =.
  '.rb': { comment: hashComment, decl: /^def\s+(?:self\.)?([A-Za-z_]\w*[?!=]?)|^(?:class|module)\s+([A-Z]\w*)/ },
  // `f()`, `function f`, `function f()`, `X=`; the shebang is a comment line with no id in it.
  '.sh': { comment: hashComment, decl: /^(?:function\s+)?([A-Za-z_][\w-]*)\s*\(\)|^function\s+([A-Za-z_][\w-]*)|^([A-Za-z_]\w*)=/ },
  '.bash': { comment: hashComment, decl: /^(?:function\s+)?([A-Za-z_][\w-]*)\s*\(\)|^function\s+([A-Za-z_][\w-]*)|^([A-Za-z_]\w*)=/ },
  '.c': cLike, '.h': cLike, '.cpp': cLike, '.hpp': cLike, '.cc': cLike, '.hh': cLike,
};

// Group 1 the id, group 2 a key of code.versions, group 3 the pinned version.
export const LINK_RE = new RegExp(`(${ID_RE.source})(?:@([a-z][a-z0-9-]*)=(\\S+))?`, 'g');
const PIN_RE = new RegExp(`(${ID_RE.source}@[a-z][a-z0-9-]*)=\\S+`, 'g');

// Project row over shipped row; a file with neither is a configuration error, not a file of rows.
export function langFor(ext, cfg) {
  const lang = cfg?.code?.languages?.[ext] ?? LANGS[ext];
  if (!lang) throw new Error(`no language for ${ext} in code.globs; add code.languages["${ext}"] = { comment, decl }`);
  return lang;
}

// The files code.globs name, sorted absolute; none without a code block. A relative vault that is a
// symlink out of the repo passes the parse-time rule, so the bound vault is checked here.
export function codeFiles(cfg, repoRoot) {
  if (!cfg?.code) return [];
  const root = resolve(repoRoot);
  const vault = resolve(root, cfg.vault);
  if (!isInsideVault(root, vault)) throw new Error(`code links need a project-specific vault inside the repo; ${vault} resolves outside ${root}`);
  return expandFiles(cfg.code.globs, root);
}

const isComment = (lang, line) => lang.comment.test(line);
const isBlank = (line) => line.trim() === '';
const symbolOf = (lang, line) => lang.decl.exec(line)?.slice(1).find(Boolean) ?? null;

// Every link in a file: { line, id, key, version, symbol, declLine }; symbol and declLine are null
// for an unattached link (only blank and comment lines may sit between the comment and its declaration).
export function extractCodeLinks(text, lang) {
  const lines = text.split('\n');
  const out = [];
  lines.forEach((line, i) => {
    const c = lang.comment.exec(line);
    const links = c ? [...c[1].matchAll(LINK_RE)] : [];
    if (!links.length) return;
    let j = i + 1;
    while (j < lines.length && (isBlank(lines[j]) || isComment(lang, lines[j]))) j++;
    const symbol = j < lines.length ? symbolOf(lang, lines[j]) : null;
    for (const m of links) {
      out.push({ line: i + 1, id: m[1], key: m[2] ?? null, version: m[3]?.replace(/[.,;:)]+$/, '') ?? null, symbol, declLine: symbol ? j + 1 : null });
    }
  });
  return out;
}

// First line of the comment block above a declaration (1-based): up over comment and blank lines,
// then past any leading blanks.
function blockStart(lines, lang, declLine) {
  let s = declLine;
  while (s > 1 && (isBlank(lines[s - 2]) || isComment(lang, lines[s - 2]))) s--;
  while (s < declLine && isBlank(lines[s - 1])) s++;
  return s;
}

// The unit's line range, trailing blank lines trimmed.
export function unitRange(text, lang, declLine) {
  const lines = text.split('\n');
  const start = blockStart(lines, lang, declLine);
  const next = lines.findIndex((l, i) => i + 1 > declLine && symbolOf(lang, l) !== null) + 1;
  let end = next ? blockStart(lines, lang, next) - 1 : lines.length;
  while (end > declLine && isBlank(lines[end - 1])) end--;
  return { start, end };
}

// The unit's text as hashed: its lines joined with \n, with the `=<version>` of every pin removed.
export function unitText(text, lang, declLine) {
  const { start, end } = unitRange(text, lang, declLine);
  return text.split('\n').slice(start - 1, end).join('\n').replace(PIN_RE, '$1');
}

// One unit per distinct declaration with an attached link, `sym:<name>` (a repeated name gets `#`
// appended until the key is free), with its range and links, in file order.
export function codeUnits(text, lang) {
  const units = [];
  const taken = new Set();
  for (const link of extractCodeLinks(text, lang)) {
    if (!link.symbol) continue;
    const hit = units.find((u) => u.declLine === link.declLine);
    if (hit) { hit.links.push(link); continue; }
    let unit = `sym:${link.symbol}`;
    while (taken.has(unit)) unit += '#';
    taken.add(unit);
    units.push({ unit, declLine: link.declLine, ...unitRange(text, lang, link.declLine), links: [link] });
  }
  return units;
}

export function codeUnitHashes(text, lang) {
  return Object.fromEntries(codeUnits(text, lang).map((u) => [u.unit, createHash('sha256').update(unitText(text, lang, u.declLine)).digest('hex')]));
}

// The declared version per key of code.versions: the first capture group of the first match of
// `pattern` (compiled with the m flag by parseProjectConfig) over the whole file.
export function readVersions(cfg, repoRoot) {
  const out = {};
  for (const [key, { file, pattern }] of Object.entries(cfg?.code?.versions ?? {})) {
    let text;
    try { text = readFileSync(resolve(repoRoot, file), 'utf8'); } catch { throw new Error(`versions.${key}: cannot read ${file}`); }
    const m = pattern.exec(text);
    if (!m) throw new Error(`versions.${key}: pattern matched nothing in ${file}`);
    out[key] = m[1];
  }
  return out;
}

// Pure: one row per link, in order. Statuses: ok, uncovered (no entry), unattached (no declaration),
// stale with its reason: `time`, `superseded by <id>`, `<key> <pinned> -> <declared>` or
// `no key <key> in code.versions`. A pin selects the version rule over the time rule, except for
// a volatile entry, which is always stale.
export function checkCodeLinks(links, entries, schema, versions, now) {
  const byId = new Map(entries.map((e) => [e.id, e]));
  return links.map((l) => {
    const row = { type: 'id', value: l.id, symbol: l.symbol, line: l.line, key: l.key, version: l.version };
    const entry = byId.get(l.id);
    if (!entry) return { ...row, status: 'uncovered' };
    row.id = entry.id;
    row.volatility = entry.volatility;
    if (!l.symbol) return { ...row, status: 'unattached' };
    const stale = (reason) => ({ ...row, status: 'stale', reason });
    if (entry.status === 'superseded') return stale(`superseded by ${entry.superseded_by}`);
    if (l.key !== null) {
      if (!(l.key in versions)) return stale(`no key ${l.key} in code.versions`);
      if (versions[l.key] !== l.version) return stale(`${l.key} ${l.version} -> ${versions[l.key]}`);
      if (schema.taxonomy.volatility[entry.volatility]?.refresh_after_days === 0) return stale('time');
      return { ...row, status: 'ok' };
    }
    return staleness(entry, schema, new Date(now)) ? stale('time') : { ...row, status: 'ok' };
  });
}

// The worst status among rows, as printed on a unit line: `stale (<reason>)`, `uncovered` or `ok`.
export function worstStatus(rows) {
  const rank = { stale: 2, uncovered: 1, unattached: 1, ok: 0 };
  const w = rows.reduce((a, r) => (rank[r.status] > rank[a.status] ? r : a), rows[0] ?? { status: 'ok' });
  return w.reason ? `${w.status} (${w.reason})` : w.status;
}

