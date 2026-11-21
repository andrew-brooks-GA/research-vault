import { readdirSync, readFileSync, writeFileSync, lstatSync, renameSync } from 'node:fs';
import { dirname, join, sep } from 'node:path';
import { parseFrontmatter, serializeFrontmatter } from './frontmatter.mjs';
import { assertInsideVault, isInsideVault } from './containment.mjs';

export const TYPE_FOLDER = { source:'sources', note:'notes', synthesis:'synthesis', snippet:'snippets', experiment:'experiments', question:'questions' };
export const FOLDER_TYPE = Object.fromEntries(Object.entries(TYPE_FOLDER).map(([t, f]) => [f, t]));
export const ENTRY_FOLDERS = Object.values(TYPE_FOLDER);

export function walkEntries(vaultPath, { onSkippedLink } = {}) {
  const files = [];
  for (const folder of ENTRY_FOLDERS) {
    const dir = join(vaultPath, folder);
    const stat = lstatSync(dir, { throwIfNoEntry: false });
    if (!stat) continue;
    if (stat.isSymbolicLink() && !isInsideVault(vaultPath, dir)) {
      onSkippedLink?.(dir);
      continue;
    }
    const entries = readdirSync(dir, { withFileTypes: true });
    entries.sort((a, b) => a.name < b.name ? -1 : Number(a.name > b.name));
    for (const entry of entries) {
      if (!entry.name.endsWith('.md') || entry.name === 'INDEX.md') continue;
      const abs = join(dir, entry.name);
      if (entry.isSymbolicLink() && !isInsideVault(vaultPath, abs)) {
        onSkippedLink?.(abs);
        continue;
      }
      files.push(abs);
    }
  }
  return files;
}

// Pass folderChecked only for paths returned by walkEntries in the same synchronous call.
export function readEntry(absPath, { folderChecked = false } = {}) {
  const folderPath = dirname(absPath);
  if ((!folderChecked && lstatSync(folderPath).isSymbolicLink()) || lstatSync(absPath).isSymbolicLink()) {
    assertInsideVault(dirname(folderPath), absPath);
  }
  const raw = readFileSync(absPath, 'utf8');
  const hasBom = raw.charCodeAt(0) === 0xFEFF;
  const hasCrlf = /\r/.test(raw);
  const { data, body } = parseFrontmatter(raw);
  const parts = absPath.split(sep);
  const folder = parts[parts.length - 2];
  const id = parts[parts.length - 1].replace(/\.md$/, '');
  return { id, folder, data, body, hasBom, hasCrlf };
}

export function writeEntry(absPath, data, body, order, vaultPath = dirname(dirname(absPath))) {
  const tmp = absPath + '.tmp';
  const text = serializeFrontmatter(data, body, order);
  assertInsideVault(vaultPath, absPath);
  assertInsideVault(vaultPath, tmp);
  writeFileSync(tmp, text, 'utf8');
  assertInsideVault(vaultPath, tmp);
  assertInsideVault(vaultPath, absPath);
  renameSync(tmp, absPath);
}
