// Where sign-in sends the owner afterwards (#2): a path under /studio and
// nothing else. An absolute URL, `//host`, a backslash, whitespace, a
// control character, or a dot segment that climbs out of /studio is
// refused, as is any of them percent-encoded: the value is checked, decoded
// once, and checked again. So is the sign-in page itself, in any case, where
// coming back would only ask for the password again. Anything refused is
// /studio. Owner code, the sign-in page, proxy.ts, and requireOwnerPage
// share it, so it holds no owner state and records no owner module.

export const DEFAULT_RETURN_TO = '/studio';

const BASE = 'https://studio.invalid';

function underStudio(path: string): boolean {
  return /^\/studio(?:[/?#]|$)/.test(path) && !path.includes('//') && !/[\\\s\p{Cc}]/u.test(path);
}

/** The sign-in page, or a path below it, in any case. */
const SIGN_IN_PAGES = /^\/studio\/sign-in(?:\/|$)/i;

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
    if (url.origin !== BASE || !underStudio(url.pathname) || SIGN_IN_PAGES.test(url.pathname)) {
      return DEFAULT_RETURN_TO;
    }
  }
  const url = new URL(value, BASE);
  const serialized = `${url.pathname}${url.search}${url.hash}`;
  return /^[\x21-\x7e]+$/.test(serialized) && underStudio(serialized)
    ? serialized
    : DEFAULT_RETURN_TO;
}

/**
 * Why the sign-in page is showing: a failed, throttled, or broken sign-in,
 * a sign-out, or a session that ended. A request that never had a session
 * comes with none.
 */
export const SIGN_IN_STATES = [
  'failed',
  'rate_limited',
  'error',
  'signed_out',
  'session_ended',
] as const;
export type SignInState = (typeof SIGN_IN_STATES)[number];

/** `value` when it is one of SIGN_IN_STATES, and null otherwise. */
export function signInStateOf(value: string | null | undefined): SignInState | null {
  return (SIGN_IN_STATES as readonly string[]).includes(value ?? '')
    ? (value as SignInState)
    : null;
}

export const SIGN_IN_PATH = '/studio/sign-in';

export const LOGIN_PATH = '/api/studio/auth.login';

/**
 * Where the sign-in form posts: auth.login, with `returnTo` in the URL as
 * well as in the form's field. An answer given before the body is read,
 * such as a blocked source's, sees only the URL.
 */
export function loginAction(returnTo: string): string {
  return returnTo === DEFAULT_RETURN_TO
    ? LOGIN_PATH
    : `${LOGIN_PATH}?${new URLSearchParams({ returnTo })}`;
}

/** The sign-in page, saying why when `state` is set, and keeping where the owner was going. */
export function signInLocation(
  state: SignInState | null,
  returnTo: string,
  retryAfterSeconds?: number,
): string {
  const query = new URLSearchParams();
  if (state) query.set('state', state);
  if (retryAfterSeconds !== undefined) query.set('retryAfter', String(retryAfterSeconds));
  if (returnTo !== DEFAULT_RETURN_TO) query.set('returnTo', returnTo);
  const search = query.toString();
  return search ? `${SIGN_IN_PATH}?${search}` : SIGN_IN_PATH;
}
