import { expect, test } from '../harness/fixtures';
import { DEMO_APP, profileMatrix } from '../harness/profile-matrix';
import { FALLBACK_ID, VARIANTS } from '../harness/registry';

// The demo profile (#1, slice 3): the bundled sample at / and /sample, with
// nothing for crawlers to index and no cookie, and the route-level matrix
// (AC4) for demo. The sample site selects Editorial Evidence, which this
// build doesn't register until #13, so both render the fallback composition
// in its place (#5). /sample?variant= renders a variant this build
// registers, and anything else it names is a 404.
const DEMO = { type: 'profile', description: 'demo' };
// identity.name in portfolio.example.yml.
const SAMPLE_NAME = 'Anamika Devi';

// The sample's images are its own, bundled beside it, and have no rendition
// until #10's second slice derives them, so the page asks no host for one.
test.use({ appOptions: DEMO_APP });

profileMatrix('demo');

for (const route of ['/', '/sample']) {
  test(
    `${route} renders the bundled sample in the fallback composition, for its unregistered selection`,
    { annotation: [{ type: 'route', description: route }, DEMO] },
    async ({ page }) => {
      const response = await page.goto(route);
      expect(response?.status()).toBe(200);
      const root = page.locator('[data-variant]');
      await expect(root).toHaveAttribute('data-variant', 'fallback');
      await expect(root).toHaveAttribute('data-requested-variant', 'editorial-evidence');
      await expect(page.getByRole('heading', { level: 1 })).toHaveText(SAMPLE_NAME);
    },
  );
}

test(
  '/sample?variant= naming the fallback, an unregistered id, nothing, or two ids is a 404 that names none',
  { annotation: [{ type: 'route', description: '/sample' }, DEMO] },
  async ({ page }) => {
    for (const query of [
      'variant=fallback',
      'variant=canary-variant',
      'variant=',
      'variant=fallback&variant=fallback',
    ]) {
      const response = await page.goto(`/sample?${query}`);
      expect(response?.status(), query).toBe(404);
      await expect(page.getByRole('heading', { level: 1 }), query).toHaveText('Page not found');
      await expect(page.locator('body'), query).not.toContainText(
        /canary|fallback|editorial|variant|studio|config/i,
        { useInnerText: true },
      );
      // Its boundary's skip link goes to its own main, and the page links home alone.
      await expect(page.locator('[data-ui-slot="skip-link"]'), query).toHaveAttribute(
        'href',
        '#main',
      );
      const links = await page
        .locator('a[href]:not([data-ui-slot="skip-link"])')
        .evaluateAll((anchors) => anchors.map((anchor) => anchor.getAttribute('href')));
      expect(links, query).toEqual(['/']);
    }
  },
);

test(
  'robots.txt disallows everything and the sitemap is empty',
  { annotation: [{ type: 'route', description: '/robots.txt' }, DEMO] },
  async ({ request }) => {
    const robots = await (await request.get('/robots.txt')).text();
    expect(robots).toMatch(/Disallow: \/\s*$/m);
    expect(robots).not.toMatch(/Sitemap:/i);
    const sitemap = await (await request.get('/sitemap.xml')).text();
    expect(sitemap).not.toContain('<url>');
  },
);

test(
  'a visit sets no cookie, and every response it loads is noindex',
  { annotation: [{ type: 'route', description: '/sample' }, DEMO] },
  async ({ page, context, app }) => {
    const responses: Array<{ url: string; robots: string | undefined }> = [];
    page.on('response', (response) => {
      if (new URL(response.url()).origin !== app.origin) return;
      responses.push({ url: response.url(), robots: response.headers()['x-robots-tag'] });
    });
    await page.goto('/sample', { waitUntil: 'networkidle' });
    await page.goto('/', { waitUntil: 'networkidle' });
    // Build assets included.
    expect(responses.some(({ url }) => new URL(url).pathname.startsWith('/_next/static/'))).toBe(
      true,
    );
    for (const { url, robots } of responses) expect(robots, url).toBe('noindex');
    expect(await context.cookies()).toEqual([]);
  },
);

test(
  'rendering the sample in every variant reaches no host outside the app',
  { annotation: [{ type: 'route', description: '/sample' }, DEMO] },
  async ({ page, app }) => {
    // The fallback composition at / and /sample, then each variant this build registers.
    const selectable = VARIANTS.map(({ manifest }) => manifest.id).filter(
      (id) => id !== FALLBACK_ID,
    );
    for (const url of ['/', '/sample', ...selectable.map((id) => `/sample?variant=${id}`)]) {
      const response = await page.goto(url, { waitUntil: 'networkidle' });
      expect(response?.status(), url).toBe(200);
    }
    expect(app.egress()).toEqual([]);
  },
);

test(
  "the sample's github section renders the snapshot bundled beside it, with its date (#10)",
  { annotation: [{ type: 'route', description: '/' }, DEMO] },
  async ({ page, app }) => {
    await page.goto('/', { waitUntil: 'networkidle' });
    const github = page.locator('#on-github');
    await expect(github.getByRole('heading', { name: 'On GitHub' })).toBeVisible();
    // Its figures, its pinned repositories, and the day it was taken.
    for (const label of ['Repositories', 'Stars received', 'Contributions in the last year']) {
      await expect(github.locator('dt', { hasText: label })).toHaveCount(1);
    }
    await expect(github.getByRole('link', { name: 'postmortem-template-kit' })).toBeVisible();
    await expect(github.locator('time[datetime="2026-10-17"]')).toHaveText('October 17, 2026');
    await expect(github.getByRole('link', { name: 'anamika', exact: true })).toHaveAttribute(
      'href',
      'https://github.com/anamika',
    );
    // From the snapshot alone: the server reached no host for it.
    expect(app.egress()).toEqual([]);
  },
);
