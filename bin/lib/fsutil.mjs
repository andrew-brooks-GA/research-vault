import { readdirSync, readFileSync, writeFileSync, lstatSync, renameSync, linkSync, unlinkSync, openSync, closeSync, copyFileSync, constants } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { dirname, join, sep, relative } from 'node:path';
import { parseFrontmatter, serializeFrontmatter } from './frontmatter.mjs';
import { assertInsideVault, isInsideVault, escapePathControls } from './containment.ts';
import { assertFieldShapes } from './validate.ts';

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
export function readEntry(absPath, { folderChecked = false, vaultPath, validateShapes = true } = {}) {
  let phase = 'ENTRY_READ';
  try {
    const folderPath = dirname(absPath);
    if ((!folderChecked && lstatSync(folderPath).isSymbolicLink()) || lstatSync(absPath).isSymbolicLink()) {
      assertInsideVault(dirname(folderPath), absPath);
    }
    const raw = readFileSync(absPath, 'utf8');
    const hasBom = raw.charCodeAt(0) === 0xFEFF;
    const hasCrlf = /\r/.test(raw);
    phase = 'ENTRY_PARSE';
    const { data, body } = parseFrontmatter(raw);
    if (validateShapes) assertFieldShapes(data);
    const parts = absPath.split(sep);
    const folder = parts[parts.length - 2];
    const id = parts[parts.length - 1].replace(/\.md$/, '');
    return { id, folder, data, body, hasBom, hasCrlf };
  } catch (cause) {
    const path = escapePathControls(vaultPath ? relative(vaultPath, absPath) : absPath);
    const error = new Error(`${path}: ${escapePathControls(cause.message)}`, { cause });
    error.code = cause.code ?? phase;
    error.entryCode = phase;
    throw error;
  }
}

// Compare the parser's data model: scalar types matter, list order matters, map order
// and the parser's non-enumerable RAW metadata do not. Dates are strings, not Date objects.
function firstDifference(want, got, field = '') {
  if (want === got) return null;
  if (!want || !got || typeof want !== 'object' || typeof got !== 'object' ||
      Array.isArray(want) !== Array.isArray(got)) return field;
  for (const key of new Set([...Object.keys(want), ...Object.keys(got)])) {
    const path = Array.isArray(want) ? `${field}[${key}]` : field ? `${field}.${key}` : key;
    if (!Object.hasOwn(want, key) || !Object.hasOwn(got, key)) return path;
    const difference = firstDifference(want[key], got[key], path);
    if (difference !== null) return difference;
  }
  return null;
}

export function checkFrontmatter(absPath, data, text) {
  let parsed;
  try { parsed = parseFrontmatter(text).data; }
  catch {
    // Diagnose the first unparseable field without exposing literal control characters.
    let field = '<frontmatter>';
    for (const key of Object.keys(data)) {
      try { parseFrontmatter(serializeFrontmatter({ [key]: data[key] }, '')); }
      catch { field = key; break; }
    }
    throw new Error(`frontmatter write refused for ${JSON.stringify(escapePathControls(absPath))} at ${JSON.stringify(escapePathControls(field))}: serialized text would not parse`);
  }
  const field = firstDifference(data, parsed);
  if (field !== null) throw new Error(`frontmatter write refused for ${JSON.stringify(escapePathControls(absPath))} at ${JSON.stringify(escapePathControls(field))}: value does not round-trip`);
}

export function writeEntry(absPath, data, body, order, vaultPath = dirname(dirname(absPath)), options = {}) {
  const text = serializeFrontmatter(data, body, order);
  checkFrontmatter(absPath, data, text);
  writeAtomic(absPath, text, { ...options, vaultPath });
}

// Same-directory publication; only remove a temporary file this call created.
export function writeAtomic(path, text, { exclusive = false, vaultPath = dirname(path), mode } = {}) {
  const tmp = join(dirname(path), `.rv-atomic-${randomUUID()}.tmp`);
  let created = false;
  assertInsideVault(vaultPath, path);
  try {
    assertInsideVault(vaultPath, tmp);
    // Opening separately lets cleanup cover a partial/failed write without deleting an existing file.
    if (!exclusive && mode === undefined) {
      const destination = lstatSync(path, { throwIfNoEntry: false });
      if (destination?.isFile()) mode = destination.mode & 0o7777;
    }
    const fd = openSync(tmp, 'wx', mode);
    created = true;
    try { writeFileSync(fd, text, 'utf8'); } finally { closeSync(fd); }
    assertInsideVault(vaultPath, tmp);
    assertInsideVault(vaultPath, path);
    if (exclusive) {
      try { linkSync(tmp, path); }
      catch (e) {
        if (!['ENOTSUP', 'EOPNOTSUPP', 'EPERM', 'ENOSYS'].includes(e.code)) throw e;
        // Without hard links, content is not published atomically.
        // A failed copy cannot prove destination ownership; leave any destination it leaves.
        copyFileSync(tmp, path, constants.COPYFILE_EXCL);
      }
    }
    else renameSync(tmp, path);
  } finally {
    if (created) {
      try { assertInsideVault(vaultPath, tmp); unlinkSync(tmp); } catch {}
    }
  }
}
