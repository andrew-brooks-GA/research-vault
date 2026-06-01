import https from 'node:https';
import { sha256 } from './ids.mjs';
import { assertSafeUrl, resolveSafe } from './ssrfguard.mjs';

const MAX_BODY = 5 * 1024 * 1024;
const TIMEOUT_MS = 15000;

function pinnedLookup(address, family) {
  return (hostname, options, cb) => {
    const callback = typeof options === 'function' ? options : cb;
    if (options && options.all) callback(null, [{ address, family }]);
    else callback(null, address, family);
  };
}

function once(url, { request, lookup }) {
  return new Promise((resolve, reject) => {
    let settled = false;
    const done = fn => v => { if (!settled) { settled = true; fn(v); } };
    const ok = done(resolve);
    const fail = done(reject);
    const u = assertSafeUrl(url);
    resolveSafe(u.hostname, { lookup }).then(addrs => {
      const { address, family } = addrs[0];
      const req = request({
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
        const status = res.statusCode;
        if (status >= 300 && status < 400 && res.headers.location) {
          res.resume();
          ok({ redirect: new URL(res.headers.location, url).toString(), fromHttps: true });
          return;
        }
        const chunks = [];
        let len = 0;
        res.on('data', c => {
          len += c.length;
          if (len > MAX_BODY) { req.destroy(new Error('body exceeds max size')); return; }
          chunks.push(c);
        });
        res.on('end', () => ok({ status, hash: sha256(Buffer.concat(chunks)) }));
        res.on('error', fail);
      });
      req.on('timeout', () => req.destroy(new Error('request timeout')));
      req.on('error', fail);
      req.end();
    }).catch(fail);
  });
}

export async function fetchSource(url, opts = {}) {
  const request = opts.request || https.request;
  const lookup = opts.lookup;
  let maxRedirects = opts.maxRedirects ?? 3;
  let current = url;
  for (;;) {
    const r = await once(current, { request, lookup });
    if (!r.redirect) return r;
    if (maxRedirects-- <= 0) throw new Error('too many redirects');
    const next = new URL(r.redirect);
    if (next.protocol !== 'https:') throw new Error(`refused redirect scheme downgrade: ${next.protocol}`);
    assertSafeUrl(next.toString());
    current = next.toString();
  }
}
