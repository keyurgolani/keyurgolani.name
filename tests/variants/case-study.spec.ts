import { readPair } from '../../packages/schema/src/node';
import { resolvePortfolioView, routedSlugs } from '../../packages/schema/src/index';
import { contractFixture, HIDDEN_CANARY } from '../../packages/variant-contract/src/node/fixtures';
import { expect, test } from '../harness/fixtures';
import { expectUnknown } from '../harness/profile-matrix';
import { withRscHash } from '../harness/rsc';
import { FALLBACK_ID, projectTarget, READ_ONLY } from './target';

// Case-study pages (#10b, VR3): a registered composition on a contract
// fixture, under read-only. Each public case study a visible section
// reaches renders at /work/<slug> from the server, its title the page's one
// h1, so it works without JavaScript, and the sitemap lists it. Its RSC
// payload answers too, and neither names a private record or the hidden
// canary. Any other slug, a private work's and one only a hidden section
// reaches included, answers every method exactly as /no-such-page does, as a
// page and as an RSC request, so nothing says it exists.

test.use({ javaScriptEnabled: false });

const RSC = { RSC: '1' };

/** The fixture's works, its routed slugs, and the ids of its private records. */
function fixtureWorks(testInfo: Parameters<typeof projectTarget>[0]) {
  const { fixture } = projectTarget(testInfo);
  if (!fixture) throw new Error('This spec runs on a contract fixture.');
  const read = readPair(contractFixture(fixture).files);
  if (!read.ok) throw new Error(`${fixture} doesn't read.`);
  const { portfolio } = read.pair;
  const routed = routedSlugs(resolvePortfolioView(read.pair, {}, { mediaBase: '/media' }));
  const records = [
    ...(portfolio.works ?? []),
    ...(portfolio.evidence ?? []),
    ...(portfolio.chronology ?? []),
  ];
  return {
    fixture,
    routed: [...routed].sort(),
    works: portfolio.works ?? [],
    privateIds: records.filter((record) => record.visibility === 'private').map(({ id }) => id),
  };
}

test(
  'each public case study renders at /work/<slug> from the server, its title the one h1, and the sitemap lists it',
  { annotation: [{ type: 'route', description: '/work/[slug]' }, READ_ONLY] },
  async ({ page, request, app }, testInfo) => {
    const { variant } = projectTarget(testInfo);
    const { fixture, routed, works, privateIds } = fixtureWorks(testInfo);
    // These fixtures each hold a public case study, so the checks below run.
    if (['complete', 'photography'].includes(fixture)) expect(routed.length).toBeGreaterThan(0);
    const sitemap = await (await request.get('/sitemap.xml')).text();
    const listed = [...sitemap.matchAll(/<loc>([^<]*)<\/loc>/g)]
      .map(([, url]) => url!)
      .filter((url) => url.startsWith(`${app.origin}/work/`));
    expect(listed).toEqual(routed.map((slug) => `${app.origin}/work/${slug}`));
    for (const slug of routed) {
      const path = `/work/${slug}`;
      const work = works.find((each) => each.slug === slug)!;
      const response = await page.goto(path);
      expect(response?.status(), path).toBe(200);
      expect(response?.request().redirectedFrom(), path).toBeNull();
      await expect(page.getByRole('heading', { level: 1 }), path).toHaveText(work.title);
      const html = await response!.text();
      const rsc = await request.get(await withRscHash(path, RSC), {
        headers: RSC,
        maxRedirects: 0,
      });
      expect(rsc.status(), `${path} RSC`).toBe(200);
      expect(rsc.headers()['content-type'], `${path} RSC`).toContain('text/x-component');
      const payload = await rsc.text();
      expect(payload, `${path} RSC`).toContain(work.title);
      for (const [name, text] of Object.entries({ html, payload })) {
        expect(text, `${path} ${name}`).not.toContain(HIDDEN_CANARY);
        for (const id of privateIds) expect(text, `${path} ${name}`).not.toContain(id);
      }
      // The shared renderers' works list links each one, and a browser
      // with no JavaScript follows the link to the page.
      if (variant.manifest.id === FALLBACK_ID) {
        await page.goto('/');
        await page.locator(`a[href="${path}"]`).first().click();
        await expect(page).toHaveURL(`${app.origin}${path}`);
        await expect(page.getByRole('heading', { level: 1 }), path).toHaveText(work.title);
      }
    }
  },
);

test(
  'any other slug, a private or unreached one included, answers every method as /no-such-page does, as a page and as RSC',
  { annotation: [{ type: 'route', description: '/work/[slug]' }, READ_ONLY] },
  async ({ request }, testInfo) => {
    const { fixture, routed, works } = fixtureWorks(testInfo);
    // A slug the fixture names that doesn't route: a private work's, one
    // with no case study, or one no visible section reaches.
    const unrouted = works.flatMap(({ slug }) => (slug && !routed.includes(slug) ? [slug] : []));
    if (fixture === 'hidden-canary') {
      expect(unrouted.sort()).toEqual(['canary-hidden-private-slug', 'canary-hidden-record-slug']);
    }
    const [first] = routed;
    const targets = [
      '/work/no-such-work',
      '/work/no-such-work/credits',
      ...unrouted.flatMap((slug) => [`/work/${slug}`, `/work/${slug}/credits`]),
      ...(first ? [`/work/${first}-x`, `/work/${first.toUpperCase()}`] : []),
    ];
    await expectUnknown(request, 'read-only', targets);
    const rsc = await Promise.all(targets.map((target) => withRscHash(target, RSC)));
    await expectUnknown(request, 'read-only', rsc, RSC);
  },
);
