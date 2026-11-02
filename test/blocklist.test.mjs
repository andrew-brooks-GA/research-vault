import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
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
