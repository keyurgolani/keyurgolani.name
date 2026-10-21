import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, createHmac } from 'node:crypto';
import {
  csrfMatches,
  csrfToken,
  isSessionToken,
  newSessionToken,
  sessionDigest,
  sessionRef,
} from './token';

test('a session token is 32 random bytes in base64url, and only that shape is a token', () => {
  const tokens = new Set(Array.from({ length: 64 }, () => newSessionToken()));
  assert.equal(tokens.size, 64);
  for (const token of tokens) {
    assert.match(token, /^[A-Za-z0-9_-]{43}$/);
    assert.equal(Buffer.from(token, 'base64url').length, 32);
    assert.ok(isSessionToken(token));
  }
  const token = [...tokens][0]!;
  for (const other of [
    token.slice(1),
    `${token}A`,
    `${token}=`,
    `${token.slice(1)}+`,
    `${token.slice(1)}/`,
    '',
    undefined,
    null,
    42,
  ]) {
    assert.equal(isSessionToken(other), false, String(other));
  }
});

test('a record is keyed by the hex SHA-256 digest of its token, and referred to by 8 of its characters', () => {
  const token = 'A'.repeat(43);
  const digest = createHash('sha256').update(token).digest('hex');
  assert.equal(sessionDigest(token), digest);
  assert.match(digest, /^[0-9a-f]{64}$/);
  assert.equal(sessionRef(digest), digest.slice(0, 8));
});

test('the CSRF token is HMAC-SHA-256 of a fixed label keyed by the session token, compared in constant time', () => {
  const token = newSessionToken();
  const expected = createHmac('sha256', token)
    .update('keyurgolani.portfolio studio csrf v1')
    .digest('base64url');
  assert.equal(csrfToken(token), expected);
  assert.notEqual(csrfToken(newSessionToken()), expected);
  assert.ok(csrfMatches(token, expected));
  for (const header of [
    csrfToken(newSessionToken()),
    expected.slice(1),
    `${expected}A`,
    token,
    '',
    undefined,
    ['x'],
  ]) {
    assert.equal(csrfMatches(token, header), false, String(header));
  }
});
