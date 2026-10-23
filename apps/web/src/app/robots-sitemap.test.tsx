import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import type { Profile } from '~/server/capabilities';
import { readDeploymentConfig } from '~/server/config';
import { setDeploymentState } from '~/server/config-store';
import robots from './robots';
import sitemap from './sitemap';

// robots.txt and the sitemap per profile (#22): owner and read-only keep
// crawlers out of Studio and the API and name the sitemap on the origin;
// demo lets them fetch every page, so they see its noindex, and names no
// sitemap, which is empty. The same deployment answers the same bytes.

const ORIGIN = 'https://rowan.test';

function deploy(t: TestContext, profile: Profile): void {
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
  setDeploymentState({
    config: read.config,
    catalog: { getLive: () => assert.fail('robots and the sitemap read no revision') },
    dispatch: () => assert.fail('they run no operation'),
    degraded: [],
  });
  t.after(() => setDeploymentState(undefined));
}

for (const profile of ['owner', 'read-only'] as const) {
  test(`under ${profile}, robots keeps crawlers out of Studio and the API, and the sitemap lists home on the origin with no date`, async (t) => {
    deploy(t, profile);
    assert.deepEqual(robots(), {
      rules: [{ userAgent: '*', allow: '/', disallow: ['/studio', '/api/'] }],
      sitemap: `${ORIGIN}/sitemap.xml`,
      host: ORIGIN,
    });
    const first = await sitemap();
    assert.deepEqual(first, [{ url: `${ORIGIN}/`, changeFrequency: 'weekly', priority: 1 }]);
    assert.deepEqual(await sitemap(), first);
  });
}

test('under demo, robots disallows nothing and names no sitemap, and the sitemap is empty', async (t) => {
  deploy(t, 'demo');
  assert.deepEqual(robots(), { rules: [{ userAgent: '*', allow: '/' }] });
  assert.deepEqual(await sitemap(), []);
});
