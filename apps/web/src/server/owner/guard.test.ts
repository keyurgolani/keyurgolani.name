import test from 'node:test';
import assert from 'node:assert/strict';
import { clearedSessionCookie, cookieMode, readCookies, sessionCookie } from './cookie';
import { checkFetchSite, checkMutationOrigin, checkRequestOrigin, clientAddress } from './guard';

// The request checks and the cookie, on their own (#2). auth.test.ts runs
// them through the dispatcher.

const forwarded = (...values: string[]) => {
  const headers = new Headers();
  for (const value of values) headers.append('x-forwarded-for', value);
  return headers;
};

test('the client is the Nth X-Forwarded-For entry from the right, so one the client sent never counts, and at 0 hops none does', () => {
  // The proxy appends the address it saw, so the client's own entries sit to its left.
  assert.equal(clientAddress(forwarded('203.0.113.5'), 1), '203.0.113.5');
  assert.equal(clientAddress(forwarded('198.51.100.1, 203.0.113.5'), 1), '203.0.113.5');
  assert.equal(clientAddress(forwarded('198.51.100.1', '203.0.113.5'), 1), '203.0.113.5');
  assert.equal(clientAddress(forwarded('2001:db8::7, 2001:db8:1::9'), 1), '2001:db8:1::9');
  // Two trusted hops: the second entry from the right.
  assert.equal(clientAddress(forwarded('198.51.100.1, 203.0.113.5, 10.0.0.2'), 2), '203.0.113.5');
  // Fewer entries than hops, or one that isn't an address, is unknown.
  assert.equal(clientAddress(forwarded('203.0.113.5'), 2), null);
  assert.equal(clientAddress(forwarded('198.51.100.1, rowan.test'), 1), null);
  assert.equal(clientAddress(forwarded('198.51.100.1, '), 1), null);
  assert.equal(clientAddress(new Headers(), 1), null);
  // With no trusted hop, the default, the header counts for nothing.
  assert.equal(clientAddress(forwarded('203.0.113.5'), 0), null);
});

test('an X-Forwarded-For entry with a port, or an IPv6 address in brackets, counts as its address', () => {
  assert.equal(clientAddress(forwarded('203.0.113.5:4711'), 1), '203.0.113.5');
  assert.equal(clientAddress(forwarded('198.51.100.1, [2001:db8:1::9]:443'), 1), '2001:db8:1::9');
  assert.equal(clientAddress(forwarded('[2001:db8:1::9]'), 1), '2001:db8:1::9');
  assert.equal(clientAddress(forwarded('2001:db8:1::9'), 1), '2001:db8:1::9');
  // Still only an address: a name with a port, a bare port, or a port past 5 digits is unknown.
  for (const entry of [
    'rowan.test:80',
    '203.0.113.5:',
    ':4711',
    '203.0.113.5:123456',
    '[rowan.test]:80',
  ]) {
    assert.equal(clientAddress(forwarded(entry), 1), null, entry);
  }
});

test("the session cookie's name and flags follow the canonical origin's scheme, never the request", () => {
  const secure = cookieMode('https://rowan.test');
  assert.deepEqual(secure, { name: '__Host-studio_session', secure: true });
  assert.equal(
    sessionCookie(secure, 'TOKEN', 3_600.9),
    '__Host-studio_session=TOKEN; Path=/; Max-Age=3600; HttpOnly; SameSite=Strict; Secure',
  );
  assert.equal(
    clearedSessionCookie(secure),
    '__Host-studio_session=; Path=/; Max-Age=0; HttpOnly; SameSite=Strict; Secure',
  );
  for (const origin of ['http://localhost:3100', 'http://127.0.0.1:3100', 'http://[::1]:3100']) {
    const local = cookieMode(origin);
    assert.deepEqual(local, { name: 'studio_session', secure: false }, origin);
    assert.doesNotMatch(sessionCookie(local, 'TOKEN', 60), /Secure|Domain/);
  }
  assert.doesNotMatch(sessionCookie(secure, 'TOKEN', 60), /Domain/);

  // Only the exact name counts, and every cookie of it is read, so the
  // provider can refuse two.
  const sent = (cookie: string) => new Request('https://rowan.test/', { headers: { cookie } });
  assert.deepEqual(readCookies(sent('a=1; __Host-studio_session=T1; b=2'), secure.name), ['T1']);
  assert.deepEqual(readCookies(sent('x__Host-studio_session=T1'), secure.name), []);
  assert.deepEqual(
    readCookies(sent('__Host-studio_session=T1; __Host-studio_session=T2'), secure.name),
    ['T1', 'T2'],
  );
  assert.deepEqual(readCookies(sent('studio_session=T1'), secure.name), []);
  assert.deepEqual(readCookies(new Request('https://rowan.test/'), secure.name), []);
});

test('the origin check reads the canonical origin, never the Host header or a forwarded one', () => {
  const command = (headers: Record<string, string>) =>
    new Request('https://rowan.test/api/studio/x', { method: 'POST', headers });
  const good = { origin: 'https://rowan.test', 'content-type': 'application/json' };
  assert.equal(checkMutationOrigin(command(good), { origin: 'https://rowan.test' }), null);
  // A request that names another host every way it can still needs the canonical Origin.
  const spoofed = {
    origin: 'https://attacker.test',
    host: 'attacker.test',
    'x-forwarded-host': 'attacker.test',
    'x-forwarded-proto': 'https',
    'content-type': 'application/json',
  };
  assert.equal(
    checkMutationOrigin(command(spoofed), { origin: 'https://rowan.test' }),
    'origin_mismatch',
  );
  // A request for attacker.test itself, by its URL and its Host, from
  // attacker.test: the URL and the Host are never the origin to match.
  const hostile = new Request('https://attacker.test/api/studio/x', {
    method: 'POST',
    headers: {
      host: 'attacker.test',
      origin: 'https://attacker.test',
      'content-type': 'application/json',
    },
  });
  assert.equal(new URL(hostile.url).host, 'attacker.test');
  assert.equal(checkMutationOrigin(hostile, { origin: 'https://rowan.test' }), 'origin_mismatch');
  assert.equal(checkRequestOrigin(hostile, 'https://rowan.test'), 'origin_mismatch');
  // The fetch site, on its own: same-origin when the browser sends it.
  const query = (site?: string) =>
    new Request('https://rowan.test/api/studio/x', {
      headers: site ? { 'sec-fetch-site': site } : {},
    });
  assert.equal(checkFetchSite(query('same-origin')), null);
  assert.equal(checkFetchSite(query()), null);
  for (const site of ['same-site', 'cross-site', 'none']) {
    assert.equal(checkFetchSite(query(site)), 'fetch_site', site);
  }
  // A query that asks for the check needs the exact Origin too, and a
  // browser's same-origin GET sends none, so such a query fails closed.
  assert.equal(checkRequestOrigin(query('same-origin'), 'https://rowan.test'), 'origin_missing');
  const withOrigin = new Request('https://rowan.test/api/studio/x', {
    headers: { origin: 'https://rowan.test', 'sec-fetch-site': 'same-origin' },
  });
  assert.equal(checkRequestOrigin(withOrigin, 'https://rowan.test'), null);
});
