#!/usr/bin/env node
// Optional, non-load-bearing: print a one-line vault summary at session start, then one line per
// research-teach workspace in the bound repo (only when the vault resolved from .research-vault.json) that has review-due records, stale reference docs or an attempt.
// Silent when no vault exists; never blocks; always exits 0.
import { existsSync, readFileSync } from 'node:fs';
import { join, dirname, basename, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { resolveVault } from '../bin/lib/resolve.mjs';
import { findProjectConfig } from '../bin/lib/projectconfig.mjs';
import { buildManifest } from '../bin/lib/manifest.mjs';
import { listStale } from '../bin/lib/stale.mjs';
import { findWorkspaces } from '../bin/lib/gate.mjs';
import { checkCitations } from '../bin/commands/check.mjs';
import { extractCitations } from '../bin/lib/citations.mjs';
import { loadSchema } from '../bin/lib/schema.mjs';
import { SPACING_DAYS, teachIndex } from '../bin/lib/teach.mjs';

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
export { SPACING_DAYS };

// name defaults to the workspace folder name; the CLI passes the path relative to the project root.
// A reference doc counts as stale when any data-cite id, or any URL or id the citation scan finds, is stale.
export function workspaceBrief(wsDir, vaultPath, now, name = basename(wsDir)) {
  const idx = teachIndex(wsDir, { now });
  const n = idx.records.filter((r) => r.reviewDue).length;
  const entries = buildManifest(vaultPath).entries;
  const schema = loadSchema(REPO_ROOT, { vaultPath });
  const m = idx.reference.filter((d) => {
    const cites = [...d.cites.map((value) => ({ type: 'id', value })), ...extractCitations(readFileSync(join(wsDir, d.file), 'utf8'))];
    return checkCitations(cites, entries, schema, now).some((r) => r.status === 'stale');
  }).length;
  const a = idx.attempts.at(-1);
  if (n + m === 0 && !a) return '';
  const last = a ? `; last attempt ${a.total - (a.wrong?.length ?? 0)}/${a.total} on ${a.lesson}` : '';
  return `research-teach ${name}: ${n} record(s) review-due; ${m} reference doc(s) with a stale citation${last}`;
}

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/\\/g, '/').split('/').pop())) {
  let input = '';
  process.stdin.on('data', d => input += d);
  process.stdin.on('end', () => {
    try {
      const cwd = resolve(JSON.parse(input || '{}').cwd || process.cwd());
      const { path: vaultPath, source } = resolveVault({ cwd });
      if (existsSync(vaultPath)) {
        process.stdout.write(`research-vault: ${buildManifest(vaultPath).entries.length} entries; ${listStale(vaultPath).length} stale\n`);
        // Walk only a bound repo: a config or default vault resolves from anywhere, including ~.
        const hit = source === 'project' && findProjectConfig(cwd);
        if (hit) {
          const root = dirname(hit.path);
          const now = new Date();
          for (const ws of findWorkspaces(root, vaultPath)) {
            try {
              const line = workspaceBrief(ws, vaultPath, now, relative(root, ws) || basename(ws));
              if (line) process.stdout.write(line + '\n');
            } catch { /* one bad workspace does not drop the others */ }
          }
        }
      }
    } catch { /* no vault / no Node tier: stay silent */ }
    process.exit(0);
  });
}
