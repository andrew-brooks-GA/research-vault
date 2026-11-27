import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { copyFileSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { compare } from '../tooling/d6-compare.mjs';
import { REPO_ROOT, testEnv, tmpVault } from './helpers.mjs';

const installHint = 'Run npm ci --ignore-scripts in tooling/ to install Acorn.';
const { tokenize } = await import('../tooling/d6-tokens.mjs').catch(error => {
  throw new Error(installHint, { cause: error });
});

const names = { beforeName: 'before.mjs', afterName: 'after.ts' };
const run = (before, after, options) => compare(before, after, { ...names, ...options });
const diff = (before, after, message) => ({ before: `before.mjs:${before}`, after: `after.ts:${after}`, message });
const lineBreak = 'line break changed between tokens';

// Assemble fixture specifiers separately so the dependency scanner only sees real imports.
const mjs = "'./x.mjs'", ts = "'./x.ts'", otherTs = "'./y.ts'", typeTs = "'./t.ts'";

for (const [name, before, after] of [
  ['a typed parameter is erased', 'function f(x) { return x; }', 'function f(x: number) { return x; }'],
  ['a return type is erased', 'function f() { return 1; }', 'function f(): number { return 1; }'],
  ['amount of horizontal whitespace can change', 'let n = 0;', 'let   n =\t0;'],
  ['number of existing line breaks can change', 'a();\nb();', 'a();\n\n\nb();'],
  ['a lone typed arrow parameter can gain parentheses', 'const f = x => x;', 'const f = (x: number) => x;'],
  ['a lone optional arrow parameter can gain parentheses', 'const f = x => x;', 'const f = (x?: number) => x;'],
  ['parentheses on a typed arrow preserve its comment neighbours', 'const f = /*a*/ x /*b*/ => x;', 'const f = (/*a*/ x: number) /*b*/ => x;'],
  ['a generic argument is erased', 'const n = id(1);', 'const n = id<number>(1);'],
  ['an interface block fits between separated statements', 'a();\nb();', 'a();\ninterface T {\n  x: number\n}\nb();'],
  ['a type alias fits between separated statements', 'a();\nb();', 'a();\ntype T = number;\nb();'],
  ['an import type fits between separated statements', 'a();\nb();', `a();\nimport type { T } from ${typeTs};\nb();`],
  ['a declare statement fits between separated statements', 'a();\nb();', 'a();\ndeclare const x: number;\nb();'],
  ['a static import can change its extension', `import c, * as m from ${mjs};`, `import c, * as m from ${ts};`],
  ['a side-effect import can change its extension', `import ${mjs};`, `import ${ts};`],
  ['a re-export can change its extension', `export { c } from ${mjs};`, `export { c } from ${ts};`],
  ['a dynamic import with a literal can change its extension', `const p = import(${mjs});`, `const p = import(${ts});`],
  ['strip-mode comparison cannot see satisfies', 'const x = y;', 'const x = y satisfies T;'],
  ['strip-mode comparison cannot see an as assertion', 'const x = y;', 'const x = y as T;'],
  ['strip-mode comparison cannot see a non-null assertion', 'const x = y;', 'const x = y!;'],
]) {
  test(name, () => assert.deepEqual(run(before, after), []));
}

const guard = 'if (isMain(process.argv[1])) main();';
const guarded = `export function main() {}\n\n${guard}\n`;
test('--launcher allows omission of the final guard without altering neighbouring gaps', () => {
  assert.deepEqual(run(guarded, 'export function main(): void {}\n', { launcher: true }), []);
});

test('--launcher ignores a parenthesis inside a template in the final guard', () => {
  assert.deepEqual(run('a();\nif (`)`) main();\n', 'a();\n', { launcher: true }), []);
});

for (const [name, prefix, suffix, joinedAt] of [
  ['before a call', 'x', '(function(){})()', '1:2'],
  ['before a bracket access', 'x', '[1].length', '1:2'],
  ['before a tagged template', 'tag', '`text`', '1:4'],
  ['before a unary or binary plus', 'let b = a', '+a', '1:10'],
]) {
  const split = `${prefix}\n${suffix}`, joined = prefix + suffix;
  test(`reports a line break removed ${name}`, () => {
    assert.deepEqual(run(split, joined), [diff('2:1', joinedAt, lineBreak)]);
  });
  test(`reports a line break added ${name}`, () => {
    assert.deepEqual(run(joined, split), [diff(joinedAt, '2:1', lineBreak)]);
  });
}

for (const [name, before, after, expected] of [
  ['reports a line break after return', 'function f() { return x; }', 'function f() { return\nx; }', diff('1:23', '2:1', lineBreak)],
  ['reports a line break left by a multiline annotation', 'const x = 1;', 'const x:\nnumber = 1;', diff('1:9', '2:8', lineBreak)],
  ['reports a line break left by multiline type arguments', 'const x = f(1);', 'const x = f<\nnumber>(1);', diff('1:12', '2:8', lineBreak)],
  ['reports CR as a line break', 'x();\ry();', 'x(); y();', diff('2:1', '1:6', lineBreak)],
  ['reports CRLF as a line break', 'x(); y();', 'x();\r\ny();', diff('1:6', '2:1', lineBreak)],
  ['reports LS as a line break', 'x();\u2028y();', 'x(); y();', diff('2:1', '1:6', lineBreak)],
  ['reports PS as a line break', 'x(); y();', 'x();\u2029y();', diff('1:6', '2:1', lineBreak)],
  ['reports deleted whitespace inside a string', "const x = 'a b';", "const x = 'ab';", diff('1:13', '1:13', '"\'a b\'" -> "\'ab\'"')],
  ['reports added whitespace inside template text', 'const x = `a${y}b`;', 'const x = `a${y} b`;', diff('1:17', '1:17', '"b" -> " b"')],
  ['reports deleted whitespace inside a regex', 'const x = /a b/;', 'const x = /ab/;', diff('1:13', '1:13', '"/a b/" -> "/ab/"')],
  ['reports a changed string character', "const x = 'a';", "const x = 'b';", diff('1:12', '1:12', '"\'a\'" -> "\'b\'"')],
  ['reports a changed number', 'const x = 10;', 'const x = 11;', diff('1:12', '1:12', '"10" -> "11"')],
  ['reports a changed identifier', 'const x = 1;', 'const y = 1;', diff('1:7', '1:7', '"x" -> "y"')],
  ['reports a changed operator', 'x < y;', 'x <= y;', diff('1:4', '1:4', '"<" -> "<="')],
  ['reports a changed regex flag', 'const x = /a/g;', 'const x = /a/i;', diff('1:14', '1:14', '"/a/g" -> "/a/i"')],
  ['reports a changed comment', '/* a */\nx();', '/* b */\nx();', diff('1:4', '1:4', '"/* a */" -> "/* b */"')],
  ['reports a changed line break inside a block comment as comment text', '/* a\nb */\nx();', '/* a b */\nx();', diff('1:5', '1:5', '"/* a\\nb */" -> "/* a b */"')],
  ['reports a removed comment', '// a\nx();', 'x();', diff('1:1', '1:1', '"// a" -> <no token>')],
  ['reports an added comment', 'x();', '// a\nx();', diff('1:1', '1:1', '<no token> -> "// a"')],
  ['reports a comment moved to another line', '/* a */ x();', '/* a */\nx();', diff('1:9', '2:1', lineBreak)],
  ['reports a changed module specifier path', `import ${mjs};`, `import ${otherTs};`, diff('1:11', '1:11', '"\'./x.mjs\'" -> "\'./y.ts\'"')],
  ['reports an extension change in an ordinary string', "const x = 'x.mjs';", "const x = 'x.ts';", diff('1:14', '1:14', '"\'x.mjs\'" -> "\'x.ts\'"')],
  ['reports an extension change in a property named import', "obj.import('x.mjs');", "obj.import('x.ts');", diff('1:15', '1:15', '"\'x.mjs\'" -> "\'x.ts\'"')],
  ['reports an extension change in a computed import argument', "import('x.mjs' + suffix);", "import('x.ts' + suffix);", diff('1:11', '1:11', '"\'x.mjs\'" -> "\'x.ts\'"')],
]) {
  test(name, () => assert.deepEqual(run(before, after), [expected]));
}

test('refuses joining + + into ++ when the edit makes the result invalid', () => {
  assertRefusal(() => run('a + +b;', 'a ++ b;'), /^after\.ts: /);
});

test('reports parentheses around an ordinary expression', () => {
  assert.deepEqual(run('f(x);', 'f((x));'), [
    diff('1:3', '1:3', '<no token> -> "("'),
    diff('1:5', '1:6', '<no token> -> ")"'),
  ]);
});

test('reports added parentheses around an untyped arrow parameter', () => {
  assert.ok(run('const f = x => x;', 'const f = (x) => x;').some(d => d.after === 'after.ts:1:11'));
});

test('reports added parentheses when the original identifier is not an arrow parameter', () => {
  assert.deepEqual(run('const f = x;', 'const f = (x: number) => x;')[0],
    diff('1:11', '1:11', '<no token> -> "("'));
});

test('identifies the leading BOM when type stripping removes it', () => {
  assertRefusal(() => run('const x = 1;', '\ufeffconst x: number = 1;'),
    'after.ts:1:1 type stripping removed a leading byte-order mark');
});

test('reports a line break inside added arrow parentheses', () => {
  assert.deepEqual(run('const f = x => x;', 'const f = (x:\nnumber) => x;'), [diff('1:11', '2:7', lineBreak)]);
});

test('reports a changed incoming gap before the added arrow parentheses', () => {
  assert.deepEqual(run('const f = x => x;', 'const f =\n(x: number) => x;'), [diff('1:11', '2:1', lineBreak)]);
});

test('reports an added statement', () => {
  assert.deepEqual(run('const x = 1;', 'const x = 1;\n0;'), [
    diff('1:13', '2:1', '<no token> -> "0"'), diff('1:13', '2:2', '<no token> -> ";"'),
  ]);
});

test('reports a removed statement', () => {
  assert.deepEqual(run('const x = 1;\n0;', 'const x = 1;'), [
    diff('2:1', '1:13', '"0" -> <no token>'), diff('2:2', '1:13', '";" -> <no token>'),
  ]);
});

test('reports the missing guard without --launcher', () => {
  const differences = run(guarded, 'export function main(): void {}\n');
  assert.deepEqual(differences[0], diff('3:1', '2:1', '"if" -> <no token>'));
});

test('--launcher reports removal of a different last statement', () => {
  assert.deepEqual(run('a();\n0;', 'a();', { launcher: true }), [
    diff('2:1', '1:5', '"0" -> <no token>'), diff('2:2', '1:5', '";" -> <no token>'),
  ]);
});

test('--launcher reports removal of final for and while loops that call main', () => {
  assert.deepEqual(run('a();\nfor (;;) main();', 'a();', { launcher: true })[0],
    diff('2:1', '1:5', '"for" -> <no token>'));
  assert.deepEqual(run('a();\nwhile (c) main();', 'a();', { launcher: true })[0],
    diff('2:1', '1:5', '"while" -> <no token>'));
});

test('--launcher reports removal of a final guard on the same line as another statement', () => {
  assert.deepEqual(run('a(); if (c) main();', 'a();', { launcher: true })[0],
    diff('1:6', '1:5', '"if" -> <no token>'));
});

test('--launcher reports removal of a guard with a comment in it', () => {
  assert.ok(run('a();\nif (/* note */ x) main();', 'a();', { launcher: true })
    .some(d => d.message === '"/* note */" -> <no token>'));
});

for (const [name, before, after, position] of [
  ['a block comment in an interface', 'const x = 1;',
    'interface T { x: /* new */ X }\nconst x = 1;', '1:18'],
  ['a line comment in an interface', 'a();\nb();',
    'a();\ninterface T { // note\nx: number }\nb();', '2:15'],
  ['a block comment in a parameter type', 'function f(x) {}',
    'function f(x: /* note */ number) {}', '1:15'],
  ['a line comment in a parameter type', 'function f(x\n) {}',
    'function f(x: // note\nnumber) {}', '1:15'],
  ['a block comment in a generic argument', 'const x = id(1);',
    'const x = id</* note */ number>(1);', '1:14'],
  ['a line comment in a generic argument', 'const x = id\n(1);',
    'const x = id<// note\nnumber>(1);', '1:14'],
  ['// in an erased string-literal type', 'const x = 1;',
    "type T = 'http://x';\nconst x = 1;", '1:16'],
]) {
  test('reports a possible comment for ' + name, () => {
    assert.deepEqual(run(before, after), [{
      after: 'after.ts:' + position,
      message: 'possible comment inside erased TypeScript at after.ts:' + position,
    }]);
  });
}

const hashbang = '#!/usr/bin/env node';
test('accepts an unchanged hashbang on both sides', () => {
  assert.deepEqual(run(hashbang + '\nconst x = 1;', hashbang + '\nconst x: number = 1;'), []);
});

test('reports a changed hashbang as comment text', () => {
  assert.deepEqual(run(hashbang + '\nx();', '#!/usr/bin/env bun\nx();'),
    [diff('1:16', '1:16', '"#!/usr/bin/env node" -> "#!/usr/bin/env bun"')]);
});

test('reports a removed hashbang as a removed comment', () => {
  assert.deepEqual(run(hashbang + '\nx();', 'x();'), [diff('1:1', '1:1', '"#!/usr/bin/env node" -> <no token>')]);
});

test('reports an added hashbang as an added comment', () => {
  assert.deepEqual(run('x();', hashbang + '\nx();'), [diff('1:1', '1:1', '<no token> -> "#!/usr/bin/env node"')]);
});

test('reports changed regex text after a const object binding in for-of', () => {
  const before = "const s = 'x  y';\nfor (const { length } of / {2}y/.exec(s) ?? []) console.log(length);";
  const after = before.replace('const s', 'const s: string').replace('{2}', '{ 2 }');
  assert.deepEqual(run(before, after), [diff('2:29', '2:29', '"/ {2}y/" -> "/ { 2 }y/"')]);
});

test('reports changed string text after a quote-bearing regex in for-of', () => {
  const before = "const s = \"'\";\nlet t = '';\nfor (const { index } of /'/.exec(s) ?? []) t = ' a  b ' + ')'.slice(1) // '\nconsole.log(JSON.stringify(t));";
  const after = before.replace('const s', 'const s: string').replace('let t', 'let t: string').replace(' a  b ', ' a b ');
  assert.deepEqual(run(before, after), [diff('3:52', '3:52', '"\' a  b \'" -> "\' a b \'"')]);
});

test('reports changed regex text after a declaration in a typed object method', () => {
  const before = [
    'const checker = {',
    '  check(s) {',
    "    function g() {} /a  b/.test(s) && console.log('match');",
    '  },',
    '};',
    "checker.check('a  b');",
  ].join('\n');
  const after = before.replace('check(s)', 'check(s: string): void').replace('/a  b/', '/a b/');
  assert.deepEqual(run(before, after), [diff('3:24', '3:24', '"/a  b/" -> "/a b/"')]);
});

for (const [context, lead, position] of [
  ['a function declaration after return and a line break in an object method',
    "function f() {} /'/; function h() { return 'a  b' } // '", '3:47'],
  ['a block after return and a line break in an object method',
    "{ } /'/; function f() { return 'a  b' } // '", '3:35'],
]) {
  test('reports changed string text after ' + context, () => {
    const fn = lead.startsWith('function') ? 'h' : 'f';
    const before = [
      'let g;',
      'const o = { m() { g = ' + fn + '; return',
      lead,
      '} };',
      'o.m(); console.log(JSON.stringify(g()));',
    ].join('\n');
    const after = before.replace('let g;', 'let g: () => string;').replace('m()', 'm(): void').replace("'a  b'", "'a b'");
    assert.deepEqual(run(before, after), [diff(position, position, '"\'a  b\'" -> "\'a b\'"')]);
  });
}

for (const [context, before, position, flags = ''] of [
  ['a let object binding', 'for (let { a } of /a  b/.exec(s)) {}', '1:22'],
  ['a defaulted object binding', 'for (const { a = 1 } of /a  b/.exec(s)) {}', '1:28'],
  ['an object binding in for await', 'async function g() { for await (const { a } of /a  b/.exec(s)) {} }', '1:51'],
  ['a function declaration in a class method', 'class A { m(s) { function g() {} /a  b/.test(s); } }', '1:37'],
  ['a function declaration in a class static block', 'class A { static { function g() {} /a  b/.test(s); } }', '1:39'],
  ['a function declaration in a getter', 'class A { get x() { function g() {} /a  b/.test(s); } }', '1:40'],
  ['an async function declaration in a method', 'class A { m() { async function g() {} /a  b/.test(s); } }', '1:42'],
  ['a function declaration in a case clause', 'switch (x) { case 1: function g() {} /a  b/.test(s); }', '1:41'],
  ['a function declaration following a class declaration', 'class A {} function g() {} /a  b/.test(s);', '1:31'],
  ['a function declaration in a labelled block', 'l0: { async function h5() { x; } /a  b/g.test(s); }', '1:37', 'g'],
  ['a function declaration following do-while', 'do x(); while (x) function g2() {} /a  b/g;', '1:39', 'g'],
  ['a block after return and a line comment in a class method', 'class K { m(s) { return // c\n{ } /a  b/.test(s) } }', '2:8'],
  ['a block after return and a line break in an object method', 'const o = { m(s) { return\n{ } /a  b/.test(s) } };', '2:8'],
  ['a block after return and a line break in a getter', 'const o = { get v() { return\n{ } /a  b/ } };', '2:8'],
]) {
  test('reports changed regex text after ' + context, () => {
    assert.deepEqual(run(before, before.replace('/a  b/', '/a b/')),
      [diff(position, position, '"/a  b/' + flags + '" -> "/a b/' + flags + '"')]);
  });
}

const sample = hashbang + '\n// note\nif (x) /a/;\n{} /b/;\nf(x) / y / z;\n' +
  'const t = `a${`b`}c`;\nclass C { #n = 1n; } /* end */\n';

test('takes the source spelling and kind of each token and comment from the full parse', () => {
  assert.deepEqual(tokenize(sample).map(({ kind, value }) => [kind, value]), [
    ['Line', '#!/usr/bin/env node'], ['Line', '// note'],
    ['if', 'if'], ['(', '('], ['name', 'x'], [')', ')'], ['regexp', '/a/'], [';', ';'],
    ['{', '{'], ['}', '}'], ['regexp', '/b/'], [';', ';'],
    ['name', 'f'], ['(', '('], ['name', 'x'], [')', ')'], ['/', '/'], ['name', 'y'], ['/', '/'], ['name', 'z'], [';', ';'],
    ['const', 'const'], ['name', 't'], ['=', '='], ['`', '`'], ['template', 'a'], ['${', '${'],
    ['`', '`'], ['template', 'b'], ['`', '`'], ['}', '}'], ['template', 'c'], ['`', '`'], [';', ';'],
    ['class', 'class'], ['name', 'C'], ['{', '{'], ['privateId', '#n'], ['=', '='], ['num', '1n'],
    [';', ';'], ['}', '}'], ['Block', '/* end */'],
  ]);
});

test('uses half-open source ranges and one-based positions for tokens and comments', () => {
  const tokens = tokenize(sample);
  assert.deepEqual(tokens[0], { kind: 'Line', value: hashbang, start: 0, end: 19, line: 1, column: 1 });
  assert.deepEqual(tokens[6], { kind: 'regexp', value: '/a/', start: 35, end: 38, line: 3, column: 8 });
  assert.deepEqual(tokens.at(-1), { kind: 'Block', value: '/* end */', start: 105, end: 114, line: 7, column: 22 });
  assert.equal(reassemble(sample, tokens, '<sample>'), sample);
});

test('token identity distinguishes regex and division kinds and equal spellings of distinct kinds', () => {
  const slashes = tokenize('/a/; x / y;').filter(({ value }) => value.startsWith('/'));
  assert.deepEqual(slashes.map(({ kind, value }) => [kind, value]), [['regexp', '/a/'], ['/', '/']]);
  assert.deepEqual(run('const a = `1`;', 'const a = 1;'), [
    diff('1:11', '1:11', '"`" -> "1"'),
    diff('1:12', '1:12', '"1" -> <no token>'),
    diff('1:13', '1:12', '"`" -> <no token>'),
  ]);
});

function assertRefusal(read, message) {
  let result;
  assert.throws(() => { result = read(); }, { message });
  assert.equal(result, undefined, 'refusal must return no tokens or comparison results');
}

const parseErrors = [
  ['an at sign', 'a(); @', '1:6', "Unexpected character '@'", 'Expected ident'],
  ['an unterminated string', '\nx = "open', '2:5', 'Unterminated string constant', 'Unterminated string constant'],
  ['an unterminated template', '\nconst x = `abc', '2:12', 'Unterminated template', 'Unterminated template'],
  ['a leftover type annotation', '\nconst x: number = 1;', '2:8', 'Unexpected token'],
];
for (const [name, invalid, position, message, stripReason] of parseErrors) {
  test('tokenize refuses ' + name + ' with its position', () => {
    assertRefusal(() => tokenize(invalid, 'input.mjs'), 'input.mjs:' + position + ' ' + message);
  });
  test('the command exits 2 for ' + name + ' with the parser diagnostic', { timeout: 15000 }, (t) => {
    const original = stripReason ? 'a();' : invalid;
    const typed = stripReason ? invalid : 'a();';
    const { dir, before, after, launch } = commandFixture(t, original, typed);
    const result = launch();
    assert.ifError(result.error);
    assert.equal(result.status, 2);
    assert.equal(result.stdout.trimEnd(), process.version);
    if (stripReason) {
      assert.ok(result.stderr.startsWith(after + ': ') && result.stderr.includes(stripReason), result.stderr);
    } else {
      assert.ok(result.stderr.split(/\r?\n/).includes(before + ':' + position + ' ' + message), result.stderr);
    }
    assertInputs(dir, before, after, original, typed);
  });
}

for (const [name, typed, reason] of [
  ['a second-line enum', 'let x = 1;\nenum E { A }', 'TypeScript enum is not supported in strip-only mode'],
  ['invalid TypeScript after a valid annotation', 'let x: number = 1;\nlet y = 2 +;', 'Expression expected'],
]) {
  test('the command exits 2 and preserves the stripper diagnostic for ' + name, { timeout: 15000 }, (t) => {
    const original = 'let x = 1;';
    const { dir, before, after, launch } = commandFixture(t, original, typed);
    const result = launch();
    assert.ifError(result.error);
    assert.equal(result.status, 2);
    assert.equal(result.stdout.trimEnd(), process.version);
    assert.doesNotMatch(result.stderr, /:1:1\b|\b1:6\b/);
    assert.ok(result.stderr.startsWith(after + ': ') && result.stderr.includes(reason), result.stderr);
    assertInputs(dir, before, after, original, typed);
  });
}

test('the command exits 2 when Acorn rejects the stripped TypeScript', { timeout: 15000 }, (t) => {
  const original = 'class C { x; }', typed = '@decorator class C { x: number; }';
  const { dir, before, after, launch } = commandFixture(t, original, typed);
  const result = launch();
  assert.ifError(result.error);
  assert.equal(result.status, 2);
  assert.equal(result.stdout.trimEnd(), process.version);
  assert.ok(result.stderr.split(/\r?\n/).includes(after + ":1:1 Unexpected character '@'"), result.stderr);
  assertInputs(dir, before, after, original, typed);
});

function reassemble(source, tokens, file) {
  const parts = [];
  let end = 0;
  for (const token of tokens) {
    const label = file + ' at offset ' + end;
    assert.ok(Number.isInteger(token.start) && token.start >= end && token.start < source.length, label);
    assert.ok(Number.isInteger(token.end) && token.end >= token.start && token.end <= source.length, label);
    if (token.end === token.start) assert.equal(token.kind, 'template', label);
    const gap = source.slice(end, token.start);
    assert.match(gap, /^\s*$/, label);
    assert.equal(source.slice(token.start, token.end), token.value, label);
    if (token.kind === 'regexp') {
      const close = token.value.lastIndexOf('/');
      assert.ok(token.value.startsWith('/') && close > 0, label);
      assert.doesNotThrow(() => new RegExp(token.value.slice(1, close), token.value.slice(close + 1)), label);
    }
    parts.push(gap, token.value);
    end = token.end;
  }
  assert.match(source.slice(end), /^\s*$/, file);
  parts.push(source.slice(end));
  return parts.join('');
}

// Named source-scan guard: every tracked plugin JavaScript file must parse in Acorn.
// Half-open token and comment ranges plus intervening whitespace must reproduce every byte.
test('source scan: the Acorn parse covers every tracked JavaScript source byte', { timeout: 20000 }, () => {
  const files = execFileSync('git', ['ls-files', '-z', '--', "bin", "hooks", "scripts", "skills"], {
    cwd: REPO_ROOT, env: testEnv(), encoding: 'utf8', timeout: 10000,
  }).split('\0').filter(file => /\.(?:mjs|js)$/.test(file));
  assert.ok(files.length > 0, 'expected tracked JavaScript files');
  for (const file of files) {
    const bytes = readFileSync(join(REPO_ROOT, file));
    const source = bytes.toString('utf8');
    assert.deepEqual(Buffer.from(reassemble(source, tokenize(source, file), file)), bytes, file);
  }
});

const termsPrefix = [
  "// Query and title terms, shared by the pre-web hook and advise's near-duplicate pairing.",
  "export const STOP = new Set('the a an and or of to in on for with how what why does is are was be this that from into about using use vs return full page text summarize paper extract verbatim'.split(' '));",
  "",
  "// Lower-cased, URLs blanked, split outside [a-z0-9_.-], terms shorter than three characters and",
  "// stop words dropped, deduplicated in first-occurrence order.",
  '',
].join('\n');
const termsBefore = termsPrefix + String.raw`export const termsOf = text => [...new Set(String(text ?? '').toLowerCase().replace(/https?:\/\/\S+/g, ' ').split(/[^a-z0-9_.-]+/).filter(t => t.length >= 3 && !STOP.has(t)))];
`;
const termsAfter = termsPrefix + String.raw`export const termsOf = (text: unknown): string[] => [...new Set(String(text ?? '').toLowerCase().replace(/https?:\/\/\S+/g, ' ').split(/[^a-z0-9_.-]+/).filter(t => t.length >= 3 && !STOP.has(t)))];
`;

test('accepts the real termsOf conversion', () => {
  assert.deepEqual(run(termsBefore, termsAfter), []);
});

const screenPrefix = [
  "// S-11: the one screen for text from entries, the blocklist and fetched pages before an agent reads it",
  "// (the pre-web hook, the text output of `search`, `related --format mermaid`, `verify --quotes` and",
  "// `--stale`, `check`, `capture`'s blocklist refusal and text lines, lint's messages, `manifest",
  "// --topics` and `--rebuild`'s dangling edges, `teach path candidates`, `advise`, `gate evidence` and",
  "// the post-edit hook's code-row reason), so a value cannot forge a line of its own or hide text.",
  "// JSON output is not screened: it is data, and JSON.stringify escapes it.",
  "// Line breaks become a space; controls, format characters (zero-width, bidi, tag characters,",
  "// interlinear annotation) and every other default-ignorable code point (variation selectors, soft",
  "// hyphen, Hangul fillers) are removed.",
  "const BREAK_RE = /[\\t\\n\\v\\f\\r\\u0085\\u2028\\u2029]/g;",
  "const HIDDEN_RE = /[\\p{Cc}\\p{Cf}\\p{Default_Ignorable_Code_Point}]/gu;",
  "export const SCREEN_MAX = 300;",
  "",
  "// One line, at most `max` characters (code points); a cut value ends with `\\u2026`.",
  '',
].join('\n');
const screenBefore = screenPrefix + String.raw`export function screenText(value, max = SCREEN_MAX) {
  const s = String(value).replace(BREAK_RE, ' ').replace(HIDDEN_RE, '').replace(/ {2,}/g, ' ').trim();
  const chars = [...s];
  return chars.length > max ? chars.slice(0, max - 1).join('').trimEnd() + '\u2026' : s;
}
`;
const screenAfter = screenPrefix + String.raw`export function screenText(value: unknown, max: number = SCREEN_MAX): string {
  const s = String(value).replace(BREAK_RE, ' ').replace(HIDDEN_RE, '').replace(/ {2,}/g, ' ').trim();
  const chars = [...s];
  return chars.length > max ? chars.slice(0, max - 1).join('').trimEnd() + '\u2026' : s;
}
`;

test('accepts the real screenText conversion', () => {
  assert.deepEqual(run(screenBefore, screenAfter), []);
});

test('reports exactly the operator edit in the real screenText conversion', () => {
  const changed = screenAfter.replace('max - 1', 'max + 1');
  assert.deepEqual(run(screenBefore, changed), [diff('18:50', '18:50', '"-" -> "+"')]);
});

const tool = join(REPO_ROOT, 'tooling/d6-compare.mjs');

function commandFixture(t, original, typed) {
  const dir = tmpVault('rv-d6-compare-');
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const before = join(dir, 'before.mjs'), after = join(dir, 'after.ts');
  writeFileSync(before, original);
  writeFileSync(after, typed);
  const launch = (flags = [], command = tool) => spawnSync(process.execPath, [...flags, command, before, after], {
    cwd: dir, env: testEnv(), encoding: 'utf8', timeout: 10000,
  });
  return { dir, before, after, launch };
}

function assertInputs(dir, before, after, original, typed, otherFiles = []) {
  assert.deepEqual(readdirSync(dir).sort(), ['after.ts', 'before.mjs', ...otherFiles].sort());
  assert.deepEqual(readFileSync(before), Buffer.from(original));
  assert.deepEqual(readFileSync(after), Buffer.from(typed));
}

test('the command prints the Node version and exits 0 for an equal pair', { timeout: 15000 }, (t) => {
  const { launch } = commandFixture(t, 'const x = 1;\n', 'const x: number = 1;\n');
  const result = launch();
  assert.ifError(result.error);
  assert.equal(result.status, 0);
  assert.equal(result.stdout.trimEnd(), process.version);
});

test('the command prints the Node version and exits 1 for a token difference', { timeout: 15000 }, (t) => {
  const { before, after, launch } = commandFixture(t, 'const x = 1;\n', 'const x: number = 2;\n');
  const result = launch();
  assert.ifError(result.error);
  assert.equal(result.status, 1);
  assert.deepEqual(result.stdout.trimEnd().split(/\r?\n/), [
    process.version, `${before}:1:11 -> ${after}:1:19: "1" -> "2"`,
  ]);
});

test('the command exits 1 and prints the position of a possible erased comment', { timeout: 15000 }, (t) => {
  const { after, launch } = commandFixture(t, 'const x = 1;', 'interface T { x: /* note */ X }\nconst x = 1;');
  const result = launch();
  assert.ifError(result.error);
  assert.equal(result.status, 1);
  assert.deepEqual(result.stdout.trimEnd().split(/\r?\n/), [
    process.version, 'possible comment inside erased TypeScript at ' + after + ':1:18',
  ]);
});

test('the command refuses Node 24.11.1 before comparing the inputs', { timeout: 15000 }, (t) => {
  const original = 'const x = 1;', typed = 'const x: number = 2;';
  const { dir, before, after, launch } = commandFixture(t, original, typed);
  const fakeVersion = 'data:text/javascript,' + encodeURIComponent(
    "Object.defineProperty(process.versions, 'node', { value: '24.11.1' });");
  const result = launch(['--import', fakeVersion]);
  assert.ifError(result.error);
  assert.equal(result.status, 2);
  assert.equal(result.stdout.trimEnd(), process.version);
  assert.equal(result.stderr, 'D6 requires Node.js 24.12.0 or newer.\n');
  assertInputs(dir, before, after, original, typed);
});

test('the command exits 2 and prints only the install hint when Acorn is missing', { timeout: 15000 }, (t) => {
  const original = 'a();', typed = 'b();';
  const { dir, before, after, launch } = commandFixture(t, original, typed);
  const command = join(dir, 'd6-compare.mjs');
  copyFileSync(tool, command);
  copyFileSync(join(REPO_ROOT, 'tooling/d6-tokens.mjs'), join(dir, 'd6-tokens.mjs'));
  const result = launch([], command);
  assert.ifError(result.error);
  assert.equal(result.status, 2);
  assert.equal(result.stdout, '');
  assert.equal(result.stderr, installHint + '\n');
  assertInputs(dir, before, after, original, typed, ['d6-compare.mjs', 'd6-tokens.mjs']);
});

test('the command reports the module error when d6-tokens.mjs is missing', { timeout: 15000 }, (t) => {
  const original = 'a();', typed = 'b();';
  const { dir, before, after, launch } = commandFixture(t, original, typed);
  const command = join(dir, 'd6-compare.mjs');
  copyFileSync(tool, command);
  const result = launch([], command);
  assert.ifError(result.error);
  assert.equal(result.status, 1);
  assert.equal(result.stdout, '');
  assert.match(result.stderr, /ERR_MODULE_NOT_FOUND.*Cannot find module .*d6-tokens\.mjs/);
  assert.ok(!result.stderr.includes(installHint), result.stderr);
  assertInputs(dir, before, after, original, typed, ['d6-compare.mjs']);
});
