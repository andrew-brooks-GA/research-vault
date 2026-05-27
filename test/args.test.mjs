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
