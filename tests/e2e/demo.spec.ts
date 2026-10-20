import { expect, test } from '../harness/fixtures';
import { DEMO_APP, profileMatrix } from '../harness/profile-matrix';

// The demo profile (#1, slice 3): the bundled sample at / and /sample, in
// any registered variant, scheme, and typography preset, with nothing for
// crawlers to index and no cookie, and the route-level matrix (AC4) for
// demo.
const DEMO = { type: 'profile', description: 'demo' };
// identity.name in portfolio.example.yml.
const SAMPLE_NAME = 'Anamika Devi';

// The sample's placeholder images live on picsum.photos, which stays blocked.
test.use({ appOptions: DEMO_APP, blockedHosts: ['picsum.photos'] });

profileMatrix('demo');

test(
  '/sample?variant=editorial renders the bundled sample in Editorial',
  { annotation: [{ type: 'route', description: '/sample' }, DEMO] },
  async ({ page }) => {
    const response = await page.goto('/sample?variant=editorial');
    expect(response?.status()).toBe(200);
    const root = page.locator('[data-variant]').first();
    await expect(root).toHaveAttribute('data-variant', 'editorial');
    await expect(root).toHaveAttribute('data-color-scheme', 'warm');
    await expect(root).toHaveAttribute('data-typography', 'classic');
    await expect(page.getByText(SAMPLE_NAME).first()).toBeVisible();
  },
);

test(
  '/ renders the bundled sample in the default variant',
  { annotation: [{ type: 'route', description: '/' }, DEMO] },
  async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('[data-variant]').first()).toHaveAttribute(
      'data-variant',
      'editorial',
    );
    await expect(page.getByText(SAMPLE_NAME).first()).toBeVisible();
  },
);

test(
  '/sample renders any registered variant, scheme, and typography preset',
  { annotation: [{ type: 'route', description: '/sample' }, DEMO] },
  async ({ page }) => {
    await page.goto('/sample?variant=kinetic-cosmos&scheme=aurora&typography=humanist');
    const root = page.locator('[data-variant]').first();
    await expect(root).toHaveAttribute('data-variant', 'kinetic-cosmos');
    await expect(root).toHaveAttribute('data-color-scheme', 'aurora');
    await expect(root).toHaveAttribute('data-typography', 'humanist');
    await expect(page.getByText(SAMPLE_NAME).first()).toBeAttached();
  },
);

test(
  'a scheme or preset the variant does not declare falls back to its default',
  { annotation: [{ type: 'route', description: '/sample' }, DEMO] },
  async ({ page }) => {
    await page.goto('/sample?variant=editorial&scheme=aurora&typography=canary-type');
    const root = page.locator('[data-variant]').first();
    await expect(root).toHaveAttribute('data-color-scheme', 'warm');
    await expect(root).toHaveAttribute('data-typography', 'classic');
  },
);

test(
  'an unknown variant is a 404',
  { annotation: [{ type: 'route', description: '/sample' }, DEMO] },
  async ({ request }) => {
    for (const query of ['variant=canary-variant', 'variant=', 'variant=editorial&variant=noir']) {
      const response = await request.get(`/sample?${query}`);
      expect(response.status(), query).toBe(404);
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
    await page.goto('/sample?variant=editorial', { waitUntil: 'networkidle' });
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
    for (const url of ['/', '/sample?variant=editorial', '/sample?variant=kinetic-cosmos']) {
      const response = await page.goto(url, { waitUntil: 'networkidle' });
      expect(response?.status(), url).toBe(200);
      // The sample's github section, which fetches a live account, is gone.
      await expect(page.locator('#on-github'), url).toHaveCount(0);
    }
    expect(app.egress()).toEqual([]);
  },
);
