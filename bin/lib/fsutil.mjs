import { readdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join, sep } from 'node:path';
import { parseFrontmatter, serializeFrontmatter } from './frontmatter.mjs';

export const ENTRY_FOLDERS = ['sources','notes','synthesis','snippets','experiments','questions'];

export function walkEntries(vaultPath) {
  const files = [];
  for (const folder of ENTRY_FOLDERS) {
    const dir = join(vaultPath, folder);
    if (!existsSync(dir)) continue;
    for (const name of readdirSync(dir)) {
      if (name.endsWith('.md') && name !== 'INDEX.md') files.push(join(dir, name));
    }
  }
  return files;
}

export function readEntry(absPath) {
  const raw = readFileSync(absPath, 'utf8');
  const hasBom = raw.charCodeAt(0) === 0xFEFF;
  const hasCrlf = /\r/.test(raw);
  const { data, body } = parseFrontmatter(raw);
  const parts = absPath.split(sep);
  const folder = parts[parts.length - 2];
  const id = parts[parts.length - 1].replace(/\.md$/, '');
  return { id, folder, data, body, hasBom, hasCrlf };
}

export function writeEntry(absPath, data, body, order) {
  writeFileSync(absPath, serializeFrontmatter(data, body, order), 'utf8');
}
