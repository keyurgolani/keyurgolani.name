import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { listRoutes } from '../src/server/routes';
import { FIXTURE_CAPABILITIES } from '../src/server/capabilities';
import { FIXTURE_ROWS } from './fixture-gate';
import { FIXTURE_ROUTES, renderFixtureRoutes, writeFixtureRoutes } from './fixture-routes';

// The fixture pages generation writes (#6, item 5): the catalog fixture's
// route file exists only with BUDGET_FIXTURES, goes without it, and a file
// there no generation wrote stops generation.

const CATALOG = '(studio)/studio/%5Fcatalog-fixture/page.tsx';

test("each fixture route is a table entry's, under a capability of its flag's key, which a gate row maps", () => {
  const fixtures: Readonly<Record<string, { readonly flag: string; readonly key: string }>> =
    FIXTURE_CAPABILITIES;
  for (const route of FIXTURE_ROUTES) {
    const entry = listRoutes().find(({ pattern }) => pattern === route.pattern);
    assert.ok(entry?.fixtureRoute, route.pattern);
    const fixture = fixtures[entry.capability];
    assert.equal(fixture?.key, route.key, route.pattern);
    assert.ok(FIXTURE_ROWS.some(({ flag, key }) => flag === fixture!.flag && key === route.key));
  }
  // And every table entry marked a fixture route has a route here.
  for (const entry of listRoutes().filter(({ fixtureRoute }) => fixtureRoute)) {
    assert.ok(
      FIXTURE_ROUTES.some(({ pattern }) => pattern === entry.pattern),
      entry.pattern,
    );
  }
});

test("the catalog fixture's page is rendered with its flag alone, and guards the owner first", () => {
  assert.deepEqual([...renderFixtureRoutes({}).keys()], []);
  assert.deepEqual([...renderFixtureRoutes({ appearance: true }).keys()], []);
  const page = renderFixtureRoutes({ budget: true }).get(CATALOG);
  assert.ok(page);
  assert.match(page, /const owner = await requireOwnerPage\('catalog\.fixtures'\);/);
  assert.match(page, /servedPage\("\/studio\/_catalog-fixture", CatalogFixturePage\)/);
});

test('generation writes a flagged route, keeps it, removes it without the flag, and stops at one it never wrote', () => {
  const app = fs.mkdtempSync(path.join(os.tmpdir(), 'portfolio-app-'));
  try {
    const target = path.join(app, CATALOG);
    const flagged = renderFixtureRoutes({ budget: true });
    assert.deepEqual(writeFixtureRoutes(app, flagged).written, [CATALOG]);
    assert.deepEqual(writeFixtureRoutes(app, flagged).unchanged, [CATALOG]);
    assert.deepEqual(writeFixtureRoutes(app, renderFixtureRoutes({})).removed, [CATALOG]);
    assert.equal(fs.existsSync(path.dirname(target)), false);
    // A page there that generation didn't write: a fixture page another way.
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, 'export default function Page() { return null; }\n');
    for (const files of [renderFixtureRoutes({}), flagged]) {
      assert.throws(() => writeFixtureRoutes(app, files), /a fixture route no generation wrote/);
    }
    assert.equal(
      fs.readFileSync(target, 'utf8'),
      'export default function Page() { return null; }\n',
    );
  } finally {
    fs.rmSync(app, { recursive: true, force: true });
  }
});
