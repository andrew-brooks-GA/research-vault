import https from 'node:https';
import net from 'node:net';
import { sha256 } from './ids.mjs';
import { assertSafeUrl, resolveSafe } from './ssrfguard.mjs';

const MAX_BODY = 5 * 1024 * 1024;
const TIMEOUT_MS = 15000;
const TOTAL_TIMEOUT_MS = 60000;

function pinnedLookup(address, family) {
  return (hostname, options, cb) => {
    const callback = typeof options === 'function' ? options : cb;
    if (options && options.all) callback(null, [{ address, family }]);
    else callback(null, address, family);
  };
}

// A URL host that is already an IP literal has been vetted as public by
// assertSafeUrl; skip DNS and pin the socket to the literal. Bracketed [..]
// hosts are IPv6 whose brackets must be stripped for the socket address, and
// dns.lookup rejects the bracketed form on glibc — so resolving it would make
// every IPv6-literal URL report unreachable.
function literalAddress(hostname) {
  const inner = hostname.startsWith('[') && hostname.endsWith(']')
    ? hostname.slice(1, -1)
    : hostname;
  const family = net.isIP(inner);
  return family ? { address: inner, family } : null;
}

function once(url, { request, lookup, signal }) {
  return new Promise((resolve, reject) => {
    signal.throwIfAborted();
    const u = assertSafeUrl(url);
    let req;
    let settled = false;
    const done = fn => v => {
      if (settled) return;
      settled = true;
      signal.removeEventListener('abort', abort);
      fn(v);
    };
    const ok = done(resolve);
    const fail = done(reject);
    const abort = () => { fail(signal.reason); req?.destroy(); };
    signal.addEventListener('abort', abort, { once: true });
    const literal = literalAddress(u.hostname);
    const resolved = literal ? Promise.resolve([literal]) : resolveSafe(u.hostname, { lookup });
    resolved.then(addrs => {
      if (settled) return; // DNS may finish after the deadline.
      const { address, family } = addrs[0];
      req = request({
        protocol: 'https:',
        hostname: u.hostname,
        port: u.port || 443,
        path: u.pathname + u.search,
        method: 'GET',
        agent: false,
        servername: u.hostname,
        lookup: pinnedLookup(address, family),
        timeout: TIMEOUT_MS,
        headers: { Host: u.hostname, 'User-Agent': 'research-vault-refresh', Accept: '*/*' },
      }, res => {
        res.on('error', fail);
        const status = res.statusCode;
        if (status >= 300 && status < 400 && res.headers.location) {
          try {
            ok({ redirect: new URL(res.headers.location, url).toString(), fromHttps: true });
          } catch {
            fail(new Error('malformed redirect Location'));
          }
          // There is no connection to reuse. Close this hop before following the redirect.
          req.destroy();
          return;
        }
        const chunks = [];
        let len = 0;
        res.on('data', c => {
          len += c.length;
          if (len > MAX_BODY) { req.destroy(new Error('body exceeds max size')); return; }
          chunks.push(c);
        });
        // `body` is for capture's ingest (spec 31); refresh reads only status and hash.
        res.on('end', () => { const body = Buffer.concat(chunks); ok({ status, hash: sha256(body), body }); });
      });
      req.on('timeout', () => req.destroy(new Error('request timeout')));
      req.on('error', fail);
      req.end();
    }).catch(fail);
  });
}

// A file view on a code host is read as the raw file (spec 52 S15): the page as addressed is the
// site's frame, not the file. One host; add a row when a run meets another.
export function rawFileUrl(url) {
  let u;
  try { u = new URL(url); } catch { return url; }
  // The parsed path has its `..` segments resolved, so the file read is in the repo the address names.
  const m = u.protocol === 'https:' && u.hostname === 'github.com' && !u.port && !u.username && /^\/([^/]+)\/([^/]+)\/blob\/(.+)$/.exec(u.pathname);
  return m ? `https://raw.githubusercontent.com/${m[1]}/${m[2]}/${m[3]}` : url;
}

// The result's `url` is the address read: the last redirect's, or the raw file's for a file view.
export async function fetchSource(url, opts = {}) {
  const request = opts.request || https.request;
  const lookup = opts.lookup;
  let maxRedirects = opts.maxRedirects ?? 3;
  const controller = new AbortController();
  const totalTimeoutMs = opts.totalTimeoutMs ?? TOTAL_TIMEOUT_MS;
  const timer = setTimeout(() => controller.abort(new Error(`fetch deadline exceeded (${totalTimeoutMs} ms)`)), totalTimeoutMs);
  try {
    let current = rawFileUrl(url);
    for (;;) {
      const r = await once(current, { request, lookup, signal: controller.signal });
      if (!r.redirect) return { ...r, url: current };
      if (maxRedirects-- <= 0) throw new Error('too many redirects');
      const next = new URL(r.redirect);
      if (next.protocol !== 'https:') throw new Error(`refused redirect scheme downgrade: ${next.protocol}`);
      assertSafeUrl(next.toString());
      current = next.toString();
    }
  } finally {
    clearTimeout(timer);
  }
}
