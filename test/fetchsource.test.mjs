import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { EventEmitter, once } from 'node:events';
import http from 'node:http';
import { setImmediate as nextTurn } from 'node:timers/promises';
import { fetchSource } from '../bin/lib/fetchsource.mjs';
import { sha256 } from '../bin/lib/ids.mjs';
import { testEnv } from './helpers.mjs';

// A fake `res` that plays a scripted status/headers, then optionally emits data.
function fakeRes({ status, headers = {}, data = [] }) {
  const res = new EventEmitter();
  res.statusCode = status;
  res.headers = headers;
  res.resume = () => {};
  res._play = () => {
    for (const chunk of data) res.emit('data', chunk);
    res.emit('end');
  };
  return res;
}

test('the request is given a lookup pinned to the pre-validated address', async () => {
  let resolverCalls = 0;
  const lookup = async () => { resolverCalls++; return [{ address: '93.184.216.34', family: 4 }]; };
  let captured;
  const request = (opts, cb) => {
    captured = opts;
    const req = new EventEmitter();
    req.end = () => {};
    req.destroy = () => {};
    const res = fakeRes({ status: 200, data: [Buffer.from('x')] });
    process.nextTick(() => { cb(res); res._play(); });
    return req;
  };

  const r = await fetchSource('https://example.com/a', { request, lookup });
  assert.deepEqual(r.body, Buffer.from('x'), 'the body is returned for ingest (spec 31)');
  assert.equal(r.hash, sha256(Buffer.from('x')));

  assert.equal(typeof captured.lookup, 'function', 'request must receive a lookup function');

  // Callback shape (host, cb): pinned address regardless of the hostname argument.
  let got;
  captured.lookup('attacker.rebind', (err, address, family) => { got = { err, address, family }; });
  assert.deepEqual(got, { err: null, address: '93.184.216.34', family: 4 });

  // Callback shape (host, options, cb) with all: same pinned address.
  let gotAll;
  captured.lookup('attacker.rebind', { all: true }, (err, addresses) => { gotAll = { err, addresses }; });
  assert.deepEqual(gotAll, { err: null, addresses: [{ address: '93.184.216.34', family: 4 }] });

  assert.equal(resolverCalls, 1, 'resolver must be consulted exactly once per hop');
});

test('the resolver is consulted once per hop across a redirect', async () => {
  const seen = [];
  const lookup = async (host) => { seen.push(host); return [{ address: '93.184.216.34', family: 4 }]; };
  let call = 0;
  const request = (opts, cb) => {
    call++;
    const req = new EventEmitter();
    req.end = () => {};
    req.destroy = () => {};
    const res = call === 1
      ? fakeRes({ status: 302, headers: { location: 'https://second.example/b' } })
      : fakeRes({ status: 200 });
    process.nextTick(() => { cb(res); res._play(); });
    return req;
  };

  await fetchSource('https://first.example/a', { request, lookup });
  assert.equal(seen.length, 2, 'one resolution per hop (two hops)');
  assert.deepEqual(seen, ['first.example', 'second.example']);
});

test('exceeding the redirect cap throws', async () => {
  const lookup = async () => [{ address: '93.184.216.34', family: 4 }];
  let n = 0;
  const request = (opts, cb) => {
    n++;
    const req = new EventEmitter();
    req.end = () => {};
    req.destroy = () => {};
    const res = fakeRes({ status: 302, headers: { location: `https://hop-${n}.example/x` } });
    process.nextTick(() => { cb(res); res._play(); });
    return req;
  };
  await assert.rejects(
    () => fetchSource('https://start.example/a', { request, lookup }),
    /too many redirects/,
  );
  assert.equal(n, 4, 'the 4th redirect (default cap 3) trips the limit');
});

test('an https->http redirect downgrade is refused', async () => {
  const lookup = async () => [{ address: '93.184.216.34', family: 4 }];
  const request = (opts, cb) => {
    const req = new EventEmitter();
    req.end = () => {};
    req.destroy = () => {};
    const res = fakeRes({ status: 302, headers: { location: 'http://plaintext.example/x' } });
    process.nextTick(() => { cb(res); res._play(); });
    return req;
  };
  await assert.rejects(
    () => fetchSource('https://start.example/a', { request, lookup }),
    /scheme downgrade/,
  );
});

test('a body exceeding MAX_BODY destroys the request', async () => {
  const lookup = async () => [{ address: '93.184.216.34', family: 4 }];
  let destroyErr;
  const request = (opts, cb) => {
    const req = new EventEmitter();
    req.end = () => {};
    req.destroy = (e) => { destroyErr = e; req.emit('error', e); };
    const res = fakeRes({ status: 200, data: [Buffer.alloc(6 * 1024 * 1024)] });
    process.nextTick(() => { cb(res); res._play(); });
    return req;
  };
  await assert.rejects(
    () => fetchSource('https://big.example/a', { request, lookup }),
    /body exceeds max size/,
  );
  assert.ok(destroyErr && /body exceeds max size/.test(destroyErr.message));
});

test('a request timeout destroys the request', async () => {
  const lookup = async () => [{ address: '93.184.216.34', family: 4 }];
  let destroyErr;
  const request = (opts) => {
    const req = new EventEmitter();
    // Node fires 'timeout' (not 'error') on the socket timeout; the handler must destroy.
    req.end = () => { process.nextTick(() => req.emit('timeout')); };
    req.destroy = (e) => { destroyErr = e; req.emit('error', e); };
    return req;
  };
  await assert.rejects(
    () => fetchSource('https://slow.example/a', { request, lookup }),
    /request timeout/,
  );
  assert.ok(destroyErr && /request timeout/.test(destroyErr.message));
});

test('the fetch deadline is shared across redirect hops', { timeout: 1000 }, async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  // MockTimers may leave refresh() as a no-op, so check that it is never called.
  const schedule = globalThis.setTimeout;
  const refresh = t.mock.fn(function () { return this; });
  t.mock.method(globalThis, 'setTimeout', (...args) => {
    const timer = schedule(...args);
    timer.refresh = refresh;
    return timer;
  });
  const paths = ['/start', '/second', '/finish'];
  const started = [];
  const request = ({ path }, cb) => {
    const hop = started.push(path);
    const res = hop < paths.length
      ? fakeRes({ status: 302, headers: { location: paths[hop] } })
      : fakeRes({ status: 200 });
    const req = new EventEmitter();
    let timer;
    req.end = () => { timer = setTimeout(() => { cb(res); res._play(); }, 60); };
    req.destroy = () => clearTimeout(timer);
    return req;
  };
  const fetch = fetchSource('https://8.8.8.8/start', { request, totalTimeoutMs: 100 });
  // Each hop takes 60 ms, so the deadline falls during the second hop.
  await nextTurn();
  t.mock.timers.tick(60);
  await nextTurn();
  t.mock.timers.tick(40);
  await assert.rejects(
    Promise.race([fetch, nextTurn()]),
    { message: 'fetch deadline exceeded (100 ms)' },
  );
  assert.equal(refresh.mock.callCount(), 0, 'the deadline timer must not be refreshed');
  assert.deepEqual(started, ['/start', '/second']);
});

test('the fetch deadline ends a lookup that never answers without starting a request', { timeout: 1000 }, async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const lookup = t.mock.fn(() => new Promise(() => {}));
  let requests = 0;
  const request = () => { requests++; throw new Error('unexpected request'); };
  const fetch = fetchSource('https://slow.example/a', { request, lookup, totalTimeoutMs: 25 });
  await nextTurn();
  assert.equal(lookup.mock.callCount(), 1);
  t.mock.timers.tick(25);
  // Give the rejection a turn to reach the caller without waiting forever for a broken deadline.
  await assert.rejects(Promise.race([fetch, nextTurn()]), { message: 'fetch deadline exceeded (25 ms)' });
  assert.equal(requests, 0);
});

test('a lookup that answers after the fetch deadline starts no request', { timeout: 1000 }, async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const { promise, resolve } = Promise.withResolvers();
  const lookup = t.mock.fn(() => promise);
  let requests = 0;
  const request = () => { requests++; throw new Error('unexpected request'); };
  const fetch = fetchSource('https://slow.example/a', { request, lookup, totalTimeoutMs: 25 });
  await nextTurn();
  assert.equal(lookup.mock.callCount(), 1);
  t.mock.timers.tick(25);
  await assert.rejects(fetch, { message: 'fetch deadline exceeded (25 ms)' });
  resolve([{ address: '93.184.216.34', family: 4 }]);
  await nextTurn();
  assert.equal(requests, 0);
});

test('the default fetch deadline expires at 60 seconds', { timeout: 1000 }, async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const lookup = t.mock.fn(() => new Promise(() => {}));
  const request = t.mock.fn(() => { throw new Error('unexpected request'); });
  const fetch = fetchSource('https://slow.example/a', { request, lookup });
  const pending = Symbol('pending');
  t.mock.timers.tick(59999);
  assert.equal(await Promise.race([fetch, nextTurn(pending)]), pending);
  t.mock.timers.tick(1);
  await assert.rejects(Promise.race([fetch, nextTurn()]), { message: 'fetch deadline exceeded (60000 ms)' });
  assert.equal(lookup.mock.callCount(), 1);
  assert.equal(request.mock.callCount(), 0);
});

test('a successful fetch clears the default deadline before the child exits', { timeout: 5000 }, () => {
  const source = new URL('../bin/lib/fetchsource.mjs', import.meta.url);
  const script = `
    import { EventEmitter } from 'node:events';
    import { fetchSource } from ${JSON.stringify(source.href)};
    const request = (opts, respond) => {
      const req = new EventEmitter();
      req.end = () => queueMicrotask(() => {
        const res = new EventEmitter();
        res.statusCode = 200;
        respond(res);
        res.emit('end');
      });
      req.destroy = () => {};
      return req;
    };
    await fetchSource('https://8.8.8.8/a', { request });
  `;
  const limit = 2000;
  const start = performance.now();
  const child = spawnSync(process.execPath, ['--input-type=module', '--eval', script], {
    env: testEnv(), stdio: 'ignore', timeout: limit, killSignal: 'SIGKILL',
  });
  const elapsed = performance.now() - start;
  assert.equal(child.status, 0, `child exit within ${limit} ms (${child.error?.code ?? child.signal ?? child.status})`);
  assert.ok(elapsed < limit, `child took ${Math.round(elapsed)} ms to exit`);
});

test('S-22: a body trickled without end is refused at the total deadline and the server sees the socket close', { timeout: 5000 }, async (t) => {
  const host = '127.0.0.1';
  let bytes = 0;
  const { promise: closed, resolve: socketClosed } = Promise.withResolvers();
  const server = http.createServer((req, res) => {
    res.writeHead(200);
    res.flushHeaders();
    const trickle = setInterval(() => { res.write('x'); bytes++; }, 10);
    req.socket.once('close', () => { clearInterval(trickle); socketClosed(); });
  });
  t.after(() => { server.close(); server.closeAllConnections(); });
  server.listen(0, host);
  await once(server, 'listening');

  const lookup = async () => [{ address: '93.184.216.34', family: 4 }];
  const port = server.address().port;
  // Keep the fetcher's URL and address checks; route only the injected transport to loopback.
  const request = (opts, cb) => http.request({ ...opts, protocol: 'http:', hostname: host, port }, cb);
  const totalTimeoutMs = 500;
  const start = performance.now();
  await assert.rejects(
    fetchSource('https://slow.example/a', { request, lookup, totalTimeoutMs }),
    /fetch deadline exceeded/,
  );
  assert.ok(performance.now() - start < totalTimeoutMs + 500, 'the short deadline ends the fetch promptly');
  await closed;
  assert.ok(bytes > 1, 'the server sent body bytes while the request was open');
});

test('a malformed redirect Location rejects without an uncaught exception', { timeout: 1000 }, async (t) => {
  const uncaught = [];
  const onUncaught = (err) => uncaught.push(err);
  process.on('uncaughtException', onUncaught);
  t.after(() => process.removeListener('uncaughtException', onUncaught));

  const lookup = async () => [{ address: '93.184.216.34', family: 4 }];
  let calls = 0;
  let destroyed = false;
  const request = (opts, cb) => {
    calls++;
    const req = new EventEmitter();
    const res = fakeRes({ status: 302, headers: { location: 'http://[::1' } });
    req.end = () => { process.nextTick(() => cb(res)); };
    req.destroy = () => { destroyed = true; };
    return req;
  };
  await assert.rejects(fetchSource('https://start.example/a', { request, lookup }), /malformed redirect Location/);
  assert.deepEqual(uncaught, []);
  assert.equal(calls, 1, 'no request is sent to the redirect target');
  assert.ok(destroyed, 'the redirect response socket is closed');
});

test('a validated IPv6-literal URL skips DNS and pins the bracket-stripped address', async () => {
  let resolverCalls = 0;
  const lookup = async () => { resolverCalls++; return [{ address: 'should-not-be-used', family: 4 }]; };
  let captured;
  const request = (opts, cb) => {
    captured = opts;
    const req = new EventEmitter();
    req.end = () => {};
    req.destroy = () => {};
    const res = fakeRes({ status: 200 });
    process.nextTick(() => { cb(res); res._play(); });
    return req;
  };

  await fetchSource('https://[2606:4700:4700::1111]/a', { request, lookup });

  assert.equal(resolverCalls, 0, 'an IP literal must not hit DNS');
  let got;
  captured.lookup('whatever', (err, address, family) => { got = { address, family }; });
  assert.deepEqual(got, { address: '2606:4700:4700::1111', family: 6 });
});

// SECURITY.md, Network refresh, SSRF-hardened: no connection pooling, and no cookies or auth headers are ever sent.
// Each hop's request options, captured as above, carry agent: false and no cookie or authorization header, whatever
// the environment holds. The 302 sets a cookie, so a cookie jar carrying it to the next hop fails the test.
test('every hop is requested with agent: false and no cookie or authorization header', async () => {
  const lookup = async () => [{ address: '93.184.216.34', family: 4 }];
  const captured = [];
  const request = (opts, cb) => {
    captured.push(opts);
    const req = new EventEmitter();
    req.end = () => {};
    req.destroy = () => {};
    const res = captured.length === 1 ? fakeRes({ status: 302, headers: { location: 'https://second.example/b', 'set-cookie': ['sid=fixture-cookie; Path=/'] } })
      : fakeRes({ status: 200 });
    process.nextTick(() => { cb(res); res._play(); });
    return req;
  };
  const names = ['HTTP_COOKIE', 'COOKIE', 'HTTP_AUTHORIZATION', 'AUTHORIZATION'];
  const saved = names.map((n) => process.env[n]);
  for (const n of names) process.env[n] = 'fixture-secret';
  try {
    await fetchSource('https://user:fixture-password@first.example/a', { request, lookup });
  } finally {
    names.forEach((n, i) => { if (saved[i] === undefined) delete process.env[n]; else process.env[n] = saved[i]; });
  }
  assert.equal(captured.length, 2);
  for (const opts of captured) {
    assert.equal(opts.agent, false);
    const keys = Object.keys(opts.headers ?? {}).map((k) => k.toLowerCase());
    assert.deepEqual(keys.filter((k) => k === 'cookie' || k === 'authorization'), [], JSON.stringify(opts.headers));
    assert.equal(opts.auth, undefined, 'no user-info sent as auth');
    assert.ok(!JSON.stringify(opts.headers).includes('fixture-'), JSON.stringify(opts.headers));
  }
});
