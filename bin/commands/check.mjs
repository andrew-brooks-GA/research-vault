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
import { buildManifest, isUnverifiedSource } from '../lib/manifest.mjs';
import { walkEntries, readEntry } from '../lib/fsutil.mjs';
import { resolveVault } from '../lib/resolve.mjs';
import { loadProjectConfig, quotedGlob } from '../lib/projectconfig.mjs';
import { checkCitations, extractCitationsDetailed } from '../lib/citations.mjs';
import { expandFiles } from '../lib/files.ts';
import { langFor, codeFiles, extractCodeLinks, readVersions, checkCodeLinks } from '../lib/codelinks.mjs';
import { screenText } from '../lib/screen.mjs';

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

export { checkCitations };

// The mark beside an ambiguous row's other reason, in the text output and the report.
// Text and report values from entries (ids, volatility, a reason such as `superseded by <id>`) pass
// screenText (S-11): the text output reaches the post-edit hook's context. The JSON report is data.
const ambiguous = (r) => (r.candidates ? `ambiguous: ${r.candidates.map((c) => screenText(c)).join(', ')}` : '');

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
      const entry = [r.reason ? screenText(r.reason) : r.id ? `${screenText(r.id)} (${screenText(r.volatility)}${r.unverified ? ', unverified' : ''})` : '', ambiguous(r)].filter(Boolean).join('; ');
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
  // Positional globs are relative to the working directory, where they were typed.
  let base = cwd;
  // No positional globs: fall back to the bound repo's `.research-vault.json` references.globs
  // plus code.globs (same discovery resolve.mjs uses), resolved against the binding's folder as
  // codeFiles does. Only error with usage when neither is available.
  if (!globs.length) { globs = [...(cfg?.references?.globs ?? []), ...(cfg?.code?.globs ?? [])]; base = repoRoot; }
  if (!globs.length) {
    process.stderr.write('usage: research-vault check <file|glob>... [--check] [--report] [--json] [--vault <path>]\n');
    return 2;
  }
  const quoted = quotedGlob(globs);
  if (quoted) { process.stderr.write(`check: ${quoted}\n`); return 2; }
  const { path: vaultPath } = resolveVault({ flag: args.vault ?? null, cwd });
  const entries = buildManifest(vaultPath).entries;
  // Sources whose every verification is `captured` or `quote-matched`; the manifest carries no methods.
  const unverified = new Set();
  for (const abs of walkEntries(vaultPath)) {
    const { id, data } = readEntry(abs, { vaultPath });
    if (isUnverifiedSource(data)) unverified.add(id);
  }
  const now = args.now || new Date().toISOString().slice(0, 10);
  // Each glob on its own, so one that matches nothing (a typo, a moved tree) is named; under
  // --check it fails the gate, since a check of nothing must not pass.
  const matched = globs.map((g) => expandFiles([g], base));
  const unmatched = globs.filter((_, i) => !matched[i].length);
  for (const g of unmatched) process.stderr.write(`check: ${g} matched no file\n`);
  const files = [...new Set(matched.flat())].sort();
  const code = codeFiles(cfg, repoRoot);
  const versions = cfg?.code ? readVersions(cfg, repoRoot) : null;

  const perFile = files.map((abs) => {
    const file = relative(cwd, abs).replace(/\\/g, '/');
    const text = readFileSync(abs, 'utf8');
    if (code.includes(abs)) {
      return { file, code: true, rows: checkCodeLinks(extractCodeLinks(text, langFor(extname(abs), cfg)), entries, schema, versions, now) };
    }
    const { citations, skipped } = extractCitationsDetailed(text);
    return { file, rows: checkCitations(citations, entries, schema, now, unverified), skipped };
  });
  const summary = tally(perFile);

  if (args.report || args.json) {
    process.stdout.write(renderReport(perFile, { format: args.json ? 'json' : 'md', now, versions }));
  } else {
    for (const f of perFile) {
      for (const r of f.rows) {
        if (r.status === 'ok' && !r.unverified && !r.candidates) continue;
        const note = r.reason ? screenText(r.reason) : r.unverified ? `${screenText(r.id)}, unverified` : !f.code && r.id ? `${screenText(r.id)}, ${screenText(r.volatility)}` : '';
        const tag = [note, ambiguous(r)].filter(Boolean).join('; ');
        process.stdout.write(`${r.status.toUpperCase().padEnd(9)} ${where(f, r)}  ${r.value}${tag ? `  (${tag})` : ''}\n`);
      }
    }
    for (const line of skippedLines(perFile)) process.stdout.write(line + '\n');
    const unverifiedCount = perFile.reduce((n, f) => n + f.rows.filter((r) => r.unverified).length, 0);
    const unverifiedTail = unverifiedCount ? `, ${unverifiedCount} unverified` : '';
    const codeTail = versions ? `, ${summary.unattached ?? 0} unattached, ${summary.code ?? 0} code link(s)` : '';
    process.stdout.write(`check: ${summary.files} file(s); ${summary.ok} ok, ${summary.stale} stale, ${summary.uncovered} uncovered${unverifiedTail}${codeTail}\n`);
    if (versions) process.stdout.write(versionsLine(versions) + '\n');
  }
  return args.check && unmatched.length + summary.stale + summary.uncovered + (summary.unattached ?? 0) > 0 ? 1 : 0;
}
