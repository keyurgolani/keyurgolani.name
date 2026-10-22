import 'server-only';
import { recordOwnerModule } from '../load-trace';
import { sessionCookieName, type SessionCookieName } from '../session-cookie';

// The Studio session cookie (#2). Over https it is __Host-studio_session,
// Secure, HttpOnly, SameSite=Strict, Path=/, with no Domain, which a sibling
// origin can't set or shadow. An http origin, which config.ts allows owner
// only on a loopback host, is HTTP test mode: studio_session without Secure.
// The mode follows the canonical origin's scheme, never X-Forwarded-Proto,
// and the server reads only its own mode's name (server/session-cookie.ts).
// A request with two cookies of that name has one somebody else set, and
// the provider takes neither.

recordOwnerModule('server/owner/cookie');

export { readCookies } from '../session-cookie';

export interface CookieMode {
  readonly name: SessionCookieName;
  readonly secure: boolean;
}

/** The session cookie for the canonical origin. */
export function cookieMode(origin: string): CookieMode {
  const name = sessionCookieName(origin);
  return Object.freeze({ name, secure: name === '__Host-studio_session' });
}

function attributes(mode: CookieMode, maxAgeSeconds: number): string {
  const secure = mode.secure ? '; Secure' : '';
  return `Path=/; Max-Age=${maxAgeSeconds}; HttpOnly; SameSite=Strict${secure}`;
}

/** The Set-Cookie value that carries a session's token for `maxAgeSeconds`. */
export function sessionCookie(mode: CookieMode, token: string, maxAgeSeconds: number): string {
  return `${mode.name}=${token}; ${attributes(mode, Math.max(0, Math.floor(maxAgeSeconds)))}`;
}

/** The Set-Cookie value that clears the session cookie. */
export function clearedSessionCookie(mode: CookieMode): string {
  return `${mode.name}=; ${attributes(mode, 0)}`;
}
