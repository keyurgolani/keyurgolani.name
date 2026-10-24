import { createRequire } from 'node:module';
import path from 'node:path';
import type { APIResponse } from '@playwright/test';
import type * as Capabilities from '../../apps/web/src/server/capabilities';
import type * as Operations from '../../apps/web/src/server/operations';
import type * as Routes from '../../apps/web/src/server/routes';
import { canaries, CANARY_BODY, encodings } from '../harness/canaries.mjs';
import { expect, test } from '../harness/fixtures';
import { DEMO_APP } from '../harness/profile-matrix';
import { concrete } from '../harness/scan-targets';

// The fail-closed probes for the demo profile (#9, A2), generated from #1's
// registry: every route entry and every operation the demo policy doesn't
// allow, and the baseline's authoring routes, fail closed. No response,
// allowed ones included, carries x-portfolio-path, a cookie, or any draft,
// history, path, session, or settings data. The profile matrix checks each
// entry's status and headers one by one; this reads every body against
// what the owner's data looks like on the wire.

// apps/web has no "type": "module", so its modules are CommonJS to Node and
// load through require().
const require = createRequire(import.meta.url);
const { accessIn } = require('../../apps/web/src/server/capabilities.ts') as typeof Capabilities;
const { listOperations } = require('../../apps/web/src/server/operations.ts') as typeof Operations;
const { listRoutes, RETIRED_PATTERNS, routeAccess } =
  require('../../apps/web/src/server/routes.ts') as typeof Routes;

test.use({ appOptions: DEMO_APP });

const DEMO = { type: 'profile', description: 'demo' };

/**
 * The baseline's authoring routes (#9, A2): #1's retired list, which holds
 * /admin, /variants, /api/portfolio, /api/variant, and /api/customize, and
 * the old /preview/[slug], whose prefix #7's grant routes now own.
 */
const BASELINE = [...RETIRED_PATTERNS, '/preview/editorial', '/preview/editorial/work/probe'];

/**
 * What draft, history, path, session, or settings data looks like in a
 * body: #3's draft and history fields as JSON keys, #2's session cookie and
 * CSRF field, #1's settings and configuration summary, a canary draft body,
 * and filesystem paths. Each in every encoding a page or a payload could
 * write it in.
 */
const OWNER_DATA = [
  '"draftId"',
  '"baseRevisionId"',
  '"expectedVersion"',
  '"previousRevisionId"',
  '"restoredFrom"',
  '"csrfToken"',
  'studio_session',
  '"previewOrigin"',
  '"dataDir"',
  '"sourceDir"',
  'PORTFOLIO_',
  CANARY_BODY,
];

const METHODS = ['GET', 'POST'] as const;

test(
  'every entry the demo policy denies, and every baseline route, fails closed, and no response carries draft, history, path, session, or settings data',
  { annotation: [{ type: 'route', description: 'every route' }, DEMO] },
  async ({ app, request }) => {
    const answered: Array<{ what: string; response: APIResponse }> = [];
    const send = async (target: string, method: (typeof METHODS)[number]) => {
      const response = await request.fetch(target, {
        method,
        maxRedirects: 0,
        data: method === 'POST' ? {} : undefined,
      });
      answered.push({ what: `${method} ${target}`, response });
      return response;
    };

    // Every route entry demo doesn't serve, to every method: 404. Not the owner's /studio,
    // whose path demo serves as Demo Studio, by its own entry (#9).
    const servedHere = (pattern: string) =>
      listRoutes().some(
        (each) => each.pattern === pattern && routeAccess('demo', each) !== 'absent',
      );
    const denied = listRoutes().filter(
      (entry) => entry.capability !== 'operations' && !servedHere(entry.pattern),
    );
    expect(denied.length, 'the demo policy denies some route').toBeGreaterThan(0);
    for (const entry of denied) {
      for (const method of METHODS) {
        expect((await send(concrete(entry.pattern), method)).status(), entry.pattern).toBe(404);
      }
    }
    // Every operation demo's policy denies, to every method: #1's fail-closed error.
    const refused = listOperations().filter(
      (operation) => accessIn('demo', operation.capability) === 'absent',
    );
    expect(refused.length, 'the demo policy denies some operation').toBeGreaterThan(0);
    for (const operation of refused) {
      for (const method of METHODS) {
        const response = await send(`/api/studio/${operation.name}`, method);
        expect(response.status(), `${method} ${operation.name}`).toBe(404);
        const { error } = (await response.json()) as { error: Record<string, string> };
        expect(error.code, `${method} ${operation.name}`).toBe('not_available_in_profile');
      }
    }
    // The baseline's authoring routes, to every method: 404.
    for (const target of BASELINE) {
      for (const method of METHODS) {
        expect((await send(concrete(target), method)).status(), target).toBe(404);
      }
    }
    // And every entry demo does serve, and every operation it allows, read as a visitor reads them.
    for (const entry of listRoutes()) {
      if (entry.capability === 'operations' || routeAccess('demo', entry) === 'absent') continue;
      await send(concrete(entry.pattern), 'GET');
    }
    for (const operation of listOperations()) {
      if (accessIn('demo', operation.capability) === 'absent') continue;
      await send(`/api/studio/${operation.name}`, operation.kind === 'query' ? 'GET' : 'POST');
    }

    const needles = [
      ...canaries(path.basename(app.root)),
      ...encodings(app.root),
      ...OWNER_DATA.flatMap(encodings),
    ];
    for (const { what, response } of answered) {
      const headers = response.headers();
      expect(headers['x-portfolio-path'], `${what}: x-portfolio-path`).toBeUndefined();
      expect(headers['set-cookie'], `${what}: set-cookie`).toBeUndefined();
      const body = await response.text();
      const found = needles.filter((needle) => body.includes(needle));
      expect(found, `${what}: owner data in the body`).toEqual([]);
      for (const [name, value] of Object.entries(headers)) {
        const leaked = needles.filter((needle) => value.includes(needle));
        expect(leaked, `${what}: owner data in ${name}`).toEqual([]);
      }
    }
  },
);
