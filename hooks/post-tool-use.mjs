#!/usr/bin/env node
// Optional, non-load-bearing: lint --fix the vault after agent edits to vault files.
// Loop-guarded: only runs when the edited path is inside the resolved vault, and
// lint --fix is idempotent (no-op when nothing changes). Never blocks edits.
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { resolveVault } from '../bin/lib/resolve.mjs';
import { fixVault } from '../bin/lib/lintrules.mjs';
import { lintAndReport } from '../bin/commands/lint.mjs';

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

let input = '';
process.stdin.on('data', d => input += d);
process.stdin.on('end', () => {
  try {
    const evt = JSON.parse(input || '{}');
    const editedPath = evt.tool_input?.file_path || '';
    const { path: vaultPath } = resolveVault({});
    if (!editedPath || !editedPath.startsWith(vaultPath)) { process.exit(0); } // not a vault edit; skip
    fixVault(vaultPath, REPO_ROOT);
    lintAndReport(vaultPath, { check: false }); // rebuild manifest
  } catch { /* never block edits */ }
  process.exit(0);
});
