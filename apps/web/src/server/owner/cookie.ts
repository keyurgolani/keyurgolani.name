import 'server-only';
import { recordOwnerModule } from '../load-trace';

// The Studio session cookie (#2). Over https it is __Host-studio_session,
// Secure, HttpOnly, SameSite=Strict, Path=/, with no Domain, which a sibling
// origin can't set or shadow. An http origin, which config.ts allows owner
// only on a loopback host, is HTTP test mode: studio_session without Secure.
// The mode follows the canonical origin's scheme, never X-Forwarded-Proto,
// and the server reads only its own mode's name. A request with two cookies
// of that name has one somebody else set, and the provider takes neither.

recordOwnerModule('server/owner/cookie');

export interface CookieMode {
  readonly name: '__Host-studio_session' | 'studio_session';
  readonly secure: boolean;
}

const SECURE: CookieMode = Object.freeze({ name: '__Host-studio_session', secure: true });
const HTTP_TEST: CookieMode = Object.freeze({ name: 'studio_session', secure: false });

/** The session cookie for the canonical origin. */
export function cookieMode(origin: string): CookieMode {
  return new URL(origin).protocol === 'https:' ? SECURE : HTTP_TEST;
}

/** The value of every cookie the request names exactly `name`, in the order sent. */
export function readCookies(request: Request, name: string): string[] {
  const header = request.headers.get('cookie');
  if (!header) return [];
  const values: string[] = [];
  for (const part of header.split(';')) {
    const index = part.indexOf('=');
    if (index !== -1 && part.slice(0, index).trim() === name) {
      values.push(part.slice(index + 1).trim());
    }
  }
  return values;
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
