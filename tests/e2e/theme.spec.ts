import type { Page } from '@playwright/test';
import { expect, test } from '../harness/fixtures';

// The visitor's appearance (#19, Slice 4). There's no theme script: the
// server renders each page's document boundary from the site's selection and
// the visitor's preference cookie, so the first paint is already the page's
// appearance, and hydration changes none of it. The visitor control in the
// variant's slot saves a choice through POST /api/appearance: with
// JavaScript at once, the page rendering again in place, and without it as
// a form that posts and comes back to the page.

const BOUNDARY = '[data-appearance-boundary="document"]';

/** The boundary's attributes and the canvas's color, as the page paints them now. */
function painted(page: Page) {
  return page.evaluate((selector) => {
    const boundary = document.querySelector(selector)!;
    const attributes = Object.fromEntries(
      boundary
        .getAttributeNames()
        .filter((name) => name.startsWith('data-'))
        .map((name) => [name, boundary.getAttribute(name)]),
    );
    return {
      attributes,
      // The packs paint the root, as the boundary, so the canvas is never another color.
      canvas: [document.documentElement, document.body, boundary]
        .map((element) => getComputedStyle(element).backgroundColor)
        .join(' '),
      html: document.documentElement.getAttributeNames().sort(),
    };
  }, BOUNDARY);
}

/** Every change any script makes to the boundary's attributes or <html>'s, from the first byte on. */
async function watchAttributes(page: Page) {
  await page.addInitScript(() => {
    const changes: string[] = [];
    (window as unknown as { __appearanceChanges: string[] }).__appearanceChanges = changes;
    new MutationObserver((records) => {
      for (const record of records) {
        const target = record.target as Element;
        if (
          target === document.documentElement ||
          target.hasAttribute('data-appearance-boundary')
        ) {
          changes.push(`${target.tagName} ${record.attributeName}`);
        }
      }
    }).observe(document, { attributes: true, subtree: true });
  });
}

/** Waits until the page has hydrated: the visitor control goes live then, and its Apply hides. */
async function hydrated(page: Page) {
  await expect(
    page
      .locator('[data-visitor-control-slot]')
      .getByRole('button', { name: 'Apply', includeHidden: true }),
  ).toBeHidden();
}

const changes = (page: Page) =>
  page.evaluate(() => (window as unknown as { __appearanceChanges: string[] }).__appearanceChanges);

for (const cookie of [null, 'mode=dark'] as const) {
  test(
    `the first paint is the boundary the server rendered, and hydration changes none of it, ${cookie ? 'with a preference cookie' : 'with no preference'}`,
    { annotation: { type: 'route', description: '/' } },
    async ({ page, app }) => {
      if (cookie) {
        await page
          .context()
          .addCookies([{ name: 'portfolio_appearance', value: cookie, url: app.origin }]);
      }
      // The server's markup alone: with its bundles refused the page never hydrates.
      await page.route(/\/_next\/static\/.+\.js(?:\?.*)?$/, (route) => route.abort());
      await page.goto('/', { waitUntil: 'load' });
      const first = await painted(page);
      expect(first.attributes['data-display-mode']).toBe(cookie ? 'dark' : 'system');
      expect(first.html).toEqual(['dir', 'lang']);
      // Hydrated, nothing has moved.
      await page.unroute(/\/_next\/static\/.+\.js(?:\?.*)?$/);
      await watchAttributes(page);
      await page.goto('/');
      await page.waitForLoadState('networkidle');
      await hydrated(page);
      expect(await painted(page)).toEqual(first);
      expect(await changes(page)).toEqual([]);
      expect(await page.content()).not.toContain('localStorage');
    },
  );
}

/** The WCAG contrast ratio of two colors as getComputedStyle() gives them. */
function contrast(a: string, b: string): number {
  const luminance = (color: string) => {
    const [r, g, bl] = (color.match(/[\d.]+/g) ?? []).map(Number).map((channel) => {
      const c = channel / 255;
      return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
    });
    return 0.2126 * r! + 0.7152 * g! + 0.0722 * bl!;
  };
  const [light, dark] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (light! + 0.05) / (dark! + 0.05);
}

for (const [mode, os] of [
  ['system', 'light'],
  ['system', 'dark'],
  ['light', 'light'],
  ['dark', 'light'],
  ['high-contrast', 'light'],
] as const) {
  test(
    `the platform's fallback packs render the fallback composition in ${mode}${mode === 'system' ? ` under a ${os} OS` : ''}, its text readable on its canvas`,
    { annotation: { type: 'route', description: '/' } },
    async ({ page, app }, testInfo) => {
      await page.emulateMedia({ colorScheme: os });
      await page
        .context()
        .addCookies([{ name: 'portfolio_appearance', value: `mode=${mode}`, url: app.origin }]);
      await page.goto('/');
      const boundary = page.locator(BOUNDARY);
      await expect(boundary).toHaveAttribute('data-variant', 'fallback');
      await expect(boundary).toHaveAttribute('data-design-language', 'platform-neutral');
      await expect(boundary).toHaveAttribute('data-color-scheme', 'warm-parchment');
      await expect(boundary).toHaveAttribute('data-typography', 'humanist-ui');
      await expect(boundary).toHaveAttribute('data-display-mode', mode);
      const { text, canvas } = await page.evaluate(() => {
        const heading = document.querySelector('h1')!;
        return {
          text: getComputedStyle(heading).color,
          canvas: getComputedStyle(document.documentElement).backgroundColor,
        };
      });
      expect(contrast(text, canvas)).toBeGreaterThanOrEqual(mode === 'high-contrast' ? 7 : 4.5);
      await testInfo.attach(`fallback-${mode}-${os}.png`, {
        body: await page.screenshot({ fullPage: true }),
        contentType: 'image/png',
      });
    },
  );
}

test.describe('with a dark OS color scheme', () => {
  test.use({ colorScheme: 'dark' });

  test(
    'the system display mode follows the OS, in CSS alone',
    { annotation: { type: 'route', description: '/' } },
    async ({ page, browser }) => {
      await page.goto('/');
      await expect(page.locator(BOUNDARY)).toHaveAttribute('data-display-mode', 'system');
      const dark = (await painted(page)).canvas;
      const light = await browser.newPage({ colorScheme: 'light' });
      try {
        await light.goto(page.url());
        expect((await painted(light)).canvas).not.toBe(dark);
      } finally {
        await light.close();
      }
    },
  );
});

test(
  'with JavaScript, a choice in the visitor control saves at once and the page renders in it, without a reload, and Reset goes back to the site default',
  {
    annotation: [
      { type: 'route', description: '/' },
      { type: 'route', description: '/api/appearance' },
    ],
  },
  async ({ page, app }) => {
    await page.goto('/');
    // Live, the form saves each change itself, so Apply hides.
    await hydrated(page);
    const slot = page.locator('[data-visitor-control-slot]');
    await expect(slot).toHaveCount(1);
    await slot.getByText('Appearance').click();
    let loads = 0;
    page.on('load', () => (loads += 1));
    const saved = page.waitForResponse(
      (response) =>
        new URL(response.url()).pathname === '/api/appearance' &&
        response.request().method() === 'POST',
    );
    await slot.getByRole('radio', { name: 'Dark' }).check();
    const answer = await saved;
    expect(answer.status()).toBe(200);
    expect(answer.headers()['cache-control']).toBe('private, no-store');
    // The answer names the saved packs' stylesheets, which the control preloads
    // before it refreshes: the page names none it doesn't render (#6's purity).
    const { stylesheets } = (await answer.json()) as { stylesheets: string[] };
    expect(stylesheets).toEqual([
      expect.stringMatching(/^\/_portfolio\/pack\/warm-parchment\.[0-9a-f]{12}\.css$/),
    ]);
    await expect(
      page.locator(`link[rel="preload"][as="style"][href="${stylesheets[0]}"]`),
    ).toHaveCount(1);
    await expect(page.locator(BOUNDARY)).toHaveAttribute('data-display-mode', 'dark');
    expect(loads).toBe(0);
    const stored = (await page.context().cookies(app.origin)).find(
      ({ name }) => name === 'portfolio_appearance',
    );
    expect(stored?.value).toBe('scheme=warm-parchment&mode=dark');
    expect(stored?.httpOnly).toBe(true);
    expect(stored?.sameSite).toBe('Lax');
    await slot.getByRole('button', { name: 'Reset to site default' }).click();
    await expect(page.locator(BOUNDARY)).toHaveAttribute('data-display-mode', 'system');
    expect(
      (await page.context().cookies(app.origin)).some(
        ({ name }) => name === 'portfolio_appearance',
      ),
    ).toBe(false);
  },
);

test.describe('without JavaScript', () => {
  test.use({ javaScriptEnabled: false });

  test(
    'the visitor control is a form that posts the choice and comes back to the page it was on',
    {
      annotation: [
        { type: 'route', description: '/' },
        { type: 'route', description: '/api/appearance' },
      ],
    },
    async ({ page }) => {
      await page.goto('/?view=all');
      const slot = page.locator('[data-visitor-control-slot]');
      await slot.getByText('Appearance').click();
      await slot.getByRole('radio', { name: 'Dark' }).check();
      await slot.getByRole('button', { name: 'Apply' }).click();
      await page.waitForURL((url) => url.pathname === '/' && url.search === '?view=all');
      await expect(page.locator(BOUNDARY)).toHaveAttribute('data-display-mode', 'dark');
      await slot.getByText('Appearance').click();
      await slot.getByRole('button', { name: 'Reset to site default' }).click();
      await page.waitForURL((url) => url.pathname === '/' && url.search === '?view=all');
      await expect(page.locator(BOUNDARY)).toHaveAttribute('data-display-mode', 'system');
    },
  );
});
