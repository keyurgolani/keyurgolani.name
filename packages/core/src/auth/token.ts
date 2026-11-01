import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { recordOwnerModule } from '../load-trace';

// Session tokens and CSRF tokens (#2). A token is 32 random bytes in
// base64url and lives only in the cookie. The server keeps the SHA-256
// digest of it, and derives the CSRF token from it with HMAC-SHA-256 over a
// fixed label, so there is no signing key, and a copy of the data directory
// yields neither token.

recordOwnerModule('core/auth/token');

const TOKEN = /^[A-Za-z0-9_-]{43}$/;
const CSRF_LABEL = 'keyurgolani.portfolio studio csrf v1';

/** A new session token: 32 random bytes, 43 characters of base64url. */
export function newSessionToken(): string {
  return randomBytes(32).toString('base64url');
}

/** Whether `value` has a session token's shape. Anything else is no session. */
export function isSessionToken(value: unknown): value is string {
  return typeof value === 'string' && TOKEN.test(value);
}

/** The key a session's record is stored under: the hex SHA-256 digest of the token. */
export function sessionDigest(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

/** What the audit log and the session list call a session: the first 8 hex characters of its digest. */
export function sessionRef(digest: string): string {
  return digest.slice(0, 8);
}

/** The session's CSRF token, for the x-csrf-token header. */
export function csrfToken(token: string): string {
  return createHmac('sha256', token).update(CSRF_LABEL).digest('base64url');
}

/** Whether `header` is the session's CSRF token, compared in constant time. */
export function csrfMatches(token: string, header: unknown): boolean {
  if (typeof header !== 'string') return false;
  const expected = Buffer.from(csrfToken(token));
  const given = Buffer.from(header);
  return given.length === expected.length && timingSafeEqual(given, expected);
}
