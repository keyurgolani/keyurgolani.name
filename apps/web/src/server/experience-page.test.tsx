import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { isValidElement } from 'react';
import { readPair } from '@portfolio/schema/node';
import { FALLBACK_ID, validateManifest, type VariantRegistry } from '@portfolio/variant-contract';
import {
  stylesheetHrefs,
  type AppearanceStylesheets,
  type ResolvedAppearance,
  type VisitorAppearanceModel,
} from '@portfolio/appearance';
import { REGISTRY } from '~/lib/variants';
import { GET as schemeRoute } from '../app/(site)/%5Fportfolio/scheme/[file]/route';
import type { LiveRevision } from './catalog-port';
import { recordingLive } from './composition';
import { readDeploymentConfig } from './config';
import {
  getDeploymentState,
  liveComposition,
  setDeploymentState,
  setLiveCaseStudies,
  setLiveComposition,
  type DeploymentState,
} from './config-store';
import { segmentFor } from './experience';
import { experiencePage } from './experience-page';
import { liveSchemes, preferenceCookie } from './visitor-appearance';

// A visitor page renders in its composition's experience segment (#6, Slice
// 2). proxy.ts picks the segment from the live composition config-store
// holds, and the page there reads that one value again once it has read the
// live revision: when the revision changed in between, it answers exactly one
// 307 to the same URL, and the segment the next request lands in renders.
// Against a build that registers the route tests' two fixture variants.

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

/** The demo deployment's PORTFOLIO_ORIGIN, which /sample's canonical redirect is built on (#9). */
const DEMO_ORIGIN = 'https://demo.rowan.test';

const PAIR = (() => {
  const result = readPair({
    portfolio: fileURLToPath(new URL('../../../../portfolio.example.yml', import.meta.url)),
    site: fileURLToPath(new URL('../../../../site.example.yml', import.meta.url)),
  });
  assert.ok(result.ok);
  return result.pair;
})();

/** The live revision with its site selecting `variant`. */
function revision(variant: string): LiveRevision {
  const site = { ...PAIR.site, appearance: { ...PAIR.site.appearance, variant } };
  return {
    state: 'live',
    revisionId: `doc-${variant}`,
    unitHash: `hash-${variant}`,
    unit: { portfolio: PAIR.portfolio, site, snapshots: {} },
  };
}

/** read-only, or demo, with a reader that hands out `live()`'s revision and records its composition. */
function deploy(
  t: TestContext,
  live: () => LiveRevision,
  profile: 'read-only' | 'demo' = 'read-only',
  dispatch: DeploymentState['dispatch'] = () => assert.fail('a page runs no operation'),
) {
  const read = readDeploymentConfig(
    profile === 'demo'
      ? { NODE_ENV: 'production', PORTFOLIO_PROFILE: 'demo', PORTFOLIO_ORIGIN: DEMO_ORIGIN }
      : {
          NODE_ENV: 'production',
          PORTFOLIO_PROFILE: 'read-only',
          PORTFOLIO_ORIGIN: 'https://rowan.test',
          PORTFOLIO_SOURCE_DIR: '/srv/config',
        },
    { cwd: '/' },
  );
  assert.ok(read.ok, JSON.stringify(read.issues));
  // Outside a request Next has no cookies: the visitor sent no preference.
  t.mock.method(preferenceCookie, 'read', async () => null);
  setDeploymentState({
    config: read.config,
    catalog: recordingLive({ getLive: async () => live() }, BUILD),
    dispatch,
    degraded: [],
  });
  t.after(() => {
    setDeploymentState(undefined);
    setLiveComposition(undefined);
    setLiveCaseStudies(undefined);
  });
}

const HostModules = () => null;

/** The experience segment page of `id`, as its generated route file builds it. */
const page = (id: string) =>
  experiencePage(
    id,
    async () => ({ default: () => <main id="main">{id}</main> }),
    HostModules,
    BUILD,
  );

/** What the page answers for `route` below its segment: a React element, or the error Next throws. */
async function answer(
  id: string,
  route: string[] = [],
  search: Readonly<Record<string, string | readonly string[]>> = {},
): Promise<{ element?: unknown; digest?: string }> {
  return answerAs(id, route, search as Record<string, string | string[]>);
}

async function answerAs(id: string, route: string[], search: Record<string, string | string[]>) {
  try {
    return {
      element: await page(id)({
        params: Promise.resolve({ route }),
        searchParams: Promise.resolve(search),
      }),
    };
  } catch (error) {
    return { digest: (error as { digest?: string }).digest ?? String(error) };
  }
}

test('a segment renders the composition it was rewritten for, and reads no other variant', async (t) => {
  deploy(t, () => revision('fixture-notes'));
  setLiveComposition('fixture-notes');
  const rendered = await answer('fixture-notes');
  assert.ok(rendered.element && isValidElement(rendered.element), JSON.stringify(rendered));
  assert.equal(liveComposition(), 'fixture-notes');
});

test('when the live revision changed after proxy.ts read it, the page answers exactly one 307 to the same URL, and the next request renders in the right segment', async (t) => {
  // proxy.ts read fixture-chapters, then the revision changed to fixture-notes.
  let current = revision('fixture-notes');
  deploy(t, () => current);
  setLiveComposition('fixture-chapters');
  const stale = await answer('fixture-chapters', [], { a: '1' });
  assert.deepEqual(stale, { digest: 'NEXT_REDIRECT;replace;/?a=1;307;' });
  // The reader recorded the new composition as the page read the revision:
  // the value the next request's rewrite reads.
  assert.equal(liveComposition(), 'fixture-notes');
  const next = segmentFor(
    { profile: 'read-only', pattern: '/', segments: [], query: new URLSearchParams('a=1') },
    BUILD,
  );
  assert.equal(next, 'fixture-notes');
  const fresh = await answer(next, [], { a: '1' });
  assert.ok(fresh.element && isValidElement(fresh.element), JSON.stringify(fresh));
  // And a revision that keeps changing still costs each request one 307 at most.
  current = revision('fixture-chapters');
  assert.equal((await answer('fixture-notes')).digest, 'NEXT_REDIRECT;replace;/;307;');
  assert.ok((await answer('fixture-chapters')).element);
});

test('a fallback composition standing in for an unregistered selection renders in the fallback segment', async (t) => {
  deploy(t, () => revision('acme-gone'));
  setLiveComposition('acme-gone');
  assert.ok((await answer(FALLBACK_ID)).element);
  assert.equal(liveComposition(), FALLBACK_ID);
  assert.equal((await answer('fixture-notes')).digest, 'NEXT_REDIRECT;replace;/;307;');
});

test("a path the table doesn't serve as a visitor page is the 404 page, in any segment", async (t) => {
  deploy(t, () => revision('fixture-notes'));
  setLiveComposition('fixture-notes');
  for (const route of [['sample'], ['work', 'tide-tables'], ['studio'], ['api', 'health']]) {
    const answered = await answer('fixture-notes', route);
    assert.match(answered.digest ?? '', /^NEXT_HTTP_ERROR_FALLBACK;404$/, route.join('/'));
  }
});

test("a work's own page, which fixture-notes leaves to the host, renders in the fallback segment proxy.ts names, with no 307, and a view below one stays in fixture-chapters' segment (#10b)", async (t) => {
  const slug = 'postmortem-template-kit';
  let current = revision('fixture-notes');
  deploy(t, () => current);
  await getDeploymentState()!.catalog.getLive();
  assert.equal(liveComposition(), 'fixture-notes');
  const at = (segments: string[]) =>
    segmentFor(
      { profile: 'read-only', pattern: '/work/[slug]', segments, query: new URLSearchParams() },
      BUILD,
    );
  assert.equal(at(['work', slug]), FALLBACK_ID);
  for (let request = 0; request < 2; request += 1) {
    const rendered = await answer(FALLBACK_ID, ['work', slug]);
    assert.ok(rendered.element && isValidElement(rendered.element), JSON.stringify(rendered));
  }
  // The live composition's own segment sends it on, once, to the same URL.
  assert.equal(
    (await answer('fixture-notes', ['work', slug])).digest,
    `NEXT_REDIRECT;replace;/work/${slug};307;`,
  );
  assert.equal(at(['work', slug]), FALLBACK_ID);
  // A view under the work is fixture-chapters' own, so proxy.ts names its
  // segment. (This build's route table, not BUILD, decides whether the view
  // exists, so visitor-routes.test.ts renders it.)
  current = revision('fixture-chapters');
  await getDeploymentState()!.catalog.getLive();
  const credits = segmentFor(
    {
      profile: 'read-only',
      pattern: '/work/[slug]/[...view]',
      segments: ['work', slug, 'credits'],
      query: new URLSearchParams(),
    },
    BUILD,
  );
  assert.equal(credits, 'fixture-chapters');
  assert.equal(at(['work', slug]), FALLBACK_ID);
  assert.ok((await answer(FALLBACK_ID, ['work', slug])).element);
});

test('a case study a publish dropped after proxy.ts read the slugs is the 404 page, and every request after it too (#10b)', async (t) => {
  // The example's one case study, its signature work.
  const slug = 'postmortem-template-kit';
  let current = revision('acme-gone');
  deploy(t, () => current);
  // The read register() makes at startup records the slugs, and the composition.
  await getDeploymentState()!.catalog.getLive();
  assert.ok((await answer(FALLBACK_ID, ['work', slug])).element);
  // The next revision drops the case study: the page reads it, and answers 404.
  const live = revision('acme-gone');
  current = {
    ...live,
    unit: {
      ...live.unit!,
      portfolio: {
        ...live.unit!.portfolio,
        works: live.unit!.portfolio.works?.map((work) => {
          const dropped = { ...work };
          delete dropped.caseStudy;
          return dropped;
        }),
      },
    },
  } as LiveRevision;
  for (let request = 0; request < 2; request += 1) {
    const answered = await answer(FALLBACK_ID, ['work', slug]);
    assert.match(answered.digest ?? '', /^NEXT_HTTP_ERROR_FALLBACK;404$/, `request ${request}`);
  }
});

/** Next's digest for a 307 to `location`, as redirect() from a page throws it. */
const redirectTo = (location: string) => `NEXT_REDIRECT;replace;${location};307;`;

test("under demo, /sample with its canonical query renders, in the segment of the variant it names or the sample's own", async (t) => {
  deploy(t, () => revision('fixture-notes'), 'demo');
  setLiveComposition('fixture-notes');
  for (const [id, search] of [
    ['fixture-notes', {}],
    ['fixture-notes', { mode: 'dark' }],
    ['fixture-chapters', { variant: 'fixture-chapters', mode: 'dark', motion: 'reduce' }],
  ] as const) {
    const rendered = await answer(id, ['sample'], search);
    assert.ok(rendered.element && isValidElement(rendered.element), JSON.stringify(search));
  }
});

test("under demo, /sample with any other query answers a 307 to the canonical one on PORTFOLIO_ORIGIN, whatever the request's host", async (t) => {
  deploy(t, () => revision('fixture-notes'), 'demo');
  setLiveComposition('fixture-notes');
  for (const [search, location] of [
    // An unknown variant falls back to the sample's own, and drops (#9).
    [{ variant: 'canary-variant' }, '/sample'],
    [{ variant: FALLBACK_ID, mode: 'dark' }, '/sample?mode=dark'],
    [{ variant: ['fixture-chapters', 'fixture-chapters'] }, '/sample'],
    // A value no axis accepts, a key outside the six, another order.
    [{ mode: 'sepia', language: 'no-such-language' }, '/sample'],
    [{ utm_source: 'mail', mode: 'dark' }, '/sample?mode=dark'],
    [{ motion: 'full' }, '/sample'],
    [{ mode: 'dark', variant: 'fixture-chapters' }, '/sample?variant=fixture-chapters&mode=dark'],
    // Text that looks like a URL or markup never reaches the location.
    [{ mode: '//evil.example', scheme: 'https://evil.example' }, '/sample'],
    [{ type: '<script>' }, '/sample'],
  ] as const) {
    const answered = await answer('fixture-notes', ['sample'], search);
    assert.equal(answered.digest, redirectTo(`${DEMO_ORIGIN}${location}`), JSON.stringify(search));
  }
});

test("under demo, the showroom at / reads the same keys but variant, which only /sample's picks, and sends any other query to the canonical one", async (t) => {
  deploy(t, () => revision('fixture-notes'), 'demo');
  setLiveComposition('fixture-notes');
  const rendered = await answer('fixture-notes', [], { mode: 'dark', motion: 'reduce' });
  assert.ok(rendered.element && isValidElement(rendered.element));
  for (const [search, location] of [
    [{ variant: 'fixture-chapters' }, '/'],
    [{ variant: 'fixture-chapters', mode: 'dark' }, '/?mode=dark'],
    [{ mode: 'sepia', x: '//evil.example' }, '/'],
  ] as const) {
    const answered = await answer('fixture-notes', [], search);
    assert.equal(answered.digest, redirectTo(`${DEMO_ORIGIN}${location}`), JSON.stringify(search));
  }
});

test('under read-only, the root reads no query, and sends none anywhere', async (t) => {
  deploy(t, () => revision('fixture-notes'));
  setLiveComposition('fixture-notes');
  const rendered = await answer('fixture-notes', [], { mode: 'sepia', variant: 'x' });
  assert.ok(rendered.element && isValidElement(rendered.element));
});

test('under demo, a /sample path with a dot segment and a query to drop is the 404 page the route table answers first, never a redirect', async (t) => {
  deploy(t, () => revision('fixture-notes'), 'demo');
  setLiveComposition('fixture-notes');
  for (const route of [
    ['sample', '..'],
    ['sample', '.', 'notes'],
  ]) {
    const answered = await answer('fixture-notes', route, { mode: 'sepia' });
    assert.match(answered.digest ?? '', /^NEXT_HTTP_ERROR_FALLBACK;404$/, route.join('/'));
  }
});

test('under read-only, /sample is no page at all, whatever its query', async (t) => {
  deploy(t, () => revision('fixture-notes'));
  setLiveComposition('fixture-notes');
  const answered = await answer('fixture-notes', ['sample'], { mode: 'sepia' });
  assert.match(answered.digest ?? '', /^NEXT_HTTP_ERROR_FALLBACK;404$/);
});

/** brand-seed's reference record (#20 PR 3), as the live revision's snapshots/schemes.json holds it. */
function storedBrandSeed() {
  const record = JSON.parse(
    readFileSync(
      new URL('../../../../packages/appearance-schemes/generated/brand-seed.json', import.meta.url),
      'utf8',
    ),
  ) as { result: { generator: unknown; input: { seedColor: string }; tokens: unknown } };
  return {
    generator: record.result.generator,
    inputsHash: createHash('sha256').update(record.result.input.seedColor).digest('hex'),
    tokens: record.result.tokens,
  };
}

/** The live revision selecting brand-seed, with `schemes` as its snapshots/schemes.json. */
function branded(schemes: unknown): LiveRevision {
  const site = {
    ...PAIR.site,
    appearance: { ...PAIR.site.appearance, variant: 'fixture-notes', colorScheme: 'brand-seed' },
  };
  return {
    state: 'live',
    revisionId: 'doc-branded',
    unitHash: 'hash-branded',
    unit: {
      portfolio: PAIR.portfolio,
      site,
      snapshots: schemes === undefined ? {} : { schemes },
    },
  };
}

/** The appearance the page's document boundary renders. */
function boundaryAppearance(element: unknown) {
  const children = (element as { props: { children: unknown[] } }).props.children;
  const boundary = children.find(
    (child) =>
      isValidElement(child) && (child.props as { appearance?: unknown }).appearance !== undefined,
  ) as { props: { appearance: { selection: { colorScheme: string } } } };
  return boundary.props.appearance;
}

test("a visitor page's stored schemes come from the request's own live revision, the cached getLive() its view reads (#20 PR 3)", () => {
  // React's cache() keeps one answer per request render, which a test outside
  // a request can't show, so this holds the read path: liveSchemes() and
  // getPublicView() read the one getLive() server/catalog.ts exports, and
  // neither reads the catalog port on its own.
  const source = (file: string) => readFileSync(new URL(`./${file}`, import.meta.url), 'utf8');
  for (const file of ['visitor-appearance.ts', 'public-view.ts']) {
    assert.match(source(file), /^import \{ getLive \} from '\.\/catalog';$/m, file);
    assert.doesNotMatch(source(file), /catalog\.getLive\(/, file);
  }
  assert.match(source('catalog.ts'), /^export \{ getLive \} from '\.\/live-revision';$/m);
  assert.match(source('live-revision.ts'), /export const getLive = cache\(/);
});

test("a visitor page renders a generated scheme from the live revision's stored sets, and only the live revision's (#20 PR 3)", async (t) => {
  const stored = storedBrandSeed();
  let current = branded({ 'brand-seed': stored });
  // A working draft with brand-seed's sets in its derived schemes, which any
  // operation would hand back: a visitor page never asks for it.
  const asked: string[] = [];
  const draft = { derived: { schemes: { 'brand-seed': stored } }, site: current.unit!.site };
  deploy(t, () => current, 'read-only', (async (operation: string) => {
    asked.push(operation);
    return { ok: true, value: draft };
  }) as never);
  setLiveComposition('fixture-notes');
  assert.deepEqual(await liveSchemes(), { 'brand-seed': stored });
  const live = await answer('fixture-notes');
  assert.ok(live.element, JSON.stringify(live));
  assert.equal(boundaryAppearance(live.element).selection.colorScheme, 'brand-seed');
  // The draft holds brand-seed's sets, and a visitor page reads the live
  // revision alone: one with no stored sets renders the scheme's fallback.
  current = branded(undefined);
  assert.equal(await liveSchemes(), undefined);
  const without = await answer('fixture-notes');
  assert.equal(boundaryAppearance(without.element).selection.colorScheme, 'warm-parchment');
  assert.deepEqual(asked, [], 'no operation, so no draft, was read');
});

/** The page's document boundary element's props: its appearance, stylesheets, and control. */
function boundaryProps(element: unknown) {
  const children = (element as { props: { children: unknown[] } }).props.children;
  return (
    children.find(
      (child) =>
        isValidElement(child) && (child.props as { appearance?: unknown }).appearance !== undefined,
    ) as {
      props: {
        appearance: ResolvedAppearance;
        stylesheets?: AppearanceStylesheets;
        control?: { model: VisitorAppearanceModel };
      };
    }
  ).props;
}

test('a site with a generated scheme renders it with its stylesheet linked from /_portfolio/scheme/, which serves the stored tokens, and the control preloads the same file (#20)', async (t) => {
  const stored = storedBrandSeed();
  deploy(t, () => branded({ 'brand-seed': stored }));
  setLiveComposition('fixture-notes');
  const live = await answer('fixture-notes');
  assert.ok(live.element, JSON.stringify(live));
  const { appearance, stylesheets, control } = boundaryProps(live.element);
  // The generated scheme renders, not its fallback.
  assert.equal(appearance.selection.colorScheme, 'brand-seed');
  assert.ok(!appearance.fallbackAxes.includes('colorScheme'), 'no fallback on the scheme');
  assert.ok(stylesheets, 'the page passes its own stylesheets');
  const hrefs = stylesheetHrefs(appearance.selection, stylesheets);
  const href = hrefs.find((each) => each.startsWith('/_portfolio/scheme/brand-seed.'));
  assert.ok(href, JSON.stringify(hrefs));
  assert.match(href, /^\/_portfolio\/scheme\/brand-seed\.[0-9a-f]{12}\.css$/);
  // The control loads that file before it applies the scheme.
  const choice = control?.model.controls
    .find((each) => each.axis === 'colorScheme')
    ?.groups.flatMap((group) => group.choices)
    .find((each) => each.value === 'brand-seed');
  assert.equal(choice?.stylesheet, href);
  // And the link serves the stored sets, compiled.
  const file = href.slice('/_portfolio/scheme/'.length);
  const response = await schemeRoute(new Request(`https://rowan.test${href}`), {
    params: Promise.resolve({ file }),
  });
  assert.equal(response.status, 200);
  const css = await response.text();
  assert.match(css, /\[data-color-scheme="brand-seed"\]/);
  const tokens = stored.tokens as { light: Record<string, string>; dark: Record<string, string> };
  for (const value of [tokens.light.canvas, tokens.dark.canvas, tokens.light.accent]) {
    assert.ok(css.includes(value!), `${value} renders`);
  }
  // With no stored sets, in a revision of its own, the scheme falls back,
  // and links no scheme file at all.
  const plain = branded(undefined);
  assert.ok(plain.unit);
  deploy(t, () => ({ ...plain, revisionId: 'doc-plain', unitHash: 'hash-plain' }));
  const without = boundaryProps((await answer('fixture-notes')).element);
  assert.ok(
    !stylesheetHrefs(without.appearance.selection, without.stylesheets!).some((each) =>
      each.startsWith('/_portfolio/scheme/'),
    ),
  );
});
