// Consumer-side linter: audit a document OUTSIDE the vault against it. For every
// citation (external URL or vault id), report whether a governing vault entry exists
// and whether it is fresh per its volatility window. Read-only on both the file and
// the vault; no network (freshness from recorded last_verified only). `--check` exits
// non-zero so a consuming repo can gate CI on it — the "lint is the guarantee"
// principle extended past the vault boundary. A file the binding's code.globs name is read for
// code links (spec 15) and never for prose citations.
import { readFileSync } from 'node:fs';
import { join, relative, dirname, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadSchema } from '../lib/schema.mjs';
import { buildManifest } from '../lib/manifest.mjs';
import { resolveVault } from '../lib/resolve.mjs';
import { loadProjectConfig } from '../lib/projectconfig.mjs';
import { normalizeUrl } from '../lib/ids.mjs';
import { extractCitationsDetailed } from '../lib/citations.mjs';
import { staleness } from '../lib/stale.mjs';
import { expandFiles } from '../lib/files.mjs';
import { langFor, codeFiles, extractCodeLinks, readVersions, checkCodeLinks } from '../lib/codelinks.mjs';

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

// Pure: classify each citation as ok | stale | uncovered against the manifest entries.
export function checkCitations(citations, entries, schema, now) {
  const byUrl = new Map();
  const byId = new Map();
  for (const e of entries) {
    if (e.source_url) byUrl.set(e.source_url, e);
    byId.set(e.id, e);
  }
  return citations.map((c) => {
    let entry = null;
    if (c.type === 'url') {
      let norm = null;
      try { norm = normalizeUrl(c.value); } catch { norm = null; }
      entry = norm ? byUrl.get(norm) : undefined;
    } else {
      entry = byId.get(c.value);
    }
    if (!entry) return { type: c.type, value: c.value, status: 'uncovered' };
    const status = staleness(entry, schema, new Date(now)) ? 'stale' : 'ok';
    return { type: c.type, value: c.value, status, id: entry.id, volatility: entry.volatility };
  });
}

// `unattached` and `code` (the code-link count) appear only when a code file was checked.
function tally(perFile) {
  const s = { files: perFile.length, ok: 0, stale: 0, uncovered: 0 };
  if (perFile.some((f) => f.code)) { s.unattached = 0; s.code = 0; }
  for (const f of perFile) for (const r of f.rows) { s[r.status]++; if (f.code) s.code++; }
  return s;
}

// `file:line symbol` for a code row, the file alone for a prose row.
const where = (f, r) => (f.code ? `${f.file}:${r.line}${r.symbol ? ` ${r.symbol}` : ''}` : f.file);
const versionsLine = (versions) => `versions: ${Object.entries(versions).map(([k, v]) => `${k}=${v}`).join(' ') || 'none'}`;

// Citation-shaped values found only inside code: listed, never counted or gated.
function skippedLines(perFile) {
  return perFile.flatMap((f) => (f.skipped ?? []).map((s) => `skipped (in code): ${f.file}  ${s.value}`));
}

// Pure: render the full coverage/freshness matrix as markdown or JSON.
export function renderReport(perFile, { format, now, versions }) {
  const summary = tally(perFile);
  if (format === 'json') {
    const rows = perFile.flatMap((f) => f.rows.map((r) => ({ file: f.file, ...r })));
    const skipped = perFile.flatMap((f) => (f.skipped ?? []).map((s) => ({ file: f.file, ...s })));
    return JSON.stringify({ generated: now, summary, rows, skipped, ...(versions && { versions }) }, null, 2);
  }
  const lines = [
    `# research-vault check report (${now})`,
    '',
    '| file | citation | status | entry |',
    '|---|---|---|---|',
  ];
  for (const f of perFile) {
    for (const r of f.rows) {
      const entry = r.reason ? r.reason : r.id ? `${r.id} (${r.volatility})` : '';
      lines.push(`| ${where(f, r)} | ${r.value} | ${r.status} | ${entry} |`);
    }
  }
  const skipped = skippedLines(perFile);
  if (skipped.length) lines.push('', ...skipped);
  lines.push('', `ok: ${summary.ok}, stale: ${summary.stale}, uncovered: ${summary.uncovered} across ${summary.files} file(s)`);
  if (versions) lines.push(versionsLine(versions));
  return lines.join('\n') + '\n';
}

export async function run(args) {
  const cwd = args.cwd ?? process.cwd();
  const schema = loadSchema(REPO_ROOT);
  // The binding is always loaded: its code block decides which files are code (spec 15).
  const hit = loadProjectConfig(cwd, { schema });
  const cfg = hit?.config;
  const repoRoot = hit ? dirname(hit.path) : cwd;
  let globs = args._.slice(1);
  // No positional globs: fall back to the bound repo's `.research-vault.json` references.globs
  // plus code.globs (same discovery resolve.mjs uses). Only error with usage when neither is available.
  if (!globs.length) globs = [...(cfg?.references?.globs ?? []), ...(cfg?.code?.globs ?? [])];
  if (!globs.length) {
    process.stderr.write('usage: research-vault check <file|glob>... [--check] [--report] [--json] [--vault <path>]\n');
    return 2;
  }
  const { path: vaultPath } = resolveVault({ flag: args.vault ?? null, cwd });
  const entries = buildManifest(vaultPath).entries;
  const now = args.now || new Date().toISOString().slice(0, 10);
  const files = expandFiles(globs, cwd);
  const code = codeFiles(cfg, repoRoot);
  const versions = cfg?.code ? readVersions(cfg, repoRoot) : null;

  const perFile = files.map((abs) => {
    const file = relative(cwd, abs).replace(/\\/g, '/');
    const text = readFileSync(abs, 'utf8');
    if (code.includes(abs)) {
      return { file, code: true, rows: checkCodeLinks(extractCodeLinks(text, langFor(extname(abs), cfg)), entries, schema, versions, now) };
    }
    const { citations, skipped } = extractCitationsDetailed(text);
    return { file, rows: checkCitations(citations, entries, schema, now), skipped };
  });
  const summary = tally(perFile);

  if (args.report || args.json) {
    process.stdout.write(renderReport(perFile, { format: args.json ? 'json' : 'md', now, versions }));
  } else {
    for (const f of perFile) {
      for (const r of f.rows) {
        if (r.status === 'ok') continue;
        const tag = r.reason ? `  (${r.reason})` : !f.code && r.id ? `  (${r.id}, ${r.volatility})` : '';
        process.stdout.write(`${r.status.toUpperCase().padEnd(9)} ${where(f, r)}  ${r.value}${tag}\n`);
      }
    }
    for (const line of skippedLines(perFile)) process.stdout.write(line + '\n');
    const codeTail = versions ? `, ${summary.unattached ?? 0} unattached, ${summary.code ?? 0} code link(s)` : '';
    process.stdout.write(`check: ${summary.files} file(s); ${summary.ok} ok, ${summary.stale} stale, ${summary.uncovered} uncovered${codeTail}\n`);
    if (versions) process.stdout.write(versionsLine(versions) + '\n');
  }
  return args.check && summary.stale + summary.uncovered + (summary.unattached ?? 0) > 0 ? 1 : 0;
}
