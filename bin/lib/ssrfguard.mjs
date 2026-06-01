import net from 'node:net';
import dns from 'node:dns/promises';

// RFC 6890 IPv4 special-purpose ranges (non-global). [networkInt, prefixBits]
const V4_RANGES = [
  ['0.0.0.0', 8],
  ['10.0.0.0', 8],
  ['100.64.0.0', 10],
  ['127.0.0.0', 8],
  ['169.254.0.0', 16],
  ['172.16.0.0', 12],
  ['192.0.0.0', 24],
  ['192.0.2.0', 24],
  ['192.88.99.0', 24],
  ['192.168.0.0', 16],
  ['198.18.0.0', 15],
  ['198.51.100.0', 24],
  ['203.0.113.0', 24],
  ['224.0.0.0', 4],
  ['240.0.0.0', 4],
];

function v4ToInt(ip) {
  const parts = ip.split('.');
  if (parts.length !== 4) return null;
  let n = 0;
  for (const p of parts) {
    const o = Number(p);
    if (!/^\d+$/.test(p) || o < 0 || o > 255) return null;
    n = (n * 256) + o;
  }
  return n >>> 0;
}

function v4InRange(n, network, bits) {
  const net0 = v4ToInt(network);
  const mask = bits === 0 ? 0 : (0xffffffff << (32 - bits)) >>> 0;
  return (n & mask) === (net0 & mask);
}

function isPublicV4(ip) {
  const n = v4ToInt(ip);
  if (n === null) return false;
  for (const [network, bits] of V4_RANGES) if (v4InRange(n, network, bits)) return false;
  return true;
}

// Expand an IPv6 literal to 8 hextet integers; handles :: and embedded IPv4.
function v6Hextets(ip) {
  let s = ip;
  let embeddedV4 = null;
  const lastColon = s.lastIndexOf(':');
  const tail = s.slice(lastColon + 1);
  if (tail.includes('.')) {
    if (net.isIPv4(tail) || /^\d+\.\d+\.\d+\.\d+$/.test(tail)) {
      embeddedV4 = tail;
      s = s.slice(0, lastColon + 1) + '0:0';
    }
  }
  const halves = s.split('::');
  if (halves.length > 2) return null;
  const head = halves[0] ? halves[0].split(':') : [];
  const back = halves.length === 2 ? (halves[1] ? halves[1].split(':') : []) : null;
  let groups;
  if (back === null) {
    groups = head;
  } else {
    const fill = 8 - head.length - back.length;
    if (fill < 0) return null;
    groups = [...head, ...Array(fill).fill('0'), ...back];
  }
  if (groups.length !== 8) return null;
  const hextets = groups.map(g => (g === '' ? 0 : parseInt(g, 16)));
  if (hextets.some(h => Number.isNaN(h) || h < 0 || h > 0xffff)) return null;
  return { hextets, embeddedV4 };
}

function isPublicV6(ip) {
  const parsed = v6Hextets(ip);
  if (!parsed) return false;
  const { hextets } = parsed;
  // ALLOWLIST posture: a legitimate public IPv6 target is global unicast 2000::/3.
  // Everything outside is rejected, which closes ALL embedded-IPv4 variants at once
  // (::ffff:a.b.c.d, ::ffff:0:a.b.c.d, ::a.b.c.d are in ::/8, outside 2000::/3), plus
  // ::, ::1, fc00::/7 ULA, fe80::/10 link-local, ff00::/8 multicast, 64:ff9b::/96 NAT64.
  const h0 = hextets[0];
  // (1) Must be within 2000::/3 (top 3 bits == 001).
  if ((h0 & 0xe000) !== 0x2000) return false;
  // (2) Carve out special-purpose ranges that live inside 2000::/3:
  //   2001::/23 — IETF protocol assignments (incl. Teredo 2001::/32).
  if (h0 === 0x2001 && (hextets[1] & 0xfe00) === 0x0000) return false;
  //   2001:db8::/32 — documentation range. Note: 0x0db8 is OUTSIDE 2001::/23
  //   (0x0db8 & 0xfe00 = 0x0c00 != 0), so the /23 test above does NOT cover it;
  //   carve it out explicitly.
  if (h0 === 0x2001 && hextets[1] === 0x0db8) return false;
  //   2002::/16 — 6to4.
  if (h0 === 0x2002) return false;
  return true;
}

export function isPublicAddress(ip) {
  const v = net.isIP(ip);
  if (v === 4) return isPublicV4(ip);
  if (v === 6) return isPublicV6(ip);
  return false;
}

export function assertSafeUrl(url) {
  const u = new URL(url);
  if (u.protocol !== 'https:') throw new Error(`refused non-https url: ${u.protocol}//`);
  // Reject numeric/alt-encoded hostnames that are not clean canonical IP literals.
  // A bracketed [..] host is IPv6; otherwise if the host parses as a single integer,
  // is octal/hex, or "looks numeric" but net.isIP rejects it, refuse it.
  let host = u.hostname;
  if (host.startsWith('[') && host.endsWith(']')) {
    const inner = host.slice(1, -1);
    if (net.isIPv6(inner) && !isPublicAddress(inner)) throw new Error(`refused non-public host: ${host}`);
    return u;
  }
  const looksNumeric = /^[0-9.]+$/.test(host) || /^0x/i.test(host) || /^\d+$/.test(host);
  if (looksNumeric && net.isIPv4(host) === false) {
    throw new Error(`refused non-canonical numeric host: ${host}`);
  }
  if (net.isIPv4(host) && !isPublicAddress(host)) throw new Error(`refused non-public host: ${host}`);
  return u;
}

export async function resolveSafe(host, opts = {}) {
  const lookup = opts.lookup || (h => dns.lookup(h, { all: true }));
  const addrs = await lookup(host);
  const list = Array.isArray(addrs) ? addrs : [addrs];
  if (list.length === 0) throw new Error(`no addresses for host: ${host}`);
  for (const a of list) {
    if (!isPublicAddress(a.address)) throw new Error(`refused private/non-public address ${a.address} for host: ${host}`);
  }
  return list.map(a => ({ address: a.address, family: a.family }));
}
