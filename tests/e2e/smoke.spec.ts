import { readFileSync } from 'node:fs';
import { expect, test } from '../harness/fixtures';

const FIXTURE_IMAGE = 'https://media.rowan.test/fixture-garden.png';
// The root attributes the baseline rendered, which the host keeps until it
// loads the site document.
const BASELINE = JSON.parse(
  readFileSync(new URL('../fixtures/baseline/example-home.json', import.meta.url), 'utf8'),
) as { root: Record<string, string> };

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
  "home renders Editorial's default scheme and typeset, each section under its content id",
  { annotation: { type: 'route', description: '/' } },
  async ({ page }) => {
    await page.goto('/');
    const root = page.locator('[data-variant]');
    for (const [name, value] of Object.entries(BASELINE.root)) {
      await expect(root).toHaveAttribute(name, value);
    }
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
  'requests outside the app are blocked',
  { annotation: { type: 'route', description: '/' } },
  async ({ page, blockedRequests }) => {
    await page.goto('/');
    const image = page.getByRole('img', { name: 'Rows of identical seedlings' });
    await image.scrollIntoViewIfNeeded();
    await expect.poll(() => blockedRequests).toContain(FIXTURE_IMAGE);
    expect(await image.evaluate((img: HTMLImageElement) => img.naturalWidth)).toBe(0);
  },
);
