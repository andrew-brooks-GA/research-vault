import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, appendFileSync, mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpVault } from './helpers.mjs';
import { appendUsage, readUsage, USAGE_LOG } from '../bin/lib/usagelog.ts';

const NOW = new Date('2026-01-02T03:04:05.006Z');

test('usage log: append one JSON line per event with a timestamp; undefined keys are absent; read returns them in order (spec 29 D1)', () => {
  const v = tmpVault('rv-usage-');
  assert.deepEqual(readUsage(v), []);
  appendUsage(v, { kind: 'queried', via: 'search', ids: ['a'], outcome: 'hits', text: undefined }, NOW);
  appendUsage(v, { kind: 'cited', via: 'post-tool-use', file: 'docs/a.md', id: 'a' }, NOW);
  const lines = readFileSync(join(v, USAGE_LOG), 'utf8').split('\n').filter(Boolean);
  assert.equal(lines.length, 2);
  assert.ok(!lines[0].includes('text'));
  const r = readUsage(v);
  assert.equal(r.length, 2);
  assert.equal(typeof r[0].ts, 'string');
  assert.equal(r[0].kind, 'queried');
  assert.equal(r[1].id, 'a');
  appendFileSync(join(v, USAGE_LOG), 'not json\n');
  assert.equal(readUsage(v).length, 2, 'a line that is not JSON is skipped (spec 30 D0.3)');
});

test('appendUsage writes the supplied timestamp', t => {
  const v = tmpVault('rv-usage-');
  t.after(() => rmSync(v, { recursive: true, force: true }));
  appendUsage(v, { kind: 'queried' }, NOW);
  assert.equal(readFileSync(join(v, USAGE_LOG), 'utf8'), '{"ts":"2026-01-02T03:04:05.006Z","kind":"queried"}\n');
});

for (const [label, times] of [['a missing', []], ['an invalid', [new Date(NaN)]]]) {
  test(`appendUsage refuses ${label} time without creating or appending to the log`, t => {
    const v = tmpVault('rv-usage-');
    t.after(() => rmSync(v, { recursive: true, force: true }));
    const append = () => appendUsage(v, { kind: 'queried' }, ...times);
    const error = { name: 'Error', message: 'appendUsage: now must be a Date' };
    const names = readdirSync(v);
    assert.throws(append, error);
    assert.deepEqual(readdirSync(v), names);

    const log = join(v, USAGE_LOG);
    const folder = join(v, '_index');
    mkdirSync(folder);
    writeFileSync(log, '{"kind":"cited"}\n');
    const logNames = readdirSync(folder);
    const bytes = readFileSync(log);
    assert.throws(append, error);
    assert.deepEqual(readdirSync(folder), logNames);
    assert.deepEqual(readFileSync(log), bytes);
  });
}
