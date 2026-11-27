// The import graph misses import() with a non-string-literal argument,
// createRequire, import.meta.resolve and .cjs files. Its builder,
// scripts/deps.mjs, does not scan its own imports.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { build, context } from '../scripts/deps.mjs';

const inGraph = /^(?:bin|hooks|scripts)\/.*\.m?js$/;
const { nodes, edges } = build(context());
const imports = edges.filter(({ kind, from, to }) =>
  kind === 'import' && inGraph.test(from) && !to.startsWith('node:'));
const isLib = (file) => file.startsWith('bin/lib/');
const isCommand = (file) => file.startsWith('bin/commands/');
const isOtherBinFile = (file) => file.startsWith('bin/') && !isLib(file) && !isCommand(file);
const isHook = (file) => file.startsWith('hooks/');
const isScript = (file) => file.startsWith('scripts/');

function exampleCycle(start, group, outgoing) {
  // Breadth-first search finds the shortest cycle through the first file.
  const previous = new Map([[start, null]]);
  for (const [file] of previous) {
    for (const { to } of outgoing.get(file) ?? []) {
      if (to === start) {
        const path = [start];
        for (let step = file; step !== null; step = previous.get(step)) path.push(step);
        return path.reverse().join(' -> ');
      }
      if (group.has(to) && !previous.has(to)) previous.set(to, file);
    }
  }
}

function cyclicImportGroups() {
  const edges = imports.filter(({ to }) => inGraph.test(to));
  const outgoing = Map.groupBy(edges, ({ from }) => from);
  const incoming = Map.groupBy(edges, ({ to }) => to);
  const visited = new Set();
  const finishOrder = [];

  // Kosaraju's first pass records when each file's outgoing search is done.
  for (const start of outgoing.keys()) {
    const pending = [[start, false]];
    while (pending.length) {
      const [file, expanded] = pending.pop();
      if (expanded) finishOrder.push(file);
      else if (!visited.has(file)) {
        visited.add(file);
        pending.push([file, true]);
        for (const { to } of outgoing.get(file) ?? []) {
          if (!visited.has(to)) pending.push([to, false]);
        }
      }
    }
  }

  // In reverse finish order, each search along incoming edges finds one component.
  visited.clear();
  const groups = [];
  for (const start of finishOrder.reverse()) {
    if (visited.has(start)) continue;
    visited.add(start);
    const group = new Set([start]);
    for (const file of group) {
      for (const { from } of incoming.get(file) ?? []) {
        if (!visited.has(from)) {
          visited.add(from);
          group.add(from);
        }
      }
    }
    if (group.size > 1 || (outgoing.get(start) ?? []).some(({ to }) => to === start)) {
      const files = [...group].sort();
      groups.push([files.join(', '), '  Example cycle: ' + exampleCycle(files[0], group, outgoing)].join('\n'));
    }
  }
  return groups.sort();
}

function forbiddenImports(source, allowed) {
  return imports.filter(({ from, to }) => source(from) && !allowed(to))
    .map(({ from, to }) => `${from} -> ${to}`).sort();
}

test('imports among code files in bin, hooks and scripts are acyclic', () => {
  const groups = cyclicImportGroups();
  if (groups.length) assert.fail(['Cyclic import groups:', ...groups].join('\n'));
});

test('library code imports only library code and the browser quiz', () => {
  const violations = forbiddenImports(isLib, (to) => isLib(to) || to === 'skills/research-teach/assets/quiz.js');
  assert.equal(violations.length, 0, ['Forbidden library imports:', ...violations].join('\n'));
});

test('commands import only library code', () => {
  const violations = forbiddenImports(isCommand, isLib);
  assert.equal(violations.length, 0, ['Forbidden command imports:', ...violations].join('\n'));
});

test('hooks import only library code', () => {
  const violations = forbiddenImports(isHook, isLib);
  assert.equal(violations.length, 0, ['Forbidden hook imports:', ...violations].join('\n'));
});

test('bin code outside bin/lib and bin/commands imports only library code and commands', () => {
  const violations = forbiddenImports(isOtherBinFile, (to) => isLib(to) || isCommand(to));
  assert.equal(violations.length, 0, ['Forbidden imports from outside bin/lib and bin/commands:', ...violations].join('\n'));
});

test('scripts import only library code and the test helpers', () => {
  const violations = forbiddenImports(isScript, (to) => isLib(to) || to === 'test/helpers.mjs');
  assert.equal(violations.length, 0, ['Forbidden script imports:', ...violations].join('\n'));
});

test('the graph has import edges from library code, commands, hooks and scripts', () => {
  const layers = [
    ['bin/lib/', isLib],
    ['bin/commands/', isCommand],
    ['hooks/', isHook],
    ['scripts/', isScript],
  ];
  const missing = layers.filter(([, inLayer]) => !imports.some(({ from }) => inLayer(from)))
    .map(([dir]) => dir);
  assert.equal(missing.length, 0, ['No import edges from:', ...missing].join('\n'));
});

test('the CLI entry is the only graph file in bin outside bin/lib and bin/commands', () => {
  const files = [...nodes].filter((file) => inGraph.test(file) && isOtherBinFile(file));
  assert.deepEqual(files, ['bin/research-vault.mjs']);
});
