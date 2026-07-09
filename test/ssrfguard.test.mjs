import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isPublicAddress, assertSafeUrl, resolveSafe } from '../bin/lib/ssrfguard.mjs';

const REJECT_V4 = [
  '0.0.0.0', '0.255.255.255',
  '10.0.0.1',
  '100.64.0.1',
  '127.0.0.1',
  '169.254.169.254', '169.254.0.1',
  '172.16.0.1', '172.31.255.255',
  '192.0.0.1',
  '192.0.2.1', '198.51.100.1', '203.0.113.1',
  '192.168.1.1',
  '198.18.0.1',
  '224.0.0.1',
  '240.0.0.1', '255.255.255.255',
];
const ACCEPT_V4 = ['8.8.8.8', '1.1.1.1', '93.184.216.34'];
const REJECT_V6 = [
  '::', '::1',
  '::ffff:127.0.0.1', '::ffff:10.0.0.1',
  '2001:db8::1',
  'fc00::1', 'fd00::1',
  'fe80::1',
  'ff02::1',
  // 6to4 (2002::/16) embedding private v4 — must reject (whole-range reject)
  '2002:0a00:0001::1',   // embeds 10.0.0.1
  '2002:c0a8:0101::1',   // embeds 192.168.1.1
  // 6to4 embedding a PUBLIC v4 — still reject because we refuse the whole range
  '2002:0808:0808::1',   // embeds 8.8.8.8
  // NAT64 (64:ff9b::/96) embedding private v4 — must reject (whole-range reject)
  '64:ff9b::0a00:0001',  // embeds 10.0.0.1
  // IPv4-translated form ::ffff:0:0/96 (allowlist closes these)
  '::ffff:0:7f00:1',     // translated 127.0.0.1
  '::ffff:0:a9fe:a9fe',  // translated 169.254.169.254 metadata
  // IPv4-compatible (deprecated) ::a.b.c.d
  '::7f00:1',            // 127.0.0.1
  // Teredo (2001::/32, inside 2001::/23)
  '2001::1',
];
const ACCEPT_V6 = ['2606:4700:4700::1111', '2001:4860:4860::8888'];

test('isPublicAddress rejects every non-global IPv4 range', () => {
  for (const ip of REJECT_V4) assert.equal(isPublicAddress(ip), false, `should reject ${ip}`);
});

test('isPublicAddress accepts global unicast IPv4', () => {
  for (const ip of ACCEPT_V4) assert.equal(isPublicAddress(ip), true, `should accept ${ip}`);
});

test('isPublicAddress rejects every non-global IPv6 range (incl IPv4-mapped)', () => {
  for (const ip of REJECT_V6) assert.equal(isPublicAddress(ip), false, `should reject ${ip}`);
});

test('isPublicAddress accepts global unicast IPv6', () => {
  for (const ip of ACCEPT_V6) assert.equal(isPublicAddress(ip), true, `should accept ${ip}`);
});

test('assertSafeUrl rejects non-https and accepts https', () => {
  assert.throws(() => assertSafeUrl('http://example.com/a'), /https/);
  assert.doesNotThrow(() => assertSafeUrl('https://example.com/a'));
});

test('assertSafeUrl rejects IPv4 alt-encodings that normalize to private targets', () => {
  // decimal, octal, hex encodings of 127.0.0.1 must not slip through
  assert.throws(() => assertSafeUrl('https://2130706433/'), /host/i);
  assert.throws(() => assertSafeUrl('https://0177.0.0.1/'), /host/i);
  assert.throws(() => assertSafeUrl('https://0x7f.0.0.1/'), /host/i);
});

test('assertSafeUrl accepts a canonical public IPv4 literal host', () => {
  assert.doesNotThrow(() => assertSafeUrl('https://8.8.8.8/'));
});

test('assertSafeUrl refuses non-public bracketed IPv6 literals', () => {
  assert.throws(() => assertSafeUrl('https://[::1]/'), /host/i);
  assert.throws(() => assertSafeUrl('https://[fe80::1]/'), /host/i);
  assert.throws(() => assertSafeUrl('https://[::ffff:169.254.169.254]/'), /host/i);
});

test('assertSafeUrl accepts a global-unicast bracketed IPv6 literal', () => {
  assert.doesNotThrow(() => assertSafeUrl('https://[2606:4700:4700::1111]/'));
});

test('resolveSafe throws if any resolved address is private', async () => {
  const lookup = async () => [{ address: '8.8.8.8', family: 4 }, { address: '10.0.0.1', family: 4 }];
  await assert.rejects(() => resolveSafe('evil.example', { lookup }), /private|public|address/i);
});

test('resolveSafe returns validated addresses when all are public', async () => {
  const lookup = async () => [{ address: '8.8.8.8', family: 4 }];
  const addrs = await resolveSafe('good.example', { lookup });
  assert.deepEqual(addrs, [{ address: '8.8.8.8', family: 4 }]);
});
