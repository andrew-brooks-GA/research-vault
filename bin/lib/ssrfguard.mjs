import net from 'node:net';
import dns from 'node:dns/promises';

// RFC 6890 IPv4 special-purpose ranges (non-global).
const v4Special = new net.BlockList();
for (const [network, prefix] of [
  ['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8],
  ['169.254.0.0', 16], ['172.16.0.0', 12], ['192.0.0.0', 24], ['192.0.2.0', 24],
  ['192.88.99.0', 24], ['192.168.0.0', 16], ['198.18.0.0', 15], ['198.51.100.0', 24],
  ['203.0.113.0', 24], ['224.0.0.0', 4], ['240.0.0.0', 4],
]) v4Special.addSubnet(network, prefix, 'ipv4');

// ALLOWLIST posture: a legitimate public IPv6 target is global unicast 2000::/3.
// Everything outside is rejected, which closes ALL embedded-IPv4 variants at once
// (::ffff:a.b.c.d, ::ffff:0:a.b.c.d, ::a.b.c.d are in ::/8, outside 2000::/3), plus
// ::, ::1, fc00::/7 ULA, fe80::/10 link-local, ff00::/8 multicast, 64:ff9b::/96 NAT64.
const v6Global = new net.BlockList();
v6Global.addSubnet('2000::', 3, 'ipv6');
// Special-purpose ranges that live inside 2000::/3. Note 2001:db8::/32 (documentation)
// is OUTSIDE 2001::/23, so it needs its own subnet.
const v6Special = new net.BlockList();
v6Special.addSubnet('2001::', 23, 'ipv6'); // IETF protocol assignments (incl. Teredo 2001::/32)
v6Special.addSubnet('2001:db8::', 32, 'ipv6'); // documentation
v6Special.addSubnet('2002::', 16, 'ipv6'); // 6to4

export function isPublicAddress(ip) {
  const v = net.isIP(ip);
  if (v === 4) return !v4Special.check(ip);
  if (v === 6) return v6Global.check(ip, 'ipv6') && !v6Special.check(ip, 'ipv6');
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
