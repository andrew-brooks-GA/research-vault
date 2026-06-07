// Consumer-side linter: audit a document OUTSIDE the vault against it. For every
// citation (external URL or vault id), report whether a governing vault entry exists
// and whether it is fresh per its volatility window. Read-only on both the file and
// the vault; no network (freshness from recorded last_verified only). `--check` exits
// non-zero so a consuming repo can gate CI on it — the "lint is the guarantee"
// principle extended past the vault boundary.
import { readdirSync, statSync, readFileSync } from 'node:fs';
import { join, relative, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadSchema } from '../lib/schema.mjs';
import { buildManifest } from '../lib/manifest.mjs';
import { resolveVault } from '../lib/resolve.mjs';
import { normalizeUrl } from '../lib/ids.mjs';
import { extractCitations } from '../lib/citations.mjs';

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const SKIP_DIRS = new Set(['.git', 'node_modules', '.idea', '_obsidian', '_index', '_attachments']);

function freshnessOf(entry, schema, now) {
  const win = schema.taxonomy.volatility[entry.volatility]?.refresh_after_days;
  if (win === undefined) return 'ok'; // unknown/absent volatility — not assessable
  if (win === 0) return 'stale'; // volatile — always re-check
  const last = entry.last_verified ? new Date(entry.last_verified) : null;
  const ageDays = last ? (new Date(now) - last) / 86400000 : Infinity;
  return ageDays > win ? 'stale' : 'ok';
}

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
    const status = freshnessOf(entry, schema, now) === 'stale' ? 'stale' : 'ok';
    return { type: c.type, value: c.value, status, id: entry.id, volatility: entry.volatility };
  });
}

// Pure: a minimal glob (** spans path segments, * stops at a separator, ? one char).
export function globToRegExp(glob) {
  const g = glob.replace(/\\/g, '/');
  let re = '';
  for (let i = 0; i < g.length; i++) {
    const c = g[i];
    if (c === '*') {
      if (g[i + 1] === '*') {
        i++;
        if (g[i + 1] === '/') { i++; re += '(?:.*/)?'; } else { re += '.*'; }
      } else { re += '[^/]*'; }
    } else if (c === '?') {
      re += '[^/]';
    } else if ('.+^${}()|[]\\'.includes(c)) {
      re += '\\' + c;
    } else {
      re += c;
    }
  }
  return new RegExp('^' + re + '$');
}

// Walk cwd, returning absolute paths whose cwd-relative path matches any pattern.
export function expandFiles(patterns, cwd) {
  const regexps = patterns.map(globToRegExp);
  const out = [];
  (function walk(dir) {
    for (const name of readdirSync(dir).sort()) {
      if (SKIP_DIRS.has(name)) continue;
      const abs = join(dir, name);
      if (statSync(abs).isDirectory()) { walk(abs); continue; }
      const rel = relative(cwd, abs).replace(/\\/g, '/');
      if (regexps.some((re) => re.test(rel))) out.push(abs);
    }
  })(cwd);
  return out;
}

export async function run(args) {
  const cwd = args.cwd ?? process.cwd();
  const globs = args._.slice(1);
  if (!globs.length) {
    process.stderr.write('usage: research-vault check <file|glob>... [--check] [--vault <path>]\n');
    return 2;
  }
  const { path: vaultPath } = resolveVault({ flag: args.vault ?? null, cwd });
  const schema = loadSchema(REPO_ROOT);
  const entries = buildManifest(vaultPath).entries;
  const now = args.now || new Date().toISOString().slice(0, 10);
  const files = expandFiles(globs, cwd);

  let ok = 0, stale = 0, uncovered = 0;
  for (const abs of files) {
    const rows = checkCitations(extractCitations(readFileSync(abs, 'utf8')), entries, schema, now);
    const rel = relative(cwd, abs).replace(/\\/g, '/');
    for (const r of rows) {
      if (r.status === 'ok') { ok++; continue; }
      if (r.status === 'stale') stale++; else uncovered++;
      const tag = r.id ? `  (${r.id}, ${r.volatility})` : '';
      process.stdout.write(`${r.status.toUpperCase().padEnd(9)} ${rel}  ${r.value}${tag}\n`);
    }
  }
  process.stdout.write(`check: ${files.length} file(s); ${ok} ok, ${stale} stale, ${uncovered} uncovered\n`);
  return args.check && stale + uncovered > 0 ? 1 : 0;
}
