// File discovery shared by check, gate and the hooks: one set of directories never walked.
import { globSync, statSync } from 'node:fs';
import type { Dirent } from 'node:fs';
import { resolve, basename } from 'node:path';

export const SKIP_DIRS: Set<string> = new Set(['.git', 'node_modules', '.idea', '_obsidian', '_index', '_attachments']);

// Expand patterns to sorted absolute file paths under cwd, pruning SKIP_DIRS.
// exclude receives a path string or a Dirent depending on Node version; basename covers both.
export function expandFiles(patterns: readonly string[], cwd: string): string[] {
  return globSync(patterns, { cwd, exclude: (e: string | Dirent): boolean => SKIP_DIRS.has(basename(typeof e === 'string' ? e : e.name)) })
    .map((rel: string): string => resolve(cwd, rel)) // globSync returns absolute paths for an absolute pattern
    .filter((abs: string): boolean => statSync(abs).isFile())
    .sort();
}
