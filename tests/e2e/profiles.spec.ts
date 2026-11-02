import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import type * as FixtureGate from '../../apps/web/scripts/fixture-gate';
import type * as Capabilities from '../../apps/web/src/server/capabilities';
import type * as Routes from '../../apps/web/src/server/routes';
import { expect, test } from '../harness/fixtures';
import { profileMatrix, READ_ONLY_APP } from '../harness/profile-matrix';

// The route-level matrix (#1, AC4) for read-only, against the built server;
// demo.spec.ts runs it for demo, and owner.spec.ts for owner with the
// password provider (#2). The build's route manifests must list exactly the
// table's routes, so a route Next serves from outside src/app, or at a URL
// the table doesn't expect, fails here too. The visitor pages have no route
// of their own: each renders in its composition's experience segment, one
// route per registered variant (#6, Slice 2).

// apps/web has no "type": "module", so its modules are CommonJS to Node and
// load through require().
const require = createRequire(import.meta.url);
const { listExperienceRoutes, listRoutes } =
  require('../../apps/web/src/server/routes.ts') as typeof Routes;
const { FIXTURE_CAPABILITIES } =
  require('../../apps/web/src/server/capabilities.ts') as typeof Capabilities;
const { fixtureFlags } = require('../../apps/web/scripts/fixture-gate.ts') as typeof FixtureGate;

/**
 * Whether the build has `entry`'s route file: registry generation writes a
 * fixture route, such as #6's catalog fixture, only with its flag, which
 * this run's environment names as the build's did.
 */
function generated(entry: Routes.RouteEntry): boolean {
  if (!entry.fixtureRoute) return true;
  const fixtures: Readonly<Record<string, { readonly key: string }>> = FIXTURE_CAPABILITIES;
  const fixture = fixtures[entry.capability];
  return fixture !== undefined && fixtureFlags(process.env)[fixture.key] === true;
}

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
    const table = new Set(
      [
        ...listRoutes().filter((entry) => !entry.experience && generated(entry)),
        ...listExperienceRoutes(),
      ].map((entry) => entry.pattern),
    );
    expect([...new Set(built)].sort()).toEqual([...table].sort());
  },
);

test.use({ appOptions: READ_ONLY_APP });

profileMatrix('read-only');
