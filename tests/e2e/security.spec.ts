import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import type * as Capabilities from '../../apps/web/src/server/capabilities';
import type * as Operations from '../../apps/web/src/server/operations';
import type * as Routes from '../../apps/web/src/server/routes';
import { startApp } from '../harness/app-server.mjs';
import { HOPS_FILE } from '../harness/canaries.mjs';
import { expect, test as base } from '../harness/fixtures';
import { send, type Answer } from '../harness/http-client.mjs';
import { ownerSecret } from '../harness/owner-secret.mjs';
import { DEMO_APP, ownerApp, READ_ONLY_APP } from '../harness/profile-matrix';
import { concrete } from '../harness/scan-targets';
import {
  auditRecords,
  command,
  directTarget,
  errorCode,
  login,
  securitySuite,
  sessionOf,
  setCookies,
  signIn,
  type SecurityTarget,
} from '../harness/security-suite';

// #2's security suite straight against the built server under owner, over
// http on loopback with no trusted proxy hop: `pnpm --filter @portfolio/web
// test:security`. The suite is tests/harness/security-suite.ts, which
// tests/proxy/security.spec.ts also runs through the HTTPS proxy. After it,
// what only this shape shows: forwarded headers count for nothing without a
// trusted hop, the Host header decides nothing, and an owner's token means
// nothing to a read-only or demo server.

// apps/web has no "type": "module", so its modules are CommonJS to Node and
// load through require().
const require = createRequire(import.meta.url);
const { accessIn } = require('../../apps/web/src/server/capabilities.ts') as typeof Capabilities;
const { listOperations } = require('../../apps/web/src/server/operations.ts') as typeof Operations;
const { listRoutes, routeAccess } = require('../../apps/web/src/server/routes.ts') as typeof Routes;

const secret = ownerSecret();
const test = base.extend<{ target: SecurityTarget }>({
  target: async ({ app }, provide) => {
    await provide(directTarget(app, secret));
  },
});
test.use({ appOptions: ownerApp(secret.hash) });

securitySuite(test);

const COOKIE =
  /^studio_session=[A-Za-z0-9_-]{43}; Path=\/; Max-Age=\d+; HttpOnly; SameSite=Strict$/;

test('with 0 trusted hops, spoofed forwarded headers change no rate-limit identity, cookie flag, or origin check', async ({
  app,
  target,
}) => {
  expect(readFileSync(app.env[HOPS_FILE.key]!, 'utf8').trim()).toBe('0');
  const spoofed = {
    'x-forwarded-for': '203.0.113.7',
    'x-forwarded-host': 'portfolio.test',
    'x-forwarded-proto': 'https',
    forwarded: 'for=203.0.113.7;host=portfolio.test;proto=https',
    'x-real-ip': '203.0.113.7',
  };
  // Rate-limit identity: with no trusted hop nothing names a source, so
  // failures from one spoofed address never block it, and the audit log
  // names no source for them.
  for (let attempt = 1; attempt <= 6; attempt += 1) {
    const answer = await login(target, { password: 'not the password', headers: spoofed });
    expect(errorCode(answer), `attempt ${attempt}`).toBe('credentials_rejected');
  }
  const failed = auditRecords(await target.dataFiles()).filter(
    (record) => record.type === 'login_failed',
  );
  expect(failed.length).toBeGreaterThan(0);
  for (const record of failed) {
    expect((record.refs as { source?: string }).source).toBe('unknown');
  }
  // Cookie flags: they follow PORTFOLIO_ORIGIN's http, whatever the headers
  // say the scheme was.
  const answer = await login(target, { headers: spoofed });
  expect(setCookies(answer)[0]).toMatch(COOKIE);
  // Origin check: the origin they describe is refused, and the canonical
  // one passes with them.
  const session = sessionOf(target, answer);
  const described = await command(target, 'auth.session.extend', {
    session,
    headers: { ...spoofed, origin: 'https://portfolio.test' },
  });
  expect(errorCode(described)).toBe('request_origin_rejected');
  const canonical = await command(target, 'auth.session.extend', { session, headers: spoofed });
  expect(canonical.status).toBe(200);
});

test('a request with another Host header gets the same origin check, cookie, and absolute URLs', async ({
  app,
  target,
}) => {
  const elsewhere = `evil.test:${new URL(app.origin).port}`;
  // Every page and route owner serves, but the Studio transport.
  const served = listRoutes()
    .filter(
      (route) => route.capability !== 'operations' && routeAccess('owner', route) !== 'absent',
    )
    .map((route) => concrete(route.pattern));
  expect(served).toContain('/robots.txt');
  const variants: Record<string, string>[] = [
    { host: elsewhere },
    { 'x-forwarded-host': elsewhere, 'x-forwarded-proto': 'https' },
    { host: elsewhere, 'x-forwarded-host': elsewhere },
  ];
  for (const headers of variants) {
    const what = Object.keys(headers).join(' and ');
    // The origin check reads PORTFOLIO_ORIGIN: an Origin that matches the
    // request's own host is refused, and the canonical one passes.
    const own = await login(target, { headers: { ...headers, origin: `http://${elsewhere}` } });
    expect(errorCode(own), what).toBe('request_origin_rejected');
    const signedIn = await login(target, { headers });
    expect(setCookies(signedIn)[0], what).toMatch(COOKIE);
    // No page, route, or redirect names the request's host.
    for (const pathname of served) {
      const answer = await target.request(pathname, { headers });
      const text = `${answer.rawHeaders.join('\n')}\n${answer.body}`;
      expect(text.includes('evil.test'), `${what}: ${pathname} names the host`).toBe(false);
    }
    // proxy.ts's redirect is to the canonical origin. Next writes it as a
    // path, or, when its own idea of the request's host differs, whole, with
    // a loopback host written as localhost.
    const studio = await target.request('/studio', { headers });
    expect(studio.status, what).toBe(303);
    const location = new URL(studio.headers.location ?? '', app.origin);
    expect(location.host.replace(/^localhost:/, '127.0.0.1:'), what).toBe(new URL(app.origin).host);
    expect(`${location.pathname}${location.search}`, what).toBe('/studio/sign-in');
    const form = await target.request('/api/studio/auth.login', {
      method: 'POST',
      headers: {
        ...headers,
        origin: app.origin,
        'sec-fetch-site': 'same-origin',
        'content-type': 'application/x-www-form-urlencoded',
      },
      body: 'username=owner&password=not-the-password',
    });
    expect(form.headers.location, what).toBe('/studio/sign-in?state=failed');
  }
  // The absolute URLs a page does carry are on the canonical origin.
  const robots = await target.request('/robots.txt', { headers: { host: elsewhere } });
  expect(robots.body).toContain(app.origin);
});

test('a token an owner server issued, under either cookie name, reaches no Studio page or operation on read-only or demo and gets no Set-Cookie', async ({
  target,
}) => {
  test.setTimeout(180_000);
  const session = await signIn(target);
  const servers = [];
  try {
    for (const options of [READ_ONLY_APP, DEMO_APP]) servers.push(await startApp(options));
    for (const server of servers) {
      const profile = server.env.PORTFOLIO_PROFILE as Capabilities.Profile;
      const port = Number(new URL(server.origin).port);
      const studioPages = listRoutes().filter(
        (route) => route.kind === 'page' && route.pattern.startsWith('/studio'),
      );
      expect(studioPages.length).toBeGreaterThan(0);
      /** The answer to a request with `cookie`, and to the same request with none. */
      const both = async (pathname: string, cookie: string, operation?: Operations.Operation) => {
        const isCommand = operation?.kind === 'command';
        const request = (headers: Record<string, string>) =>
          send({
            protocol: 'http:',
            port,
            path: pathname,
            method: isCommand ? 'POST' : 'GET',
            headers: {
              'sec-fetch-site': 'same-origin',
              ...(isCommand
                ? {
                    origin: server.origin,
                    'content-type': 'application/json',
                    'x-csrf-token': session.csrf,
                  }
                : {}),
              ...headers,
            },
            body: isCommand ? '{}' : undefined,
          });
        return [await request({ cookie }), await request({})] as const;
      };
      const shape = (answer: Answer) => [answer.status, errorCode(answer)];
      for (const cookie of [
        `studio_session=${session.token}`,
        `__Host-studio_session=${session.token}`,
        `studio_session=${session.token}; __Host-studio_session=${session.token}`,
      ]) {
        for (const entry of studioPages) {
          const [carried, none] = await both(concrete(entry.pattern), cookie);
          const what = `${profile} ${entry.pattern}`;
          expect(carried.headers['set-cookie'], what).toBeUndefined();
          expect(shape(carried), what).toEqual(shape(none));
          // Absent unless another entry serves the path here, as demo's /studio does (#9).
          const served = studioPages.some(
            (each) => each.pattern === entry.pattern && routeAccess(profile, each) !== 'absent',
          );
          if (!served) expect(carried.status, what).toBe(404);
        }
        for (const operation of listOperations()) {
          const pathname = `/api/studio/${operation.name}`;
          const [carried, none] = await both(pathname, cookie, operation);
          const what = `${profile} ${operation.name}`;
          expect(carried.headers['set-cookie'], what).toBeUndefined();
          expect(shape(carried), what).toEqual(shape(none));
          if (accessIn(profile, operation.capability) === 'absent') {
            expect(shape(carried), what).toEqual([404, 'not_available_in_profile']);
          }
        }
      }
      expect(server.egress(), `${profile} reached out`).toEqual([]);
    }
  } finally {
    await Promise.all(servers.map((server) => server.stop()));
  }
  // And the owner server still takes the token.
  const still = await target.request('/api/studio/auth.session', {
    headers: { cookie: session.cookie, 'sec-fetch-site': 'same-origin' },
  });
  expect(still.status).toBe(200);
});
