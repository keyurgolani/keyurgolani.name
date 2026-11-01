import 'server-only';
import { isIP } from 'node:net';
import { csrfMatches } from '@portfolio/core/owner';
import { recordOwnerModule } from '../load-trace';
import type { BodyType } from '../operations';

// What the dispatcher's step 3 checks for #2, and where a request came from.
// A command needs an Origin exactly equal to the canonical origin,
// Sec-Fetch-Site: same-origin whenever the browser sends it, and a body type
// its entry accepts: JSON, or a form for auth.login. Same-site never counts,
// since a sibling origin is the same site as the owner's. Every command but
// auth.login also needs an x-csrf-token matching its session's, compared in
// constant time. A query that asks for the check (no registered one does)
// needs the same Origin and token, which a browser's same-origin GET never
// carries, so it fails closed. Each check names its reason for the audit log
// only: the response is the same 403 whichever one failed.

recordOwnerModule('server/owner/guard');

export type OriginRejection = 'origin_missing' | 'origin_mismatch' | 'fetch_site' | 'content_type';
export type CsrfRejection = 'csrf_missing' | 'csrf_mismatch';

const MEDIA_TYPES: Readonly<Record<BodyType, string>> = Object.freeze({
  json: 'application/json',
  form: 'application/x-www-form-urlencoded',
});

/** A browser's Sec-Fetch-Site, when it sends one, must say the request came from the owner origin. */
export function checkFetchSite(request: Request): 'fetch_site' | null {
  const site = request.headers.get('sec-fetch-site');
  return site === null || site === 'same-origin' ? null : 'fetch_site';
}

/**
 * Why a request fails the origin check, or null when it passes: an Origin
 * exactly `origin`, the canonical origin, never one read from the request's
 * Host or a forwarded header, and a same-origin fetch.
 */
export function checkRequestOrigin(
  request: Request,
  origin: string,
): Exclude<OriginRejection, 'content_type'> | null {
  const sent = request.headers.get('origin');
  if (sent === null) return 'origin_missing';
  if (sent !== origin) return 'origin_mismatch';
  return checkFetchSite(request);
}

/** Why a command fails the origin check, or null when it passes: checkRequestOrigin, then its body type. */
export function checkMutationOrigin(
  request: Request,
  {
    origin,
    bodyTypes = ['json'],
  }: { readonly origin: string; readonly bodyTypes?: readonly BodyType[] },
): OriginRejection | null {
  const rejected = checkRequestOrigin(request, origin);
  if (rejected) return rejected;
  const essence = request.headers.get('content-type')?.split(';')[0]?.trim().toLowerCase();
  return bodyTypes.some((type) => MEDIA_TYPES[type] === essence) ? null : 'content_type';
}

/** Why a command's x-csrf-token isn't its session's, or null when it is. */
export function checkCsrf(request: Request, sessionToken: string): CsrfRejection | null {
  const sent = request.headers.get('x-csrf-token');
  if (sent === null || sent === '') return 'csrf_missing';
  return csrfMatches(sessionToken, sent) ? null : 'csrf_mismatch';
}

/** An address a proxy may write with a port, `203.0.113.5:4711` or `[2001:db8::1]:443`, or in brackets alone. */
const WITH_PORT = /^(?:\[([^\]]+)\](?::\d{1,5})?|(\d{1,3}(?:\.\d{1,3}){3}):\d{1,5})$/;

/**
 * The client's address. With no trusted proxy hop, the default, every
 * forwarded header is ignored and the source is unknown. With N hops it is
 * the Nth X-Forwarded-For entry from the right, since each trusted proxy
 * appends the address it saw: what the client sent itself sits further left
 * and never counts. A port, and the brackets around an IPv6 address, are
 * taken off. An entry that isn't an IP address is unknown too.
 */
export function clientAddress(headers: Headers, trustedHops: number): string | null {
  const header = headers.get('x-forwarded-for');
  if (trustedHops < 1 || header === null) return null;
  const entries = header.split(',').map((entry) => entry.trim());
  const entry = entries.length >= trustedHops ? entries[entries.length - trustedHops] : undefined;
  if (entry === undefined) return null;
  const ported = WITH_PORT.exec(entry);
  const address = ported ? (ported[1] ?? ported[2] ?? '') : entry;
  return isIP(address) !== 0 ? address : null;
}
