#!/usr/bin/env node
// Stop hook: block the end of a turn while a gated draft changed this session has no
// PASS or MERIT recorded for its current content, or while a code.versions file changed this
// session declares a version some link is still pinned to the old value of (spec 15). Silent
// outside a bound repo; always exits 0, and says so in a systemMessage when it fails open.
import { statSync, readFileSync } from 'node:fs';
import { dirname, join, resolve, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { resolveVault } from '../bin/lib/resolve.mjs';
import { loadProjectConfig } from '../bin/lib/projectconfig.mjs';
import { loadSchema } from '../bin/lib/schema.mjs';
import { gatedFiles, gateStatus, ledgerKey } from '../bin/lib/gate.mjs';
import { langFor, codeFiles, extractCodeLinks, readVersions } from '../bin/lib/codelinks.mjs';

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

export const TWELVE_HOURS = 12 * 60 * 60 * 1000;

// Rows of two shapes: { file, sha256 } for a gated file without a verdict, and
// { file, line, symbol, id, key, version, declared } for a link pinned to a version a changed versions file no longer declares.
export function missingGates(repoRoot, vaultPath, cfg, since) {
  const changed = (f) => statSync(f).mtimeMs >= since;
  const out = gatedFiles(repoRoot, vaultPath, cfg)
    .filter(changed)
    .map((f) => gateStatus(repoRoot, f))
    .filter((s) => !s.verdict)
    .map(({ file, sha256 }) => ({ file, sha256 }));
  const keys = Object.entries(cfg?.code?.versions ?? {}).filter(([, v]) => changed(resolve(repoRoot, v.file))).map(([k]) => k);
  if (keys.length) {
    const versions = readVersions(cfg, repoRoot);
    for (const f of codeFiles(cfg, repoRoot)) {
      for (const l of extractCodeLinks(readFileSync(f, 'utf8'), langFor(extname(f), cfg))) {
        if (keys.includes(l.key) && l.version !== versions[l.key]) out.push({ file: ledgerKey(repoRoot, f), line: l.line, symbol: l.symbol, id: l.id, key: l.key, version: l.version, declared: versions[l.key] });
      }
    }
  }
  return out;
}

export function reasonLine(m) {
  if (m.sha256) return `- ${m.file}: run the research-claims-gate skill, then research-vault gate record ${m.file} PASS|MERIT`;
  return `- ${m.file}:${m.line} ${m.symbol}: pinned ${m.key}=${m.version}, declared ${m.declared}; re-verify ${m.id} and move the pin, or capture the new version and replace the id`;
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
        const reason = ['Gated drafts changed without a claims verdict for their current content:', ...missing.map(reasonLine)].join('\n');
        process.stdout.write(JSON.stringify({ decision: 'block', reason }) + '\n');
      }
    }
  } catch (err) {
    // Never crash a session: no decision, a systemMessage so the user sees the skip.
    process.stdout.write(JSON.stringify({ systemMessage: `research-vault: stop-gate skipped (${err?.message ?? err})` }) + '\n');
  }
  process.exit(0);
}
