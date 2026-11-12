// Claims-gate ledger: append-only JSONL of reviewer verdicts keyed to a draft's sha256,
// so any edit to the draft invalidates the record. Also derives a draft's evidence list
// from what it cites, and finds the files the gate covers. A code file the binding's
// code.globs name is keyed by linked symbol (spec 15); everything else as before.
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { readFileSync, appendFileSync, existsSync, readdirSync } from 'node:fs';
import { join, resolve, relative, dirname, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { extractCitations } from './citations.mjs';
import { buildManifest } from './manifest.mjs';
import { walkEntries, readEntry } from './fsutil.mjs';
import { listStale } from './stale.mjs';
import { loadSchema } from './schema.mjs';
import { SKIP_DIRS, expandFiles } from './files.mjs';
import { checkCitations } from '../commands/check.mjs';
import { parseBlocks, imgAttr, imageTarget } from './lesson.mjs';
import { findProjectConfig, loadProjectConfig } from './projectconfig.mjs';
import { isInsideVault } from './containment.mjs';
import { langFor, codeFiles, extractCodeLinks, codeUnits, codeUnitHashes, checkCodeLinks, worstStatus } from './codelinks.mjs';

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
export function ledgerRoot(abs, vaultPath) {
  const cfg = findProjectConfig(dirname(abs));
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

// Claim units of a draft, each hashed on its own: for a lesson, every data-block (the fact block
// per <p>, the quiz per item), so a verdict carries over to the units an edit did not touch.
// A lesson or reference page's <img> tags that are also units, `img:<src>` as written, hashed over the enclosing <figure>
// (the tag itself outside one) and the file's bytes, so a pixel change reopens it alone and a caption or alt change also
// reopens the data-block holding the figure (for a fact block, the paragraph holding it; none for a figure between fact paragraphs);
// a missing file hashes differently from a present one. Given the page's path, so src can be resolved as the image lint does.
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
  for (const [name, { html: inner }] of blocks) {
    if (name === 'fact') {
      [...inner.matchAll(/<p\b[^>]*>[\s\S]*?<\/p>/gi)].forEach((pm, i) => { units[`fact:${i}`] = contentHash(pm[0]); });
      if (!Object.keys(units).some((k) => k.startsWith('fact:'))) units.fact = contentHash(inner);
    } else if (name === 'quiz') {
      let items = null;
      try { items = JSON.parse(/<script\b[^>]*\bdata-quiz\b[^>]*>([\s\S]*?)<\/script>/i.exec(inner)?.[1] ?? 'null')?.items; } catch { items = null; }
      if (Array.isArray(items)) items.forEach((it, i) => { units[`quiz:${i}`] = contentHash(JSON.stringify(it)); });
      else units.quiz = contentHash(inner);
    } else {
      units[name] = contentHash(inner);
    }
  }
  if (page) {
    for (const im of imageRefs(html, page)) {
      let name = `img:${im.src}`;
      while (name in units) name += '#';
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
function imageRefs(html, page, { bytes = true } = {}) {
  const abs = resolve(page);
  const ws = workspaceOf(abs);
  const figs = [...html.matchAll(/<figure\b[\s\S]*?<\/figure>/gi)];
  return [...html.matchAll(/<img\b([^>]*)>/gi)].filter((m) => imgAttr(m[1], 'src') !== undefined).map((m) => {
    const src = imgAttr(m[1], 'src');
    const fig = figs.find((f) => f.index < m.index && m.index < f.index + f[0].length);
    const t = imageTarget(ws, dirname(abs), src, { bytes: false });
    const file = join(ws, t.path);
    const ok = t.ok && IMAGE_EXTS.has(extname(t.path).toLowerCase());
    let body = null;
    if (ok && bytes) try { body = readFileSync(file); } catch { /* unreadable: the image counts as missing */ }
    return { src, markup: fig ? fig[0] : m[0], path: t.path, file, ok: ok && (!bytes || body !== null), body };
  });
}

// The existing image files a lesson or reference page references, as absolute paths; none for a page that cannot be read.
// Existence only: no image bytes are read.
export function referencedImages(page) {
  if (extname(page) !== '.html') return [];
  try { return imageRefs(readFileSync(page, 'utf8'), page, { bytes: false }).filter((i) => i.ok).map((i) => i.file); } catch { return []; }
}

// The binding of this repo root and the language of a code.globs file under it, else null. A
// binding found above the root belongs to another repo and is not read.
export function codeLang(repoRoot, filePath) {
  const hit = loadProjectConfig(resolve(repoRoot), { schema: loadSchema(REPO_ROOT) });
  const cfg = hit && dirname(hit.path) === resolve(repoRoot) ? hit.config : null;
  const abs = resolve(repoRoot, filePath);
  // ponytail: expands code.globs per call; switch to path.matchesGlob if large repos make this slow.
  return codeFiles(cfg, repoRoot).includes(abs) ? { cfg, lang: langFor(extname(abs), cfg) } : null;
}

function ledgerRows(repoRoot) {
  const ledger = join(repoRoot, LEDGER_FILENAME);
  return existsSync(ledger)
    ? readFileSync(ledger, 'utf8').split('\n').filter(Boolean).flatMap((l) => { try { return [JSON.parse(l)]; } catch { return []; } }) : [];
}

// Units of the draft's current content that no PASS or MERIT row for this file has covered,
// by unit id: the reviewer's worklist after an edit.
export function changedUnits(repoRoot, filePath) {
  const file = ledgerKey(repoRoot, filePath);
  const units = unitHashes(readFileSync(resolve(repoRoot, filePath)), codeLang(repoRoot, filePath)?.lang, resolve(repoRoot, filePath));
  const covered = new Set();
  const reviewer = reviewerHash();
  for (const r of ledgerRows(repoRoot)) {
    if (!counts(r, file, reviewer)) continue;
    for (const h of Object.values(r.units ?? {})) covered.add(h);
  }
  return Object.entries(units).filter(([, h]) => !covered.has(h)).map(([id]) => id);
}

export function recordVerdict(repoRoot, filePath, verdict, note) {
  if (!VERDICTS.includes(verdict)) throw new Error(`verdict must be one of ${VERDICTS.join(', ')}`);
  const content = readFileSync(resolve(repoRoot, filePath));
  const row = {
    ts: new Date().toISOString(), event: 'claims', file: ledgerKey(repoRoot, filePath),
    sha256: contentHash(content), verdict, units: unitHashes(content, codeLang(repoRoot, filePath)?.lang, resolve(repoRoot, filePath)),
  };
  const reviewer = reviewerHash();
  if (reviewer) row.reviewer = reviewer;
  if (note !== undefined) row.note = note;
  appendFileSync(join(repoRoot, LEDGER_FILENAME), JSON.stringify(row) + '\n');
  return row;
}

export function gateStatus(repoRoot, filePath) {
  const file = ledgerKey(repoRoot, filePath);
  const sha256 = contentHash(readFileSync(resolve(repoRoot, filePath)));
  const rows = ledgerRows(repoRoot);
  const reviewer = reviewerHash();
  const hit = rows.findLast((r) => counts(r, file, reviewer) && r.sha256 === sha256);
  const pending = changedUnits(repoRoot, filePath);
  // The page's exact bytes were passed, unless an image it references has changed since (only an img: unit can differ).
  if (hit && !pending.some((u) => u.startsWith('img:'))) return { file, sha256, verdict: hit.verdict, ts: hit.ts, units: [] };
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
export function hasVerdict(file, vaultPath) {
  try {
    const root = ledgerRoot(file, vaultPath);
    return Boolean(root && gateStatus(root, file).verdict);
  } catch { return false; }
}

export const MIN_BODY_CHARS = 200;
const BODY_TYPES = new Set(['source', 'note']);

// Body text after the first `# ` title line, trimmed.
function bodyText(body) {
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

export function renderEvidence({ entries, uncovered, images = [] }) {
  const lines = entries.map((e) =>
    `${e.id} [${[e.type, e.status, e.stale && 'STALE', e.noBody && 'no-body'].filter(Boolean).join(', ')}]`);
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

// Workspace lessons, reference docs and README.md, gates.globs, and every code.globs file with an attached link.
// Staged files that are gated, each with the verdict for its current content. Empty outside git.
// The index is the one git finds from cwd, so a worktree that inherits the binding above it is
// judged by its own index and the binding's globs expanded at its own top; the ledger key stays
// relative to the bound root, as `gate record` writes it.
// ponytail: judges the working copy, not the index; a partially staged file reads as its working copy.
export function stagedGates(repoRoot, vaultPath, cfg, cwd = repoRoot) {
  let top, staged;
  try {
    const git = (...a) => execFileSync('git', ['-C', cwd, ...a], { stdio: ['ignore', 'pipe', 'ignore'], encoding: 'utf8' });
    top = git('rev-parse', '--show-toplevel').trim();
    staged = git('diff', '--cached', '--name-only', '--diff-filter=ACMR', '-z').split('\0').filter(Boolean).map((f) => resolve(top, f));
  } catch { return []; }
  const gated = new Set(gatedFiles(top, vaultPath, cfg));
  // A gated page is also judged when an image it references is staged.
  const pages = [...gated].filter((f) => staged.includes(f) || referencedImages(f).some((i) => staged.includes(i)));
  return pages.map((f) => { const { file, verdict, reviewerChanged } = gateStatus(repoRoot, f); return { file, verdict, ...(reviewerChanged && { reviewerChanged }) }; });
}

// The files of a teach workspace the gate covers; `teach export` gates exactly these.
export const WORKSPACE_GATES = ['lessons/*.html', 'reference/*.html', 'README.md'];

export function gatedFiles(repoRoot, vaultPath, cfg) {
  const files = findWorkspaces(repoRoot, vaultPath).flatMap((ws) => expandFiles(WORKSPACE_GATES, ws));
  const globs = cfg?.gates?.globs ?? [];
  if (globs.length) files.push(...expandFiles(globs, resolve(repoRoot)));
  for (const f of codeFiles(cfg, repoRoot)) {
    if (extractCodeLinks(readFileSync(f, 'utf8'), langFor(extname(f), cfg)).some((l) => l.symbol)) files.push(f);
  }
  return [...new Set(files)];
}
