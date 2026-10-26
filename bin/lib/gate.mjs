// Claims-gate ledger: append-only JSONL of reviewer verdicts keyed to a draft's sha256,
// so any edit to the draft invalidates the record. Also derives a draft's evidence list
// from what it cites, and finds the files the gate covers.
import { createHash } from 'node:crypto';
import { readFileSync, appendFileSync, existsSync, readdirSync } from 'node:fs';
import { join, resolve, relative } from 'node:path';
import { extractCitations } from './citations.mjs';
import { buildManifest } from './manifest.mjs';
import { walkEntries, readEntry } from './fsutil.mjs';
import { normalizeUrl } from './ids.mjs';
import { listStale } from './stale.mjs';
import { expandFiles } from '../commands/check.mjs';

export const LEDGER_FILENAME = '.research-vault-ledger.jsonl';
export const VERDICTS = ['PASS', 'FAIL-as-sent', 'MERIT'];
const SATISFIES = new Set(['PASS', 'MERIT']);

export function contentHash(text) { return createHash('sha256').update(text).digest('hex'); }

export function ledgerKey(repoRoot, filePath) {
  return relative(resolve(repoRoot), resolve(repoRoot, filePath)).replace(/\\/g, '/');
}

export function recordVerdict(repoRoot, filePath, verdict, note) {
  if (!VERDICTS.includes(verdict)) throw new Error(`verdict must be one of ${VERDICTS.join(', ')}`);
  const row = {
    ts: new Date().toISOString(), event: 'claims', file: ledgerKey(repoRoot, filePath),
    sha256: contentHash(readFileSync(resolve(repoRoot, filePath), 'utf8')), verdict,
  };
  if (note !== undefined) row.note = note;
  appendFileSync(join(repoRoot, LEDGER_FILENAME), JSON.stringify(row) + '\n');
  return row;
}

export function gateStatus(repoRoot, filePath) {
  const file = ledgerKey(repoRoot, filePath);
  const sha256 = contentHash(readFileSync(resolve(repoRoot, filePath), 'utf8'));
  const ledger = join(repoRoot, LEDGER_FILENAME);
  const rows = existsSync(ledger)
    ? readFileSync(ledger, 'utf8').split('\n').filter(Boolean).flatMap((l) => { try { return [JSON.parse(l)]; } catch { return []; } }) : [];
  const hit = rows.findLast((r) => r.event === 'claims' && r.file === file && r.sha256 === sha256 && SATISFIES.has(r.verdict));
  return { file, sha256, verdict: hit?.verdict ?? null, ts: hit?.ts ?? null };
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
  const byUrl = new Map(manifest.entries.filter((e) => e.source_url).map((e) => [e.source_url, e]));
  const cites = [...extractCitations(readFileSync(draftPath, 'utf8')), ...extra.map((value) => ({ type: 'id', value }))];
  const hit = new Map();
  const uncovered = [];
  for (const c of cites) {
    let e;
    if (c.type === 'url') { try { e = byUrl.get(normalizeUrl(c.value)); } catch { e = undefined; } }
    else e = byId.get(c.value);
    if (e) hit.set(e.id, e);
    else if (!uncovered.some((u) => u.type === c.type && u.value === c.value)) uncovered.push({ type: c.type, value: c.value });
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

const SKIP_DIRS = new Set(['.git', 'node_modules', '_obsidian', '_index']);

// Directories holding MISSION.md, walked from repoRoot; the vault itself is never searched.
export function findWorkspaces(repoRoot, vaultPath) {
  const vault = resolve(vaultPath);
  const out = [];
  const walk = (dir) => {
    const dirents = readdirSync(dir, { withFileTypes: true });
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
