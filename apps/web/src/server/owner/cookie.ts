import 'server-only';
import { recordOwnerModule } from '../load-trace';
import { sessionCookieName, type SessionCookieName } from '../session-cookie';
import { DISCARD_MARKER_MAX_AGE, discardMarkerName } from '~/lib/studio/discard-marker';

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
/**
 * The pending-discard marker a Sign out without JavaScript leaves when it chose to discard (row
 * 88c-RC2, the coordinator's ruling; lib/studio/discard-marker.ts): its value is the sign-out's
 * time, which Studio's pages read as they render and hand to their script. HttpOnly, as no script
 * reads it; SameSite=Strict, Secure over https, Path=/, for the journal's retention.
 */
export function discardMarkerCookie(mode: CookieMode, at: number): string {
  const name = discardMarkerName(mode.secure);
  return `${name}=${Math.max(0, Math.floor(at))}; ${attributes(mode, DISCARD_MARKER_MAX_AGE)}`;
}

export function clearedSessionCookie(mode: CookieMode): string {
  return `${mode.name}=; ${attributes(mode, 0)}`;
}
