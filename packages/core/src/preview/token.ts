import { createHash, randomBytes } from 'node:crypto';
import { recordOwnerModule } from '../load-trace';

// Preview grant tokens (#7, Slice 2). A grant is a capability: 128 random
// bits in base64url, which only the frame's URL carries, in its grant path.
// The server keeps the token's SHA-256 digest, so the data directory holds
// no token, and logs name a grant by the first 8 hex characters of that
// digest, never the token.

recordOwnerModule('core/preview/token');

const TOKEN = /^[A-Za-z0-9_-]{22}$/;
const DIGEST = /^[0-9a-f]{64}$/;

/** A new grant token: 16 random bytes, 22 characters of base64url. */
export function newGrantToken(): string {
  return randomBytes(16).toString('base64url');
}

/** Whether `value` has a grant token's shape. Anything else names no grant. */
export function isGrantToken(value: unknown): value is string {
  return typeof value === 'string' && TOKEN.test(value);
}

/** The key a grant's record is stored under: the hex SHA-256 digest of its token. */
export function grantDigest(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

/** Whether `value` is a grant digest, as a record's file is named. */
export function isGrantDigest(value: unknown): value is string {
  return typeof value === 'string' && DIGEST.test(value);
}

/** What a log line calls a grant: the first 8 hex characters of its digest. */
export function grantRef(digest: string): string {
  return digest.slice(0, 8);
}

/**
 * The nonce of a grant's channel, which Studio gets at mint and the frame's
 * agent says back in its handshake (Slice 3): 16 random bytes in base64url.
 */
export function newChannelNonce(): string {
  return randomBytes(16).toString('base64url');
}
