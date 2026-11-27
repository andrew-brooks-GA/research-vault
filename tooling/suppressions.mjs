import { readdirSync, readFileSync, realpathSync, statSync } from 'node:fs';
import { join, relative, resolve, sep } from 'node:path';

const suppressionMarkers = ['eslint-disable', 'oxlint-disable', '@ts-ignore', '@ts-expect-error', '@ts-nocheck'];
const pattern = new RegExp(suppressionMarkers.join('|'), 'gi');

function* lintFiles(path, ancestors, entry = statSync(path, { throwIfNoEntry: false })) {
  if (entry?.isSymbolicLink()) entry = statSync(path, { throwIfNoEntry: false });
  if (entry?.isDirectory()) {
    const real = realpathSync(path);
    if (ancestors.has(real)) return;
    ancestors.add(real);
    // Ignore files can change which directories Oxlint visits. Scan them conservatively.
    for (const child of readdirSync(path, { withFileTypes: true })) {
      yield* lintFiles(join(path, child.name), ancestors, child);
    }
    ancestors.delete(real);
  } else if (entry?.isFile() && /\.(?:[cm]?ts|tsx|cjs|jsx|astro|svelte|vue)$/.test(path)) {
    yield path;
  }
}

export function findSuppressions(root, paths) {
  const files = new Set();
  for (const path of paths) {
    for (const file of lintFiles(resolve(root, path), new Set())) files.add(file);
  }
  const findings = [];
  for (const file of [...files].sort()) {
    const name = relative(root, file).split(sep).join('/');
    const lines = readFileSync(file, 'utf8').split(/\r\n|[\n\r\u2028\u2029]/);
    for (const [index, line] of lines.entries()) {
      for (const [marker] of line.matchAll(pattern)) findings.push({ file: name, line: index + 1, marker });
    }
  }
  return findings;
}
