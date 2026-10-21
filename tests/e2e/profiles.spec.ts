import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import type * as Routes from '../../apps/web/src/server/routes';
import { expect, test } from '../harness/fixtures';
import { profileMatrix, READ_ONLY_APP } from '../harness/profile-matrix';

// The route-level matrix (#1, AC4) for read-only, against the built server;
// demo.spec.ts runs it for demo, and owner.spec.ts for owner with the
// password provider (#2). The build's route manifests must list exactly the
// table's routes, so a route Next serves from outside src/app, or at a URL
// the table doesn't expect, fails here too.

// apps/web has no "type": "module", so its modules are CommonJS to Node and
// load through require().
const require = createRequire(import.meta.url);
const { listRoutes } = require('../../apps/web/src/server/routes.ts') as typeof Routes;

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

test(
  'the build serves the routes in the table and no others',
  { annotation: [{ type: 'route', description: 'every route' }] },
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

test.use({ appOptions: READ_ONLY_APP });

profileMatrix('read-only');
