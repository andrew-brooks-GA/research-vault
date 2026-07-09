import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { fetchSource } from '../bin/lib/fetchsource.mjs';

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
    const res = fakeRes({ status: 200 });
    process.nextTick(() => { cb(res); res._play(); });
    return req;
  };

  await fetchSource('https://example.com/a', { request, lookup });

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
