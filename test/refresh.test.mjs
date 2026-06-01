import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { mkdtempSync, cpSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { EventEmitter } from 'node:events';
import { refreshVault, run } from '../bin/commands/refresh.mjs';
import { fetchSource } from '../bin/lib/fetchsource.mjs';
import { buildManifest } from '../bin/lib/manifest.mjs';
import { lintAndReport } from '../bin/commands/lint.mjs';

function freshVault() {
  const dir = join(mkdtempSync(join(tmpdir(), 'rv-')), 'v');
  cpSync(fileURLToPath(new URL('./fixtures/vault', import.meta.url)), dir, { recursive: true });
  return dir;
}

function sourceTarget(dir) {
  const e = buildManifest(dir).entries.find(x => x.type === 'source' && x.source_url);
  return e;
}

test('matching hash -> confirmed', async () => {
  const dir = freshVault();
  const e = sourceTarget(dir);
  const fetch = async () => ({ status: 200, hash: e.content_hash });
  const [r] = await refreshVault(dir, { targets: [e], fetch });
  assert.equal(r.result, 'confirmed');
});

test('differing hash -> changed', async () => {
  const dir = freshVault();
  const e = sourceTarget(dir);
  const fetch = async () => ({ status: 200, hash: 'sha256:deadbeef' });
  const [r] = await refreshVault(dir, { targets: [e], fetch });
  assert.equal(r.result, 'changed');
});

test('thrown fetch -> unreachable', async () => {
  const dir = freshVault();
  const e = sourceTarget(dir);
  const fetch = async () => { throw new Error('boom'); };
  const [r] = await refreshVault(dir, { targets: [e], fetch });
  assert.equal(r.result, 'unreachable');
});

test('redirect to a private IP is rejected by fetchSource', async () => {
  // First response: 302 to a host that resolves to a private IP.
  // lookup returns public for the first host, private for the redirect target.
  const lookup = async (host) => host === 'start.example'
    ? [{ address: '8.8.8.8', family: 4 }]
    : [{ address: '10.0.0.1', family: 4 }];
  let call = 0;
  const request = (opts, cb) => {
    call++;
    const req = new EventEmitter();
    req.end = () => {};
    req.destroy = () => {};
    const res = new EventEmitter();
    res.statusCode = 302;
    res.headers = { location: 'https://evil.example/x' };
    res.resume = () => {};
    process.nextTick(() => cb(res));
    return req;
  };
  await assert.rejects(
    () => fetchSource('https://start.example/a', { request, lookup }),
    /private|non-public|address/i,
  );
  assert.equal(call, 1, 'must not issue the request to the private redirect target');
});

test('a refresh run leaves the vault byte-identical and lint-clean', async () => {
  const dir = freshVault();
  // establish a baseline manifest (fresh fixture copy has none)
  lintAndReport(dir, { check: false });
  const srcPath = join(dir, 'sources', '2026-01-01-a.md');
  const before = readFileSync(srcPath);

  const e = sourceTarget(dir);
  const fetch = async () => ({ status: 200, hash: 'sha256:deadbeef' });
  await refreshVault(dir, { targets: [e], fetch });

  const after = readFileSync(srcPath);
  assert.ok(before.equals(after), 'source entry must be byte-identical after refresh');
  const { violations } = lintAndReport(dir, { check: true });
  assert.equal(violations.length, 0, 'vault must be unchanged/lint-clean: ' + JSON.stringify(violations));
});

test('run() refuses without RESEARCH_VAULT_ALLOW_NETWORK and never fetches', async () => {
  const dir = freshVault();
  lintAndReport(dir, { check: false });
  const prev = process.env.RESEARCH_VAULT_ALLOW_NETWORK;
  delete process.env.RESEARCH_VAULT_ALLOW_NETWORK;
  let fetched = false;
  const origWrite = process.stderr.write;
  process.stderr.write = () => true;
  try {
    const code = await run({ vault: dir, fetch: () => { fetched = true; } });
    assert.equal(code, 1);
    assert.equal(fetched, false);
  } finally {
    process.stderr.write = origWrite;
    if (prev !== undefined) process.env.RESEARCH_VAULT_ALLOW_NETWORK = prev;
  }
});
