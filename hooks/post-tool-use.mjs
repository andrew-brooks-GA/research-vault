#!/usr/bin/env node
// Optional, non-load-bearing PostToolUse hook for Edit/Write. Two branches, never blocks:
// - an edit inside the resolved vault runs lint --fix (idempotent, so no loop) and rebuilds the manifest;
// - an edit to a citation-bearing doc in a bound repo (references.globs or a gated file) reports its
//   uncovered or stale citations to the model, so capture happens before the claims gate.
import { readFileSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { resolveVault } from '../bin/lib/resolve.mjs';
import { isInsideVault } from '../bin/lib/containment.mjs';
import { fixVault } from '../bin/lib/lintrules.mjs';
import { lintAndReport } from '../bin/commands/lint.mjs';
import { checkCitations, expandFiles } from '../bin/commands/check.mjs';
import { extractCitations } from '../bin/lib/citations.mjs';
import { buildManifest } from '../bin/lib/manifest.mjs';
import { loadSchema } from '../bin/lib/schema.mjs';
import { loadProjectConfig } from '../bin/lib/projectconfig.mjs';
import { gatedFiles, ledgerKey } from '../bin/lib/gate.mjs';

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

export function citationWarnings(editedPath, repoRoot, vaultPath, cfg, now) {
  const file = resolve(editedPath);
  // ponytail: expands every glob per edit; switch to path.matchesGlob if large repos make this slow.
  const watched = [...expandFiles(cfg?.references?.globs ?? [], resolve(repoRoot)), ...gatedFiles(repoRoot, vaultPath, cfg)];
  if (!watched.includes(file)) return '';
  const rows = checkCitations(extractCitations(readFileSync(file, 'utf8')), buildManifest(vaultPath).entries, loadSchema(REPO_ROOT), now);
  const key = ledgerKey(repoRoot, file);
  const lines = rows.filter((r) => r.status !== 'ok').map((r) => `research-vault: ${r.status.toUpperCase()} ${r.value} in ${key}`);
  return lines.length ? [...lines, 'capture it (or verify the entry) before the claims gate.'].join('\n') : '';
}

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/\\/g, '/').split('/').pop())) {
  let input = '';
  process.stdin.on('data', d => input += d);
  process.stdin.on('end', () => {
    try {
      const evt = JSON.parse(input || '{}');
      const editedPath = evt.tool_input?.file_path || '';
      const { path: vaultPath } = resolveVault({});
      if (isInsideVault(vaultPath, editedPath)) {
        fixVault(vaultPath, REPO_ROOT);
        lintAndReport(vaultPath, { check: false }); // rebuild manifest
      } else if (editedPath) {
        const hit = loadProjectConfig(dirname(resolve(editedPath)), { schema: loadSchema(REPO_ROOT) });
        if (hit) {
          const repoRoot = dirname(hit.path);
          const { path: repoVault } = resolveVault({ cwd: repoRoot });
          const ctx = citationWarnings(editedPath, repoRoot, repoVault, hit.config, new Date().toISOString().slice(0, 10));
          if (ctx) process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: 'PostToolUse', additionalContext: ctx } }) + '\n');
        }
      }
    } catch { /* never block edits */ }
    process.exit(0);
  });
}
