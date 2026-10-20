// The route-level matrix (#1, AC4) for one profile, generated from the route
// table and the operation registry and run against the built server: every
// page, route, and operation the profile doesn't serve fails closed, and
// each one it serves answers. No response sets a cookie, and under a profile
// crawlers may not index (demo), every response says so. A spec runs it for
// the profile its app options start.
import { createRequire } from 'node:module';
import type { APIResponse } from '@playwright/test';
import type * as Capabilities from '../../apps/web/src/server/capabilities';
import type * as Operations from '../../apps/web/src/server/operations';
import type * as Routes from '../../apps/web/src/server/routes';
import { expect, test, type AppOptions } from './fixtures';

// apps/web has no "type": "module", so its modules are CommonJS to Node and
// load through require().
const require = createRequire(import.meta.url);
const { accessIn, INDEXABLE } =
  require('../../apps/web/src/server/capabilities.ts') as typeof Capabilities;
const { listOperations } = require('../../apps/web/src/server/operations.ts') as typeof Operations;
const { listRoutes, RETIRED_PATTERNS, routeAccess } =
  require('../../apps/web/src/server/routes.ts') as typeof Routes;
type Profile = Capabilities.Profile;
type Operation = Operations.Operation;

/** The demo profile on the bundled sample, with no source directory: demo reads none. */
export const DEMO_APP: AppOptions = {
  env: { PORTFOLIO_PROFILE: 'demo', PORTFOLIO_SOURCE_DIR: '' },
  portfolio: null,
};

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
  // No provider: the origin check refuses every command.
  if (operation.kind === 'command') return [403, 'request_origin_rejected'];
  return [200, null];
}

/** No cookie, and noindex exactly where the profile can't be indexed. */
function expectProfileHeaders(profile: Profile, response: APIResponse, what: string) {
  const headers = response.headers();
  expect(headers['set-cookie'], `${what}: no cookie`).toBeUndefined();
  expect(headers['x-robots-tag'], `${what}: X-Robots-Tag`).toBe(
    INDEXABLE[profile] ? undefined : 'noindex',
  );
}

/** Registers the matrix for `profile`, which the spec's app options must start. */
export function profileMatrix(profile: Profile): void {
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
}
