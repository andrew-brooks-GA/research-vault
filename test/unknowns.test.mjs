import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { errorCode, isRecord, parseJson } from '../bin/lib/unknowns.mjs';

test('parseJson returns a parsed object', () => {
  assert.deepEqual(parseJson('{"value":7}'), { value: 7 });
});

test('parseJson returns a parsed array', () => {
  assert.deepEqual(parseJson('[1,2]'), [1, 2]);
});

test('parseJson returns a parsed scalar', () => {
  assert.equal(parseJson('7'), 7);
});

test('parseJson throws the error JSON.parse throws', (t) => {
  const thrown = new SyntaxError('from JSON.parse');
  t.mock.method(JSON, 'parse', () => { throw thrown; });
  assert.throws(() => parseJson('not json'), (error) => error === thrown);
});

test('parseJson throws a SyntaxError for text that is not JSON', () => {
  assert.throws(() => parseJson('not json'), SyntaxError);
});

test('isRecord accepts a plain object', () => {
  assert.equal(isRecord({}), true);
});

test('isRecord accepts an object with a null prototype', () => {
  assert.equal(isRecord(Object.create(null)), true);
});

test('isRecord rejects null', () => {
  assert.equal(isRecord(null), false);
});

test('isRecord rejects an array', () => {
  assert.equal(isRecord([]), false);
});

test('isRecord rejects a string', () => {
  assert.equal(isRecord('text'), false);
});

test('isRecord rejects a number', () => {
  assert.equal(isRecord(7), false);
});

test('isRecord rejects undefined', () => {
  assert.equal(isRecord(undefined), false);
});

test('isRecord rejects a function', () => {
  assert.equal(isRecord(() => {}), false);
});

test('isRecord rejects a symbol', () => {
  assert.equal(isRecord(Symbol('value')), false);
});

test('isRecord rejects a bigint', () => {
  assert.equal(isRecord(7n), false);
});

test('isRecord rejects a boolean', () => {
  assert.equal(isRecord(true), false);
});

test('errorCode returns ENOENT for a missing file', (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'rv-unknowns-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  assert.throws(() => readFileSync(join(dir, 'missing')), (error) => {
    assert.equal(errorCode(error), 'ENOENT');
    return true;
  });
});

test('errorCode returns undefined for null', () => {
  assert.equal(errorCode(null), undefined);
});

test('errorCode returns undefined for undefined', () => {
  assert.equal(errorCode(undefined), undefined);
});

test('errorCode returns undefined for a string', () => {
  assert.equal(errorCode('ENOENT'), undefined);
});

test('errorCode returns undefined for a number', () => {
  assert.equal(errorCode(7), undefined);
});

test('errorCode returns undefined for an Error without a code', () => {
  assert.equal(errorCode(new Error('missing code')), undefined);
});

test('errorCode returns undefined for a numeric code', () => {
  assert.equal(errorCode({ code: 7 }), undefined);
});

test('errorCode returns the string code of an array', () => {
  const error = [];
  error.code = 'EARRAY';
  assert.equal(errorCode(error), 'EARRAY');
});

test('errorCode returns undefined for a function with a string code', () => {
  const error = Object.assign(() => {}, { code: 'EFUNCTION' });
  assert.equal(errorCode(error), undefined);
});

test('errorCode reads code from a Proxy when its has trap reports it absent', () => {
  const error = new Proxy({}, {
    get: (_target, property) => property === 'code' ? 'EPROXY' : undefined,
    has: () => false,
  });
  assert.equal(errorCode(error), 'EPROXY');
});

test('errorCode returns undefined when reading code throws', () => {
  assert.equal(errorCode({ get code() { throw new Error('unreadable code'); } }), undefined);
});
