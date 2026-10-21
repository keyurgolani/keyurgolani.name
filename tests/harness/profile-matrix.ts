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

/** A concrete path for a pattern, filling each dynamic segment. */
const concrete = (pattern: string) => pattern.replace(/\[\[?\.{0,3}[^\]]+\]\]?/g, 'sample') || '/';

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

/** The headers next.config.ts sets on every route (#1, item 22). */
const BASELINE_HEADERS = {
  'x-content-type-options': 'nosniff',
  'referrer-policy': 'strict-origin-when-cross-origin',
  'content-security-policy': "frame-ancestors 'none'",
} as const;

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

/**
 * The baseline headers, no cookie, and noindex exactly where the profile
 * can't be indexed.
 */
function expectProfileHeaders(profile: Profile, response: APIResponse, what: string) {
  const headers = response.headers();
  for (const [name, value] of Object.entries(BASELINE_HEADERS)) {
    expect(headers[name], `${what}: ${name}`).toBe(value);
  }
  expect(headers['set-cookie'], `${what}: no cookie`).toBeUndefined();
  expect(headers['x-robots-tag'], `${what}: X-Robots-Tag`).toBe(
    INDEXABLE[profile] ? undefined : 'noindex',
  );
}

/** Every target the leak scan requests: each route, retired route, and operation, and some that don't exist. */
function scanTargets(): string[] {
  return [
    ...listRoutes()
      .filter((route) => route.capability !== 'operations')
      .map((route) => concrete(route.pattern)),
    ...RETIRED_PATTERNS.map(concrete),
    ...listOperations().map((operation) => `/api/studio/${operation.name}`),
    '/api/studio/no.such.operation',
    '/no-such-page',
    '/api/no-such-route',
    IMAGE_PROBE,
  ];
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
    const served = routeAccess(profile, entry) !== 'absent';
    test(
      `${entry.pattern} is ${served ? 'served' : 'absent, 404 for every method'}`,
      { annotation: [{ type: 'route', description: entry.pattern }, annotation] },
      async ({ request }) => {
        if (served) {
          const response = await request.get(concrete(entry.pattern), { maxRedirects: 0 });
          expect(response.status()).toBe(200);
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
    'a trailing slash is a 308 to the path without it, whose body is only that path',
    { annotation: [{ type: 'route', description: 'every route' }, annotation] },
    async ({ request }) => {
      // Next answers these itself, before proxy.ts and the next.config.ts
      // headers, so they carry none of the baseline headers. The target is
      // the canonical path, and the body holds it and nothing else
      // (docs/deployment.md).
      const targets = listRoutes()
        .filter((route) => route.pattern !== '/' && routeAccess(profile, route) !== 'absent')
        .map((route) => concrete(route.pattern));
      expect(targets.length).toBeGreaterThan(0);
      for (const target of targets) {
        const response = await request.get(`${target}/`, { maxRedirects: 0 });
        expect(response.status(), target).toBe(308);
        expect(response.headers()['location'], target).toBe(target);
        expect(await response.text(), target).toBe(target);
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
