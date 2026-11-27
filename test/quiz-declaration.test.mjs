import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const script = await import('../skills/research-teach/assets/quiz.js');
const declaration = readFileSync(join(import.meta.dirname, '..', 'skills/research-teach/assets/quiz.d.ts'), 'utf8');

// Match top-level function and const declarations, with optional export and declare modifiers.
// A plain export list names local declarations, optionally with aliases. Type exports are skipped.
const namedDeclarations = /^(export\s+)?(?:declare\s+)?(function|const)\s+([\w$]+)(?=\s*[(<:=])/gm;
const localExportLists = [...declaration.matchAll(/^export\s*\{([^}]*)\}/gm)].filter(match => {
  const rest = declaration.slice(match.index + match[0].length);
  const afterTrivia = rest.replace(/^(?:\s|\/\/[^\r\n\u2028\u2029]*|\/\*[^]*?\*\/)*/, '');
  return !/^from\b/.test(afterTrivia);
});
const localSpecifier = /^(?:(type)\s+)?([\w$]+)(?:\s+as\s+([\w$]+))?$/;
const typeExports = /^export\s+(?:interface|type)\b/gm;

const localKinds = new Map(), exportKinds = new Map();
for (const [, exported, kind, name] of declaration.matchAll(namedDeclarations)) {
  localKinds.set(name, kind);
  if (exported) exportKinds.set(name, kind);
}
for (const [, bindings] of localExportLists) {
  for (const binding of bindings.split(',')) {
    const [, typeOnly, local, exported = local] = localSpecifier.exec(binding.trim()) ?? [];
    if (!local || typeOnly) continue;
    exportKinds.set(exported, localKinds.get(local));
  }
}

// Source scan: the name check understands line-initial named function and single-name const
// declarations (optionally with declare), export { ... } lists of local names (with optional
// aliases and type specifiers), and type-only export interface and export type statements.
test('quiz.d.ts uses only export forms the name check understands', () => {
  // Accept a single-line const annotation ending in a semicolon. Quoted literals may contain commas.
  const singleConst = /^[ \t]*:(?:[^,;{}'"`/\r\n]|'(?:\\.|[^'\\\r\n])*'|"(?:\\.|[^"\\\r\n])*")*;/;
  const understood = new Set();
  for (const match of declaration.matchAll(namedDeclarations)) {
    const [head, exported, kind] = match;
    if (exported && (kind === 'function' || singleConst.test(declaration.slice(match.index + head.length)))) {
      understood.add(match.index);
    }
  }
  for (const match of localExportLists) {
    if (match[1].split(',').every(binding => !binding.trim() || localSpecifier.test(binding.trim()))) {
      understood.add(match.index);
    }
  }
  for (const { index } of declaration.matchAll(typeExports)) understood.add(index);

  // An export can start a line or follow a semicolon, closing brace or block comment.
  const exportStarts = /(?<=(?:^|[;}]|\*\/)[^\S\r\n\u2028\u2029]*)export(?![\p{ID_Continue}$\u200c\u200d])/gmu;
  const offending = new Set();
  const lineBreak = /\r\n|[\r\n\u2028\u2029]/;
  const lines = declaration.split(lineBreak);
  for (const { index } of declaration.matchAll(exportStarts)) {
    if (understood.has(index)) continue;
    const line = declaration.slice(0, index).split(lineBreak).length;
    offending.add(`${line}: ${lines[line - 1]}`);
  }
  assert.equal(offending.size, 0, `Unsupported export lines in quiz.d.ts:\n${[...offending].join('\n')}`);
});

test('quiz.d.ts declares exactly the runtime export names of quiz.js', () => {
  assert.deepEqual([...exportKinds.keys()].sort(), Object.keys(script).sort());
});

test('quiz.d.ts declares runtime functions as functions and other exports as constants', () => {
  for (const [name, kind] of exportKinds) {
    if (Object.hasOwn(script, name)) {
      assert.equal(kind, typeof script[name] === 'function' ? 'function' : 'const', name);
    }
  }
});
