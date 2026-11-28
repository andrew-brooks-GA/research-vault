import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sha256Hex, sha256Tagged } from '../bin/lib/hash.mjs';

const ABC_HEX = 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad';

test('sha256Hex returns the bare digest of a string', () => {
  assert.equal(sha256Hex('abc'), ABC_HEX);
});

test('sha256Hex returns the bare digest of the same bytes in a Buffer', () => {
  assert.equal(sha256Hex(Buffer.from('abc')), ABC_HEX);
});

test('sha256Tagged returns the prefixed digest of the empty string', () => {
  assert.equal(sha256Tagged(''), 'sha256:e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
});

test('the tagged and bare digests differ by exactly the sha256: prefix', () => {
  const prefix = 'sha256:';
  const tagged = sha256Tagged('abc');
  assert.equal(tagged.slice(0, prefix.length), prefix);
  assert.equal(tagged.slice(prefix.length) === sha256Hex('abc'), true);
});
