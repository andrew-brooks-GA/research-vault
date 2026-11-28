import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';
import { join, posix } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runGit } from '../bin/lib/git.ts';

function declareLines(text, file = 'test source') {
  let stripped;
  try {
    stripped = stripTypeScriptTypes(text, { mode: 'strip' });
  } catch (error) {
    throw new Error(`${file}: ${error.message}`, { cause: error });
  }
  assert.equal(stripped.length, text.length, `${file}: type stripping changed the source length`);

  const lines = [];
  for (const match of text.matchAll(/\bdeclare\b/g)) {
    const [word] = match;
    const { index } = match;
    if (stripped.slice(index, index + word.length) !== word) {
      lines.push(text.slice(0, index).split(/\r\n|[\n\r\u2028\u2029]/).length);
    }
  }
  return lines;
}

const root = fileURLToPath(new URL('../', import.meta.url));
let trackedFiles;

function isTypeScriptFile(file) {
  return ['.ts', '.mts', '.cts'].some((ext) => file.endsWith(ext));
}

function trackedTypeScriptFiles() {
  trackedFiles ??= runGit(['ls-files', '-z', '--', 'bin/', 'hooks/', 'scripts/'], { processCwd: root })
    .split('\0').filter(isTypeScriptFile);
  assert.ok(trackedFiles.length > 0, 'No tracked TypeScript files found under bin/, hooks/ or scripts/');
  return trackedFiles;
}

function isDeclarationFile(file) {
  const name = posix.basename(file);
  return isTypeScriptFile(name) && name.includes('.d.');
}

// Source-scan guard: tracked TypeScript cannot introduce declarations erased at runtime.
test('source scan: tracked TypeScript has no declare keyword', { timeout: 10000 }, () => {
  const findings = trackedTypeScriptFiles().flatMap((file) =>
    declareLines(readFileSync(join(root, file), 'utf8'), file).map((line) => `${file}:${line}`));
  assert.equal(findings.length, 0, `TypeScript declare keyword found at:\n${findings.join('\n')}`);
});

// Source-scan guard: no tracked declaration file under bin/, hooks/ or scripts/ can add ambient types.
test('source scan: tracked TypeScript has no declaration files', { timeout: 10000 }, () => {
  const findings = trackedTypeScriptFiles().filter(isDeclarationFile);
  assert.equal(findings.length, 0, `TypeScript declaration files found:\n${findings.join('\n')}`);
});

// Fixture paths use double quotes so the dependency graph does not count them as file reads.
test('the declaration file rule reports bin/lib/x.d.ts', () => {
  assert.equal(isDeclarationFile("bin/lib/x.d.ts"), true);
});

test('the declaration file rule reports hooks/x.d.mts', () => {
  assert.equal(isDeclarationFile("hooks/x.d.mts"), true);
});

test('the declaration file rule reports scripts/x.d.cts', () => {
  assert.equal(isDeclarationFile("scripts/x.d.cts"), true);
});

test('the declaration file rule reports bin/lib/x.d.json.ts', () => {
  assert.equal(isDeclarationFile("bin/lib/x.d.json.ts"), true);
});

test('the declaration file rule ignores bin/lib/x.ts', () => {
  assert.equal(isDeclarationFile("bin/lib/x.ts"), false);
});

test('the declaration file rule ignores bin/lib/d.ts', () => {
  assert.equal(isDeclarationFile("bin/lib/d.ts"), false);
});

test('the declaration file rule ignores bin/lib/x.d.txt', () => {
  assert.equal(isDeclarationFile("bin/lib/x.d.txt"), false);
});

test('the declaration file rule ignores bin/lib/x.d.ts.txt', () => {
  assert.equal(isDeclarationFile("bin/lib/x.d.ts.txt"), false);
});

test('the declaration file rule ignores bin/x.d/y.ts', () => {
  assert.equal(isDeclarationFile("bin/x.d/y.ts"), false);
});

test('the declaration file rule ignores bin/x.d.part/y.ts', () => {
  assert.equal(isDeclarationFile("bin/x.d.part/y.ts"), false);
});

test('the declaration file rule ignores bin/lib/x.d.mjs', () => {
  assert.equal(isDeclarationFile("bin/lib/x.d.mjs"), false);
});

test('the scan reports both declare const statements on their original lines', () => {
  assert.deepEqual(declareLines('declare const Map: unknown;\n\ndeclare const Object: unknown;'), [1, 3]);
});

test('the scan reports declare function', () => {
  assert.deepEqual(declareLines('declare function read(): string;'), [1]);
});

test('the scan reports declare global', () => {
  assert.deepEqual(declareLines('declare global { interface Array<T> { value: T } }'), [1]);
});

test('the scan reports declare module with a string name', () => {
  assert.deepEqual(declareLines("declare module 'x' { export const value: string; }"), [1]);
});

test('the scan reports declare namespace', () => {
  assert.deepEqual(declareLines('declare namespace N { const value: string; }'), [1]);
});

test('the scan reports export declare const', () => {
  assert.deepEqual(declareLines('export declare const value: string;'), [1]);
});

test('the scan ignores declare in a string literal', () => {
  assert.deepEqual(declareLines('const text = "declare";'), []);
});

test('the scan ignores declare in a template literal', () => {
  assert.deepEqual(declareLines('const text = `declare`;'), []);
});

test('the scan ignores declare in a regular expression literal', () => {
  assert.deepEqual(declareLines('const pattern = /declare/;'), []);
});

test('the scan ignores declare in a line comment', () => {
  assert.deepEqual(declareLines('// declare\nconst value = 1;'), []);
});

test('the scan ignores declare in a block comment', () => {
  assert.deepEqual(declareLines('/* declare */\nconst value = 1;'), []);
});

test('the scan ignores declare as a JavaScript identifier', () => {
  assert.deepEqual(declareLines('const declare = 1;'), []);
});
