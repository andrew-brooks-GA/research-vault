#!/usr/bin/env node
// Optional, non-load-bearing PostToolUse hook for Edit/Write. Two branches, never blocks:
// - an edit inside the resolved vault runs lint --fix (idempotent, so no loop) and rebuilds the manifest;
// - an edit to a citation-bearing doc in a bound repo (references.globs or a gated file) reports its
//   uncovered or stale citations to the model, so capture happens before the claims gate; a code.globs
//   file reports its code rows, and a code.versions file every link whose pin now differs from it (spec 15).
import { readFileSync } from 'node:fs';
import { join, dirname, resolve, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { resolveVault } from '../bin/lib/resolve.mjs';
import { isInsideVault } from '../bin/lib/containment.mjs';
import { fixVault, lintAndReport } from '../bin/lib/lintrules.mjs';
import { expandFiles } from '../bin/lib/files.mjs';
import { checkCitations, extractCitations } from '../bin/lib/citations.mjs';
import { buildManifest } from '../bin/lib/manifest.mjs';
import { loadSchema } from '../bin/lib/schema.mjs';
import { loadProjectConfig } from '../bin/lib/projectconfig.mjs';
import { appendUsage, readUsage } from '../bin/lib/usagelog.mjs';
import { gatedFiles, ledgerKey } from '../bin/lib/gate.mjs';
import { langFor, codeFiles, extractCodeLinks, readVersions, checkCodeLinks } from '../bin/lib/codelinks.mjs';
import { screenText } from '../bin/lib/screen.mjs';

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

export function citationWarnings(editedPath, repoRoot, vaultPath, cfg, now) {
  const file = resolve(editedPath);
  // ponytail: expands every glob per edit; switch to path.matchesGlob if large repos make this slow.
  const code = codeFiles(cfg, repoRoot);
  const versionFiles = Object.values(cfg?.code?.versions ?? {}).map((v) => resolve(repoRoot, v.file));
  const watched = [...expandFiles(cfg?.references?.globs ?? [], resolve(repoRoot)), ...gatedFiles(repoRoot, vaultPath, cfg), ...code, ...versionFiles];
  if (!watched.includes(file)) return '';
  const key = ledgerKey(repoRoot, file);
  const read = (f) => extractCodeLinks(readFileSync(f, 'utf8'), langFor(extname(f), cfg));
  let lines;
  if (versionFiles.includes(file)) {
    // The hook stores nothing between runs, so the blast radius of a version bump is every link
    // whose pin differs from the version now read from this file.
    const versions = readVersions(cfg, repoRoot);
    const keys = Object.entries(cfg.code.versions).filter(([, v]) => resolve(repoRoot, v.file) === file).map(([k]) => k);
    lines = code.flatMap((f) => read(f).filter((l) => keys.includes(l.key) && l.version !== versions[l.key])
      .map((l) => `research-vault: STALE ${l.id} in ${ledgerKey(repoRoot, f)}:${l.line} ${l.symbol}  (${l.key} ${l.version} -> ${versions[l.key]})`));
  } else if (code.includes(file)) {
    // S-11: a reason can carry `superseded by <id>` from an entry, so it is screened; the value (the cited id)
    // and the symbol are read from the edited file, the user's own, and print as they are.
    const rows = checkCodeLinks(read(file), buildManifest(vaultPath).entries, loadSchema(REPO_ROOT), readVersions(cfg, repoRoot), now);
    lines = rows.filter((r) => r.status !== 'ok')
      .map((r) => `research-vault: ${r.status.toUpperCase()} ${r.value} in ${key}:${r.line}${r.symbol ? ` ${r.symbol}` : ''}${r.reason ? `  (${screenText(r.reason)})` : ''}`);
  } else {
    const entries = buildManifest(vaultPath).entries;
    const citations = extractCitations(readFileSync(file, 'utf8'));
    const rows = checkCitations(citations, entries, loadSchema(REPO_ROOT), now);
    lines = rows.filter((r) => r.status !== 'ok').map((r) => `research-vault: ${r.status.toUpperCase()} ${r.value} in ${key}`);
    // The usage log (spec 29): one cited event per id this file newly cites; the log is the only state.
    // A URL citation's id is the one checkCitations chose for it (rows run parallel to citations).
    try {
      const ids = [...new Set(citations.map((c, i) => c.type === 'id' ? c.value : rows[i].id).filter(Boolean))];
      const seen = new Set(readUsage(vaultPath).filter((e) => e.kind === 'cited' && e.file === key).map((e) => e.id));
      for (const id of ids) if (!seen.has(id)) appendUsage(vaultPath, { kind: 'cited', via: 'post-tool-use', file: key, id });
    } catch { /* never change the hook's answer */ }
  }
  return lines.length ? [...lines, 'capture it (or verify the entry) before the claims gate.'].join('\n') : '';
}

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/\\/g, '/').split('/').pop())) {
  let input = '';
  process.stdin.on('data', d => input += d);
  process.stdin.on('end', () => {
    try {
      const evt = JSON.parse(input || '{}');
      const editedPath = evt.tool_input?.file_path || '';
      const { path: vaultPath } = resolveVault({ cwd: evt.cwd });
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
