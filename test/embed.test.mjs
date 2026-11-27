import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { mkdtempSync, cpSync, writeFileSync, existsSync, readFileSync, mkdirSync, readdirSync, realpathSync, rmSync, symlinkSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { embedTexts, cosine, readIndex, INDEX } from '../bin/lib/embed.mjs';
import { run as embedRun } from '../bin/commands/embed.mjs';
import { captureEntry } from '../bin/commands/capture.mjs';
import { applyVerification } from '../bin/commands/verify.mjs';
import { REPO_ROOT, testEnv, tmpVault, put } from './helpers.mjs';
import { VAULT_PATH_OUTSIDE } from '../bin/lib/containment.mjs';

export const LOOPBACK_ENDPOINT = 'http://127.0.0.1:1/v1/embeddings';
export const HTTPS_ENDPOINT = 'https://embed.example.test/';

export function freshVault() {
  const dir = join(mkdtempSync(join(tmpdir(), 'rv-embed-')), 'v');
  cpSync(fileURLToPath(new URL('./fixtures/vault', import.meta.url)), dir, { recursive: true });
  return dir;
}

// A bound scratch repo: its .research-vault.json carries the vault path and the embedding block.
export function boundRepo(vault, embedding = { url: LOOPBACK_ENDPOINT, model: 'fake' }) {
  const repo = mkdtempSync(join(tmpdir(), 'rv-embed-repo-'));
  writeFileSync(join(repo, '.research-vault.json'), JSON.stringify({ vault, embedding }), 'utf8');
  return repo;
}

// The fake endpoint: a vector of counts over a fixed vocabulary, so the ranking is predictable.
export const VOCAB = ['zig', 'kubernetes', 'scheduler'];
export const vec = (t) => VOCAB.map(w => (t.toLowerCase().match(new RegExp(w, 'g')) || []).length);
export function fakeFetch(calls = [], shape = 'data') {
  return async (url, init) => {
    const body = JSON.parse(init.body);
    calls.push({ url, method: init.method, headers: init.headers, body });
    const vectors = body.input.map(vec);
    return { ok: true, status: 200, json: async () => shape === 'data' ? { data: vectors.map(embedding => ({ embedding })) } : { embeddings: vectors } };
  };
}

function withNetwork(fn) {
  const saved = process.env.RESEARCH_VAULT_ALLOW_NETWORK;
  process.env.RESEARCH_VAULT_ALLOW_NETWORK = '1';
  return fn().finally(() => { if (saved === undefined) delete process.env.RESEARCH_VAULT_ALLOW_NETWORK; else process.env.RESEARCH_VAULT_ALLOW_NETWORK = saved; });
}

test('embed refuses an index file linked outside an ordinary index folder', async (t) => {
  embeddingEnv(t);
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'rv-embed-link-')));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const vault = join(root, 'vault');
  cpSync(fileURLToPath(new URL('./fixtures/vault', import.meta.url)), vault, { recursive: true });
  const outside = join(root, 'outside');
  mkdirSync(outside);
  mkdirSync(join(vault, '_index'));
  const other = join(outside, 'index.jsonl');
  const bytes = Buffer.from('outside index fixture\r\n');
  writeFileSync(other, bytes);
  try {
    symlinkSync(other, join(vault, INDEX), 'file');
  } catch (err) {
    if (process.platform !== 'win32' || !['EPERM', 'EACCES', 'ENOSYS', 'ENOTSUP'].includes(err.code)) throw err;
    t.skip(`File symlink unavailable (${err.code})`);
    return;
  }
  const names = readdirSync(outside).sort();
  const cwd = boundRepo(vault);
  t.after(() => rmSync(cwd, { recursive: true, force: true }));
  const calls = [];
  try {
    await assert.rejects(recordEmbeddingRun(embedRun, { vault, cwd, fetch: fakeFetch(calls) }), { code: VAULT_PATH_OUTSIDE });
    assert.ok(calls.length > 0, 'the injected endpoint supplied the vectors');
  } finally {
    assert.deepEqual(readdirSync(outside).sort(), names, 'outside folder names are unchanged');
    assert.deepEqual(readFileSync(other), bytes, 'outside index bytes are unchanged');
  }
});

export function embeddingEnv(t, approved = LOOPBACK_ENDPOINT, key) {
  for (const [name, value] of Object.entries({ RESEARCH_VAULT_ALLOW_NETWORK: '1', RESEARCH_VAULT_EMBED_URL: approved, RESEARCH_VAULT_EMBED_KEY: key })) {
    const saved = process.env[name];
    if (value === undefined) delete process.env[name]; else process.env[name] = value;
    t.after(() => { if (saved === undefined) delete process.env[name]; else process.env[name] = saved; });
  }
}

// Record the stderr already written when each injected request starts.
export async function recordEmbeddingRun(run, { fetch = fakeFetch(), ...args }) {
  const so = process.stdout.write, se = process.stderr.write;
  const calls = [];
  let stdout = '', stderr = '';
  process.stdout.write = (s) => { stdout += s; return true; };
  process.stderr.write = (s) => { stderr += s; return true; };
  try {
    const status = await run({ 'ack-data-egress': true, ...args, fetch: (url, init) => {
      calls.push({ url, init, stderr });
      return fetch(url, init);
    } });
    return { status, stdout, stderr, calls };
  } finally { process.stdout.write = so; process.stderr.write = se; }
}

test('embedTexts posts { input, model } as JSON, adds the bearer key only when set, reads both response shapes, and throws on a bad status or count (spec 34 D2)', async (t) => {
  const cfg = { url: 'https://h/e', model: 'm' };
  embeddingEnv(t, cfg.url);
  const calls = [];
  const v = await embedTexts(cfg, ['zig zig', 'kubernetes'], { fetch: fakeFetch(calls) });
  assert.deepEqual(v, [[2, 0, 0], [0, 1, 0]]);
  assert.deepEqual(calls[0], { url: cfg.url, method: 'POST', headers: { 'Content-Type': 'application/json' }, body: { input: ['zig zig', 'kubernetes'], model: 'm' } });
  process.env.RESEARCH_VAULT_EMBED_KEY = 'k';
  await embedTexts(cfg, ['x'], { fetch: fakeFetch(calls) });
  assert.equal(calls[1].headers.Authorization, 'Bearer k');
  assert.deepEqual(await embedTexts(cfg, ['scheduler'], { fetch: fakeFetch([], 'embeddings') }), [[0, 0, 1]]);
  await assert.rejects(embedTexts(cfg, ['x'], { fetch: async () => ({ ok: false, status: 500 }) }), /embedding endpoint 500/);
  await assert.rejects(embedTexts(cfg, ['x', 'y'], { fetch: async () => ({ ok: true, status: 200, json: async () => ({ data: [{ embedding: [1] }] }) }) }), /1 vectors for 2 texts/);
  assert.equal(cosine([1, 0], [1, 0]), 1);
  assert.equal(cosine([1, 0], [0, 1]), 0);
});

test('embed writes the index (a header, one row per window, superseded entries left out) and refuses without the block, the variable or the ack (spec 34 D2)', async (t) => {
  embeddingEnv(t);
  const dir = freshVault();
  captureEntry(dir, { type: 'note', title: 'Zig writer', sources: ['2026-01-01-a'], summary: 'zig', body: 'zig zig zig' });
  const gone = captureEntry(dir, { type: 'note', title: 'Old zig', sources: ['2026-01-01-a'], summary: 'zig', body: 'zig' });
  applyVerification(dir, { id: gone.id, method: 'cross-referenced', result: 'outdated', supersededBy: '2026-01-01-a', repoRoot: REPO_ROOT });
  const repo = boundRepo(dir);
  const orig = process.stdout.write.bind(process.stdout), origErr = process.stderr.write.bind(process.stderr);
  const errs = [];
  process.stdout.write = () => true; process.stderr.write = (s) => { errs.push(s); return true; };
  try {
    delete process.env.RESEARCH_VAULT_ALLOW_NETWORK;
    assert.equal(await embedRun({ vault: dir, cwd: repo, 'ack-data-egress': true, fetch: fakeFetch() }), 1);
    assert.match(errs.at(-1), /RESEARCH_VAULT_ALLOW_NETWORK/);
    await withNetwork(async () => {
      assert.equal(await embedRun({ vault: dir, cwd: repo, fetch: fakeFetch() }), 1);
      assert.match(errs.at(-1), /--ack-data-egress/);
      assert.ok(!existsSync(join(dir, INDEX)));
      assert.equal(await embedRun({ vault: dir, cwd: mkdtempSync(join(tmpdir(), 'rv-unbound-')), 'ack-data-egress': true, fetch: fakeFetch() }), 1);
      assert.match(errs.at(-1), /no embedding endpoint/);
      const calls = [];
      assert.equal(await embedRun({ vault: dir, cwd: repo, 'ack-data-egress': true, fetch: fakeFetch(calls) }), 0);
      assert.ok(calls.length >= 1);
    });
  } finally { process.stdout.write = orig; process.stderr.write = origErr; }
  const index = readIndex(dir);
  assert.deepEqual(Object.keys(index.header), ['url', 'model', 'dimensions', 'chunk', 'overlap', 'built']);
  assert.equal(index.header.dimensions, 3);
  assert.ok(index.rows.length > 0);
  assert.ok(index.rows.every(r => typeof r.id === 'string' && 'index' in r.chunk && typeof r.text === 'string' && r.vector.length === 3));
  assert.ok(!index.rows.some(r => r.id === gone.id), 'the superseded entry is not indexed');
  assert.equal(readIndex(freshVault()), null);
});

export const unapprovedUrls = [
  ['unset', undefined], ['empty', ''], ['invalid', 'not a URL'],
  ['different host', 'https://other.example.test/'], ['different path', `${HTTPS_ENDPOINT}other`],
  ['different query', `${HTTPS_ENDPOINT}?different=1`], ['different port', 'https://embed.example.test:8443/'],
];

export function assertEmbeddingRefusal(result, name, reason) {
  assert.equal(result.stderr, `${name} refused: ${reason}\n`);
  assert.equal(result.status, 1);
  assert.equal(result.stdout, '');
  assert.deepEqual(result.calls, []);
}

test('embed refuses an unset, empty, invalid or different approved URL', async (t) => {
  embeddingEnv(t);
  const vault = freshVault();
  const cwd = boundRepo(vault, { url: HTTPS_ENDPOINT });
  for (const [label, url] of unapprovedUrls) await t.test(label, async () => {
    if (url === undefined) delete process.env.RESEARCH_VAULT_EMBED_URL;
    else process.env.RESEARCH_VAULT_EMBED_URL = url;
    assertEmbeddingRefusal(await recordEmbeddingRun(embedRun, { vault, cwd }), 'embed', `set RESEARCH_VAULT_EMBED_URL to ${HTTPS_ENDPOINT} to allow this embedding endpoint`);
    assert.equal(existsSync(join(vault, INDEX)), false);
  });
});

test('embed sends to the approved HTTPS or loopback HTTP URL and shows the counts before fetching', async (t) => {
  embeddingEnv(t, LOOPBACK_ENDPOINT, 'test-key');
  for (const address of ['HTTPS://EMBED.EXAMPLE.TEST:443', 'http://127.0.0.1:1/', 'http://127.2.3.4:1/', 'http://localhost:1/', 'http://[::1]:1/']) {
    const url = new URL(address).href;
    process.env.RESEARCH_VAULT_EMBED_URL = url;
    const vault = freshVault();
    const result = await recordEmbeddingRun(embedRun, { vault, cwd: boundRepo(vault, { url: address }) });
    assert.equal(result.status, 0, result.stderr);
    const { rows } = readIndex(vault);
    const counts = `${rows.length} windows of ${new Set(rows.map(r => r.id)).size} entries`;
    assert.equal(result.stdout, `embedded ${counts} into ${INDEX}\n`);
    assert.equal(result.stderr, `embed: sending ${counts} to ${url}\n`);
    assert.ok(result.calls.length > 0);
    for (const call of result.calls) {
      assert.equal(call.url, url);
      assert.equal(call.init.headers.Authorization, 'Bearer test-key');
      assert.equal(call.stderr, result.stderr);
    }
  }
});

export const refusedEndpoints = [
  ['http://127.0.0.1.example.test/', 'embedding endpoint http://127.0.0.1.example.test/ must use HTTPS or loopback HTTP'],
  ...['localhost.', 'foo.localhost', '0.0.0.0', '128.0.0.1', '[::ffff:127.0.0.1]'].map(host => {
    const url = `http://${host}/`;
    return [url, `embedding endpoint ${new URL(url).href} must use HTTPS or loopback HTTP`];
  }),
  ['https://user:fixture-password@embed.example.test/', `embedding endpoint ${HTTPS_ENDPOINT} must not contain user-info`],
  ['https://@embed.example.test/', `embedding endpoint ${HTTPS_ENDPOINT} must not contain user-info`],
];

test('embed refuses non-loopback HTTP and URLs with user-info, including in direct calls', async (t) => {
  embeddingEnv(t);
  for (const [url, reason] of refusedEndpoints) {
    process.env.RESEARCH_VAULT_EMBED_URL = url;
    const vault = freshVault();
    assertEmbeddingRefusal(await recordEmbeddingRun(embedRun, { vault, cwd: boundRepo(vault, { url }) }), 'embed', reason);
    const calls = [];
    await assert.rejects(embedTexts({ url }, ['zig'], { fetch: fakeFetch(calls) }), { message: reason });
    assert.deepEqual(calls, []);
    assert.equal(existsSync(join(vault, INDEX)), false);
  }
});

test('embedTexts refuses a URL without matching approval before serialising the payload', async (t) => {
  embeddingEnv(t, 'https://other.example.test/');
  const calls = [];
  const texts = ['zig'];
  texts.toJSON = () => { assert.fail('the payload was serialised'); };
  await assert.rejects(embedTexts({ url: HTTPS_ENDPOINT }, texts, { fetch: fakeFetch(calls) }), /set RESEARCH_VAULT_EMBED_URL/);
  assert.deepEqual(calls, []);
});

test('embed keeps its first two opt-in refusals in order and omits URL credentials', async (t) => {
  embeddingEnv(t, '');
  delete process.env.RESEARCH_VAULT_ALLOW_NETWORK;
  const vault = freshVault();
  const cwd = boundRepo(vault, { url: 'https://user:fixture-password@embed.example.test/' });
  const args = { vault, cwd, 'ack-data-egress': false };
  assertEmbeddingRefusal(await recordEmbeddingRun(embedRun, args), 'embed', `set RESEARCH_VAULT_ALLOW_NETWORK=1 to send text to ${HTTPS_ENDPOINT}`);
  process.env.RESEARCH_VAULT_ALLOW_NETWORK = '1';
  assertEmbeddingRefusal(await recordEmbeddingRun(embedRun, args), 'embed', `--ack-data-egress is required (the text leaves this process for ${HTTPS_ENDPOINT})`);
  assert.equal(existsSync(join(vault, INDEX)), false);
});

export const normalisedEndpoints = [
  ['uppercase host and default port', 'https://EMBED.EXAMPLE.TEST:443', HTTPS_ENDPOINT],
  ['tab in host', 'https://em\tbed.example.test/', HTTPS_ENDPOINT],
  ['non-ASCII host', 'https://m\u00fcnich.example.test/', 'https://xn--mnich-kva.example.test/'],
  ['controls and Unicode in path', `${HTTPS_ENDPOINT}a\u007f\u202e\ud800\u2028\u2029`, `${HTTPS_ENDPOINT}a%7F%E2%80%AE%EF%BF%BD%E2%80%A8%E2%80%A9`],
];

test('embed prints the normalised address in refusals and before fetching', async (t) => {
  for (const [label, address, url] of normalisedEndpoints) await t.test(label, async (t) => {
    embeddingEnv(t, '');
    const vault = freshVault();
    const args = { vault, cwd: boundRepo(vault, { url: address }) };
    delete process.env.RESEARCH_VAULT_ALLOW_NETWORK;
    assertEmbeddingRefusal(await recordEmbeddingRun(embedRun, args), 'embed', `set RESEARCH_VAULT_ALLOW_NETWORK=1 to send text to ${url}`);
    process.env.RESEARCH_VAULT_ALLOW_NETWORK = '1';
    assertEmbeddingRefusal(await recordEmbeddingRun(embedRun, { ...args, 'ack-data-egress': false }), 'embed', `--ack-data-egress is required (the text leaves this process for ${url})`);
    const refused = await recordEmbeddingRun(embedRun, args);
    assertEmbeddingRefusal(refused, 'embed', `set RESEARCH_VAULT_EMBED_URL to ${url} to allow this embedding endpoint`);
    process.env.RESEARCH_VAULT_EMBED_URL = refused.stderr.match(/ to (\S+) to allow this embedding endpoint\n$/)[1];
    const allowed = await recordEmbeddingRun(embedRun, args);
    assert.equal(allowed.status, 0, allowed.stderr);
    const { rows } = readIndex(vault);
    assert.equal(allowed.stderr, `embed: sending ${rows.length} windows of ${new Set(rows.map(r => r.id)).size} entries to ${url}\n`);
    assert.ok(allowed.calls.length > 0);
    assert.ok(allowed.calls.every(call => call.url === url && call.stderr === allowed.stderr));
  });
});

const replyText = 'fixture reply text\u001b\nsecond line';
export const refusedEmbeddingReplies = [
  ['HTTP error', () => new Response(replyText, { status: 503 }), 'embedding endpoint 503'],
  ['invalid HTTP status', () => ({ ok: false, status: replyText }), 'embedding endpoint request failed'],
  ['invalid JSON', () => new Response(replyText), 'embedding endpoint returned invalid JSON'],
  ['missing vector list', () => Response.json({ detail: replyText }), count => `embedding endpoint returned no vectors for ${count} texts`],
  ['wrong vector count', () => Response.json({ embeddings: [], detail: replyText }), count => `embedding endpoint returned 0 vectors for ${count} texts`],
  ['non-array vector list', () => Response.json({ embeddings: { length: replyText } }), count => `embedding endpoint returned no vectors for ${count} texts`],
  ['invalid vector', count => Response.json({ data: Array.from({ length: count }, () => ({ embedding: replyText })) }), 'embedding endpoint returned an invalid vector'],
];

export function assertEmbeddingReplyRefusal(result, name, reason) {
  assert.equal(result.calls.length, 1);
  const [call] = result.calls;
  const count = JSON.parse(call.init.body).input.length;
  const message = typeof reason === 'function' ? reason(count) : reason;
  assert.equal(result.stderr, `${call.stderr}${name} refused: ${message}\n`);
  assert.equal(result.status, 1);
  assert.equal(result.stdout, '');
}

test('embed refuses unusable replies with one fixed error line and no index', async (t) => {
  embeddingEnv(t, HTTPS_ENDPOINT);
  for (const [label, reply, reason] of refusedEmbeddingReplies) await t.test(label, async () => {
    const vault = freshVault();
    const cwd = boundRepo(vault, { url: HTTPS_ENDPOINT });
    const fetch = async (_url, init) => reply(JSON.parse(init.body).input.length);
    assertEmbeddingReplyRefusal(await recordEmbeddingRun(embedRun, { vault, cwd, fetch }), 'embed', reason);
    assert.equal(existsSync(join(vault, INDEX)), false);
  });
});

test('embed refuses a rejected redirect without printing its location or writing an index', async (t) => {
  embeddingEnv(t, HTTPS_ENDPOINT);
  const vault = freshVault();
  const result = await recordEmbeddingRun(embedRun, { vault, cwd: boundRepo(vault, { url: HTTPS_ENDPOINT }), fetch: async () => {
    throw new Error('redirect to https://redirect.example.test/');
  } });
  assert.equal(result.status, 1);
  assert.equal(result.stdout, '');
  assert.equal(result.calls.length, 1);
  assert.equal(result.calls[0].init.redirect, 'error');
  assert.equal(result.stderr, `${result.calls[0].stderr}embed refused: embedding endpoint request failed\n`);
  assert.equal(existsSync(join(vault, INDEX)), false);
});

test('CLI embed refuses an endpoint without URL approval', () => {
  // The vault is empty, so this fixture cannot reach fetch even if the refusal is absent.
  const vault = mkdtempSync(join(tmpdir(), 'rv-empty-embed-'));
  const cwd = boundRepo(vault, { url: HTTPS_ENDPOINT });
  const cli = fileURLToPath(new URL('../bin/research-vault.mjs', import.meta.url));
  const result = spawnSync(process.execPath, [cli, 'embed', '--vault', vault, '--ack-data-egress'], {
    cwd, env: testEnv({ RESEARCH_VAULT_ALLOW_NETWORK: '1' }), encoding: 'utf8',
  });
  assert.equal(result.stderr, `embed refused: set RESEARCH_VAULT_EMBED_URL to ${HTTPS_ENDPOINT} to allow this embedding endpoint\n`);
  assert.equal(result.status, 1);
  assert.equal(result.stdout, '');
  assert.equal(existsSync(join(vault, INDEX)), false);
});

test('CLI embed refuses an unapproved address before resolving the bound vault', () => {
  const cwd = boundRepo('missing\0vault', { url: HTTPS_ENDPOINT });
  const cli = fileURLToPath(new URL('../bin/research-vault.mjs', import.meta.url));
  const run = approved => spawnSync(process.execPath, [cli, 'embed', '--ack-data-egress'], {
    cwd, env: testEnv({ RESEARCH_VAULT_ALLOW_NETWORK: '1', RESEARCH_VAULT_EMBED_URL: approved }), encoding: 'utf8',
  });
  const refused = run();
  assert.equal(refused.stderr, `embed refused: set RESEARCH_VAULT_EMBED_URL to ${HTTPS_ENDPOINT} to allow this embedding endpoint\n`);
  assert.equal(refused.status, 1);
  assert.equal(refused.stdout, '');
  const approved = run(HTTPS_ENDPOINT);
  assert.equal(approved.status, 2, approved.stderr);
  assert.match(approved.stderr, /vault that could not be resolved/);
});

// SECURITY.md, Embedding endpoint, "What leaves the machine": embed sends the windows in batches of 64, one POST per
// batch, as { input, model }, and nothing else. A loopback stub endpoint records each request; 130 one-window
// entries make three batches. The CLI runs as a child process (the stub serves from this one). The inputs sent, in
// order, are the index's text fields; each request carries the header names of a bare fetch POST of JSON to the same
// stub. The vault's files are compared, by path and bytes, before and after.
test('embed POSTs 130 windows as batches of 64, 64 and 2 to the endpoint path, { input, model } only, and changes no entry', { timeout: 60000 }, async (t) => {
  const vault = tmpVault('rv-embed-batches-');
  for (let i = 0; i < 130; i++) put(vault, 'source', `2026-01-01-e${String(i).padStart(3, '0')}`, { source_type: 'article', source_url: `https://example.org/${i}` });
  const requests = [];
  const server = createServer((req, res) => {
    let body = '';
    req.setEncoding('utf8');
    req.on('data', (c) => { body += c; });
    req.on('end', () => {
      const parsed = JSON.parse(body);
      requests.push({ method: req.method, url: req.url, headers: req.headers, body: parsed });
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ data: parsed.input.map(() => ({ embedding: [1, 0] })) }));
    });
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => { server.closeAllConnections(); server.close(); });
  const url = `http://127.0.0.1:${server.address().port}/v1/embeddings`;
  const files = () => readdirSync(vault, { recursive: true }).sort().map((f) => [f, statSync(join(vault, f)).isFile() ? readFileSync(join(vault, f)).toString('base64') : 'dir']);
  const before = files();
  const cli = fileURLToPath(new URL('../bin/research-vault.mjs', import.meta.url));
  const child = spawn(process.execPath, [cli, 'embed', '--vault', vault, '--ack-data-egress'], {
    cwd: boundRepo(vault, { url, model: 'fake' }), timeout: 30000, stdio: ['ignore', 'pipe', 'pipe'],
    env: testEnv({ RESEARCH_VAULT_ALLOW_NETWORK: '1', RESEARCH_VAULT_EMBED_URL: url }),
  });
  t.after(() => child.kill('SIGKILL'));
  let stderr = '';
  child.stderr.setEncoding('utf8');
  child.stderr.on('data', (c) => { stderr += c; });
  child.stdout.resume();
  const [status] = await once(child, 'exit');
  assert.equal(status, 0, stderr);
  const sent = requests.splice(0);
  const bare = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ input: ['x'], model: 'fake' }), signal: AbortSignal.timeout(5000) });
  await bare.text();
  const names = (r) => Object.keys(r.headers).filter((k) => k !== 'content-length').sort();
  const bareNames = names(requests[0]);
  console.log(`requests: ${JSON.stringify(sent.map((r) => [r.method, r.url, r.body.input.length]))}; bare fetch headers: ${bareNames}`);
  assert.deepEqual(sent.map((r) => [r.method, r.url, r.body.input.length]), [['POST', '/v1/embeddings', 64], ['POST', '/v1/embeddings', 64], ['POST', '/v1/embeddings', 2]]);
  for (const r of sent) {
    assert.deepEqual(Object.keys(r.body), ['input', 'model']);
    assert.equal(r.body.model, 'fake');
    assert.equal(r.headers['content-type'], 'application/json');
    assert.deepEqual(names(r), bareNames, 'the header names of a bare fetch, nothing added');
  }
  const indexed = readFileSync(join(vault, INDEX), 'utf8').trim().split('\n').slice(1).map((l) => JSON.parse(l).text);
  assert.equal(indexed.length, 130);
  assert.deepEqual(sent.flatMap((r) => r.body.input), indexed, 'the inputs sent, in order, are the index texts');
  assert.equal(new Set(indexed).size, 130, 'each window sent once');
  const after = new Map(files());
  const changed = [...new Set([...before.map(([f]) => f), ...after.keys()])].filter((f) => new Map(before).get(f) !== after.get(f)).sort();
  assert.deepEqual(changed, ['_index', INDEX], 'only the index is written');
});
