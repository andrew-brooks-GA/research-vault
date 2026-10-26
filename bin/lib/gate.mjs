// Claims-gate ledger: append-only JSONL of reviewer verdicts keyed to a draft's sha256,
// so any edit to the draft invalidates the record. Also derives a draft's evidence list
// from what it cites, and finds the files the gate covers.
import { createHash } from 'node:crypto';
import { readFileSync, appendFileSync, existsSync, readdirSync } from 'node:fs';
import { join, resolve, relative, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { extractCitations } from './citations.mjs';
import { buildManifest } from './manifest.mjs';
import { walkEntries, readEntry } from './fsutil.mjs';
import { listStale } from './stale.mjs';
import { loadSchema } from './schema.mjs';
import { SKIP_DIRS, expandFiles } from './files.mjs';
import { checkCitations } from '../commands/check.mjs';

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
// A draft without data-block elements is one unit, "all".
export function unitHashes(content) {
  const html = typeof content === 'string' ? content : content.toString('utf8');
  const units = {};
  const blocks = [...html.matchAll(/<([a-z][a-z0-9]*)\b[^>]*\bdata-block\s*=\s*(["'])([^"']+)\2[^>]*>/gi)];
  if (!blocks.length) return { all: contentHash(html) };
  for (const m of blocks) {
    const [open, tag, , name] = m;
    const start = m.index + open.length;
    const re = new RegExp(`<(/?)${tag}\\b[^>]*>`, 'gi');
    re.lastIndex = start;
    let depth = 1;
    let end = html.length;
    for (let t; (t = re.exec(html));) { depth += t[1] ? -1 : 1; if (depth === 0) { end = t.index; break; } }
    const inner = html.slice(start, end);
    if (units[name] !== undefined) continue;
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

function ledgerRows(repoRoot) {
  const ledger = join(repoRoot, LEDGER_FILENAME);
  return existsSync(ledger)
    ? readFileSync(ledger, 'utf8').split('\n').filter(Boolean).flatMap((l) => { try { return [JSON.parse(l)]; } catch { return []; } }) : [];
}

// Units of the draft's current content that no PASS or MERIT row for this file has covered,
// by unit id: the reviewer's worklist after an edit.
export function changedUnits(repoRoot, filePath) {
  const file = ledgerKey(repoRoot, filePath);
  const units = unitHashes(readFileSync(resolve(repoRoot, filePath)));
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
    sha256: contentHash(content), verdict, units: unitHashes(content),
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

export function evidenceFor(draftPath, vaultPath, { extra = [] } = {}) {
  const manifest = buildManifest(vaultPath);
  const byId = new Map(manifest.entries.map((e) => [e.id, e]));
  const cites = [...extractCitations(readFileSync(draftPath, 'utf8')), ...extra.map((value) => ({ type: 'id', value }))];
  const now = new Date().toISOString().slice(0, 10);
  const hit = new Map();
  const uncovered = [];
  for (const r of checkCitations(cites, manifest.entries, loadSchema(REPO_ROOT), now)) {
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
  return { entries, uncovered };
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

export function gatedFiles(repoRoot, vaultPath, cfg) {
  const files = findWorkspaces(repoRoot, vaultPath).flatMap((ws) => expandFiles(['lessons/*.html', 'reference/*.html'], ws));
  const globs = cfg?.gates?.globs ?? [];
  if (globs.length) files.push(...expandFiles(globs, resolve(repoRoot)));
  return [...new Set(files)];
}
