// #2's security suite: sign-in, sessions, and Studio commands over HTTP,
// against the server under owner with the password provider, in the two
// shapes #2 names. tests/e2e/security.spec.ts (`pnpm --filter @portfolio/web
// test:security`) runs it straight against the built server over http on
// loopback, with no trusted proxy hop, and tests/proxy/security.spec.ts
// (`test:security:proxy`) through the HTTPS proxy fixture, with one. Each
// spec supplies the target, and every test here runs on either. Requests
// carry exactly the headers a test gives them (http-client.mjs), with no
// cookie jar, so a test sends exactly the cookie it means to.
//
// With a trusted hop, sign-in counts failures per source, and 5 in 15
// minutes block it, so every test starts with a sign-in, which clears the
// count, and no test fails more than 4 sign-ins between two that succeed.
import { createHash, randomBytes } from 'node:crypto';
import { readdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { expect, type TestType } from '@playwright/test';
import { authPaths } from '../../packages/core/src/data/layout.mjs';
import { encodings, hashCanaries } from './canaries.mjs';
import { send, type Answer } from './http-client.mjs';
import { OWNER_CLI } from './owner-secret.mjs';
import { scanTargets } from './scan-targets';

export type { Answer };

/** A header's value, or null to leave out one the helper would send. */
export type HeaderValues = Readonly<Record<string, string | null>>;

export interface Sent {
  readonly method?: string;
  readonly headers?: HeaderValues;
  readonly body?: string;
}

/** Session times to set, in milliseconds from the server's own clock: -60_000 is a minute ago. */
export interface SessionTimes {
  readonly createdAt?: number;
  readonly lastSeenAt?: number;
  readonly absoluteExpiresAt?: number;
}

/** A file in the data directory: its path inside it, with `/` separators, and its bytes as latin1. */
export interface DataFile {
  readonly path: string;
  readonly text: string;
}

/** The server under test, in one of the two shapes. */
export interface SecurityTarget {
  /** PORTFOLIO_ORIGIN. */
  readonly origin: string;
  /** The session cookie's name in this shape: studio_session over http, __Host-studio_session over https. */
  readonly cookie: 'studio_session' | '__Host-studio_session';
  /** PORTFOLIO_TRUSTED_PROXY_HOPS. */
  readonly hops: number;
  /** The owner password, and its hash, which the server reads from its _FILE. */
  readonly password: string;
  readonly hash: string;
  request(path: string, sent?: Sent): Promise<Answer>;
  /** What the server has written to stdout and stderr so far. */
  serverOutput(): Promise<string>;
  /** Every file in the server's data directory. */
  dataFiles(): Promise<readonly DataFile[]>;
  /** Rewrites a session record's times, as an operator with the data directory could. */
  setSessionTimes(digest: string, times: SessionTimes): Promise<void>;
  /** owner.mjs revoke-sessions, run against the server's data directory. */
  revokeSessions(): Promise<void>;
}

/** A signed-in session: its token, the CSRF token auth.login gave it, and its Cookie header. */
export interface Session {
  readonly token: string;
  readonly csrf: string;
  readonly cookie: string;
}

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const TOKEN = /^(?:studio_session|__Host-studio_session)=([A-Za-z0-9_-]{43});/;

/** The record a session's token is kept under: the hex SHA-256 digest of the token. */
export const digestOf = (token: string) => createHash('sha256').update(token).digest('hex');

const withoutNulls = (headers: HeaderValues): Record<string, string> =>
  Object.fromEntries(
    Object.entries(headers).filter((entry): entry is [string, string] => entry[1] !== null),
  );

/** Every Set-Cookie an answer carries. */
export function setCookies(answer: Answer): string[] {
  const value = answer.headers['set-cookie'];
  return value === undefined ? [] : Array.isArray(value) ? value : [value];
}

/** The error code of an answer in the error envelope, or null. */
export function errorCode(answer: Answer): string | null {
  try {
    return (JSON.parse(answer.body) as { error?: { code?: string } }).error?.code ?? null;
  } catch {
    return null;
  }
}

/** The Set-Cookie that clears the session cookie in this shape. */
export function clearedCookie(target: SecurityTarget): string {
  const secure = target.origin.startsWith('https:') ? '; Secure' : '';
  return `${target.cookie}=; Path=/; Max-Age=0; HttpOnly; SameSite=Strict${secure}`;
}

/** The cookie name this shape doesn't read: the other scheme's. */
export const otherCookie = (target: SecurityTarget) =>
  target.cookie === 'studio_session' ? '__Host-studio_session' : 'studio_session';

/** A JSON body to a Studio command, as studioFetch sends one from the owner origin. */
function commandHeaders(target: SecurityTarget, session?: Session): Record<string, string> {
  return {
    origin: target.origin,
    'sec-fetch-site': 'same-origin',
    'content-type': 'application/json',
    ...(session ? { cookie: session.cookie, 'x-csrf-token': session.csrf } : {}),
  };
}

/** A JSON sign-in from the owner origin, with the owner password unless the test gives another. */
export function login(
  target: SecurityTarget,
  { password = target.password, headers = {} }: { password?: unknown; headers?: HeaderValues } = {},
): Promise<Answer> {
  return target.request('/api/studio/auth.login', {
    method: 'POST',
    headers: { ...commandHeaders(target), ...headers },
    body: JSON.stringify({ password }),
  });
}

/** The session a sign-in's answer started. */
export function sessionOf(target: SecurityTarget, answer: Answer): Session {
  expect(answer.status, `sign-in answered ${answer.status}: ${answer.body}`).toBe(200);
  const cookies = setCookies(answer);
  expect(cookies, 'one Set-Cookie').toHaveLength(1);
  const token = TOKEN.exec(cookies[0]!)?.[1];
  expect(token, cookies[0]).toBeTruthy();
  const { data } = JSON.parse(answer.body) as { data: { csrfToken: string } };
  return { token: token!, csrf: data.csrfToken, cookie: `${target.cookie}=${token!}` };
}

export async function signIn(
  target: SecurityTarget,
  options: { headers?: HeaderValues } = {},
): Promise<Session> {
  return sessionOf(target, await login(target, options));
}

/** A Studio command, sent as studioFetch sends it, with `headers` on top. */
export function command(
  target: SecurityTarget,
  name: string,
  {
    session,
    body = {},
    headers = {},
  }: { session?: Session; body?: unknown; headers?: HeaderValues },
): Promise<Answer> {
  return target.request(`/api/studio/${name}`, {
    method: 'POST',
    headers: { ...commandHeaders(target, session), ...headers },
    body: JSON.stringify(body),
  });
}

/** A Studio query, sent as a same-origin GET. */
export function query(
  target: SecurityTarget,
  name: string,
  { cookie, headers = {} }: { cookie?: string; headers?: HeaderValues } = {},
): Promise<Answer> {
  return target.request(`/api/studio/${name}`, {
    headers: { 'sec-fetch-site': 'same-origin', ...(cookie ? { cookie } : {}), ...headers },
  });
}

/** The audit records in the data directory, in the order they were written. */
export function auditRecords(files: readonly DataFile[]): Record<string, unknown>[] {
  return files
    .filter((file) => file.path.startsWith('audit/'))
    .flatMap((file) => file.text.split('\n'))
    .filter((line) => line.trim() !== '')
    .map((line) => JSON.parse(line) as Record<string, unknown>);
}

/** The same answer apart from what differs per request: its ID and the date. */
function shapeOf(answer: Answer) {
  const headers = Object.fromEntries(
    Object.entries(answer.headers).filter(([name]) => !['date', 'x-request-id'].includes(name)),
  );
  let body: unknown = answer.body;
  try {
    const parsed = JSON.parse(answer.body) as { error?: Record<string, unknown> };
    body = parsed.error ? { error: { ...parsed.error, requestId: 'per request' } } : parsed;
  } catch {
    // Not JSON: compared as text.
  }
  return { status: answer.status, headers, body };
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * The target for the server under test straight over http (app-server.mjs),
 * started with ownerApp(), whose hop count is 0: its data directory, log,
 * and owner CLI on this machine.
 */
export function directTarget(
  app: { origin: string; log: string; env: Record<string, string> },
  secret: { password: string; hash: string },
): SecurityTarget {
  const port = Number(new URL(app.origin).port);
  const dataDir = app.env.PORTFOLIO_DATA_DIR;
  if (!dataDir) throw new Error('the server under test has no data directory');
  return {
    origin: app.origin,
    cookie: 'studio_session',
    hops: 0,
    password: secret.password,
    hash: secret.hash,
    request: (pathname, { method, headers = {}, body } = {}) =>
      send({
        protocol: 'http:',
        port,
        path: pathname,
        method,
        headers: withoutNulls(headers),
        body,
      }),
    serverOutput: async () => readFileSync(app.log, 'latin1'),
    dataFiles: async () =>
      readdirSync(dataDir, { withFileTypes: true, recursive: true })
        .filter((entry) => entry.isFile())
        .map((entry) => {
          const file = path.join(entry.parentPath, entry.name);
          return {
            path: path.relative(dataDir, file).split(path.sep).join('/'),
            text: readFileSync(file, 'latin1'),
          };
        }),
    setSessionTimes: async (digest, times) => {
      const file = path.join(authPaths(dataDir).sessions, `${digest}.json`);
      const record = JSON.parse(readFileSync(file, 'utf8')) as Record<string, unknown>;
      const now = Date.now();
      for (const [field, offset] of Object.entries(times)) {
        record[field] = new Date(now + offset).toISOString();
      }
      // A whole record at once, as the server writes one.
      const temporary = `${file}.${randomBytes(4).toString('hex')}.tmp`;
      writeFileSync(temporary, `${JSON.stringify(record)}\n`, { mode: 0o600 });
      renameSync(temporary, file);
    },
    revokeSessions: async () => {
      const [node, cli] = OWNER_CLI;
      const result = spawnSync(node!, [cli!, 'revoke-sessions'], {
        env: { PATH: process.env.PATH ?? '', PORTFOLIO_DATA_DIR: dataDir },
        encoding: 'utf8',
      });
      expect(result.status, `revoke-sessions: ${result.stdout}${result.stderr}`).toBe(0);
    },
  };
}

/** What the suite uses of a stack startProxyStack() started with its `owner` option. */
export interface OwnerProxyStack {
  readonly origin: string;
  request(
    path: string,
    sent?: { method?: string; headers?: Record<string, string>; body?: string },
  ): Promise<Answer>;
  exec(
    service: string,
    command: string[],
    options?: { input?: string },
  ): { status: number | null; stdout: string; stderr: string };
  logs(service?: string): string;
}

/**
 * Runs `script` with the app container's node, which reads it from stdin, so
 * nothing in it passes through a shell on the way. Returns what it printed.
 */
function inApp(stack: OwnerProxyStack, script: string): string {
  const result = stack.exec('app', ['node', '-'], { input: script });
  expect(result.status, `node in the app container: ${result.stderr}`).toBe(0);
  return result.stdout;
}

/**
 * The target for the image under test behind the HTTPS proxy fixture
 * (proxy-stack.mjs with compose.owner.yml), trusting `hops` proxies: its
 * data directory, log, and owner CLI in the app container, whose clock the
 * session times count from.
 */
export function proxyTarget(
  stack: OwnerProxyStack,
  secret: { password: string; hash: string },
  { dataDir, hops }: { dataDir: string; hops: number },
): SecurityTarget {
  return {
    origin: stack.origin,
    cookie: '__Host-studio_session',
    hops,
    password: secret.password,
    hash: secret.hash,
    request: (pathname, { method, headers = {}, body } = {}) =>
      stack.request(pathname, { method, headers: withoutNulls(headers), body }),
    serverOutput: async () => stack.logs('app'),
    dataFiles: async () => {
      const listed = inApp(
        stack,
        `const fs = require('node:fs');
const path = require('node:path');
const root = ${JSON.stringify(dataDir)};
const files = [];
for (const entry of fs.readdirSync(root, { withFileTypes: true, recursive: true })) {
  if (!entry.isFile()) continue;
  const file = path.join(entry.parentPath, entry.name);
  files.push({ path: path.relative(root, file), base64: fs.readFileSync(file).toString('base64') });
}
process.stdout.write(JSON.stringify(files));
`,
      );
      return (JSON.parse(listed) as { path: string; base64: string }[]).map((file) => ({
        path: file.path,
        text: Buffer.from(file.base64, 'base64').toString('latin1'),
      }));
    },
    setSessionTimes: async (digest, times) => {
      // A whole record at once, as the server writes one, and on its clock.
      const file = path.posix.join(authPaths(dataDir).sessions, `${digest}.json`);
      inApp(
        stack,
        `const fs = require('node:fs');
const path = require('node:path');
const { randomBytes } = require('node:crypto');
const file = ${JSON.stringify(file)};
const record = JSON.parse(fs.readFileSync(file, 'utf8'));
const now = Date.now();
for (const [field, offset] of Object.entries(${JSON.stringify(times)})) {
  record[field] = new Date(now + offset).toISOString();
}
const temporary = path.join(path.dirname(file), '.' + path.basename(file) + '.' + randomBytes(6).toString('hex') + '.tmp');
fs.writeFileSync(temporary, JSON.stringify(record) + '\\n', { mode: 0o600 });
fs.renameSync(temporary, file);
`,
      );
    },
    revokeSessions: async () => {
      const result = stack.exec('app', ['node', 'apps/web/bin/owner.mjs', 'revoke-sessions']);
      expect(result.status, `revoke-sessions: ${result.stdout}${result.stderr}`).toBe(0);
    },
  };
}

/**
 * Registers the suite on `test`, whose `target` fixture is the server
 * under test in one of the two shapes.
 */
export function securitySuite<T extends { target: SecurityTarget }, W extends object>(
  test: TestType<T, W>,
): void {
  // A sign-in that succeeds clears the source's failures, under a trusted hop.
  test.beforeEach(async ({ target }) => {
    await signIn(target);
  });

  test('every credential failure, whatever was wrong, gets the same answer', async ({ target }) => {
    const wrong = `${target.password}-not-it`;
    const failures: [what: string, body: string][] = [
      ['no password', '{}'],
      ['an empty one', JSON.stringify({ password: '' })],
      ['a number', JSON.stringify({ password: 12_345 })],
      ['null', JSON.stringify({ password: null })],
      ['an object', JSON.stringify({ password: { length: 20 } })],
      ['one past 256 characters', JSON.stringify({ password: 'p'.repeat(257) })],
      ['the wrong one', JSON.stringify({ password: wrong })],
      ['the right one in capitals', JSON.stringify({ password: target.password.toUpperCase() })],
    ];
    const answers: [string, Answer][] = [];
    for (const [index, [what, body]] of failures.entries()) {
      if (index > 0 && index % 4 === 0) await signIn(target);
      const answer = await target.request('/api/studio/auth.login', {
        method: 'POST',
        headers: commandHeaders(target),
        body,
      });
      answers.push([what, answer]);
    }
    const [, first] = answers[0]!;
    expect(first.status).toBe(401);
    expect(errorCode(first)).toBe('credentials_rejected');
    expect(setCookies(first)).toEqual([]);
    for (const [what, answer] of answers) expect(shapeOf(answer), what).toEqual(shapeOf(first));

    // The sign-in form: back to the sign-in page saying it failed, never
    // with the input, whatever was wrong.
    await signIn(target);
    const forms: [what: string, body: string][] = [
      ['no password', 'username=owner'],
      ['the wrong one', `username=owner&password=${encodeURIComponent(wrong)}`],
      ['one past 256 characters', `username=owner&password=${'p'.repeat(257)}`],
    ];
    for (const [what, body] of forms) {
      const answer = await target.request('/api/studio/auth.login', {
        method: 'POST',
        headers: {
          ...commandHeaders(target),
          'content-type': 'application/x-www-form-urlencoded',
        },
        body,
      });
      expect(answer.status, what).toBe(303);
      expect(answer.headers.location, what).toBe('/studio/sign-in?state=failed');
      expect(answer.body, what).toBe('');
      expect(setCookies(answer), what).toEqual([]);
    }
  });

  test("sign-in issues a new token every time, and ends the session the request's cookie carried", async ({
    target,
  }) => {
    const first = await signIn(target);
    // Signing in again with the session it has: a new token, and the old one ends.
    const second = await signIn(target, { headers: { cookie: first.cookie } });
    expect(second.token).not.toBe(first.token);
    expect(second.csrf).not.toBe(first.csrf);
    expect((await query(target, 'auth.session', { cookie: first.cookie })).status).toBe(401);
    expect((await query(target, 'auth.session', { cookie: second.cookie })).status).toBe(200);
    // A token chosen and planted by someone else is never adopted.
    const planted = `${target.cookie}=${randomBytes(32).toString('base64url')}`;
    const third = await signIn(target, { headers: { cookie: planted } });
    expect(third.cookie).not.toBe(planted);
    expect((await query(target, 'auth.session', { cookie: planted })).status).toBe(401);
    // Staying signed in renews the session in place: the same token, and no cookie set.
    const extended = await command(target, 'auth.session.extend', { session: third });
    expect(extended.status).toBe(200);
    expect(setCookies(extended)).toEqual([]);
    expect((await query(target, 'auth.session', { cookie: third.cookie })).status).toBe(200);
  });

  test("a command needs its session's CSRF token and a JSON body, and nothing changes state over GET, HEAD, or OPTIONS", async ({
    target,
  }) => {
    const session = await signIn(target);
    const other = await signIn(target);
    const cases: [what: string, headers: HeaderValues, body?: string][] = [
      ['no CSRF token', { 'x-csrf-token': null }],
      ['an empty one', { 'x-csrf-token': '' }],
      ['a made-up one', { 'x-csrf-token': 'x'.repeat(43) }],
      ["another session's", { 'x-csrf-token': other.csrf }],
      ['the session token in its place', { 'x-csrf-token': session.token }],
      [
        'the right one in the body instead',
        { 'x-csrf-token': null },
        JSON.stringify({ csrfToken: session.csrf }),
      ],
      ['a text/plain body', { 'content-type': 'text/plain' }],
      ['a form body', { 'content-type': 'application/x-www-form-urlencoded' }, 'a=b'],
      ['no content type', { 'content-type': null }],
    ];
    for (const [what, headers, body] of cases) {
      const answer = await target.request('/api/studio/auth.session.extend', {
        method: 'POST',
        headers: { ...commandHeaders(target, session), ...headers },
        body: body ?? '{}',
      });
      expect(answer.status, what).toBe(403);
      expect(errorCode(answer), what).toBe('request_origin_rejected');
    }
    expect((await command(target, 'auth.session.extend', { session })).status).toBe(200);

    // A command over another method is refused before anything runs, and no
    // answer offers CORS.
    for (const method of ['GET', 'HEAD', 'OPTIONS', 'PUT', 'DELETE']) {
      const answer = await target.request('/api/studio/auth.sessions.revokeAll', {
        method,
        headers: commandHeaders(target, session),
      });
      expect(answer.status, method).toBe(405);
      expect(
        Object.keys(answer.headers).filter((name) => name.startsWith('access-control-')),
        method,
      ).toEqual([]);
    }
    for (const signedIn of [session, other]) {
      expect((await query(target, 'auth.session', { cookie: signedIn.cookie })).status).toBe(200);
    }
  });

  test('a command without the exact Origin or a same-origin fetch is refused, sign-in included', async ({
    target,
  }) => {
    const url = new URL(target.origin);
    const port = Number(url.port || (url.protocol === 'https:' ? 443 : 80));
    const cases: [what: string, headers: HeaderValues][] = [
      ['no Origin', { origin: null }],
      ['an opaque Origin', { origin: 'null' }],
      [
        'a sibling subdomain',
        { origin: `${url.protocol}//demo.${url.host}`, 'sec-fetch-site': 'same-site' },
      ],
      [
        'the other scheme',
        { origin: `${url.protocol === 'https:' ? 'http:' : 'https:'}//${url.host}` },
      ],
      ['another port', { origin: `${url.protocol}//${url.hostname}:${port + 1}` }],
      ['a trailing slash', { origin: `${target.origin}/` }],
      ['the origin in capitals', { origin: target.origin.toUpperCase() }],
      ['a same-site fetch', { 'sec-fetch-site': 'same-site' }],
      ['a cross-site fetch', { 'sec-fetch-site': 'cross-site' }],
      ['a fetch the user started', { 'sec-fetch-site': 'none' }],
    ];
    const session = await signIn(target);
    for (const [what, headers] of cases) {
      // The right password, but no session comes of it.
      const signingIn = await login(target, { headers });
      expect(signingIn.status, `auth.login, ${what}`).toBe(403);
      expect(errorCode(signingIn), `auth.login, ${what}`).toBe('request_origin_rejected');
      expect(setCookies(signingIn), `auth.login, ${what}`).toEqual([]);
      // A command with its session and CSRF token.
      const revoking = await command(target, 'auth.sessions.revokeAll', { session, headers });
      expect(revoking.status, `auth.sessions.revokeAll, ${what}`).toBe(403);
      expect(errorCode(revoking), `auth.sessions.revokeAll, ${what}`).toBe(
        'request_origin_rejected',
      );
    }
    // The sign-in form from a sibling gets the same JSON 403, not the sign-in page.
    const form = await target.request('/api/studio/auth.login', {
      method: 'POST',
      headers: {
        origin: `${url.protocol}//demo.${url.host}`,
        'sec-fetch-site': 'same-site',
        'content-type': 'application/x-www-form-urlencoded',
      },
      body: `username=owner&password=${encodeURIComponent(target.password)}`,
    });
    expect(form.status).toBe(403);
    expect(form.headers['content-type']).toMatch(/^application\/json/);
    expect(setCookies(form)).toEqual([]);
    // None of it ended the session.
    expect((await query(target, 'auth.session', { cookie: session.cookie })).status).toBe(200);
  });

  test('the session cookie is HttpOnly, SameSite=Strict, and Path=/, with no Domain and a Max-Age of the time left, and over https it is Secure and named __Host-', async ({
    target,
  }) => {
    const https = target.origin.startsWith('https:');
    expect(target.cookie).toBe(https ? '__Host-studio_session' : 'studio_session');
    const answer = await login(target);
    const [cookie] = setCookies(answer);
    expect(cookie).toMatch(
      new RegExp(
        `^${target.cookie}=[A-Za-z0-9_-]{43}; Path=/; Max-Age=\\d+; HttpOnly; SameSite=Strict${https ? '; Secure' : ''}$`,
      ),
    );
    // Max-Age is the absolute lifetime left: 12 hours at sign-in.
    const maxAge = Number(/Max-Age=(\d+)/.exec(cookie!)?.[1]);
    expect(maxAge).toBeGreaterThan(12 * 3_600 - 120);
    expect(maxAge).toBeLessThanOrEqual(12 * 3_600);
    const session = sessionOf(target, answer);
    // The other scheme's name counts for nothing here.
    const elsewhere = `${otherCookie(target)}=${session.token}`;
    expect((await query(target, 'auth.session', { cookie: elsewhere })).status).toBe(401);
    // Sign-out clears it, with the same flags, and the HTTP cache too.
    const out = await command(target, 'auth.logout', { session });
    expect(out.status).toBe(200);
    expect(setCookies(out)).toEqual([clearedCookie(target)]);
    expect(out.headers['clear-site-data']).toBe('"cache"');
  });

  test('a session past its idle or absolute limit is refused on the server, and its cookie cleared', async ({
    target,
  }) => {
    const expiry = async (session: Session) => {
      const answer = await query(target, 'auth.session', { cookie: session.cookie });
      expect(answer.status).toBe(200);
      const { data } = JSON.parse(answer.body) as { data: { idleExpiresAt: string } };
      return Date.parse(data.idleExpiresAt) - Date.now();
    };
    // A minute short of the idle limit it still counts. A query never
    // slides it; a command does.
    const idle = await signIn(target);
    await target.setSessionTimes(digestOf(idle.token), { lastSeenAt: -59 * MINUTE });
    expect(await expiry(idle)).toBeLessThan(2 * MINUTE);
    expect(await expiry(idle)).toBeLessThan(2 * MINUTE);
    expect((await command(target, 'auth.session.extend', { session: idle })).status).toBe(200);
    expect(await expiry(idle)).toBeGreaterThan(58 * MINUTE);

    for (const [what, times] of [
      ['idle for 61 minutes', { lastSeenAt: -61 * MINUTE }],
      ['past its absolute expiry', { absoluteExpiresAt: -MINUTE }],
      ['signed in 12 hours and a minute ago', { createdAt: -(12 * HOUR + MINUTE) }],
    ] as const) {
      const session = await signIn(target);
      expect((await query(target, 'auth.session', { cookie: session.cookie })).status, what).toBe(
        200,
      );
      await target.setSessionTimes(digestOf(session.token), times);
      const ended = await query(target, 'auth.session', { cookie: session.cookie });
      expect(ended.status, what).toBe(401);
      expect(errorCode(ended), what).toBe('authentication_required');
      expect(setCookies(ended), what).toEqual([clearedCookie(target)]);
      // Ended means gone: no command gets past it either, and its record is deleted.
      const later = await command(target, 'auth.session.extend', { session });
      expect(later.status, what).toBe(401);
      const files = await target.dataFiles();
      expect(
        files.some((file) => file.path.endsWith(`${digestOf(session.token)}.json`)),
        what,
      ).toBe(false);
    }
  });

  test('a session ends on logout, on revoking it or every session, and on revoke-sessions, and no answer tells one ended session from another', async ({
    target,
  }) => {
    const loggedOut = await signIn(target);
    expect((await command(target, 'auth.logout', { session: loggedOut })).status).toBe(200);

    const keeper = await signIn(target);
    const revoked = await signIn(target);
    const ref = digestOf(revoked.token).slice(0, 8);
    const listed = await query(target, 'auth.sessions.list', { cookie: keeper.cookie });
    const { data } = JSON.parse(listed.body) as { data: { sessions: { ref: string }[] } };
    expect(data.sessions.map((entry) => entry.ref)).toContain(ref);
    const revoking = await command(target, 'auth.sessions.revoke', {
      session: keeper,
      body: { ref },
    });
    expect(JSON.parse(revoking.body)).toEqual({ data: { revoked: true } });
    expect((await query(target, 'auth.session', { cookie: keeper.cookie })).status).toBe(200);

    const bystander = await signIn(target);
    const all = await command(target, 'auth.sessions.revokeAll', { session: keeper });
    expect(all.status).toBe(200);
    // Its own session ends with the rest, and its cookie with it.
    expect(setCookies(all)).toEqual([clearedCookie(target)]);

    const before = [await signIn(target), await signIn(target)];
    await target.revokeSessions();
    // Sessions signed in after the run, past its millisecond, count again.
    await sleep(5);

    const expired = await signIn(target);
    await target.setSessionTimes(digestOf(expired.token), { lastSeenAt: -61 * MINUTE });

    const ended: [what: string, cookie: string][] = [
      ['signed out', loggedOut.cookie],
      ['revoked from the session list', revoked.cookie],
      ['revoked with every session', bystander.cookie],
      ['the session that revoked every one', keeper.cookie],
      ['signed out by revoke-sessions', before[0]!.cookie],
      ['signed out by revoke-sessions too', before[1]!.cookie],
      ['past its idle limit', expired.cookie],
      ['never issued', `${target.cookie}=${randomBytes(32).toString('base64url')}`],
      ['not a token', `${target.cookie}=not-a-token`],
    ];
    const answers: [string, Answer][] = [];
    for (const [what, cookie] of ended) {
      answers.push([what, await query(target, 'auth.session', { cookie })]);
    }
    const [, first] = answers[0]!;
    expect(first.status).toBe(401);
    expect(errorCode(first)).toBe('authentication_required');
    expect(setCookies(first)).toEqual([clearedCookie(target)]);
    for (const [what, answer] of answers) expect(shapeOf(answer), what).toEqual(shapeOf(first));

    // Signed in after revoke-sessions, a session counts.
    const after = await signIn(target);
    expect((await query(target, 'auth.session', { cookie: after.cookie })).status).toBe(200);
    // The audit log has each end, revoke-sessions as the operator's.
    const events = auditRecords(await target.dataFiles()).map(
      (record) => `${String(record.type)}:${String(record.actor)}`,
    );
    for (const event of [
      'logout:owner',
      'session_revoked:owner',
      'sessions_revoked_all:owner',
      'sessions_revoked_all:operator',
    ]) {
      expect(events).toContain(event);
    }
  });

  test('no captured response, server output, or data directory file holds the password, hash, session, or CSRF canary', async ({
    target,
  }) => {
    // The canaries: the password, a wrong one sent to sign-in, the hash and
    // its salt and key, and two sessions' tokens and CSRF tokens.
    const wrong = `canary-wrong-${randomBytes(8).toString('hex')}`;
    const session = await signIn(target);
    const second = await signIn(target);
    const canaries = [
      target.password,
      wrong,
      ...hashCanaries(target.hash),
      session.token,
      session.csrf,
      second.token,
      second.csrf,
    ].flatMap(encodings);
    const hit = (text: string) => canaries.find((canary) => text.includes(canary));

    // What Studio does with them: read the session, list, extend, and sign one out.
    expect((await query(target, 'auth.session', { cookie: session.cookie })).status).toBe(200);
    expect((await query(target, 'auth.sessions.list', { cookie: session.cookie })).status).toBe(
      200,
    );
    expect((await command(target, 'auth.session.extend', { session })).status).toBe(200);
    expect((await command(target, 'auth.logout', { session: second })).status).toBe(200);
    // And what an attacker sends: the wrong password, and a forged command.
    expect((await login(target, { password: wrong })).status).toBe(401);
    const forged = await command(target, 'auth.session.extend', {
      session: { ...session, csrf: wrong },
    });
    expect(forged.status).toBe(403);

    // Every route and operation, by GET and by POST from the owner origin,
    // without a session: with no cookie, and with the token under the name
    // this shape doesn't read. The session token never comes back in a
    // body, either.
    for (const cookie of [null, `${otherCookie(target)}=${session.token}`]) {
      for (const pathname of scanTargets()) {
        for (const method of ['GET', 'POST'] as const) {
          const answer = await target.request(pathname, {
            method,
            headers: {
              cookie,
              ...(method === 'POST'
                ? { origin: target.origin, 'content-type': 'application/json' }
                : {}),
            },
            body: method === 'POST' ? JSON.stringify({ draft: 'canary-draft' }) : undefined,
          });
          const leak = hit(`${answer.rawHeaders.join('\n')}\n${answer.body}`);
          expect(leak === undefined, `${method} ${pathname} carries a canary`).toBe(true);
        }
      }
    }
    const signedIn = await query(target, 'auth.session', { cookie: session.cookie });
    expect(signedIn.body.includes(session.token), 'auth.session names the token').toBe(false);

    // Give the log its last lines.
    await sleep(500);
    expect(hit(await target.serverOutput()) === undefined, 'server output').toBe(true);
    const files = await target.dataFiles();
    // Sessions and the audit log, at least, are there to look in.
    expect(files.some((file) => file.path.startsWith('audit/'))).toBe(true);
    expect(files.some((file) => file.path.startsWith('ephemeral/auth/sessions/'))).toBe(true);
    for (const file of files) expect(hit(file.text) === undefined, file.path).toBe(true);
  });

  test('sign-ins sent at once beyond what may verify together get 429 with Retry-After: 1', async ({
    target,
  }) => {
    // Two verifications at most at once, and with a trusted hop one place per source.
    const answers = await Promise.all(
      Array.from({ length: 8 }, () => login(target, { password: 'not the password' })),
    );
    const busy = answers.filter((answer) => answer.status === 429);
    expect(busy.length).toBeGreaterThan(0);
    for (const answer of busy) {
      expect(errorCode(answer)).toBe('rate_limited');
      expect(answer.headers['retry-after']).toBe('1');
    }
    for (const answer of answers.filter((entry) => entry.status !== 429)) {
      expect(errorCode(answer)).toBe('credentials_rejected');
    }
  });
}
