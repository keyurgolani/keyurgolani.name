import test from 'node:test';
import assert from 'node:assert/strict';
import { limitSource, sourcePrefix } from './source';

test('a source is kept as its IPv4 /24 or IPv6 /48 prefix, or unknown', () => {
  const cases: [string | null | undefined, string][] = [
    ['203.0.113.77', '203.0.113.0/24'],
    ['10.0.0.1', '10.0.0.0/24'],
    ['2001:db8:85a3::8a2e:370:7334', '2001:db8:85a3::/48'],
    ['2001:0DB8:0000:0042:0000:8A2E:0370:7334', '2001:db8:0::/48'],
    ['::1', '0:0:0::/48'],
    ['fe80::1%eth0', 'fe80:0:0::/48'],
    ['::ffff:198.51.100.23', '198.51.100.0/24'],
    ['::ffff:c633:6417', '198.51.100.0/24'],
    ['203.0.113', 'unknown'],
    ['203.0.113.777', 'unknown'],
    ['example.com', 'unknown'],
    ['', 'unknown'],
    [null, 'unknown'],
    [undefined, 'unknown'],
  ];
  for (const [address, expected] of cases) {
    assert.equal(sourcePrefix(address), expected, String(address));
  }
});

test("sign-in's limit counts an IPv4 address or an IPv6 /64, and nothing for no address", () => {
  const cases: [string | null | undefined, string | null][] = [
    ['203.0.113.77', '203.0.113.77'],
    ['::ffff:198.51.100.23', '198.51.100.23'],
    ['2001:db8:85a3:42:8a2e:370:7334:1', '2001:db8:85a3:42::/64'],
    // Two addresses in one /64 are one source.
    ['2001:db8:85a3:42::9', '2001:db8:85a3:42::/64'],
    ['2001:db8:85a3:43::9', '2001:db8:85a3:43::/64'],
    ['example.com', null],
    ['', null],
    [null, null],
  ];
  for (const [address, expected] of cases) {
    assert.equal(limitSource(address), expected, String(address));
  }
});
