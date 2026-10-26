#!/usr/bin/env node
// Stop hook: block the end of a turn while a gated draft changed this session has no
// PASS or MERIT recorded for its current content. Silent outside a bound repo; always exits 0, and says so on stderr when it fails open.
import { statSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { resolveVault } from '../bin/lib/resolve.mjs';
import { loadProjectConfig } from '../bin/lib/projectconfig.mjs';
import { loadSchema } from '../bin/lib/schema.mjs';
import { gatedFiles, gateStatus } from '../bin/lib/gate.mjs';

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

export const TWELVE_HOURS = 12 * 60 * 60 * 1000;

export function missingGates(repoRoot, vaultPath, cfg, since) {
  return gatedFiles(repoRoot, vaultPath, cfg)
    .filter((f) => statSync(f).mtimeMs >= since)
    .map((f) => gateStatus(repoRoot, f))
    .filter((s) => !s.verdict)
    .map(({ file, sha256 }) => ({ file, sha256 }));
}

// Session start from the transcript's birth time. A filesystem without birth time reports
// 0 (which would gate every file ever touched), so fall back to the last twelve hours.
export function sinceFrom(transcriptPath, now = Date.now(), stat = statSync) {
  try {
    const born = stat(transcriptPath).birthtimeMs;
    if (born) return born;
  } catch { /* missing transcript */ }
  return now - TWELVE_HOURS;
}

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/\\/g, '/').split('/').pop())) {
  try {
    const evt = JSON.parse(readFileSync(0, 'utf8') || '{}');
    const cwd = evt.cwd || process.cwd();
    const hit = evt.stop_hook_active ? null : loadProjectConfig(cwd, { schema: loadSchema(REPO_ROOT) });
    if (hit) {
      const since = sinceFrom(evt.transcript_path);
      const { path: vaultPath } = resolveVault({ cwd });
      const missing = missingGates(dirname(hit.path), vaultPath, hit.config, since);
      if (missing.length) {
        const reason = ['Gated drafts changed without a claims verdict for their current content:',
          ...missing.map((m) => `- ${m.file}: run the research-claims-gate skill, then research-vault gate record ${m.file} PASS|MERIT`)].join('\n');
        process.stdout.write(JSON.stringify({ decision: 'block', reason }) + '\n');
      }
    }
  } catch (err) {
    // Never crash a session: no decision on stdout, one line on stderr so the skip is visible.
    process.stderr.write(`research-vault: stop-gate skipped (${err?.message ?? err})\n`);
  }
  process.exit(0);
}
