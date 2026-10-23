import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolvePortfolioView, routedSlugs, type PublicView, type Site } from '@portfolio/schema';
import { readPair } from '@portfolio/schema/node';
import {
  FALLBACK_ID,
  validateManifest,
  type RouteTarget,
  type VariantRegistry,
} from '@portfolio/variant-contract';
import { setLiveCaseStudies } from '../server/config-store';
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

/** The example's one case study: its signature work, which a visible works section lists. */
const SLUG = 'postmortem-template-kit';

/** The hidden fixture's public view: its case studies are a private work's and an unreached one's. */
const HIDDEN = (() => {
  const dir = fileURLToPath(new URL('../../../../tests/fixtures/hidden/', import.meta.url));
  const result = readPair({ portfolio: `${dir}portfolio.yml`, site: `${dir}site.yml` });
  assert.ok(result.ok);
  return resolvePortfolioView(result.pair, {}, { mediaBase: '/media' });
})();

/** What `path` resolves to, and whether resolving it loaded the view. */
async function resolve(
  path: Partial<VisitorPath> & { segments: string[] },
  view: PublicView = viewFor('fixture-chapters'),
  registry: VariantRegistry = BUILD,
): Promise<{ route: VisitorRoute; loaded: boolean }> {
  let loaded = false;
  const route = await resolveVisitorPath(
    { basePath: '', ...path },
    async () => {
      loaded = true;
      return view;
    },
    registry,
  );
  return { route, loaded };
}

/** A resolved render as [rendered id, target, canonical]. */
function rendered(route: VisitorRoute): [string, RouteTarget, string | undefined] {
  assert.equal(route.kind, 'render', JSON.stringify(route));
  if (route.kind !== 'render') throw new Error('unreachable');
  return [route.composition.rendered.manifest.id, route.target, route.canonical];
}

test("home and a path view of the site's variant render, home its own canonical and the view canonical to home", async () => {
  assert.deepEqual(rendered((await resolve({ segments: [] })).route), [
    'fixture-chapters',
    { route: 'home' },
    '/',
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
  // /sample's home isn't the live site's, so it names no canonical (#22).
  assert.equal(rendered((await resolve({ ...named, segments: [] }, sample)).route)[2], undefined);
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

test('a public case study renders at its slug, and its views as any view does (#10b)', async () => {
  // fixture-chapters says routes.work: shared, so the fallback composition
  // renders the work's own page (lib/work-page.ts).
  assert.deepEqual(rendered((await resolve({ segments: ['work', SLUG] })).route), [
    FALLBACK_ID,
    { route: 'work', slug: SLUG },
    undefined,
  ]);
  const credits = BUILD[1]!.manifest.routes.views.find((view) => view.id === 'credits')!;
  assert.deepEqual(rendered((await resolve({ segments: ['work', SLUG, 'credits'] })).route), [
    'fixture-chapters',
    { route: 'view', view: credits, params: {}, slug: SLUG },
    `/work/${SLUG}`,
  ]);
  // Only fixture-chapters declares credits: under fixture-notes, a 307 to the work.
  assert.deepEqual(
    (await resolve({ segments: ['work', SLUG, 'credits'] }, viewFor('fixture-notes'))).route,
    { kind: 'redirect', location: `/work/${SLUG}` },
  );
  // Under /sample, the link base and ?variant= stay.
  assert.deepEqual(
    (
      await resolve(
        {
          segments: ['work', SLUG, 'credits'],
          basePath: '/sample',
          selected: 'fixture-notes',
          query: { variant: 'fixture-notes' },
        },
        viewFor('editorial-evidence'),
      )
    ).route,
    { kind: 'redirect', location: `/sample/work/${SLUG}?variant=fixture-notes` },
  );
});

test("a work's own page renders in a composition that says routes.work: bespoke, and in the fallback composition for one that says shared, the site's selection kept (#10b)", async () => {
  const notes = BUILD[2]!;
  // fixture-notes, as a variant that renders its work pages itself.
  const bespoke = {
    ...notes,
    manifest: {
      ...notes.manifest,
      id: 'fixture-bespoke',
      routes: { ...notes.manifest.routes, work: 'bespoke' as const },
    },
  };
  const build: VariantRegistry = [...BUILD, bespoke];
  const work = { route: 'work', slug: SLUG } as const;
  const own = (await resolve({ segments: ['work', SLUG] }, viewFor('fixture-bespoke'), build))
    .route;
  assert.deepEqual(rendered(own), ['fixture-bespoke', work, undefined]);
  assert.equal(own.kind === 'render' && own.composition.fallback, false);
  for (const variant of ['fixture-chapters', 'fixture-notes']) {
    const shared = (await resolve({ segments: ['work', SLUG] }, viewFor(variant), build)).route;
    assert.deepEqual(rendered(shared), [FALLBACK_ID, work, undefined], variant);
    assert.ok(shared.kind === 'render');
    assert.equal(shared.composition.requested, variant);
    assert.equal(shared.composition.fallback, true);
    // Home and the variant's own views stay its own.
    assert.equal(
      rendered((await resolve({ segments: [] }, viewFor(variant), build)).route)[0],
      variant,
    );
  }
  // A view under work is the variant's, so it renders there.
  assert.equal(
    rendered((await resolve({ segments: ['work', SLUG, 'credits'] }, undefined, build)).route)[0],
    'fixture-chapters',
  );
  // Under /sample, ?variant= picks the composition, and the rule is the same.
  for (const [selected, expected] of [
    ['fixture-notes', FALLBACK_ID],
    ['fixture-bespoke', 'fixture-bespoke'],
  ] as const) {
    const sample = await resolve(
      {
        segments: ['work', SLUG],
        basePath: '/sample',
        selected,
        query: { variant: selected },
      },
      viewFor('editorial-evidence'),
      build,
    );
    assert.deepEqual(rendered(sample.route), [expected, work, undefined], selected);
  }
});

test('any other work is missing, its views and redirects included: unknown, with no case study, private, or unreached (#10b)', async () => {
  for (const slug of [
    'tide-tables',
    // A public work with no case study.
    'small-traces',
    'Postmortem-Template-Kit',
    `${SLUG}-x`,
  ]) {
    for (const segments of [
      ['work', slug],
      ['work', slug, 'credits'],
      ['work', slug, 'no-such-view'],
    ]) {
      for (const view of [viewFor('fixture-chapters'), viewFor('fixture-notes')]) {
        assert.deepEqual((await resolve({ segments }, view)).route, { kind: 'not-found' });
      }
    }
  }
  assert.deepEqual((await resolve({ segments: ['work'] })).route, { kind: 'not-found' });
  // The hidden fixture's case studies: a private work's, and a public one
  // only a hidden section reaches. Neither is in its view, so neither routes.
  assert.deepEqual([...routedSlugs(HIDDEN)], []);
  for (const slug of ['canary-hidden-private-slug', 'canary-hidden-record-slug']) {
    for (const segments of [
      ['work', slug],
      ['work', slug, 'credits'],
    ]) {
      assert.deepEqual((await resolve({ segments }, HIDDEN)).route, { kind: 'not-found' }, slug);
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
  ['work', SLUG],
  ['work', SLUG, 'credits'],
  ['work', SLUG, 'notes'],
  ['work', 'small-traces'],
  ['work'],
  ['api', 'no-such'],
  ['favicon.ico'],
  // Under a Studio page's first segment, where no route lists it (#2).
  ['studio', 'nowhere'],
];

test('the route table calls a path missing exactly when no visitor page renders or redirects it (#5, Slice 4)', async (t) => {
  const table = routeResolver(listRoutes(), RETIRED_PATTERNS, BUILD);
  // The slugs the composition root's reader records from the same view (#10b).
  t.after(() => setLiveCaseStudies(undefined));
  setLiveCaseStudies(routedSlugs(viewFor('fixture-chapters')));
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
