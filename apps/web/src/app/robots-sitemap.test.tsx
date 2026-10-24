import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { readPair } from '@portfolio/schema/node';
import type { LiveRevision } from '~/server/catalog-port';
import type { Profile } from '~/server/capabilities';
import { readDeploymentConfig } from '~/server/config';
import { setDeploymentState } from '~/server/config-store';
import robots from './robots';
import sitemap from './sitemap';

// robots.txt and the sitemap per profile (#22): owner and read-only keep
// crawlers out of Studio and the API and name the sitemap on the origin;
// demo lets them fetch every page, so they see its noindex, and names no
// sitemap, which is empty. The sitemap lists home and each case study the
// live revision routes (#10b), on the origin, from the revision the
// deployment serves: never a private work's, nor one only a hidden section
// reaches. The same revision answers the same bytes.

const ORIGIN = 'https://rowan.test';

/** A pair's live revision, read from `dir`'s portfolio and site documents. */
function revisionOf(portfolio: string, site: string): LiveRevision {
  const read = readPair({
    portfolio: fileURLToPath(new URL(portfolio, import.meta.url)),
    site: fileURLToPath(new URL(site, import.meta.url)),
  });
  assert.ok(read.ok, JSON.stringify(read));
  return {
    state: 'live',
    revisionId: 'doc-sitemap',
    unitHash: 'hash-sitemap',
    unit: { ...read.pair, snapshots: {} },
  };
}

/** The bundled example: one case study, its signature work, which a visible works section lists. */
const EXAMPLE = revisionOf('../../../../portfolio.example.yml', '../../../../site.example.yml');
const EXAMPLE_SLUG = 'postmortem-template-kit';

/** The hidden fixture: a private work's case study, and one only a hidden section reaches. */
const HIDDEN = revisionOf(
  '../../../../tests/fixtures/hidden/portfolio.yml',
  '../../../../tests/fixtures/hidden/site.yml',
);

/** Deploys `profile` with a reader that serves `live`, and counts its reads. */
function deploy(t: TestContext, profile: Profile, live: LiveRevision = EXAMPLE): { reads: number } {
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
  const counted = { reads: 0 };
  setDeploymentState({
    config: read.config,
    catalog: {
      getLive: async () => {
        counted.reads += 1;
        return live;
      },
    },
    dispatch: () => assert.fail('they run no operation'),
    degraded: [],
  });
  t.after(() => setDeploymentState(undefined));
  return counted;
}

for (const profile of ['owner', 'read-only'] as const) {
  test(`under ${profile}, robots keeps crawlers out of Studio and the API, and the sitemap lists home and each routed case study on the origin with no date`, async (t) => {
    const reads = deploy(t, profile);
    assert.deepEqual(robots(), {
      rules: [{ userAgent: '*', allow: '/', disallow: ['/studio', '/api/'] }],
      sitemap: `${ORIGIN}/sitemap.xml`,
      host: ORIGIN,
    });
    assert.equal(reads.reads, 0, 'robots reads no revision');
    const first = await sitemap();
    assert.deepEqual(first, [
      { url: `${ORIGIN}/`, changeFrequency: 'weekly', priority: 1 },
      { url: `${ORIGIN}/work/${EXAMPLE_SLUG}`, changeFrequency: 'weekly', priority: 0.8 },
    ]);
    assert.ok(reads.reads > 0, 'the sitemap reads the live revision');
    // No entry carries a query string, and none a date.
    for (const entry of first) {
      assert.equal(new URL(entry.url).search, '', entry.url);
      assert.equal('lastModified' in entry, false, entry.url);
    }
    assert.deepEqual(await sitemap(), first);
  });

  test(`under ${profile}, the sitemap lists no private work's case study and none only a hidden section reaches`, async (t) => {
    deploy(t, profile, HIDDEN);
    const urls = (await sitemap()).map(({ url }) => url);
    assert.deepEqual(urls, [`${ORIGIN}/`]);
    for (const slug of ['canary-hidden-private-slug', 'canary-hidden-record-slug']) {
      assert.ok(!urls.some((url) => url.includes(slug)), slug);
    }
  });
}

test('under demo, robots disallows nothing and names no sitemap, and the sitemap is empty', async (t) => {
  const reads = deploy(t, 'demo');
  assert.deepEqual(robots(), { rules: [{ userAgent: '*', allow: '/' }] });
  assert.deepEqual(await sitemap(), []);
  assert.equal(reads.reads, 0, "demo's sitemap reads no revision");
});
