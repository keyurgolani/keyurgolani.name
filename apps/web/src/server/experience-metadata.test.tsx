import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { Metadata, ResolvedMetadata, ResolvingMetadata } from 'next';
import { readPair } from '@portfolio/schema/node';
import { FALLBACK_ID, validateManifest, type VariantRegistry } from '@portfolio/variant-contract';
import { REGISTRY } from '~/lib/variants';
import type { Profile } from './capabilities';
import type { LiveRevision } from './catalog-port';
import { readDeploymentConfig } from './config';
import { recordingLive } from './composition';
import { setDeploymentState, setLiveCaseStudies, setLiveComposition } from './config-store';
import { experienceMetadata } from './experience-metadata';
import { servedMetadata } from './page-guard';

// A visitor page's head metadata (#22): its og:url names the route's
// canonical path on the live site, and nothing under /sample or for a path
// that renders nothing, and it keeps the share image the layout resolved. A
// case study's is its own page, /work/<slug> (#10b).
// The route table reads the build's own registry, which declares no path
// view, so visitor-routes.test.ts shows a view's canonical is its parent.

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
];

const LIVE: LiveRevision = (() => {
  const result = readPair({
    portfolio: fileURLToPath(new URL('../../../../portfolio.example.yml', import.meta.url)),
    site: fileURLToPath(new URL('../../../../site.example.yml', import.meta.url)),
  });
  assert.ok(result.ok);
  const { portfolio, site } = result.pair;
  return {
    state: 'live',
    revisionId: 'doc-chapters',
    unitHash: 'hash-chapters',
    unit: {
      portfolio,
      site: { ...site, appearance: { ...site.appearance, variant: 'fixture-chapters' } },
      snapshots: {},
    },
  };
})();

const ORIGIN = 'https://rowan.test';

function deploy(t: TestContext, profile: Profile): { reads: () => number } {
  const read = readDeploymentConfig(
    {
      NODE_ENV: 'production',
      PORTFOLIO_PROFILE: profile,
      PORTFOLIO_ORIGIN: ORIGIN,
      ...(profile === 'demo' ? {} : { PORTFOLIO_SOURCE_DIR: '/srv/config' }),
    },
    { cwd: '/' },
  );
  assert.ok(read.ok, JSON.stringify(read.issues));
  let reads = 0;
  setDeploymentState({
    config: read.config,
    // The composition root's reader, which records the live case studies'
    // slugs the route table reads (#10b).
    catalog: recordingLive(
      {
        getLive: async () => {
          reads++;
          return LIVE;
        },
      },
      BUILD,
    ),
    dispatch: () => assert.fail('metadata runs no operation'),
    degraded: [],
  });
  t.after(() => {
    setDeploymentState(undefined);
    setLiveCaseStudies(undefined);
    setLiveComposition(undefined);
  });
  return { reads: () => reads };
}

/** What the layout resolved, as Next hands it to a page's generateMetadata. */
const IMAGE = {
  url: `${ORIGIN}/opengraph-image-12o0cb?0123456789abcdef`,
  width: 1200,
  height: 630,
};
const parent = (openGraph: object | null = { type: 'profile', images: [IMAGE] }) =>
  Promise.resolve({ openGraph } as unknown as ResolvedMetadata) as ResolvingMetadata;

const metadata = (route: string[], search: Record<string, string> = {}, from = parent()) =>
  experienceMetadata(BUILD)(
    { params: Promise.resolve({ route }), searchParams: Promise.resolve(search) },
    from,
  );

const openGraph = (head: Metadata) => head.openGraph as Record<string, unknown> | undefined;

for (const profile of ['owner', 'read-only'] as const) {
  test(`under ${profile}, home's og:url is / with no query, and keeps the layout's share image`, async (t) => {
    deploy(t, profile);
    const head = await metadata([], { utm_source: 'feed' });
    // Only the Open Graph tags: the title and the rest stay the layout's.
    assert.deepEqual(Object.keys(head), ['openGraph']);
    assert.equal(openGraph(head)?.url, '/');
    assert.deepEqual(openGraph(head)?.images, [IMAGE]);
    assert.equal(openGraph(head)?.type, 'profile');
  });
}

/** The example's one case study, its signature work, which a visible works section lists. */
const SLUG = 'postmortem-template-kit';

for (const profile of ['owner', 'read-only'] as const) {
  test(`under ${profile}, a case study's og:url is /work/<slug> with no query, and keeps the layout's share image`, async (t) => {
    const { reads } = deploy(t, profile);
    // The reader records the slugs as the site serves, before the route table asks.
    await metadata([]);
    assert.ok(reads() > 0);
    const head = await metadata(['work', SLUG], {
      utm_source: 'feed',
      variant: 'fixture-chapters',
    });
    assert.deepEqual(Object.keys(head), ['openGraph']);
    assert.equal(openGraph(head)?.url, `/work/${SLUG}`);
    assert.deepEqual(openGraph(head)?.images, [IMAGE]);
  });
}

test('a path that renders nothing adds nothing to the layout', async (t) => {
  deploy(t, 'read-only');
  await metadata([]);
  assert.deepEqual(await metadata(['nope']), {});
  assert.deepEqual(await metadata(['studio']), {});
  // A slug the live revision doesn't route: unknown, or a public work with no case study.
  assert.deepEqual(await metadata(['work', 'atlas']), {});
  assert.deepEqual(await metadata(['work', 'small-traces']), {});
});

test('a layout with no share image gives the page none', async (t) => {
  deploy(t, 'read-only');
  const head = await metadata([], {}, parent(null));
  assert.equal(openGraph(head)?.url, '/');
  assert.ok(!('images' in (openGraph(head) ?? {})), JSON.stringify(head));
});

test('under demo, a /sample page names no og:url and reads no revision for it', async (t) => {
  const { reads } = deploy(t, 'demo');
  assert.deepEqual(await metadata(['sample']), {});
  assert.deepEqual(
    await metadata(['sample', 'chapters', 'about'], { variant: 'fixture-chapters' }),
    {},
  );
  assert.equal(reads(), 0);
});

test("servedMetadata adds nothing, and reads nothing, where the profile doesn't serve its pattern", async (t) => {
  deploy(t, 'read-only');
  let calls = 0;
  const guarded = servedMetadata('/studio', async () => {
    calls++;
    return { title: 'Studio' };
  });
  assert.deepEqual(await guarded(), {});
  assert.equal(calls, 0);
  const served = servedMetadata('/feed.xml', async () => ({ title: 'Feed' }));
  assert.deepEqual(await served(), { title: 'Feed' });
});
