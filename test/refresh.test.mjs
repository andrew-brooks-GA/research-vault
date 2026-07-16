import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { mkdtempSync, cpSync, readFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { EventEmitter } from 'node:events';
import { refreshVault, run } from '../bin/commands/refresh.mjs';
import { fetchSource } from '../bin/lib/fetchsource.mjs';
import { buildManifest } from '../bin/lib/manifest.mjs';
import { lintAndReport } from '../bin/commands/lint.mjs';
import { writeEntry } from '../bin/lib/fsutil.mjs';
import { loadSchema, fieldOrder } from '../bin/lib/schema.mjs';

function freshVault() {
  const dir = join(mkdtempSync(join(tmpdir(), 'rv-')), 'v');
  cpSync(fileURLToPath(new URL('./fixtures/vault', import.meta.url)), dir, { recursive: true });
  return dir;
}

function sourceTarget(dir) {
  const e = buildManifest(dir).entries.find(x => x.type === 'source' && x.source_url);
  return e;
}

// Hand-write a stale (fast volatility, last verified 2026-01-01) source directly to
// disk, mirroring the handWrite helper used in lint.test.mjs/capture.test.mjs.
function handWriteStaleSource(dir, id, sourceUrl, extra = {}) {
  const schema = loadSchema(process.cwd());
  const data = {
    title: id, type: 'source', created: '2026-01-01',
    domain: ['software-engineering'], stage: schema.taxonomy.stage_by_folder.sources.default,
    topics: ['x'], status: 'active', related: [], volatility: 'fast',
    source_type: 'article', source_url: sourceUrl,
    verifications: [{ date: '2026-01-01', by_type: 'agent', by_id: '', method: 'human-spot-check', result: 'confirmed', notes: '' }],
    ...extra,
  };
  mkdirSync(join(dir, 'sources'), { recursive: true });
  writeEntry(join(dir, 'sources', `${id}.md`), data, `# ${id}\n`, fieldOrder(schema, 'source'));
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

test('dry-run excludes cli:// probe sources (tool-probe, re-derived locally) but keeps stale https sources', async () => {
  const dir = freshVault();
  handWriteStaleSource(dir, '2020-01-01-probe', 'cli://vcluster/create-help', {
    source_type: 'tool-output', authority_basis: 'tool-output',
    subject: { name: 'vcluster', version: '0.20.0' },
    verifications: [{ date: '2026-01-01', by_type: 'agent', by_id: 'vcluster-cli', method: 'tool-probe', result: 'confirmed', notes: '' }],
  });
  // A stale https source alongside it: proves the guard filters by scheme rather
  // than accidentally excluding every source.
  handWriteStaleSource(dir, '2020-01-02-web', 'https://example.com/stale-web');
  lintAndReport(dir, { check: false });

  const prev = process.env.RESEARCH_VAULT_ALLOW_NETWORK;
  process.env.RESEARCH_VAULT_ALLOW_NETWORK = '1';
  const lines = [];
  const origWrite = process.stdout.write;
  process.stdout.write = (chunk) => { lines.push(String(chunk)); return true; };
  try {
    // Both hand-written sources have volatility fast (refresh_after_days 90) and
    // last_verified 2026-01-01, well past today's date, so both are stale; the probe
    // source would be a gather() candidate but for the scheme guard under test.
    const code = await run({ vault: dir, 'dry-run': true });
    assert.equal(code, 0);
  } finally {
    process.stdout.write = origWrite;
    if (prev !== undefined) process.env.RESEARCH_VAULT_ALLOW_NETWORK = prev;
    else delete process.env.RESEARCH_VAULT_ALLOW_NETWORK;
  }
  const output = lines.join('');
  assert.ok(!output.includes('cli://vcluster/create-help'), 'cli:// probe source must not be a would-fetch candidate:\n' + output);
  assert.ok(output.includes('would-fetch  2020-01-02-web  https://example.com/stale-web'),
    'stale https source must still be a would-fetch candidate:\n' + output);
});
