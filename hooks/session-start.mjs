#!/usr/bin/env node
// Optional, non-load-bearing: print a one-line vault summary at session start.
// Silent when no vault exists; never blocks; always exits 0.
import { existsSync } from 'node:fs';
import { resolveVault } from '../bin/lib/resolve.mjs';
import { vaultSummary } from '../bin/lib/summary.mjs';

let input = '';
process.stdin.on('data', d => input += d);
process.stdin.on('end', () => {
  try {
    const { path: vaultPath } = resolveVault({});
    if (existsSync(vaultPath)) process.stdout.write(`research-vault: ${vaultSummary(vaultPath)}\n`);
  } catch { /* no vault / no Node tier — stay silent */ }
  process.exit(0);
});
