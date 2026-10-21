import 'server-only';
import { recordOwnerModule } from '../load-trace';

// Where sign-in sends the owner afterwards (#2): a path under /studio and
// nothing else. An absolute URL, `//host`, a backslash, whitespace, a
// control character, or a dot segment that climbs out of /studio is
// refused, as is any of them percent-encoded: the value is checked, decoded
// once, and checked again. Anything refused is /studio.

recordOwnerModule('server/owner/return-to');

export const DEFAULT_RETURN_TO = '/studio';

const BASE = 'https://studio.invalid';

function underStudio(path: string): boolean {
  return /^\/studio(?:[/?#]|$)/.test(path) && !path.includes('//') && !/[\\\s\p{Cc}]/u.test(path);
}

/**
 * `value` when it is a safe path under /studio, and /studio otherwise. The
 * path comes back as the URL parser serializes it, path, query, and
 * fragment, percent-encoded into printable ASCII, so a Location header can
 * always carry it.
 */
export function safeReturnTo(value: string | null | undefined): string {
  if (!value || !underStudio(value)) return DEFAULT_RETURN_TO;
  let decoded: string;
  try {
    decoded = decodeURIComponent(value);
  } catch {
    return DEFAULT_RETURN_TO;
  }
  // The URL parser resolves dot segments, so check where both forms land.
  for (const form of [value, decoded]) {
    if (!underStudio(form)) return DEFAULT_RETURN_TO;
    const url = new URL(form, BASE);
    if (url.origin !== BASE || !underStudio(url.pathname)) return DEFAULT_RETURN_TO;
  }
  const url = new URL(value, BASE);
  const serialized = `${url.pathname}${url.search}${url.hash}`;
  return /^[\x21-\x7e]+$/.test(serialized) && underStudio(serialized)
    ? serialized
    : DEFAULT_RETURN_TO;
}

export type SignInState = 'failed' | 'rate_limited' | 'error';

/** The sign-in page a form post comes back to, keeping where the owner was going. */
export function signInLocation(
  state: SignInState,
  returnTo: string,
  retryAfterSeconds?: number,
): string {
  const query = new URLSearchParams({ state });
  if (retryAfterSeconds !== undefined) query.set('retryAfter', String(retryAfterSeconds));
  if (returnTo !== DEFAULT_RETURN_TO) query.set('returnTo', returnTo);
  return `/studio/sign-in?${query}`;
}
