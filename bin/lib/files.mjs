// File discovery shared by check, gate and the hooks: one set of directories never walked.
import { globSync, statSync } from 'node:fs';
import { join, basename } from 'node:path';

export const SKIP_DIRS = new Set(['.git', 'node_modules', '.idea', '_obsidian', '_index', '_attachments']);

// Expand patterns to sorted absolute file paths under cwd, pruning SKIP_DIRS.
// exclude receives a path string or a Dirent depending on Node version; basename covers both.
export function expandFiles(patterns, cwd) {
  return globSync(patterns, { cwd, exclude: (e) => SKIP_DIRS.has(basename(typeof e === 'string' ? e : e.name)) })
    .map((rel) => join(cwd, rel))
    .filter((abs) => statSync(abs).isFile())
    .sort();
}
