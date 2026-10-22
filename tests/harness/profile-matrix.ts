// The route-level matrix (#1, AC4) for one profile, generated from the route
// table and the operation registry and run against the built server: every
// page, route, and operation the profile doesn't serve fails closed, and
// each one it serves answers. Every response the app sends carries the
// baseline headers and no cookie, and under a profile crawlers may not index
// (demo), says so; Next's trailing-slash 308s, which come before the app,
// point at the canonical path. Health and readiness answer their documented
// shapes, and the canary scan (#1, Verification item 2) finds no path,
// secret, or config summary in any response. A spec runs it for the profile
// its app options start: read-only and demo, and owner with the password
// provider (#2), whose password and hash join the canaries.
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { APIRequestContext, APIResponse } from '@playwright/test';
import { parse } from 'yaml';
import type * as Capabilities from '../../apps/web/src/server/capabilities';
import type * as Operations from '../../apps/web/src/server/operations';
import type * as Routes from '../../apps/web/src/server/routes';
import {
  CANARY_BODY,
  CANARY_DATA,
  CANARY_SECRET,
  CANARY_SOURCE,
  canaries as leakCanaries,
  FORGED_LINE,
  HOPS_FILE,
  IMAGE_PROBE,
} from './canaries.mjs';
import { DEFAULT_SITE } from './app-server.mjs';
import { expect, test, type App, type AppOptions } from './fixtures';
import { VARIANTS } from './registry';
import { headerProblems, isStudioPath } from './route-headers.mjs';
import { concrete, scanTargets } from './scan-targets';

// apps/web has no "type": "module", so its modules are CommonJS to Node and
// load through require().
const require = createRequire(import.meta.url);
const { accessIn, CAPABILITIES, INDEXABLE } =
  require('../../apps/web/src/server/capabilities.ts') as typeof Capabilities;
const { listOperations } = require('../../apps/web/src/server/operations.ts') as typeof Operations;
const { listRoutes, RETIRED_PATTERNS, routeAccess } =
  require('../../apps/web/src/server/routes.ts') as typeof Routes;
type Profile = Capabilities.Profile;
type Operation = Operations.Operation;

/** A _FILE every profile reads, in a canary-named directory. */
const ENV_FILES: AppOptions['envFiles'] = {
  [HOPS_FILE.key]: { path: `${CANARY_SECRET}/${HOPS_FILE.name}`, text: HOPS_FILE.text },
};

/** The read-only profile on the harness fixture, seeded for the canary scan. */
export const READ_ONLY_APP: AppOptions = { sourceName: CANARY_SOURCE, envFiles: ENV_FILES };

/** The demo profile on the bundled sample pair, with no source directory: demo reads none. */
export const DEMO_APP: AppOptions = {
  env: { PORTFOLIO_PROFILE: 'demo', PORTFOLIO_SOURCE_DIR: '' },
  envFiles: ENV_FILES,
  portfolio: null,
  site: null,
};

/**
 * The owner profile on the harness fixture with the password provider (#2):
 * `hash` in a _FILE beside the hop count, and a data directory made for the
 * run, each at a canary path.
 */
export function ownerApp(hash: string): AppOptions {
  return {
    sourceName: CANARY_SOURCE,
    dataName: CANARY_DATA,
    env: { PORTFOLIO_PROFILE: 'owner' },
    envFiles: {
      ...ENV_FILES,
      PORTFOLIO_AUTH_PASSWORD_HASH_FILE: {
        path: `${CANARY_SECRET}/owner_password_hash`,
        text: `${hash}\n`,
      },
    },
  };
}

export interface MatrixOptions {
  /** The run's own secrets, such as owner's password and its hash, which no response may carry. */
  readonly secrets?: readonly string[];
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const METHODS = ['GET', 'POST', 'PUT', 'DELETE'] as const;
/** Every method a client can send a path, for the checks that compare two paths' answers. */
const EVERY_METHOD = ['GET', 'HEAD', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'] as const;

/**
 * Studio paths in every spelling a request may use (#2): the pages the table
 * lists, in another case, deeper than any page, with a fixed segment
 * percent-encoded, and with the slash encoded. Under a profile with no
 * Studio, each one answers every method as /no-such-page does.
 */
const STUDIO_SPELLINGS = [
  '/studio',
  '/studio/sign-in',
  '/studio/sign-in?state=failed&returnTo=%2Fstudio',
  '/Studio',
  '/STUDIO/sign-in',
  '/sTuDiO/x',
  '/studio/nowhere',
  '/studio/sign-in/x',
  '/%73tudio',
  '/%73tudio/sign-in',
  '/studio/%73ign-in',
  '/studio%2Fsign-in',
  '/%73tudio%2Fsign-in',
] as const;

/**
 * The pattern's concrete path once for each of its fixed segments, with that
 * segment's first character percent-encoded, as /%66eed.xml spells
 * /feed.xml. The route table reads it as the route; Next, which matches a
 * fixed segment as sent, as another path (#5, Slice 4).
 */
function encodedSpellings(pattern: string): string[] {
  const parts = pattern.split('/').filter(Boolean);
  const sent = concrete(pattern).split('/').filter(Boolean);
  return parts.flatMap((part, index) => {
    const segment = sent[index];
    if (part.startsWith('[') || segment === undefined) return [];
    const encoded = `%${segment.charCodeAt(0).toString(16).toUpperCase()}${segment.slice(1)}`;
    return [`/${sent.map((each, at) => (at === index ? encoded : each)).join('/')}`];
  });
}

/**
 * Paths that are a route file's own, as sent or decoded whole: each page
 * pattern with a dynamic segment written out, and again with its brackets
 * encoded, each fixed route of two segments or more with its slashes
 * encoded, and Next's /_not-found with its underscore encoded. The route
 * table finds each one names nothing, but Next's file check finds a route
 * file for it (#5, Slice 4).
 */
function routeFileSpellings(): string[] {
  const spellings = new Set(['/%5Fnot-found']);
  for (const { kind, pattern } of listRoutes()) {
    if (kind === 'page' && pattern.includes('[')) {
      spellings.add(pattern);
      spellings.add(pattern.replace(/\[/g, '%5B').replace(/\]/g, '%5D'));
    } else if (!pattern.includes('[') && pattern.indexOf('/', 1) > 0) {
      spellings.add(pattern.replace(/(?!^)\//g, '%2F'));
    }
  }
  return [...spellings];
}

/**
 * A page whose concrete path names nothing it can render: no installed
 * variant declares a view at /probe, and no slug names a work until #10
 * (#5, Slice 4). The route table calls it missing in every profile, so a
 * GET gets the app's 404 page, rendered from the server, and any other
 * method the proxy's plain 404, as an absent route does.
 */
const namesNothing = (entry: Routes.RouteEntry) =>
  entry.kind === 'page' && concrete(entry.pattern).includes('probe');

/** What the transport answers a visitor with no session, by the registry and the matrix. */
function expected(
  profile: Profile,
  operation: Operation,
  method: string,
): [status: number, code: string | null] {
  if (accessIn(profile, operation.capability) === 'absent') {
    return [404, 'not_available_in_profile'];
  }
  if (method !== (operation.kind === 'query' ? 'GET' : 'POST')) return [405, 'method_not_allowed'];
  if (operation.session) return [401, 'authentication_required'];
  // These requests send no Origin, so the origin check refuses every
  // command: owner's provider wants the exact one, and the other profiles
  // bind no provider, whose check refuses them all.
  if (operation.kind === 'command') return [403, 'request_origin_rejected'];
  return [200, null];
}

/** The site document each profile's app serves here: the harness fixture, or the bundled sample. */
const SERVED_SITES: Partial<Record<Profile, string>> = {
  'read-only': DEFAULT_SITE,
  owner: DEFAULT_SITE,
  demo: fileURLToPath(new URL('../../site.example.yml', import.meta.url)),
};

/**
 * The packs check: `ok` when this build registers the variant the profile's
 * site selects, and `degraded` while the fallback composition renders in its
 * place (#5), as it does for the harness fixture's missing-variant.
 */
function packsStatus(profile: Profile): 'ok' | 'degraded' {
  const site = SERVED_SITES[profile];
  if (!site) throw new Error(`No ${profile} app runs the matrix against the built server.`);
  const selected = (parse(readFileSync(site, 'utf8')) as { appearance: { variant: string } })
    .appearance.variant;
  return VARIANTS.some(({ manifest }) => manifest.id === selected) ? 'ok' : 'degraded';
}

/** What /api/ready answers for a profile whose checks pass, or the packs check only degrades. */
function readyBody(profile: Profile) {
  const packs = packsStatus(profile);
  return {
    status: packs === 'ok' ? 'ready' : 'degraded',
    profile,
    capabilities: CAPABILITIES.flatMap((id) => {
      const access = accessIn(profile, id);
      return access === 'absent' ? [] : [{ id, access }];
    }),
    checks: [
      { id: 'catalog', status: 'ok' },
      { id: 'packs', status: packs },
      ...(profile === 'owner' ? [] : [{ id: 'owner-modules', status: 'ok' }]),
    ],
  };
}

/** Whether `profile` serves a Studio page, as owner does: under another, /studio is as unknown as any path (#2). */
const hasStudio = (profile: Profile) =>
  listRoutes().some(
    (entry) =>
      entry.kind === 'page' &&
      isStudioPath(entry.pattern) &&
      routeAccess(profile, entry) !== 'absent',
  );

/**
 * The headers its path gets (route-headers.mjs): the baseline ones, or
 * Studio's (#2) where the profile has Studio. No cookie, and noindex exactly
 * where the profile can't be indexed.
 */
function expectProfileHeaders(profile: Profile, response: APIResponse, what: string) {
  const headers = response.headers();
  expect(
    headerProblems(new URL(response.url()).pathname, headers, { studio: hasStudio(profile) }),
    what,
  ).toEqual([]);
  expect(headers['set-cookie'], `${what}: no cookie`).toBeUndefined();
  expect(headers['x-robots-tag'], `${what}: X-Robots-Tag`).toBe(
    INDEXABLE[profile] ? undefined : 'noindex',
  );
}

/**
 * A 404 page's body with its own path taken out of Next's payload, which
 * names the path it answers, query and all, as sent or decoded, so two 404
 * pages compare as the same page.
 */
function withoutOwnPath(body: string, target: string): string {
  const url = new URL(target, 'http://unset.invalid');
  const sent = url.pathname.split('/').filter(Boolean);
  const spellings = [sent];
  try {
    // Each segment decoded, and the path decoded whole, encoded slashes and all.
    spellings.push(sent.map((segment) => decodeURIComponent(segment)));
    spellings.push(decodeURIComponent(url.pathname).split('/').filter(Boolean));
  } catch {
    // Named as sent.
  }
  for (const spelling of spellings) {
    const segments = ['', ...spelling];
    segments[segments.length - 1] += url.search;
    // The payload is JSON inside a JSON string in a script: its quotes come
    // escaped, and its ampersands as \u0026.
    const named = `\\"c\\":${JSON.stringify(segments).replace(/"/g, '\\"').replace(/&/g, '\\u0026')}`;
    const parts = body.split(named);
    if (parts.length === 2) return parts.join('\\"c\\":"<path>"');
  }
  throw new Error(`Next's payload doesn't name ${target} once.`);
}

/**
 * Sends GET and POST to every scan target, with `headers` on each, and
 * expects no canary in any body or header of what comes back.
 */
export async function expectNoLeaks(
  request: APIRequestContext,
  canaries: readonly string[],
  headers: Record<string, string> = {},
): Promise<void> {
  for (const target of scanTargets()) {
    for (const method of ['GET', 'POST'] as const) {
      const response = await request.fetch(target, {
        method,
        maxRedirects: 0,
        headers,
        data: method === 'POST' ? { draft: CANARY_BODY } : undefined,
      });
      const body = (await response.body()).toString('latin1');
      const sent = response
        .headersArray()
        .map(({ name, value }) => `${name}: ${value}`)
        .join('\n');
      for (const canary of canaries) {
        expect(body, `${method} ${target}: body`).not.toContain(canary);
        expect(sent, `${method} ${target}: headers`).not.toContain(canary);
      }
    }
  }
}

/** Registers the matrix for `profile`, which the spec's app options must start. */
export function profileMatrix(profile: Profile, { secrets = [] }: MatrixOptions = {}): void {
  const annotation = { type: 'profile', description: profile };

  test(`the app under test runs ${profile}`, async ({ app }) => {
    expect(app.env.PORTFOLIO_PROFILE).toBe(profile);
  });

  for (const entry of listRoutes().filter((route) => route.capability !== 'operations')) {
    const access = routeAccess(profile, entry);
    const served = access !== 'absent';
    const gated = entry.kind === 'page' && access === 'session';
    const missing = namesNothing(entry);
    const state = missing
      ? 'missing there, the 404 page'
      : served
        ? gated
          ? 'served to a session, and sends a visitor to sign-in'
          : 'served'
        : 'absent, 404 for every method';
    test(
      `${entry.pattern} is ${state}`,
      { annotation: [{ type: 'route', description: entry.pattern }, annotation] },
      async ({ app, request }) => {
        if (missing) {
          const page = await request.get(concrete(entry.pattern), { maxRedirects: 0 });
          expect(page.status()).toBe(404);
          // The app's 404 page, from the server: it needs no JavaScript.
          expect(page.headers()['content-type']).toMatch(/^text\/html/);
          expect(await page.text()).toMatch(/<h1>Page not found<\/h1>/);
          expect(page.headers()['x-request-id']).toMatch(UUID);
          expectProfileHeaders(profile, page, 'GET');
          for (const method of METHODS.filter((each) => each !== 'GET')) {
            const response = await request.fetch(concrete(entry.pattern), {
              method,
              maxRedirects: 0,
            });
            expect(response.status(), method).toBe(404);
            expect(response.headers()['content-type'], method).toMatch(/^text\/plain/);
            expectProfileHeaders(profile, response, method);
          }
          return;
        }
        if (served) {
          const response = await request.get(concrete(entry.pattern), { maxRedirects: 0 });
          if (gated) {
            // No session cookie: proxy.ts sends it to sign-in before the page renders (#2).
            expect(response.status()).toBe(303);
            const location = new URL(response.headers()['location'] ?? '', app.origin);
            expect(location.origin).toBe(app.origin);
            expect(location.pathname).toBe('/studio/sign-in');
          } else {
            expect(response.status()).toBe(200);
          }
          expect(response.headers()['x-request-id']).toMatch(UUID);
          expectProfileHeaders(profile, response, 'GET');
          return;
        }
        for (const method of METHODS) {
          const response = await request.fetch(concrete(entry.pattern), {
            method,
            maxRedirects: 0,
          });
          expect(response.status(), method).toBe(404);
          // The proxy's plain answer, before Next routes it, but for a GET
          // of a Studio page under a profile with none, which answers as an
          // unknown path does, with the 404 page (#2).
          const page = method === 'GET' && isStudioPath(entry.pattern);
          expect(response.headers()['content-type'], method).toMatch(
            page ? /^text\/html/ : /^text\/plain/,
          );
          expectProfileHeaders(profile, response, method);
        }
      },
    );
  }

  for (const pattern of RETIRED_PATTERNS) {
    test(
      `retired ${pattern} is 404 for every method`,
      { annotation: [{ type: 'route', description: pattern }, annotation] },
      async ({ request }) => {
        for (const method of METHODS) {
          const response = await request.fetch(concrete(pattern), { method, maxRedirects: 0 });
          expect(response.status(), method).toBe(404);
          expect(response.headers()['cache-control'], method).toBe('no-store');
          expectProfileHeaders(profile, response, method);
        }
      },
    );
  }

  for (const operation of listOperations()) {
    test(
      `operation ${operation.name} fails closed as the matrix says, for every method`,
      { annotation: [{ type: 'route', description: '/api/studio/[name]' }, annotation] },
      async ({ request }) => {
        for (const method of METHODS) {
          const response = await request.fetch(`/api/studio/${operation.name}`, {
            method,
            data: method === 'GET' ? undefined : {},
            headers: { 'x-request-id': 'client-chosen' },
          });
          const [status, code] = expected(profile, operation, method);
          expect(response.status(), method).toBe(status);
          expect(response.headers()['cache-control'], method).toBe('no-store');
          expectProfileHeaders(profile, response, method);
          if (code === null) continue;
          const { error } = (await response.json()) as { error: Record<string, string> };
          expect(Object.keys(error)).toEqual(['code', 'message', 'requestId']);
          expect(error.code, method).toBe(code);
          // The ID is the one proxy.ts set, never the client's.
          expect(error.requestId).toMatch(UUID);
          expect(response.headers()['x-request-id']).toBe(error.requestId);
        }
      },
    );
  }

  test(
    '/api/health is liveness and /api/ready reports every check ok',
    {
      annotation: [
        { type: 'route', description: '/api/health' },
        { type: 'route', description: '/api/ready' },
        annotation,
      ],
    },
    async ({ request }) => {
      const health = await request.get('/api/health');
      expect(health.status()).toBe(200);
      expect(health.headers()['cache-control']).toBe('no-store');
      expect(await health.json()).toEqual({ status: 'ok', profile });

      const ready = await request.get('/api/ready');
      expect(ready.status()).toBe(200);
      expect(ready.headers()['cache-control']).toBe('no-store');
      expect(await ready.json()).toEqual(readyBody(profile));
    },
  );

  /**
   * The canaries for this run, once the app shows it seeded them. Every path
   * the server could leak sits under its own directory: the build, the
   * bundled example, the source directory, the data directory, and the
   * _FILEs it read at startup. The summary's own fields go only to an owner
   * session, through config.status (#1, item 20).
   */
  const seeded = (app: App) => {
    expect(app.env[HOPS_FILE.key]).toContain(CANARY_SECRET);
    if (profile !== 'demo') expect(app.env.PORTFOLIO_SOURCE_DIR).toContain(CANARY_SOURCE);
    if (profile === 'owner') {
      expect(app.env.PORTFOLIO_DATA_DIR).toContain(CANARY_DATA);
      expect(app.env.PORTFOLIO_AUTH_PASSWORD_HASH_FILE).toContain(CANARY_SECRET);
      expect(secrets.length, 'the password and the hash').toBeGreaterThan(1);
    }
    return leakCanaries(path.basename(app.root), { secrets });
  };

  if (profile === 'owner') {
    test(
      'no response to GET or POST carries a path, a secret, the config summary, the password, or its hash',
      { annotation: [{ type: 'route', description: 'every route' }, annotation] },
      async ({ app, request }) => {
        await expectNoLeaks(request, seeded(app));
      },
    );
  } else {
    test(
      'no response to GET or POST carries a path, a secret, or the config summary, and no owner module loads',
      { annotation: [{ type: 'route', description: 'every route' }, annotation] },
      async ({ app, request }) => {
        await expectNoLeaks(request, seeded(app));
        // After every route and operation, still no owner module.
        const ready = (await (await request.get('/api/ready')).json()) as { checks: unknown[] };
        expect(ready.checks).toContainEqual({ id: 'owner-modules', status: 'ok' });
      },
    );
  }

  if (profile !== 'owner') {
    test(
      'in demo and read-only every Studio path, in any spelling and to any method, and every auth route answer the unknown-route 404',
      {
        annotation: [
          { type: 'route', description: '/studio' },
          { type: 'route', description: '/studio/sign-in' },
          { type: 'route', description: '/api/studio/[name]' },
          annotation,
        ],
      },
      async ({ request }) => {
        // With a cookie of either name, holding what looks like a token: no
        // session store reads it, and nothing clears it (#2).
        const cookie = `__Host-studio_session=${'x'.repeat(43)}; studio_session=${'x'.repeat(43)}`;
        // Each one exactly as a path no route matches: the same status,
        // headers, and body, but for the path Next's payload names in a page.
        const shape = async (response: APIResponse, target: string) => {
          const text = await response.text();
          const page = /^text\/html/.test(response.headers()['content-type'] ?? '') && text !== '';
          return {
            status: response.status(),
            headers: Object.fromEntries(
              Object.entries(response.headers()).filter(
                ([name]) => !['date', 'x-request-id'].includes(name),
              ),
            ),
            body: page ? withoutOwnPath(text, target) : text,
          };
        };
        for (const target of STUDIO_SPELLINGS) {
          const query = target.includes('?') ? target.slice(target.indexOf('?')) : '';
          for (const method of EVERY_METHOD) {
            const what = `${method} ${target}`;
            const options = { method, maxRedirects: 0, headers: { cookie } };
            const response = await request.fetch(target, options);
            const unknown = await request.fetch(`/no-such-page${query}`, options);
            expect(response.status(), what).toBe(404);
            expect(await response.text(), what).not.toContain('Password');
            expectProfileHeaders(profile, response, what);
            expect(await shape(response, target), what).toEqual(
              await shape(unknown, `/no-such-page${query}`),
            );
          }
        }
        for (const operation of listOperations().filter(({ name }) => name.startsWith('auth.'))) {
          for (const method of ['GET', 'POST'] as const) {
            const response = await request.fetch(`/api/studio/${operation.name}`, {
              method,
              headers: { cookie },
              data: method === 'POST' ? {} : undefined,
            });
            expect(response.status(), `${method} ${operation.name}`).toBe(404);
            const { error } = (await response.json()) as { error: Record<string, string> };
            expect(error.code).toBe('not_available_in_profile');
            expectProfileHeaders(profile, response, `${method} ${operation.name}`);
          }
        }
      },
    );
  }

  test(
    'an unknown operation gets the same 404 envelope',
    { annotation: [{ type: 'route', description: '/api/studio/[name]' }, annotation] },
    async ({ request }) => {
      for (const name of ['publish', 'draft.write', 'no.such.operation']) {
        const response = await request.post(`/api/studio/${name}`, { data: {} });
        expect(response.status(), name).toBe(404);
        const { error } = (await response.json()) as { error: Record<string, string> };
        expect(error.code, name).toBe('not_available_in_profile');
        expectProfileHeaders(profile, response, name);
      }
    },
  );

  test(
    'a route spelled with a fixed segment percent-encoded is a path no route matches: the 404 page for GET, the plain 404 for POST',
    { annotation: [{ type: 'route', description: 'every route' }, annotation] },
    async ({ request }) => {
      // The route table reads /%66eed.xml as /feed.xml, but Next matches a
      // fixed segment as sent and would hand it to the views catch-all,
      // whose 404 needs JavaScript (#5, Slice 4).
      let spellings = 0;
      for (const entry of listRoutes()) {
        const access = routeAccess(profile, entry);
        for (const target of encodedSpellings(entry.pattern)) {
          spellings += 1;
          const page = await request.get(target, { maxRedirects: 0 });
          if (entry.kind === 'page' && access === 'session') {
            // No session cookie: sign-in comes first, as for the route's own spelling.
            expect(page.status(), target).toBe(303);
          } else if (access === 'absent' && !namesNothing(entry) && !isStudioPath(entry.pattern)) {
            // A route the profile doesn't serve: its plain 404, in any spelling.
            expect(page.status(), target).toBe(404);
            expect(page.headers()['content-type'], target).toMatch(/^text\/plain/);
          } else {
            // The full 404 page, from the server.
            expect(page.status(), target).toBe(404);
            expect(page.headers()['content-type'], target).toMatch(/^text\/html/);
            expect(await page.text(), target).toMatch(/<h1>Page not found<\/h1>/);
          }
          expectProfileHeaders(profile, page, `GET ${target}`);
          const posted = await request.post(target, { maxRedirects: 0 });
          expect(posted.status(), `POST ${target}`).toBe(404);
          expect(posted.headers()['content-type'], `POST ${target}`).toMatch(/^text\/plain/);
          expectProfileHeaders(profile, posted, `POST ${target}`);
        }
      }
      expect(spellings, 'spellings checked').toBeGreaterThan(10);
    },
  );

  test(
    "a path that is a route file's own, as sent or decoded whole, is a path no route matches: the 404 page for GET, the plain 404 for POST",
    { annotation: [{ type: 'route', description: 'every route' }, annotation] },
    async ({ request }) => {
      // Such as /work/[slug] or /studio%2Fsign-in: the route table finds it
      // names nothing, but Next's file check finds a route file for it before
      // the afterFiles rewrite runs, and the views catch-all's 404 needs
      // JavaScript (#5, Slice 4).
      const spellings = routeFileSpellings();
      expect(spellings.length, 'spellings checked').toBeGreaterThan(5);
      for (const target of spellings) {
        const page = await request.get(target, { maxRedirects: 0 });
        expect(page.status(), target).toBe(404);
        expect(page.headers()['content-type'], target).toMatch(/^text\/html/);
        expect(await page.text(), target).toMatch(/<h1>Page not found<\/h1>/);
        expectProfileHeaders(profile, page, `GET ${target}`);
        const posted = await request.post(target, { maxRedirects: 0 });
        expect(posted.status(), `POST ${target}`).toBe(404);
        expect(posted.headers()['content-type'], `POST ${target}`).toMatch(/^text\/plain/);
        expectProfileHeaders(profile, posted, `POST ${target}`);
      }
    },
  );

  test(
    'the image optimizer is off: /_next/image is the 404 page, and its url never reaches the log',
    { annotation: [{ type: 'route', description: '/_next/image' }, annotation] },
    async ({ app, request }) => {
      // images.unoptimized (next.config.ts): Next answers with the 404 page,
      // under the baseline headers, before it reads the url. On, it sent its
      // own CSP and wrote the url to stderr as it came, line breaks included.
      const responses: [method: string, response: APIResponse][] = [];
      for (const method of METHODS) {
        responses.push([method, await request.fetch(IMAGE_PROBE, { method, maxRedirects: 0 })]);
      }
      // The server writes its log a line at a time; give it a moment. The
      // log comes first, so an optimizer back on fails here as well.
      await new Promise((resolve) => setTimeout(resolve, 500));
      expect.soft(readFileSync(app.log, 'utf8'), 'the server log').not.toContain(FORGED_LINE);
      for (const [method, response] of responses) {
        expect(response.status(), method).toBe(404);
        expectProfileHeaders(profile, response, method);
      }
    },
  );

  test(
    'a trailing or repeated slash is a 308 to the path without it, whose body is only that path',
    { annotation: [{ type: 'route', description: 'every route' }, annotation] },
    async ({ app, request }) => {
      // Next answers these itself, before proxy.ts and the next.config.ts
      // headers, so they carry none of the baseline headers. The target is
      // the canonical path, and the body holds it and nothing else
      // (docs/deployment.md).
      const targets = listRoutes()
        .filter((route) => route.pattern !== '/' && routeAccess(profile, route) !== 'absent')
        .map((route) => concrete(route.pattern));
      expect(targets.length).toBeGreaterThan(0);
      for (const target of targets) {
        // The repeated slash goes whole, so no one reads it as a host.
        for (const sent of [`${target}/`, `${app.origin}/${target}`]) {
          const response = await request.get(sent, { maxRedirects: 0 });
          expect(response.status(), sent).toBe(308);
          expect(response.headers()['location'], sent).toBe(target);
          expect(await response.text(), sent).toBe(target);
        }
      }
    },
  );

  test(
    "a request with Next's router prefetch header and no RSC header, for a page or a /_next/ path that isn't a build file, gets an answer at once: the 404 page, or what proxy.ts answers first (#1)",
    { annotation: [{ type: 'route', description: 'every route' }, annotation] },
    async ({ request }) => {
      // Next's router sends it only beside RSC: 1. next.config.ts sends a
      // request without one to the 404 page; a redirect proxy.ts answers
      // itself, such as sign-in for a Studio page, stays as it is. A build
      // file is still served.
      const prefetch = { 'next-router-prefetch': '1', 'next-router-segment-prefetch': '/_tree' };
      const notFound = await request.get('/no-such-page');
      const asset = (await notFound.text()).match(/\/_next\/static\/[^"'?\s]+\.js/)?.[0];
      expect(asset, 'a build file the 404 page loads').toBeDefined();
      const served = await request.get(asset ?? '', { headers: prefetch, timeout: 5_000 });
      expect(served.status(), `${asset}, with the prefetch header`).toBe(200);
      const targets = [
        ...listRoutes()
          .filter((entry) => entry.kind === 'page' && routeAccess(profile, entry) !== 'absent')
          .map((entry) => concrete(entry.pattern)),
        '/no-such-page',
        '/_next/foo',
        '/_next/static/nonexistent.js',
      ];
      expect(targets.length).toBeGreaterThan(1);
      for (const target of targets) {
        for (const method of ['GET', 'HEAD'] as const) {
          const what = `${method} ${target}`;
          const page = await request.fetch(target, { method, maxRedirects: 0 });
          const redirect = page.status() >= 300 && page.status() < 400;
          const prefetched = await request.fetch(target, {
            method,
            maxRedirects: 0,
            headers: prefetch,
            timeout: 5_000,
          });
          expect(prefetched.status(), what).toBe(redirect ? page.status() : 404);
          if (redirect) {
            expect(prefetched.headers()['location'], what).toBe(page.headers()['location']);
            continue;
          }
          expect(prefetched.headers()['content-type'], what).toMatch(/^text\/html/);
          expect(prefetched.headers()['cache-control'], what).toMatch(/(?:^|,)\s*no-store/);
          if (method === 'GET') {
            expect(await prefetched.text(), what).toMatch(/<h1>Page not found<\/h1>/);
          }
        }
      }
    },
  );

  test(
    'no HTML response names localhost, and the server never resolves metadata against it',
    { annotation: [{ type: 'route', description: 'every route' }, annotation] },
    async ({ app, request }) => {
      // The app here is at 127.0.0.1, so localhost could only come from the
      // origin Next falls back to when a page's metadata has no
      // metadataBase, which it warns of in the log.
      let pages = 0;
      for (const target of scanTargets()) {
        const response = await request.get(target, { maxRedirects: 0 });
        if (!(response.headers()['content-type'] ?? '').startsWith('text/html')) continue;
        pages += 1;
        expect((await response.text()).includes('localhost'), `${target} names localhost`).toBe(
          false,
        );
      }
      expect(pages, 'HTML pages to look at').toBeGreaterThan(1);
      await new Promise((resolve) => setTimeout(resolve, 300));
      expect(readFileSync(app.log, 'utf8'), 'the server log').not.toContain('metadataBase');
    },
  );
}
