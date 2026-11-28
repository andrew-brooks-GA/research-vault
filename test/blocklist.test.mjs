import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpVault } from './helpers.mjs';
import { BLOCKLIST, loadBlocklist, matchBlock } from '../bin/lib/blocklist.mjs';

export const ROWS = [
  { pattern: 'spam.example.com', scope: 'domain', reason: 'content farm', added: '2026-11-02' },
  { pattern: 'https://good.example.com/sponsored/', scope: 'url', reason: 'advertorial', added: '2026-11-02' },
];
export function writeBlocklist(v, rows = ROWS) {
  mkdirSync(join(v, 'meta'), { recursive: true });
  writeFileSync(join(v, BLOCKLIST), JSON.stringify(rows), 'utf8');
}

test('blocklist: absent is empty; a domain row covers subdomains; a url row is a prefix after normalisation; a bad file or row throws (spec 32 D1)', () => {
  const v = tmpVault('rv-block-');
  assert.deepEqual(loadBlocklist(v), []);
  writeBlocklist(v);
  const rows = loadBlocklist(v);
  assert.equal(matchBlock(rows, 'https://spam.example.com/a').reason, 'content farm');
  assert.equal(matchBlock(rows, 'https://news.spam.example.com/b').scope, 'domain');
  assert.equal(matchBlock(rows, 'https://notspam.example.com/c'), null);
  assert.equal(matchBlock(rows, 'https://good.example.com/sponsored/x?utm_source=y').reason, 'advertorial');
  assert.equal(matchBlock(rows, 'https://good.example.com/other'), null);
  assert.equal(matchBlock(rows, 'not a url'), null);
  writeFileSync(join(v, BLOCKLIST), '{}', 'utf8');
  assert.throws(() => loadBlocklist(v), /invalid meta\/source-blocklist.json/);
  writeBlocklist(v, [{ pattern: 'x', scope: 'host', reason: 'r' }]);
  assert.throws(() => loadBlocklist(v), /invalid meta\/source-blocklist.json: row 0/);
});

test('blocklist identifies malformed JSON in the file diagnostic', () => {
  const v = tmpVault('rv-block-');
  writeBlocklist(v);
  const path = join(v, BLOCKLIST);
  writeFileSync(path, '[');
  assert.throws(() => loadBlocklist(v), /^Error: invalid meta\/source-blocklist\.json: .+/);
  assert.equal(readFileSync(path, 'utf8'), '[');
});

test('blocklist refuses a row with an empty reason', () => {
  const v = tmpVault('rv-block-');
  writeBlocklist(v, [{ ...ROWS[0], reason: '' }]);
  const path = join(v, BLOCKLIST);
  const bytes = readFileSync(path);
  assert.throws(() => loadBlocklist(v), {
    name: 'Error',
    message: 'invalid meta/source-blocklist.json: row 0 needs a pattern, a scope of url or domain and a reason',
  });
  assert.deepEqual(readFileSync(path), bytes);
});

test('blocklist refuses a row with an empty pattern at index 1', () => {
  const v = tmpVault('rv-block-');
  writeBlocklist(v, [ROWS[0], { ...ROWS[1], pattern: '' }]);
  const path = join(v, BLOCKLIST);
  const bytes = readFileSync(path);
  assert.throws(() => loadBlocklist(v), {
    name: 'Error',
    message: 'invalid meta/source-blocklist.json: row 1 needs a pattern, a scope of url or domain and a reason',
  });
  assert.deepEqual(readFileSync(path), bytes);
});

test('blocklist refuses a null row with the row diagnostic', () => {
  const v = tmpVault('rv-block-');
  writeBlocklist(v, [null]);
  const path = join(v, BLOCKLIST);
  const bytes = readFileSync(path);
  assert.throws(() => loadBlocklist(v), {
    name: 'Error',
    message: 'invalid meta/source-blocklist.json: row 0 needs a pattern, a scope of url or domain and a reason',
  });
  assert.deepEqual(readFileSync(path), bytes);
});

test('a url row does not match an empty address', () => {
  assert.equal(matchBlock([ROWS[1]], ''), null);
});

test('a url row does not match an undefined address', () => {
  assert.equal(matchBlock([ROWS[1]], undefined), null);
});

test('a domain row does not match an empty address', () => {
  assert.equal(matchBlock([ROWS[0]], ''), null);
});
