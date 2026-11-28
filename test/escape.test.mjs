import { test } from 'node:test';
import assert from 'node:assert/strict';
import { escapeHtml } from '../bin/lib/escape.mjs';

test('escapes an ampersand', () => {
  assert.equal(escapeHtml('&'), '&amp;');
});

test('escapes a less-than sign', () => {
  assert.equal(escapeHtml('<'), '&lt;');
});

test('escapes a greater-than sign', () => {
  assert.equal(escapeHtml('>'), '&gt;');
});

test('escapes a double quote', () => {
  assert.equal(escapeHtml('"'), '&quot;');
});

// A later task will deliberately add apostrophe escaping.
test('leaves an apostrophe unchanged', () => {
  assert.equal(escapeHtml("'"), "'");
});

test('escapes an existing HTML entity again', () => {
  assert.equal(escapeHtml('&lt;'), '&amp;lt;');
});

test('leaves plain text unchanged', () => {
  assert.equal(escapeHtml('Plain text!'), 'Plain text!');
});

test('escapeHtml escapes every occurrence in a string', () => {
  assert.equal(escapeHtml('<a & "b">'), '&lt;a &amp; &quot;b&quot;&gt;');
});
