import { test } from 'node:test';
import assert from 'node:assert/strict';
import { STOP, termsOf } from '../bin/lib/terms.ts';

test('termsOf lower-cases terms', () => {
  assert.deepEqual(termsOf('MiXeD UPPER'), ['mixed', 'upper']);
});

test('termsOf blanks HTTP and HTTPS URLs through the next whitespace', () => {
  assert.deepEqual(termsOf('alpha http://one.example/path?q=word\tbeta https://two.example/other#tag\ngamma'),
    ['alpha', 'beta', 'gamma']);
});

test('termsOf splits outside letters, digits, underscores, dots and hyphens', () => {
  assert.deepEqual(termsOf('abc_12,def.34/ghi-56+jkl=xyzéend'),
    ['abc_12', 'def.34', 'ghi-56', 'jkl', 'xyz', 'end']);
});

test('termsOf drops terms shorter than three characters', () => {
  assert.deepEqual(termsOf('x xy xyz'), ['xyz']);
});

test('termsOf drops stop words', () => {
  assert.deepEqual(termsOf('the using paper findings'), ['findings']);
});

test('termsOf removes duplicates in first-occurrence order', () => {
  assert.deepEqual(termsOf('zebra alpha zebra beta alpha'), ['zebra', 'alpha', 'beta']);
});

test('termsOf returns no terms for null or undefined', () => {
  assert.deepEqual(termsOf(null), []);
  assert.deepEqual(termsOf(undefined), []);
});

test('termsOf stringifies a number', () => {
  assert.deepEqual(termsOf(123.45), ['123.45']);
});

test('STOP is a Set containing the 35 stop words in order', () => {
  assert.ok(STOP instanceof Set);
  assert.deepEqual([...STOP], [
    'the', 'a', 'an', 'and', 'or', 'of', 'to', 'in', 'on', 'for', 'with', 'how', 'what', 'why',
    'does', 'is', 'are', 'was', 'be', 'this', 'that', 'from', 'into', 'about', 'using', 'use', 'vs',
    'return', 'full', 'page', 'text', 'summarize', 'paper', 'extract', 'verbatim',
  ]);
});
