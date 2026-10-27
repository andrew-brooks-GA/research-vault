// Claims-gate ledger: append-only JSONL of reviewer verdicts keyed to a draft's sha256,
// so any edit to the draft invalidates the record. Also derives a draft's evidence list
// from what it cites, and finds the files the gate covers. A code file the binding's
// code.globs name is keyed by linked symbol (spec 15); everything else as before.
import { createHash } from 'node:crypto';
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
import { parseBlocks } from './lesson.mjs';
import { loadProjectConfig } from './projectconfig.mjs';
import { langFor, codeFiles, extractCodeLinks, codeUnits, codeUnitHashes, checkCodeLinks, worstStatus } from './codelinks.mjs';

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

export const LEDGER_FILENAME = '.research-vault-ledger.jsonl';
export const VERDICTS = ['PASS', 'FAIL-as-sent', 'MERIT'];
const SATISFIES = new Set(['PASS', 'MERIT']);

// Raw bytes (a Buffer) or a string; a string hashes as its UTF-8 encoding.
export function contentHash(data) { return createHash('sha256').update(data).digest('hex'); }

export function ledgerKey(repoRoot, filePath) {
  return relative(resolve(repoRoot), resolve(repoRoot, filePath)).replace(/\\/g, '/');
}

// Claim units of a draft, each hashed on its own: for a lesson, every data-block (the fact block
// per <p>, the quiz per item), so a verdict carries over to the units an edit did not touch.
// With a language, one `sym:<name>` unit per linked declaration; a draft without data-block
// elements, or a code file without an attached link, is one unit, "all".
export function unitHashes(content, lang = null) {
  const html = typeof content === 'string' ? content : content.toString('utf8');
  if (lang) {
    const code = codeUnitHashes(html, lang);
    if (Object.keys(code).length) return code;
  }
  const units = {};
  const blocks = parseBlocks(html);
  if (!blocks.size) return { all: contentHash(html) };
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
  return units;
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
  const units = unitHashes(readFileSync(resolve(repoRoot, filePath)), codeLang(repoRoot, filePath)?.lang);
  const covered = new Set();
  for (const r of ledgerRows(repoRoot)) {
    if (r.event !== 'claims' || r.file !== file || !SATISFIES.has(r.verdict)) continue;
    for (const h of Object.values(r.units ?? {})) covered.add(h);
  }
  return Object.entries(units).filter(([, h]) => !covered.has(h)).map(([id]) => id);
}

export function recordVerdict(repoRoot, filePath, verdict, note) {
  if (!VERDICTS.includes(verdict)) throw new Error(`verdict must be one of ${VERDICTS.join(', ')}`);
  const content = readFileSync(resolve(repoRoot, filePath));
  const row = {
    ts: new Date().toISOString(), event: 'claims', file: ledgerKey(repoRoot, filePath),
    sha256: contentHash(content), verdict, units: unitHashes(content, codeLang(repoRoot, filePath)?.lang),
  };
  if (note !== undefined) row.note = note;
  appendFileSync(join(repoRoot, LEDGER_FILENAME), JSON.stringify(row) + '\n');
  return row;
}

export function gateStatus(repoRoot, filePath) {
  const file = ledgerKey(repoRoot, filePath);
  const sha256 = contentHash(readFileSync(resolve(repoRoot, filePath)));
  const rows = ledgerRows(repoRoot);
  const hit = rows.findLast((r) => r.event === 'claims' && r.file === file && r.sha256 === sha256 && SATISFIES.has(r.verdict));
  if (hit) return { file, sha256, verdict: hit.verdict, ts: hit.ts, units: [] };
  // No row for these exact bytes: the draft still passes when every unit of it was passed in some row.
  const pending = changedUnits(repoRoot, filePath);
  if (pending.length) return { file, sha256, verdict: null, ts: null, units: pending };
  const last = rows.findLast((r) => r.event === 'claims' && r.file === file && SATISFIES.has(r.verdict) && r.units);
  return { file, sha256, verdict: last ? `${last.verdict} (by unit)` : null, ts: last?.ts ?? null, units: [] };
}

export const MIN_BODY_CHARS = 200;
const BODY_TYPES = new Set(['source', 'note']);

// Body text after the first `# ` title line, trimmed.
function bodyText(body) {
  const lines = body.split('\n');
  const i = lines.findIndex((l) => l.startsWith('# '));
  return lines.slice(i + 1).join('\n').trim();
}

// `code` ({ lang, versions }) marks a code file: its citations are its links, and the result
// gains `units`, one per linked declaration with its line range and the worst status of its links.
export function evidenceFor(draftPath, vaultPath, { extra = [], code = null } = {}) {
  const manifest = buildManifest(vaultPath);
  const byId = new Map(manifest.entries.map((e) => [e.id, e]));
  const text = readFileSync(draftPath, 'utf8');
  const links = code ? extractCodeLinks(text, code.lang) : null;
  const cites = [...(links ? links.map((l) => ({ type: 'id', value: l.id })) : extractCitations(text)), ...extra.map((value) => ({ type: 'id', value }))];
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
  }
  return out;
}

export function renderEvidence({ entries, uncovered }) {
  const lines = entries.map((e) =>
    `${e.id} [${[e.type, e.status, e.stale && 'STALE', e.noBody && 'no-body'].filter(Boolean).join(', ')}]`);
  for (const u of uncovered) lines.push(`uncovered: ${u.value}`);
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

// Workspace lessons and reference docs, gates.globs, and every code.globs file with an attached link.
export function gatedFiles(repoRoot, vaultPath, cfg) {
  const files = findWorkspaces(repoRoot, vaultPath).flatMap((ws) => expandFiles(['lessons/*.html', 'reference/*.html'], ws));
  const globs = cfg?.gates?.globs ?? [];
  if (globs.length) files.push(...expandFiles(globs, resolve(repoRoot)));
  for (const f of codeFiles(cfg, repoRoot)) {
    if (extractCodeLinks(readFileSync(f, 'utf8'), langFor(extname(f), cfg)).some((l) => l.symbol)) files.push(f);
  }
  return [...new Set(files)];
}
