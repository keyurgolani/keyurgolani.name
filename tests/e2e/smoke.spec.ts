import { expect, test } from '../harness/fixtures';

const FIXTURE_IMAGE = 'https://media.rowan.test/fixture-garden.png';

test(
  'home renders the mounted portfolio',
  { annotation: { type: 'route', description: '/' } },
  async ({ page }, testInfo) => {
    const pageErrors: string[] = [];
    page.on('pageerror', (error) => pageErrors.push(error.message));

    const response = await page.goto('/');
    expect(response?.status()).toBe(200);
    await expect(page).toHaveTitle('Rowan Fixture');
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Rowan Fixture');

    // Recorded, not asserted: production builds hit an intermittent hydration
    // error (React #418) on some cold starts, which predates this harness.
    await page.waitForLoadState('networkidle');
    if (pageErrors.length > 0) {
      await testInfo.attach('page-errors.txt', {
        body: `${pageErrors.join('\n')}\n`,
        contentType: 'text/plain',
      });
    }
  },
);

test(
  'home renders the fallback composition for an unregistered selection, each section under its content id',
  { annotation: { type: 'route', description: '/' } },
  async ({ page }) => {
    const response = await page.goto('/');
    expect(response?.status()).toBe(200);
    // The data marker is the only sign: visitors see no label.
    const root = page.locator('[data-variant]');
    await expect(root).toHaveAttribute('data-variant', 'fallback');
    await expect(root).toHaveAttribute('data-requested-variant', 'missing-variant');
    await expect(page.locator('body')).not.toContainText(/missing-variant|fallback/i, {
      useInnerText: true,
    });
    // The skip link comes first, and moves focus to the composition's main.
    await page.keyboard.press('Tab');
    const skip = page.getByRole('link', { name: 'Skip to content' });
    await expect(skip).toBeFocused();
    await expect(skip).toHaveAttribute('href', '#main');
    await expect(page.locator('main')).toHaveCount(1);
    await expect(page.locator('main')).toHaveAttribute('id', 'main');
    const ids = await page
      .locator('main > section')
      .evaluateAll((sections) => sections.map((section) => section.id));
    expect(ids).toEqual(['top', 'selected-work', 'contact']);
  },
);

test(
  '/api/health answers 200',
  { annotation: { type: 'route', description: '/api/health' } },
  async ({ request }) => {
    const response = await request.get('/api/health');
    expect(response.status()).toBe(200);
    expect(await response.json()).toEqual({ status: 'ok', profile: 'read-only' });
  },
);

test(
  "the harness's API requests each close their connection",
  { annotation: { type: 'route', description: '/api/health' } },
  async ({ request }) => {
    // The server closes it once it answers, so no later request goes out on
    // a socket the server has closed since (tests/harness/fixtures.ts).
    const response = await request.get('/api/health');
    expect(response.status()).toBe(200);
    expect(response.headers().connection).toBe('close');
  },
);

test(
  'requests outside the app are blocked',
  { annotation: { type: 'route', description: '/' } },
  async ({ page, blockedRequests }) => {
    await page.goto('/', { waitUntil: 'networkidle' });
    // The work's cover is on a .test host, which a fetch refuses (#10), so it
    // has no rendition and renders as unavailable, and the page asks that host
    // for nothing.
    await expect(page.locator('[data-media-asset="fixture-garden-cover"]')).toContainText(
      'Image unavailable',
    );
    expect(blockedRequests).not.toContain(FIXTURE_IMAGE);
    // An image the page loads from that host never arrives.
    const width = await page.evaluate(
      (src) =>
        new Promise<number>((resolve) => {
          const image = new Image();
          image.onload = image.onerror = () => resolve(image.naturalWidth);
          image.src = src;
        }),
      FIXTURE_IMAGE,
    );
    expect(width).toBe(0);
    await expect.poll(() => blockedRequests).toContain(FIXTURE_IMAGE);
  },
);
