// The Studio session cookie's name (#2): __Host-studio_session for an https
// canonical origin, and studio_session in HTTP test mode, an http origin
// config.ts allows owner only on a loopback host. The name follows the
// canonical origin's scheme, never X-Forwarded-Proto. Owner code sets and
// reads the cookie; proxy.ts only asks whether a request carries one, so
// this module holds no owner state and records no owner module.

export type SessionCookieName = '__Host-studio_session' | 'studio_session';

/** The session cookie's name for the canonical origin. */
export function sessionCookieName(origin: string): SessionCookieName {
  return new URL(origin).protocol === 'https:' ? '__Host-studio_session' : 'studio_session';
}

/** The value of every cookie the request names exactly `name`, in the order sent. */
export function readCookies(request: Pick<Request, 'headers'>, name: string): string[] {
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
