// Consumer-side linter: audit a document OUTSIDE the vault against it. For every
// citation (external URL or vault id), report whether a governing vault entry exists
// and whether it is fresh per its volatility window. Read-only on both the file and
// the vault; no network (freshness from recorded last_verified only). `--check` exits
// non-zero so a consuming repo can gate CI on it — the "lint is the guarantee"
// principle extended past the vault boundary.
import { globSync, statSync, readFileSync } from 'node:fs';
import { join, relative, dirname, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadSchema } from '../lib/schema.mjs';
import { buildManifest } from '../lib/manifest.mjs';
import { resolveVault } from '../lib/resolve.mjs';
import { loadProjectConfig } from '../lib/projectconfig.mjs';
import { normalizeUrl } from '../lib/ids.mjs';
import { extractCitations } from '../lib/citations.mjs';
import { staleness } from '../lib/stale.mjs';

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const SKIP_DIRS = new Set(['.git', 'node_modules', '.idea', '_obsidian', '_index', '_attachments']);

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

// Expand patterns to sorted absolute file paths under cwd, pruning SKIP_DIRS.
// exclude receives a path string or a Dirent depending on Node version; basename covers both.
export function expandFiles(patterns, cwd) {
  return globSync(patterns, { cwd, exclude: (e) => SKIP_DIRS.has(basename(typeof e === 'string' ? e : e.name)) })
    .map((rel) => join(cwd, rel))
    .filter((abs) => statSync(abs).isFile())
    .sort();
}

function tally(perFile) {
  const s = { files: perFile.length, ok: 0, stale: 0, uncovered: 0 };
  for (const f of perFile) for (const r of f.rows) s[r.status]++;
  return s;
}

// Pure: render the full coverage/freshness matrix as markdown or JSON.
export function renderReport(perFile, { format, now }) {
  const summary = tally(perFile);
  if (format === 'json') {
    const rows = perFile.flatMap((f) => f.rows.map((r) => ({ file: f.file, ...r })));
    return JSON.stringify({ generated: now, summary, rows }, null, 2);
  }
  const lines = [
    `# research-vault check report (${now})`,
    '',
    '| file | citation | status | entry |',
    '|---|---|---|---|',
  ];
  for (const f of perFile) {
    for (const r of f.rows) {
      const entry = r.id ? `${r.id} (${r.volatility})` : '';
      lines.push(`| ${f.file} | ${r.value} | ${r.status} | ${entry} |`);
    }
  }
  lines.push('', `ok: ${summary.ok}, stale: ${summary.stale}, uncovered: ${summary.uncovered} across ${summary.files} file(s)`);
  return lines.join('\n') + '\n';
}

export async function run(args) {
  const cwd = args.cwd ?? process.cwd();
  const schema = loadSchema(REPO_ROOT);
  let globs = args._.slice(1);
  // No positional globs: fall back to the bound repo's `.research-vault.json` references.globs
  // (same discovery resolve.mjs uses). Only error with usage when neither is available.
  if (!globs.length) {
    const cfg = loadProjectConfig(cwd, { schema });
    globs = cfg?.config?.references?.globs ?? [];
  }
  if (!globs.length) {
    process.stderr.write('usage: research-vault check <file|glob>... [--check] [--report] [--json] [--vault <path>]\n');
    return 2;
  }
  const { path: vaultPath } = resolveVault({ flag: args.vault ?? null, cwd });
  const entries = buildManifest(vaultPath).entries;
  const now = args.now || new Date().toISOString().slice(0, 10);
  const files = expandFiles(globs, cwd);

  const perFile = files.map((abs) => ({
    file: relative(cwd, abs).replace(/\\/g, '/'),
    rows: checkCitations(extractCitations(readFileSync(abs, 'utf8')), entries, schema, now),
  }));
  const summary = tally(perFile);

  if (args.report || args.json) {
    process.stdout.write(renderReport(perFile, { format: args.json ? 'json' : 'md', now }));
  } else {
    for (const f of perFile) {
      for (const r of f.rows) {
        if (r.status === 'ok') continue;
        const tag = r.id ? `  (${r.id}, ${r.volatility})` : '';
        process.stdout.write(`${r.status.toUpperCase().padEnd(9)} ${f.file}  ${r.value}${tag}\n`);
      }
    }
    process.stdout.write(`check: ${summary.files} file(s); ${summary.ok} ok, ${summary.stale} stale, ${summary.uncovered} uncovered\n`);
  }
  return args.check && summary.stale + summary.uncovered > 0 ? 1 : 0;
}
