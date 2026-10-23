// The `auth: session` mode (#11, Slice 1, item 4): a #2 test session for a
// surface that needs one, made once, before the surface's tests, through
// the login API (auth.login with a JSON body and the app's own Origin),
// retried on 429 after the Retry-After it gives, and shared with the tests
// as Playwright storage state. The session's cookie and CSRF token are
// secrets the artifact scrub removes. The first Studio surface arrives with
// #8; until then nothing registers `session`, and this is tested against a
// stand-in for the login API.

import { chmodSync, writeFileSync } from 'node:fs';

/** auth.login, as the sign-in form posts it with JavaScript. */
export const LOGIN_PATH = '/api/studio/auth.login';

/** A cookie as Playwright's storage state holds one. */
export interface StateCookie {
  readonly name: string;
  readonly value: string;
  readonly domain: string;
  readonly path: string;
  readonly expires: number;
  readonly httpOnly: boolean;
  readonly secure: boolean;
  readonly sameSite: 'Strict' | 'Lax' | 'None';
}

export interface StorageState {
  readonly cookies: readonly StateCookie[];
  readonly origins: readonly [];
}

export interface Session {
  readonly storageState: StorageState;
  readonly csrfToken: string;
  /** How many logins it took, the 429s included. */
  readonly attempts: number;
}

export interface SessionOptions {
  /** The app's origin, which the login's Origin header names. */
  readonly origin: string;
  readonly password: string;
  /** How each request goes: fetch, or a stand-in's. */
  readonly fetch?: typeof fetch;
  readonly sleep?: (ms: number) => Promise<void>;
  /** Logins to try before giving up. */
  readonly attempts?: number;
  /** The longest Retry-After it waits out; a longer one fails the setup. */
  readonly maxWaitSeconds?: number;
}

/** Seconds a Retry-After asks for: delta seconds or an HTTP date, null when it's neither. */
export function retryAfterSeconds(value: string | null, now: number = Date.now()): number | null {
  if (value === null) return null;
  if (/^\d+$/.test(value.trim())) return Number(value.trim());
  const date = Date.parse(value);
  return Number.isNaN(date) ? null : Math.max(0, Math.ceil((date - now) / 1000));
}

/** One Set-Cookie header as a storage-state cookie for `origin`. */
export function parseSetCookie(header: string, origin: string): StateCookie {
  const [pair = '', ...attributes] = header.split(';').map((part) => part.trim());
  const at = pair.indexOf('=');
  const values = new Map<string, string>();
  for (const attribute of attributes) {
    const [key = '', ...rest] = attribute.split('=');
    values.set(key.trim().toLowerCase(), rest.join('=').trim());
  }
  const maxAge = values.get('max-age');
  const expires = values.get('expires');
  const sameSite = values.get('samesite')?.toLowerCase();
  return {
    name: pair.slice(0, at),
    value: pair.slice(at + 1),
    domain: new URL(origin).hostname,
    path: values.get('path') || '/',
    expires:
      maxAge !== undefined
        ? Math.floor(Date.now() / 1000) + Number(maxAge)
        : expires
          ? Math.floor(Date.parse(expires) / 1000)
          : -1,
    httpOnly: values.has('httponly'),
    secure: values.has('secure'),
    sameSite: sameSite === 'strict' ? 'Strict' : sameSite === 'none' ? 'None' : 'Lax',
  };
}

const sleepFor = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** Signs in once through the login API, waiting out each 429's Retry-After. */
export async function createAuthSession({
  origin,
  password,
  fetch: send = fetch,
  sleep = sleepFor,
  attempts = 5,
  maxWaitSeconds = 120,
}: SessionOptions): Promise<Session> {
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    const response = await send(new URL(LOGIN_PATH, origin), {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin },
      body: JSON.stringify({ password }),
      redirect: 'manual',
    });
    if (response.status === 429) {
      const wait = retryAfterSeconds(response.headers.get('retry-after')) ?? 1;
      if (wait > maxWaitSeconds) {
        throw new Error(`auth.login asked to wait ${wait}s, over the ${maxWaitSeconds}s the setup waits.`);
      }
      await response.body?.cancel();
      await sleep(wait * 1000);
      continue;
    }
    if (response.status !== 200) {
      await response.body?.cancel();
      throw new Error(`auth.login answered ${response.status}, so no test session was made.`);
    }
    const body = (await response.json()) as { data?: { csrfToken?: unknown } };
    const csrfToken = body.data?.csrfToken;
    const cookies = response.headers.getSetCookie().map((header) => parseSetCookie(header, origin));
    if (typeof csrfToken !== 'string' || cookies.length === 0) {
      throw new Error('auth.login answered 200 without a session cookie and a CSRF token.');
    }
    return { storageState: { cookies, origins: [] }, csrfToken, attempts: attempt };
  }
  throw new Error(`auth.login was still rate limited after ${attempts} attempts.`);
}

/** Writes the session's storage state for the tests, readable by this user alone. */
export function writeStorageState(file: string, session: Session): void {
  writeFileSync(file, `${JSON.stringify(session.storageState, null, 2)}\n`, { mode: 0o600 });
  chmodSync(file, 0o600);
}

/** What the artifact scrub must remove for a session: its cookies' values and its CSRF token. */
export function sessionSecrets(session: Session): string[] {
  return [...session.storageState.cookies.map((cookie) => cookie.value), session.csrfToken];
}
