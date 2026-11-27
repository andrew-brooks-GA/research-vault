// Claims-gate ledger: append-only JSONL of reviewer verdicts keyed to a draft's sha256,
// so any edit to the draft invalidates the record. Also derives a draft's evidence list
// from what it cites, and finds the files the gate covers. A code file the binding's
// code.globs name is keyed by linked symbol (spec 15); everything else as before.
import { createHash } from 'node:crypto';
import { readFileSync, appendFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { join, resolve, relative, dirname, extname, basename, isAbsolute, matchesGlob, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { checkCitations, extractCitations } from './citations.mjs';
import { buildManifest } from './manifest.mjs';
import { walkEntries, readEntry } from './fsutil.mjs';
import { listStale } from './stale.mjs';
import { loadSchema } from './schema.mjs';
import { SKIP_DIRS, expandFiles } from './files.mjs';
import { runGit } from './git.mjs';
import { imageTarget, STATIC_DIRS } from './serve-file.mjs';
import { parseBlocks, blockSpans, imgAttr } from './lesson-format.mjs';
import { findProjectConfig, loadProjectConfig } from './projectconfig.mjs';
import { assertInsideVault, compareContainment, isInsideVault } from './containment.mjs';
import { langFor, codeFiles, extractCodeLinks, codeUnits, codeUnitHashes, checkCodeLinks, worstStatus } from './codelinks.mjs';
import { screenText } from './screen.mjs';

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

export const LEDGER_FILENAME = '.research-vault-ledger.jsonl';
export const VERDICTS = ['PASS', 'FAIL-as-sent', 'MERIT'];
const SATISFIES = new Set(['PASS', 'MERIT']);
const REVIEWER_FILE = join(REPO_ROOT, 'agents', 'claims-reviewer.md');

// The reviewer is the agent file: its frontmatter pins the model and effort, its body is the
// procedure. Its hash goes into every row (spec 18 D3); null when the file is not shipped.
export function reviewerHash() { return existsSync(REVIEWER_FILE) ? contentHash(readFileSync(REVIEWER_FILE)) : null; }

// A row counts for a file while its verdict passes and the reviewer that gave it is the one
// installed; a row written before the reviewer field keeps standing.
const counts = (r, file, reviewer) => r.event === 'claims' && r.file === file && SATISFIES.has(r.verdict) && (r.reviewer == null || r.reviewer === reviewer);

// Raw bytes (a Buffer) or a string; a string hashes as its UTF-8 encoding.
export function contentHash(data) { return createHash('sha256').update(data).digest('hex'); }

// The ledger root for a file: the repo bound above it, else the vault when the file is inside it, else null.
export function ledgerRoot(abs, vaultPath, opts) {
  if (compareContainment(vaultPath, abs, undefined, null)) assertInsideVault(vaultPath, abs);
  const cfg = findProjectConfig(dirname(abs), opts);
  return cfg ? dirname(cfg.path) : isInsideVault(vaultPath, abs) ? resolve(vaultPath) : null;
}

export function ledgerKey(repoRoot, filePath) {
  return relative(resolve(repoRoot), resolve(repoRoot, filePath)).replace(/\\/g, '/');
}

// Markdown sections: one unit per ATX heading, `sec:<slug>`, from the heading line to the line before
// the next heading (headings inside fenced code are text); what precedes the first heading is
// `sec:preamble`. A document with no heading has no sections. Line numbers are 1-based.
// Each data row of a table (the `|` lines after a `|---|` separator) is its own unit,
// `sec:<slug>/<first-cell slug>` with `row: true`, listed after its section, so a one-row edit reopens
// that row only; the header and separator stay in the section.
export const HEADING_RE = /^#{1,6}\s+(.+?)\s*#*\s*$/;
export const TABLE_SEP_RE = /^\s*\|[\s:|-]*-[\s:|-]*$/;
const slugOf = (s) => s.toLowerCase().replace(/`/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'untitled';
export function mdUnits(text) {
  const lines = text.split(/\r?\n/);
  const out = [];
  let fence = false, table = false, cur = null, rows = [];
  const uniq = (name) => { while (out.some((u) => u.unit === name) || rows.some((u) => u.unit === name)) name += '#'; return name; };
  const close = (end) => {
    while (cur && end > cur.start - 1 && !lines[end - 1].trim()) end--; // trailing blank lines belong to no section
    if (cur && end >= cur.start) out.push({ ...cur, end });
    out.push(...rows);
    cur = null; rows = [];
  };
  lines.forEach((line, i) => {
    if (/^\s*(```|~~~)/.test(line)) fence = !fence;
    const m = !fence && HEADING_RE.exec(line);
    if (!m) {
      if (!cur) cur = { unit: 'sec:preamble', start: i + 1 };
      const pipe = !fence && /^\s*\|/.test(line);
      if (pipe && table) rows.push({ unit: uniq(`${cur.unit}/${slugOf(line.split(/(?<!\\)\|/)[1])}`), start: i + 1, end: i + 1, row: true });
      else table = pipe && TABLE_SEP_RE.test(line) && /^\s*\|/.test(lines[i - 1] ?? '');
      return;
    }
    close(i);
    table = false;
    cur = { unit: uniq(`sec:${slugOf(m[1])}`), start: i + 1 };
  });
  close(lines.length);
  return out.some((u) => u.unit !== 'sec:preamble' && !u.row) ? out : [];
}

// Block pages cover every raw text position: each removed span is hashed by its unit;
// all remaining text and a NUL separator per removed span are hashed by `rest`. NUL is not
// valid HTML text. Parsed quiz scripts alone are canonicalized: item values keep their
// existing JSON.stringify hashes, and rest holds all other keys and the item count.
// Changes discarded by JSON.parse/JSON.stringify (such as whitespace) are exempt.
// Claim units of a draft, each hashed on its own: for a lesson, every data-block (the fact block
// per <p>, the quiz per item), so a verdict carries over to the units an edit did not touch.
// A lesson or reference page's <img> tags that are also units, `img:<src>` as written, hashed over the enclosing <figure>
// (the tag itself outside one) and the file's bytes, so a pixel change reopens it alone and a caption or alt change also
// reopens the data-block holding the figure (for a fact block, the paragraph holding it; none for a figure between fact paragraphs);
// a missing file hashes differently from a present one. Given the page's path, so src can be resolved as the image lint does.
// A checked task's `step` unit is hashed over the block and its requirements file's bytes (taskFile), so an edit to
// the file reopens the step alone.
// With a language, one `sym:<name>` unit per linked declaration; a Markdown draft without data-block
// elements is one unit per heading section and per table row (mdUnits); anything else, or a code file without an
// attached link, is one unit, "all". A page whose path ends in .md is never cut as a lesson (pageBlocks).
export function unitHashes(content, lang = null, page = null) {
  const html = typeof content === 'string' ? content : content.toString('utf8');
  if (lang) {
    const code = codeUnitHashes(html, lang);
    if (Object.keys(code).length) return code;
  }
  const units = {};
  const blocks = pageBlocks(html, page);
  if (!blocks.size) {
    const lines = html.split(/\r?\n/);
    const md = mdUnits(html);
    const rowLines = new Set(md.filter((u) => u.row).map((u) => u.start));
    // A section hashes without its table rows, so a row edit leaves the section's hash as it was.
    for (const u of md) units[u.unit] = contentHash(lines.slice(u.start - 1, u.end).filter((_, k) => u.row || !rowLines.has(u.start + k)).join('\n'));
    return Object.keys(units).length ? units : { all: contentHash(html) };
  }
  const task = page && taskFile(page);
  const spans = blockSpans(html);
  const names = new Set(spans.map((b) => b.name));
  const seen = new Set();
  const removed = [];
  // Reserve real names before assigning suffixes: note#2 can itself be a real name.
  // rest is the residual; __proto__ cannot be assigned as an own property of units.
  const unique = (base, repeated = false) => {
    let name = repeated ? base + '#2' : base, n = repeated ? 3 : 2;
    while (name === 'rest' || name === '__proto__' || Object.hasOwn(units, name) || (name !== base && names.has(name))) name = base + '#' + n++;
    return name;
  };
  for (const { name, html: inner, start, end } of spans) {
    const repeated = seen.has(name);
    seen.add(name);
    const cover = (a, b, replacement = '\0') => removed.push({ start: a, end: b, replacement });
    if (name === 'fact' && !repeated) {
      const paragraphs = [...inner.matchAll(/<p\b[^>]*>[\s\S]*?<\/p>/gi)];
      paragraphs.forEach((pm, i) => {
        units[unique(`fact:${i}`)] = contentHash(pm[0]);
        cover(start + pm.index, start + pm.index + pm[0].length);
      });
      if (!paragraphs.length) { units[unique(name)] = contentHash(inner); cover(start, end); }
    } else if (name === 'quiz' && !repeated) {
      const script = /<script\b[^>]*\bdata-quiz\b[^>]*>([\s\S]*?)<\/script>/i.exec(inner);
      let quiz = null;
      try { quiz = JSON.parse(script?.[1] ?? 'null'); } catch { /* the whole block is a unit */ }
      if (Array.isArray(quiz?.items)) {
        quiz.items.forEach((it, i) => { units[unique(`quiz:${i}`)] = contentHash(JSON.stringify(it)); });
        const offset = start + script.index + script[0].indexOf('>') + 1;
        cover(offset, offset + script[1].length, '\0' + JSON.stringify({ ...quiz, items: quiz.items.map(() => null) }) + '\0');
      } else { units[unique(name)] = contentHash(inner); cover(start, end); }
    } else {
      units[unique(name, repeated)] = name === 'step' && task
        ? contentHash(Buffer.concat([Buffer.from(inner + '\0'), readFileSync(task)])) : contentHash(inner);
      cover(start, end);
    }
  }
  // Only remove spans whose raw bytes were hashed (or canonical quiz text). Merge overlaps
  // from nested blocks; an enclosing raw unit already covers anything it contains.
  let rest = '', offset = 0;
  for (const span of removed.sort((a, b) => a.start - b.start || b.end - a.end)) {
    if (span.start < offset) continue;
    rest += html.slice(offset, span.start) + span.replacement;
    offset = span.end;
  }
  units.rest = contentHash('rest\0' + rest + html.slice(offset));
  if (page) {
    for (const script of imageRefs(html, page, { scripts: true })) {
      units[unique(`script:${script.src}`)] = scriptHash(script);
    }
    for (const im of imageRefs(html, page)) {
      let name = `img:${im.src}`;
      while (name === '__proto__' || Object.hasOwn(units, name)) name += '#';
      units[name] = contentHash(Buffer.concat([Buffer.from(im.markup + '\0'), im.body ? Buffer.concat([Buffer.from('f'), im.body]) : Buffer.from('m')]));
    }
  }
  return units;
}

// A page's data-block elements, none for a Markdown file: what it quotes in a code span or fence is not its own block.
const pageBlocks = (text, page) => (page && extname(page) === '.md' ? new Map() : parseBlocks(text));

// The workspace is the nearest directory above the page that holds MISSION.md, else the page's grandparent.
function workspaceOf(page) {
  for (let d = dirname(page); dirname(d) !== d; d = dirname(d)) if (existsSync(join(d, 'MISSION.md'))) return d;
  return dirname(dirname(page));
}

// What the gate treats as an image file; any other target of an <img> (a lesson, a text file) counts as no file.
const IMAGE_EXTS = new Set(['.png', '.jpg', '.jpeg', '.gif', '.svg', '.webp']);

// Each <img> of the page that has a src (a tag named in prose has none): its src, its figure markup, and
// imageTarget's workspace-relative path with the bytes read from disk (body null when the target is no image file).
// Scripts use the same resolution and containment, without the image extension filter; URLs are excluded before resolution.
function imageRefs(html, page, { bytes = true, scripts = false } = {}) {
  const abs = resolve(page);
  const ws = workspaceOf(abs);
  const figs = [...html.matchAll(/<figure\b[\s\S]*?<\/figure>/gi)];
  return [...html.matchAll(scripts ? /<script\b([^>]*)>/gi : /<img\b([^>]*)>/gi)].filter((m) => imgAttr(m[1], 'src') !== undefined && (!scripts || !/^[a-z][a-z0-9+.-]*:|^\/\//i.test(imgAttr(m[1], 'src')))).map((m) => {
    const src = imgAttr(m[1], 'src');
    const fig = figs.find((f) => f.index < m.index && m.index < f.index + f[0].length);
    const t = imageTarget(ws, dirname(abs), src, { bytes: false, dirs: scripts ? STATIC_DIRS : undefined });
    if (scripts && (!existsSync(join(ws, 'MISSION.md')) || src.includes('\\') || !STATIC_DIRS.includes(t.path.split('/')[0]))) return null;
    const file = join(ws, t.path);
    const ok = t.ok && (scripts || IMAGE_EXTS.has(extname(t.path).toLowerCase()));
    let body = null;
    if (ok && bytes) try { body = readFileSync(file); } catch { /* unreadable: the image counts as missing */ }
    let shipped = false;
    if (scripts && body) {
      const asset = join(REPO_ROOT, 'skills', 'research-teach', t.path);
      try { shipped = body.equals(readFileSync(asset)); } catch { /* not a shipped asset */ }
    }
    return { shipped, src, markup: fig ? fig[0] : m[0], path: t.path, file, ok: ok && (!bytes || body !== null), body };
  }).filter(Boolean);
}

// Path identity prevents passed bytes from another script satisfying this unit.
function scriptHash(script) {
  return contentHash(Buffer.concat([Buffer.from(`script\0${script.path}\0${script.body === null ? 'missing' : 'file'}\0`), script.body ?? Buffer.alloc(0)]));
}

export function referencedScripts(page) {
  if (extname(page) !== '.html') return [];
  try { return imageRefs(readFileSync(page, 'utf8'), page, { bytes: false, scripts: true }).filter((s) => s.ok).map((s) => s.file); } catch { return []; }
}

// The existing image files a lesson or reference page references, as absolute paths; none for a page that cannot be read.
// Existence only: no image bytes are read.
export function referencedImages(page) {
  if (extname(page) !== '.html') return [];
  try { return imageRefs(readFileSync(page, 'utf8'), page, { bytes: false }).filter((i) => i.ok).map((i) => i.file); } catch { return []; }
}

// Issue 79 D9: a lesson page's evidence/NNNN/requirements.json as an absolute path when the file exists, else null.
export function taskFile(page) {
  const file = taskPath(page);
  return file && existsSync(file) ? file : null;
}

// The requirements file path a lesson page's step unit reads, present or not; null for a page that has none.
function taskPath(page) {
  const abs = resolve(page);
  const nnnn = /^(\d{4})-.*\.html$/.exec(basename(abs))?.[1];
  if (!nnnn || basename(dirname(abs)) !== 'lessons') return null;
  const ws = workspaceOf(abs);
  const file = join(ws, 'evidence', nnnn, 'requirements.json');
  return isInsideVault(ws, file) ? file : null;
}

// The files beside a page whose bytes or absence its verdict reads, present or not: the images under the folders
// imageTarget serves, the local scripts, and the requirements file. None for a page with no data-block (unitHashes).
function pageDeps(html, page) {
  if (!pageBlocks(html, page).size) return [];
  const images = imageRefs(html, page, { bytes: false }).filter((i) => IMAGE_EXTS.has(extname(i.path).toLowerCase()) && ['lessons', 'reference', 'assets'].includes(i.path.split('/')[0]));
  return [...images, ...imageRefs(html, page, { bytes: false, scripts: true })].map((r) => r.file).concat(taskPath(page) ?? []);
}

// The binding of this repo root and the language of a code.globs file under it, else null. A
// binding found above the root belongs to another repo and is not read.
export function codeLang(repoRoot, filePath, opts) {
  const hit = loadProjectConfig(resolve(repoRoot), { ...opts, schema: loadSchema(REPO_ROOT) });
  const cfg = hit && dirname(hit.path) === resolve(repoRoot) ? hit.config : null;
  const abs = resolve(repoRoot, filePath);
  // ponytail: expands code.globs per call; switch to path.matchesGlob if large repos make this slow.
  return codeFiles(cfg, repoRoot).includes(abs) ? { cfg, lang: langFor(extname(abs), cfg) } : null;
}

function ledgerRows(repoRoot) {
  const ledger = join(repoRoot, LEDGER_FILENAME);
  assertInsideVault(repoRoot, ledger);
  return existsSync(ledger)
    ? readFileSync(ledger, 'utf8').split('\n').filter(Boolean).flatMap((l) => { try { return [JSON.parse(l)]; } catch { return []; } }) : [];
}

// Units of the draft's current content that no PASS or MERIT row for this file has covered,
// by unit id: the reviewer's worklist after an edit. `opts.content` (bytes) stands in for the file on disk.
export function changedUnits(repoRoot, filePath, opts) {
  const file = ledgerKey(repoRoot, filePath);
  const content = opts?.content ?? readFileSync(resolve(repoRoot, filePath));
  const units = unitHashes(content, codeLang(repoRoot, filePath, opts)?.lang, resolve(repoRoot, filePath));
  const covered = new Set();
  const reviewer = reviewerHash();
  for (const r of ledgerRows(repoRoot)) {
    if (!counts(r, file, reviewer)) continue;
    for (const h of Object.values(r.units ?? {})) covered.add(h);
  }
  const shipped = new Set(imageRefs(content.toString('utf8'), resolve(repoRoot, filePath), { scripts: true }).filter((s) => s.shipped).map(scriptHash));
  return Object.entries(units).filter(([id, h]) => !covered.has(h) && !(id.startsWith('script:') && shipped.has(h))).map(([id]) => id);
}

// What a claims row stores of the draft and the files beside it (its sha256 and its unit hashes, which hold the
// images, scripts and requirements file), with `reviewHash`, the SHA-256 over exactly those: `gate evidence` prints
// it and `gate record --expect` compares it, so a row is refused when anything it would store changed since.
export function draftState(repoRoot, filePath) {
  const content = readFileSync(resolve(repoRoot, filePath));
  const state = { sha256: contentHash(content), units: unitHashes(content, codeLang(repoRoot, filePath)?.lang, resolve(repoRoot, filePath)) };
  return { ...state, reviewHash: contentHash(JSON.stringify(state)) };
}

// `expect` is the review hash `gate evidence` printed: a mismatch throws (code DRAFT_CHANGED, `actual` the current
// hash) and writes nothing. A row recorded without it is marked `manual`; nothing reads the mark for the verdict.
export function recordVerdict(repoRoot, filePath, verdict, note, expect) {
  if (!VERDICTS.includes(verdict)) throw new Error(`verdict must be one of ${VERDICTS.join(', ')}`);
  const { sha256, units, reviewHash } = draftState(repoRoot, filePath);
  if (expect !== undefined && expect.toLowerCase() !== reviewHash) {
    throw Object.assign(new Error('draft changed since gate evidence'), { code: 'DRAFT_CHANGED', actual: reviewHash });
  }
  const row = { ts: new Date().toISOString(), event: 'claims', file: ledgerKey(repoRoot, filePath), sha256, verdict, units };
  const reviewer = reviewerHash();
  if (reviewer) row.reviewer = reviewer;
  if (note !== undefined) row.note = note;
  if (expect === undefined) row.manual = true;
  const ledger = join(repoRoot, LEDGER_FILENAME);
  const line = JSON.stringify(row) + '\n';
  assertInsideVault(repoRoot, ledger);
  appendFileSync(ledger, line);
  return row;
}

// `opts.content` (bytes) is judged in place of the file on disk; files beside it are read from disk.
export function gateStatus(repoRoot, filePath, opts) {
  const file = ledgerKey(repoRoot, filePath);
  const content = opts?.content ?? readFileSync(resolve(repoRoot, filePath));
  const sha256 = contentHash(content);
  const rows = ledgerRows(repoRoot);
  const reviewer = reviewerHash();
  const hit = rows.findLast((r) => counts(r, file, reviewer) && r.sha256 === sha256);
  const pending = changedUnits(repoRoot, filePath, { ...opts, content });
  // The page's exact bytes were passed, unless a referenced image, script or requirements file (taskFile) has changed
  // since. Only step keeps the legacy exception for rows without its hash.
  if (hit && !pending.some((u) => u.startsWith('img:') || u.startsWith('script:') || (u === 'step' && hit.units?.step))) return { file, sha256, verdict: hit.verdict, ts: hit.ts, units: [] };
  // No row for these exact bytes: the draft still passes when every unit of it was passed in some row.
  if (pending.length) {
    // Say why a file covered yesterday is not today: a passing row exists, from another reviewer.
    const reviewerChanged = rows.some((r) => r.event === 'claims' && r.file === file && SATISFIES.has(r.verdict) && r.reviewer != null && r.reviewer !== reviewer);
    return { file, sha256, verdict: null, ts: null, units: pending, ...(reviewerChanged && { reviewerChanged }) };
  }
  const last = rows.findLast((r) => counts(r, file, reviewer) && r.units);
  return { file, sha256, verdict: last ? `${last.verdict} (by unit)` : null, ts: last?.ts ?? null, units: [] };
}

// A PASS or MERIT for the file's current content, by gate status's rule and the ledger ledgerRoot finds;
// false when no ledger resolves or the file cannot be read. `teach next` and `teach export` ask this.
export function hasVerdict(file, vaultPath, workspaceDir) {
  try {
    const opts = { workspaceDir };
    const root = ledgerRoot(file, vaultPath, opts);
    return Boolean(root && gateStatus(root, file, opts).verdict);
  } catch { return false; }
}

export const MIN_BODY_CHARS = 200;
const BODY_TYPES = new Set(['source', 'note']);

// Body text after the first `# ` title line, trimmed.
export function bodyText(body) {
  const lines = body.split('\n');
  const i = lines.findIndex((l) => l.startsWith('# '));
  return lines.slice(i + 1).join('\n').trim();
}

// A Markdown draft's citations inside the `changed` units' line ranges. A changed row with none takes
// its section's, from the section's lines outside rows. A changed unit with none, or no changed unit,
// gives the whole file's: the list is never empty for want of a citation in range.
function changedCites(text, sections, changed) {
  const all = extractCitations(text);
  if (!changed || !sections.length) return all;
  const lines = text.split(/\r?\n/);
  const rowLines = new Set(sections.filter((u) => u.row).map((u) => u.start));
  const cut = (u, rows) => extractCitations(lines.slice(u.start - 1, u.end).filter((_, k) => rows || !rowLines.has(u.start + k)).join('\n'));
  const out = [];
  for (const u of sections.filter((s) => changed.includes(s.unit))) {
    let c = cut(u, true);
    if (!c.length && u.row) c = cut(sections.find((s) => !s.row && s.start <= u.start && u.end <= s.end), false);
    if (!c.length) return all;
    out.push(...c);
  }
  return out.length ? out : all;
}

// `code` ({ lang, versions }) marks a code file: its citations are its links, and the result
// gains `units`, one per linked declaration with its line range and the worst status of its links.
// `changed` (unit names, from `gate evidence --changed`) narrows a Markdown draft's citations (changedCites).
export function evidenceFor(draftPath, vaultPath, { extra = [], code = null, changed = null } = {}) {
  if (compareContainment(vaultPath, draftPath, undefined, null)) assertInsideVault(vaultPath, draftPath);
  const manifest = buildManifest(vaultPath);
  const byId = new Map(manifest.entries.map((e) => [e.id, e]));
  const text = readFileSync(draftPath, 'utf8');
  const links = code ? extractCodeLinks(text, code.lang) : null;
  const sections = !code && !pageBlocks(text, draftPath).size ? mdUnits(text) : null;
  const cites = [...(links ? links.map((l) => ({ type: 'id', value: l.id })) : changedCites(text, sections ?? [], changed)), ...extra.map((value) => ({ type: 'id', value }))];
  const now = new Date().toISOString().slice(0, 10);
  const schema = loadSchema(REPO_ROOT);
  const hit = new Map();
  const uncovered = [];
  for (const r of checkCitations(cites, manifest.entries, schema, now)) {
    if (r.status !== 'uncovered') hit.set(r.id, byId.get(r.id));
    else if (!uncovered.some((u) => u.type === r.type && u.value === r.value)) uncovered.push({ type: r.type, value: r.value });
  }
  // The sources behind a listed note (spec 52 point 1). One step: a note named by a note is listed and not followed.
  for (const e of [...hit.values()]) if (e.type === 'note') for (const id of e.sources || []) if (byId.has(id)) hit.set(id, byId.get(id));
  const stale = new Set(listStale(vaultPath, { manifest }).map((s) => s.id));
  const bodies = new Map();
  for (const abs of walkEntries(vaultPath)) {
    const { id, body } = readEntry(abs);
    if (hit.has(id)) bodies.set(id, bodyText(body));
  }
  const entries = [...hit.values()].sort((a, b) => a.id.localeCompare(b.id)).map((e) => ({
    id: e.id, type: e.type, status: e.status, stale: stale.has(e.id),
    noBody: BODY_TYPES.has(e.type) && (bodies.get(e.id) ?? '').length < MIN_BODY_CHARS,
  }));
  const out = { entries, uncovered };
  if (code) {
    const rows = checkCodeLinks(links, manifest.entries, schema, code.versions, now);
    out.units = codeUnits(text, code.lang).map((u) => ({
      unit: u.unit, start: u.start, end: u.end, status: worstStatus(rows.filter((r, i) => links[i].declLine === u.declLine)),
    }));
  } else if (sections) {
    // A Markdown draft: one line per heading section, so the reviewer can read only the changed ones.
    if (sections.length) out.units = sections.map((u) => ({ ...u, status: 'prose' }));
  } else {
    // A lesson or reference page: the image files it references that exist, for the reviewer to open.
    out.images = [...new Map(imageRefs(text, draftPath).filter((i) => i.body).map((i) => [i.path, { path: i.path, sha256: contentHash(i.body) }])).values()];
  }
  return out;
}

// S-11: the id, type and status come from entries and pass screenText; an uncovered value and an image path
// come from the draft.
export function renderEvidence({ entries, uncovered, images = [] }) {
  const lines = entries.map((e) =>
    `${screenText(e.id)} [${[e.type, e.status, e.stale && 'STALE', e.noBody && 'no-body'].filter(Boolean).map((v) => screenText(v)).join(', ')}]`);
  for (const u of uncovered) lines.push(`uncovered: ${u.value}`);
  for (const i of images) lines.push(`image: ${i.path} sha256:${i.sha256}`);
  return lines.length ? lines.join('\n') + '\n' : '';
}

// Directories holding MISSION.md, walked from repoRoot; the vault itself is never searched.
export function findWorkspaces(repoRoot, vaultPath) {
  const vault = resolve(vaultPath);
  const out = [];
  const walk = (dir) => {
    let dirents;
    try { dirents = readdirSync(dir, { withFileTypes: true }); } catch { return; } // unreadable: skip it
    if (dirents.some((d) => d.isFile() && d.name === 'MISSION.md')) out.push(dir);
    for (const d of dirents) {
      if (!d.isDirectory() || SKIP_DIRS.has(d.name)) continue;
      const sub = join(dir, d.name);
      if (sub !== vault) walk(sub);
    }
  };
  walk(resolve(repoRoot));
  return out;
}

// Staged files that are gated, chosen by gateRule from their paths and index content (a clean one on disk only when it
// is a regular file after any link is followed, as expandFiles finds it), each with the verdict for its
// staged content by gateStatus's rule. A file git reports clean is judged by its working copy, the bytes gate record
// hashed; one whose working copy differs or is gone, by the index blob as a checkout would write it (cat-file
// --filters), so a changed file under a line-ending, ident or filter rule is judged in that checkout form. A gated
// page not staged is judged when its content, read the same way, references a staged image, script or requirements
// file (pageDeps, present or not). A page whose images, scripts or requirements file differ between the index and
// the working tree, an untracked one included, has no verdict and names them in `differs`; otherwise those files are
// read from disk. Throws when git cannot be inspected or a staged blob cannot be read.
// The index is the one git finds from cwd, so a worktree that inherits the binding above it is
// judged by its own index and the binding's globs matched at its own top; the ledger key stays
// relative to the bound root, as `gate record` writes it.
export function stagedGates(repoRoot, vaultPath, cfg, cwd = repoRoot) {
  const git = (args, encoding) => {
    try { return runGit(['--literal-pathspecs', ...args], { cwd, timeout: 0, stderr: 'pipe', encoding }); } catch (err) {
      const cmd = args.includes('--') ? args.slice(0, args.indexOf('--')) : args;
      throw new Error(`git ${cmd.join(' ')} failed in ${cwd}: ${String(err.stderr || err.message).trim().split('\n').at(-1)}`);
    }
  };
  const top = git(['rev-parse', '--show-toplevel']).trim();
  const paths = (out) => out.split('\0').filter(Boolean).map((f) => resolve(top, f));
  // A submodule (gitlink) holds no file to judge; T is a type change (a link replaced by a file, or the reverse).
  const staged = new Set(paths(git(['diff', '--cached', '--name-only', '--diff-filter=ACMRT', '--ignore-submodules=all', '-z'])));
  // Tracked files whose working copy differs from the index or is gone.
  const dirty = new Set(paths(git(['diff', '--name-only', '--ignore-submodules=all', '-z'])));
  const blobs = new Map();
  const blob = (f) => blobs.get(f) ?? blobs.set(f, git(['cat-file', '--filters', `:0:${ledgerKey(top, f)}`], 'buffer')).get(f);
  // The bytes a file is judged by; null for a clean file that cannot be read.
  const read = (f) => {
    if (dirty.has(f) || !existsSync(f)) return blob(f);
    try { return readFileSync(f); } catch { return null; }
  };
  const deps = new Map();
  const depsOf = (f) => deps.get(f) ?? deps.set(f, pageDeps(read(f)?.toString('utf8') ?? '', f)).get(f);
  const gates = gateRule(top, vaultPath, cfg);
  const own = [...staged].filter((f) => (dirty.has(f) || !existsSync(f) || statSync(f).isFile()) && gates(f, () => blob(f)));
  // Only an HTML page references an image, a script or a requirements file. A page on disk and clean is gated as
  // gatedFiles finds it; one that differs or is gone, by its index version.
  const others = [...new Set([...gatedFiles(top, vaultPath, cfg), ...dirty])]
    .filter((f) => !staged.has(f) && extname(f) === '.html' && (!dirty.has(f) || gates(f, () => blob(f))) && depsOf(f).some((d) => staged.has(d)));
  // A page that is untracked is skipped: nothing of it is committed.
  const untracked = others.length ? paths(git(['ls-files', '--others', '--full-name', '-z', '--', ...others])) : [];
  const pages = [...own, ...others.filter((f) => !untracked.includes(f))];
  const all = [...new Set(pages.flatMap(depsOf))];
  const inside = all.filter((d) => !/^\.\.(\/|$)/.test(ledgerKey(top, d)));
  // A file outside the repository cannot be staged: it differs when it exists.
  const differ = new Set(all.filter((d) => !inside.includes(d) && existsSync(d)));
  if (inside.length) {
    for (const f of paths(git(['diff', '--name-only', '-z', '--', ...inside]))) differ.add(f);
    for (const f of paths(git(['ls-files', '--others', '--full-name', '-z', '--', ...inside]))) differ.add(f);
  }
  const cache = {};
  return pages.map((f) => {
    const content = read(f) ?? undefined;
    const { file, verdict, reviewerChanged, units } = gateStatus(repoRoot, f, { content });
    const missing = verdict ? 0 : missingEvidence(repoRoot, f, vaultPath, units, cache, content);
    const differs = depsOf(f).filter((d) => differ.has(d)).map((d) => ledgerKey(repoRoot, d));
    return { file, verdict: differs.length ? null : verdict, ...(reviewerChanged && { reviewerChanged }), ...(missing && { missing }), ...(differs.length && { differs }) };
  });
}

// Issue 72 item 12: how many ids the changed units of a Markdown file cite that this vault does not hold. A doc gated
// against another vault cites them, and those units cannot pass here until that evidence is rebuilt. Code files are not
// counted. `cache` lets a caller build the vault's manifest once for many files; `content` (bytes) stands in for the file.
export function missingEvidence(repoRoot, filePath, vaultPath, units, cache = {}, content = null) {
  try {
    const abs = resolve(repoRoot, filePath);
    if (codeLang(repoRoot, abs)) return 0;
    const text = (content ?? readFileSync(abs)).toString('utf8');
    const cites = changedCites(text, !pageBlocks(text, abs).size ? mdUnits(text) : [], units?.length ? units : null);
    const rows = checkCitations(cites, (cache.manifest ??= buildManifest(vaultPath)).entries, loadSchema(REPO_ROOT), new Date().toISOString().slice(0, 10));
    return new Set(rows.filter((r) => r.status === 'uncovered' && r.type === 'id').map((r) => r.value)).size;
  } catch { return 0; }
}

// The files of a teach workspace the gate covers; `teach export` gates exactly these.
export const WORKSPACE_GATES = ['lessons/*.html', 'reference/*.html', 'README.md'];

// gatedFiles's rule for one file (absolute, under repoRoot) whose content `read()` returns, read only for a code.globs
// match: what gate staged applies to the index. A path matches as expandFiles finds it on disk: relative to the root
// it is expanded at (a pattern's leading ./ dropped, an absolute pattern against the absolute path), with no folder
// above it in SKIP_DIRS (expandFiles prunes those folders; a file of such a name it prunes for some patterns only, and
// it matches here). A pattern with a .. segment matches the absolute path as resolved against the root, so one that
// leaves the root gates nothing under it. On Node 26, path.matchesGlob and fs.globSync agree on * and **, which pass no dot name.
function gateRule(repoRoot, vaultPath, cfg) {
  const workspaces = findWorkspaces(repoRoot, vaultPath);
  const slash = (p) => p.split(sep).join('/');
  const match = (root, file, globs) => {
    const rel = slash(relative(root, file));
    if (/^\.\.(\/|$)/.test(rel) || rel.split('/').slice(0, -1).some((d) => SKIP_DIRS.has(d))) return false;
    return globs.some((g) => (g.split('/').includes('..') ? matchesGlob(slash(file), slash(resolve(root, g)))
      : isAbsolute(g) ? matchesGlob(file, g) : matchesGlob(rel, g.replace(/^(\.\/)+/, ''))));
  };
  return (file, read) => workspaces.some((ws) => match(ws, file, WORKSPACE_GATES)) || match(repoRoot, file, cfg?.gates?.globs ?? [])
    || (!!cfg?.code && match(repoRoot, file, cfg.code.globs) && extractCodeLinks(read().toString('utf8'), langFor(extname(file), cfg)).some((l) => l.symbol));
}

export function gatedFiles(repoRoot, vaultPath, cfg) {
  const files = findWorkspaces(repoRoot, vaultPath).flatMap((ws) => expandFiles(WORKSPACE_GATES, ws));
  const globs = cfg?.gates?.globs ?? [];
  if (globs.length) files.push(...expandFiles(globs, resolve(repoRoot)));
  for (const f of codeFiles(cfg, repoRoot)) {
    if (extractCodeLinks(readFileSync(f, 'utf8'), langFor(extname(f), cfg)).some((l) => l.symbol)) files.push(f);
  }
  return [...new Set(files)];
}
