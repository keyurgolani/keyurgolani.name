import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolvePortfolioView, type PublicView, type Site } from '@portfolio/schema';
import { readPair } from '@portfolio/schema/node';
import {
  FALLBACK_ID,
  validateManifest,
  type RouteTarget,
  type VariantRegistry,
} from '@portfolio/variant-contract';
import { listRoutes, RETIRED_PATTERNS, routeResolver } from '../server/routes';
import { sampleSelection } from './sample';
import { REGISTRY } from './variants';
import { resolveVisitorPath, type VisitorPath, type VisitorRoute } from './visitor-routes';

// Which route a visitor's path is (#5, Slice 4), against a build that also
// registers the route tests' two fixture variants: fixture-chapters declares
// chapters/{chapter} under home and credits under work, and fixture-notes
// declares notes under home.

const FIXTURES = new URL('../../../../tests/fixtures/variants/', import.meta.url);

function fixture(name: string) {
  const read = (file: string) =>
    JSON.parse(readFileSync(new URL(`${name}/${file}`, FIXTURES), 'utf8'));
  const { name: packageName, version } = read('package.json');
  const result = validateManifest(read('manifest.json'), { packageName });
  assert.ok(result.ok, JSON.stringify(result.diagnostics));
  return { packageName, version, manifest: result.manifest };
}

const BUILD: VariantRegistry = [
  REGISTRY.find(({ manifest }) => manifest.id === FALLBACK_ID)!,
  fixture('chapters'),
  fixture('notes'),
];
const CHAPTERS = BUILD[1]!.manifest.routes.views.find((view) => view.id === 'chapters')!;

const EXAMPLES = {
  portfolio: fileURLToPath(new URL('../../../../portfolio.example.yml', import.meta.url)),
  site: fileURLToPath(new URL('../../../../site.example.yml', import.meta.url)),
};
const PAIR = (() => {
  const result = readPair(EXAMPLES);
  assert.ok(result.ok);
  return result.pair;
})();

/** The bundled pair's public view, its site selecting `variant`, with `routes` toggles. */
function viewFor(variant: string, routes?: Site['routes']): PublicView {
  const site = { ...PAIR.site, appearance: { ...PAIR.site.appearance, variant }, routes };
  return resolvePortfolioView({ portfolio: PAIR.portfolio, site }, {}, { mediaBase: '/media' });
}

/** What `path` resolves to, and whether resolving it loaded the view. */
async function resolve(
  path: Partial<VisitorPath> & { segments: string[] },
  view: PublicView = viewFor('fixture-chapters'),
): Promise<{ route: VisitorRoute; loaded: boolean }> {
  let loaded = false;
  const route = await resolveVisitorPath(
    { basePath: '', ...path },
    async () => {
      loaded = true;
      return view;
    },
    BUILD,
  );
  return { route, loaded };
}

/** A resolved render as [rendered id, target, canonical]. */
function rendered(route: VisitorRoute): [string, RouteTarget, string | undefined] {
  assert.equal(route.kind, 'render', JSON.stringify(route));
  if (route.kind !== 'render') throw new Error('unreachable');
  return [route.composition.rendered.manifest.id, route.target, route.canonical];
}

test("home and a path view of the site's variant render, the view canonical to home", async () => {
  assert.deepEqual(rendered((await resolve({ segments: [] })).route), [
    'fixture-chapters',
    { route: 'home' },
    undefined,
  ]);
  assert.deepEqual(rendered((await resolve({ segments: ['chapters', 'about'] })).route), [
    'fixture-chapters',
    { route: 'view', view: CHAPTERS, params: { chapter: 'about' } },
    '/',
  ]);
});

test('a path only another installed variant declares is a 307 to its canonical route', async () => {
  assert.deepEqual((await resolve({ segments: ['notes'] })).route, {
    kind: 'redirect',
    location: '/',
  });
  // After a switch to fixture-notes, the chapters it no longer serves redirect home.
  const notes = viewFor('fixture-notes');
  assert.deepEqual((await resolve({ segments: ['chapters', 'about'] }, notes)).route, {
    kind: 'redirect',
    location: '/',
  });
  assert.equal(rendered((await resolve({ segments: ['notes'] }, notes)).route)[0], 'fixture-notes');
  // The fallback composition, standing in for an unregistered selection, declares no view.
  const missing = viewFor('missing-variant');
  assert.deepEqual((await resolve({ segments: ['chapters', 'about'] }, missing)).route, {
    kind: 'redirect',
    location: '/',
  });
});

test('under /sample, the variant ?variant= names renders its views, and links and redirects keep it', async () => {
  // The sample site selects Editorial Evidence, which this build doesn't register.
  const sample = viewFor('editorial-evidence');
  const named = {
    basePath: '/sample',
    selected: 'fixture-chapters',
    query: { variant: 'fixture-chapters' },
  } as const;
  assert.deepEqual(
    rendered((await resolve({ ...named, segments: ['chapters', 'about'] }, sample)).route),
    [
      'fixture-chapters',
      { route: 'view', view: CHAPTERS, params: { chapter: 'about' } },
      '/sample?variant=fixture-chapters',
    ],
  );
  assert.deepEqual((await resolve({ ...named, segments: ['notes'] }, sample)).route, {
    kind: 'redirect',
    location: '/sample?variant=fixture-chapters',
  });
  // Without ?variant=, the sample's own selection: the fallback, whose path is another's.
  assert.deepEqual(
    (await resolve({ basePath: '/sample', segments: ['chapters', 'about'] }, sample)).route,
    { kind: 'redirect', location: '/sample' },
  );
});

test('anything else is missing: an undeclared path, a bare view prefix, or a turned-off view', async () => {
  for (const segments of [
    ['no-such-view'],
    ['chapters'],
    ['chapters', 'about', 'more'],
    ['Chapters', 'about'],
  ]) {
    assert.deepEqual(
      (await resolve({ segments })).route,
      { kind: 'not-found' },
      segments.join('/'),
    );
  }
  // A view the site turned off doesn't redirect anywhere either.
  const off = viewFor('fixture-chapters', { chapters: { enabled: false } });
  assert.deepEqual((await resolve({ segments: ['chapters', 'about'] }, off)).route, {
    kind: 'not-found',
  });
});

test('no work resolves until #10, so a work, its views, and redirects to one are missing', async () => {
  for (const segments of [
    ['work', 'tide-tables'],
    ['work', 'tide-tables', 'credits'],
    ['work', 'tide-tables', 'no-such-view'],
  ]) {
    for (const view of [viewFor('fixture-chapters'), viewFor('fixture-notes')]) {
      assert.deepEqual((await resolve({ segments }, view)).route, { kind: 'not-found' });
    }
  }
});

test('a path under a first segment the host owns is missing before the catalog loads', async () => {
  for (const segments of [
    ['api', 'no-such'],
    ['_next', 'image'],
    ['sample'],
    ['robots.txt'],
    ['admin'],
  ]) {
    const { route, loaded } = await resolve({ segments });
    assert.deepEqual(route, { kind: 'not-found' }, segments.join('/'));
    assert.equal(loaded, false, segments.join('/'));
  }
  // `work` is the work route's own, so it goes through dispatch.
  assert.equal((await resolve({ segments: ['work', 'x'] })).loaded, true);
});

/** Paths below the root or /sample, with every way to name a view or miss one. */
const PATHS: readonly string[][] = [
  [],
  ['chapters', 'about'],
  ['chapters', 'a'.repeat(64)],
  ['chapters', 'a'.repeat(65)],
  ['chapters'],
  ['chapters', 'about', 'more'],
  ['chapters', 'About'],
  ['notes'],
  ['notes', 'more'],
  ['credits'],
  ['no-such-view'],
  ['work', 'tide-tables'],
  ['work', 'tide-tables', 'credits'],
  ['api', 'no-such'],
  ['favicon.ico'],
  // Under a Studio page's first segment, where no route lists it (#2).
  ['studio', 'nowhere'],
];

test('the route table calls a path missing exactly when no visitor page renders or redirects it (#5, Slice 4)', async () => {
  const table = routeResolver(listRoutes(), RETIRED_PATTERNS, BUILD);
  // At the root, whichever variant the site selects.
  for (const segments of PATHS) {
    const pathname = `/${segments.join('/')}`;
    const missing = table('read-only', pathname).status === 'missing';
    for (const variant of ['fixture-chapters', 'fixture-notes', 'missing-variant']) {
      const { route } = await resolve({ segments }, viewFor(variant));
      assert.equal(route.kind === 'not-found', missing, `${variant} ${pathname}`);
    }
  }
  // Below /sample, with and without ?variant=, as the page reads it.
  const sample = viewFor(PAIR.site.appearance.variant);
  for (const segments of PATHS) {
    for (const query of ['', 'variant=fixture-chapters', 'variant=fixture-notes']) {
      const pathname = `/sample/${segments.join('/')}`;
      const params = new URLSearchParams(query);
      const missing = table('demo', pathname, params).status === 'missing';
      const selection = sampleSelection(Object.fromEntries(params), BUILD);
      assert.ok(selection, query);
      const { route } = await resolve({ segments, basePath: '/sample', ...selection }, sample);
      assert.equal(route.kind === 'not-found', missing, `${pathname}?${query}`);
    }
  }
});
