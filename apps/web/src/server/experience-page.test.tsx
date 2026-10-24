import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { isValidElement } from 'react';
import { readPair } from '@portfolio/schema/node';
import { FALLBACK_ID, validateManifest, type VariantRegistry } from '@portfolio/variant-contract';
import { REGISTRY } from '~/lib/variants';
import type { LiveRevision } from './catalog-port';
import { recordingLive } from './composition';
import { readDeploymentConfig } from './config';
import {
  getDeploymentState,
  liveComposition,
  setDeploymentState,
  setLiveCaseStudies,
  setLiveComposition,
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

/** read-only, with a reader that hands out `live()`'s revision and records its composition. */
function deploy(t: TestContext, live: () => LiveRevision) {
  const read = readDeploymentConfig(
    {
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
    dispatch: () => assert.fail('a page runs no operation'),
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
async function answer(id: string, route: string[] = [], search: Record<string, string> = {}) {
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

test("a visitor page renders a generated scheme from the live revision's stored sets, and only the live revision's (#20 PR 3)", async (t) => {
  const stored = storedBrandSeed();
  let current = branded({ 'brand-seed': stored });
  deploy(t, () => current);
  setLiveComposition('fixture-notes');
  assert.deepEqual(await liveSchemes(), { 'brand-seed': stored });
  const live = await answer('fixture-notes');
  assert.ok(live.element, JSON.stringify(live));
  assert.equal(boundaryAppearance(live.element).selection.colorScheme, 'brand-seed');
  // Whatever a draft holds, a visitor page reads the live revision alone:
  // one with no stored sets renders the scheme's fallback.
  current = branded(undefined);
  assert.equal(await liveSchemes(), undefined);
  const without = await answer('fixture-notes');
  assert.equal(boundaryAppearance(without.element).selection.colorScheme, 'warm-parchment');
});
