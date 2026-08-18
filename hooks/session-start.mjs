#!/usr/bin/env node
// Optional, non-load-bearing: print a one-line vault summary at session start.
// Silent when no vault exists; never blocks; always exits 0.
import { existsSync } from 'node:fs';
import { resolveVault } from '../bin/lib/resolve.mjs';
import { buildManifest } from '../bin/lib/manifest.mjs';
import { listStale } from '../bin/lib/stale.mjs';

let input = '';
process.stdin.on('data', d => input += d);
process.stdin.on('end', () => {
  try {
    const { path: vaultPath } = resolveVault({});
    if (existsSync(vaultPath)) process.stdout.write(`research-vault: ${buildManifest(vaultPath).entries.length} entries; ${listStale(vaultPath).length} stale\n`);
  } catch { /* no vault / no Node tier — stay silent */ }
  process.exit(0);
});
