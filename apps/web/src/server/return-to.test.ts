import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_RETURN_TO,
  safeReturnTo,
  SIGN_IN_STATES,
  signInLocation,
  signInStateOf,
} from './return-to';

// Where sign-in sends the owner afterwards (#2), and how the sign-in page
// learns why it is showing.

test('returnTo accepts only a path under /studio, however it is encoded', () => {
  const kept = [
    '/studio',
    '/studio/',
    '/studio/drafts',
    '/studio/drafts/about?tab=history',
    '/studio#publish',
    '/studio/drafts/a-b_c.1',
  ];
  for (const path of kept) assert.equal(safeReturnTo(path), path, path);
  const refused = [
    null,
    undefined,
    '',
    '/',
    '/admin',
    '/studios',
    '/studio-sign-in',
    'studio',
    'https://rowan.test/studio',
    'https://elsewhere.test/studio',
    '//elsewhere.test/studio',
    '/studio//elsewhere.test',
    '/\\elsewhere.test',
    '/studio\\..\\admin',
    '/studio/../admin',
    '/studio/%2e%2e/admin',
    '/studio/%2E%2E%2Fadmin',
    '/studio/%2F%2Felsewhere.test',
    '/studio/%5C%5Celsewhere.test',
    '%2Fstudio',
    '/studio/%0d%0aSet-Cookie:x',
    '/studio/\tx',
    '/studio/ x',
    '/studio/drafts%20one',
    '/studio/%',
    'javascript:alert(1)//studio',
  ];
  for (const value of refused) {
    assert.equal(safeReturnTo(value), DEFAULT_RETURN_TO, String(value));
  }
});

test('a returnTo comes back as the URL parser serializes it, in printable ASCII, so a Location header can carry it', () => {
  const encoded: [value: string, serialized: string][] = [
    ['/studio/ünïcödé', '/studio/%C3%BCn%C3%AFc%C3%B6d%C3%A9'],
    ['/studio/drafts?tab=日本', '/studio/drafts?tab=%E6%97%A5%E6%9C%AC'],
    ['/studio#Ω', '/studio#%CE%A9'],
    ['/studio/😀', '/studio/%F0%9F%98%80'],
    // Already encoded, it stays as it is.
    ['/studio/%C3%BC', '/studio/%C3%BC'],
    // Dot segments that stay under /studio are resolved.
    ['/studio/drafts/../settings', '/studio/settings'],
  ];
  for (const [value, serialized] of encoded) {
    assert.equal(safeReturnTo(value), serialized, value);
    assert.match(serialized, /^[\x21-\x7e]+$/);
    assert.doesNotThrow(() => new Headers({ location: safeReturnTo(value) }), value);
  }
  // Whitespace and control characters past ASCII are refused, as in ASCII,
  // and so is a percent-encoding that isn't UTF-8.
  for (const value of ['/studio/a\u00a0b', '/studio/a\u2028b', '/studio/a\u0085b', '/studio/%ff']) {
    assert.equal(safeReturnTo(value), DEFAULT_RETURN_TO, JSON.stringify(value));
  }
});

test('a form post comes back to sign-in with its state, and keeps where the owner was going', () => {
  assert.equal(signInLocation('failed', '/studio'), '/studio/sign-in?state=failed');
  assert.equal(
    signInLocation('failed', '/studio/drafts?tab=a'),
    '/studio/sign-in?state=failed&returnTo=%2Fstudio%2Fdrafts%3Ftab%3Da',
  );
  assert.equal(
    signInLocation('rate_limited', '/studio', 60),
    '/studio/sign-in?state=rate_limited&retryAfter=60',
  );
  assert.equal(signInLocation('error', '/studio'), '/studio/sign-in?state=error');
  // A request that never had a session comes with no state.
  assert.equal(signInLocation(null, '/studio'), '/studio/sign-in');
  assert.equal(
    signInLocation(null, '/studio/drafts'),
    '/studio/sign-in?returnTo=%2Fstudio%2Fdrafts',
  );
  assert.equal(
    signInLocation('session_ended', '/studio/drafts'),
    '/studio/sign-in?state=session_ended&returnTo=%2Fstudio%2Fdrafts',
  );
});

test('the sign-in page reads only the states it knows', () => {
  for (const state of SIGN_IN_STATES) assert.equal(signInStateOf(state), state);
  for (const value of [null, undefined, '', 'FAILED', 'failed ', 'signed_in', '<script>']) {
    assert.equal(signInStateOf(value), null, String(value));
  }
});
