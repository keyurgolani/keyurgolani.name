import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import type * as Capabilities from '../../apps/web/src/server/capabilities';
import type * as Operations from '../../apps/web/src/server/operations';
import type * as Routes from '../../apps/web/src/server/routes';
import { expect, test } from '../harness/fixtures';

// apps/web has no "type": "module", so its modules are CommonJS to Node and
// load through require().
const require = createRequire(import.meta.url);
const { accessIn } = require('../../apps/web/src/server/capabilities.ts') as typeof Capabilities;
const { listOperations } = require('../../apps/web/src/server/operations.ts') as typeof Operations;
const { listRoutes, RETIRED_PATTERNS, routeAccess } =
  require('../../apps/web/src/server/routes.ts') as typeof Routes;
type Profile = Capabilities.Profile;
type Operation = Operations.Operation;

// The route-level matrix (#1, AC4) for read-only, generated from the route
// table and the operation registry and run against the built server. Every
// page, route, and operation the profile doesn't serve fails closed, and
// each one it serves answers. Owner runs the same matrix in process until #2
// ships a provider (server/composition-owner.test.ts); demo joins with its
// catalog. The build's route manifests must list exactly the table's routes,
// so a route Next serves from outside src/app, or at a URL the table doesn't
// expect, fails here too.

const PROFILE: Profile = 'read-only';
const READ_ONLY = { type: 'profile', description: PROFILE };
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const METHODS = ['GET', 'POST', 'PUT', 'DELETE'] as const;

// The build's own entries in its route manifests, which no route file declares.
const NEXT_ENTRIES = new Set([
  '/_not-found',
  '/_global-error',
  '/_app',
  '/_document',
  '/_error',
  '/404',
  '/500',
]);

/** A JSON manifest from the build under test, in apps/web/.next. */
function manifest(file: string): Record<string, string> {
  const url = new URL(`../../apps/web/.next/${file}`, import.meta.url);
  return JSON.parse(readFileSync(url, 'utf8')) as Record<string, string>;
}

/** A concrete path for a pattern, filling each dynamic segment. */
const concrete = (pattern: string) => pattern.replace(/\[\[?\.{0,3}[^\]]+\]\]?/g, 'sample') || '/';

/** What the transport answers a visitor with no session, by the registry and the matrix. */
function expected(operation: Operation, method: string): [status: number, code: string | null] {
  if (accessIn(PROFILE, operation.capability) === 'absent')
    return [404, 'not_available_in_profile'];
  if (method !== (operation.kind === 'query' ? 'GET' : 'POST')) return [405, 'method_not_allowed'];
  if (operation.session) return [401, 'authentication_required'];
  // No provider: the origin check refuses every command.
  if (operation.kind === 'command') return [403, 'request_origin_rejected'];
  return [200, null];
}

test(
  'the build serves the routes in the table and no others',
  { annotation: [{ type: 'route', description: 'every route' }, READ_ONLY] },
  () => {
    // App Router routes map to their URLs; Pages Router URLs are the keys.
    const built = [
      ...Object.values(manifest('app-path-routes-manifest.json')),
      ...Object.keys(manifest('server/pages-manifest.json')),
    ].filter((url) => !NEXT_ENTRIES.has(url));
    const table = new Set(listRoutes().map((entry) => entry.pattern));
    expect([...new Set(built)].sort()).toEqual([...table].sort());
  },
);

for (const entry of listRoutes().filter((route) => route.capability !== 'operations')) {
  const served = routeAccess(PROFILE, entry) !== 'absent';
  test(
    `${entry.pattern} is ${served ? 'served' : 'absent, 404 for every method'}`,
    { annotation: [{ type: 'route', description: entry.pattern }, READ_ONLY] },
    async ({ request }) => {
      if (served) {
        const response = await request.get(concrete(entry.pattern), { maxRedirects: 0 });
        expect(response.status()).toBe(200);
        expect(response.headers()['x-request-id']).toMatch(UUID);
        return;
      }
      for (const method of METHODS) {
        const response = await request.fetch(concrete(entry.pattern), { method, maxRedirects: 0 });
        expect(response.status(), method).toBe(404);
      }
    },
  );
}

for (const pattern of RETIRED_PATTERNS) {
  test(
    `retired ${pattern} is 404 for every method`,
    { annotation: [{ type: 'route', description: pattern }, READ_ONLY] },
    async ({ request }) => {
      for (const method of METHODS) {
        const response = await request.fetch(concrete(pattern), { method, maxRedirects: 0 });
        expect(response.status(), method).toBe(404);
        expect(response.headers()['cache-control'], method).toBe('no-store');
      }
    },
  );
}

for (const operation of listOperations()) {
  test(
    `operation ${operation.name} fails closed as the matrix says, for every method`,
    { annotation: [{ type: 'route', description: '/api/studio/[name]' }, READ_ONLY] },
    async ({ request }) => {
      for (const method of METHODS) {
        const response = await request.fetch(`/api/studio/${operation.name}`, {
          method,
          data: method === 'GET' ? undefined : {},
          headers: { 'x-request-id': 'client-chosen' },
        });
        const [status, code] = expected(operation, method);
        expect(response.status(), method).toBe(status);
        expect(response.headers()['cache-control'], method).toBe('no-store');
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
  { annotation: [{ type: 'route', description: '/api/studio/[name]' }, READ_ONLY] },
  async ({ request }) => {
    for (const name of ['publish', 'draft.write', 'no.such.operation']) {
      const response = await request.post(`/api/studio/${name}`, { data: {} });
      expect(response.status(), name).toBe(404);
      const { error } = (await response.json()) as { error: Record<string, string> };
      expect(error.code, name).toBe('not_available_in_profile');
    }
  },
);
