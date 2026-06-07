import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseArgs } from '../bin/lib/args.mjs';

test('parses flags, --key value, --bool, and positionals', () => {
  const a = parseArgs(['capture', '--type', 'source', '--title', 'X', '--json', 'pos1']);
  assert.equal(a._[0], 'capture');
  assert.equal(a.type, 'source');
  assert.equal(a.json, true);
  assert.deepEqual(a._.slice(1), ['pos1']);
});

test('boolean flags do not swallow the following --option', () => {
  // --project and --report are booleans; the token after them is a separate flag,
  // not their value. Regression: previously --project consumed --vault.
  const a = parseArgs(['init', '--project', '--vault', '/v']);
  assert.equal(a.project, true);
  assert.equal(a.vault, '/v');
  const b = parseArgs(['check', 'plan/**/*.md', '--report', '--check']);
  assert.equal(b.report, true);
  assert.equal(b.check, true);
  assert.deepEqual(b._.slice(1), ['plan/**/*.md']);
});
