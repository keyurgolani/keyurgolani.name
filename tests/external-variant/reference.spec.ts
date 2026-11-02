import type { Page } from '@playwright/test';
import { expect, test } from '../harness/fixtures';
import { DEMO, READ_ONLY } from '../variants/target';
import { REFERENCE_ID } from './reference';

// The reference variant's own checks (#5, Slice 6), on the complete fixture
// and the bundled sample, once pnpm test:external-variant has installed its
// tarball: its colophon view, its compact control, its bespoke stats and
// unsupported fun facts, and its badge enhancement, which loads after the
// page hydrates, from a chunk the page doesn't name.

const ROOT = { type: 'route', description: '/' };
const VIEW = { type: 'route', description: '/[...view]' };

/** Each section's margin after it, in rem: 3 by default, 1 with the compact control on. */
async function sectionGap(page: Page): Promise<number> {
  return page.evaluate(() => {
    const rem = Number.parseFloat(getComputedStyle(document.documentElement).fontSize);
    const section = document.querySelector('main > section');
    if (!section) throw new Error('The page has no section.');
    return Number.parseFloat(getComputedStyle(section).marginBlockEnd) / rem;
  });
}

test(
  'the colophon view renders at /colophon, after a reload, and links home',
  { tag: '@defaults', annotation: [VIEW, READ_ONLY] },
  async ({ page, app }) => {
    expect((await page.goto('/colophon'))?.status()).toBe(200);
    await expect(page.locator('[data-variant]')).toHaveAttribute('data-variant', REFERENCE_ID);
    await expect(page.locator('h1')).toHaveText('Colophon');
    await expect(page.getByRole('link', { name: 'Colophon' })).toHaveAttribute(
      'aria-current',
      'page',
    );
    await page.reload();
    await expect(page.locator('h1')).toHaveText('Colophon');
    await page.getByRole('link', { name: 'Home' }).click();
    await expect(page).toHaveURL(`${app.origin}/`);
    await expect(page.getByRole('link', { name: 'Home' })).toHaveAttribute('aria-current', 'page');
    await expect(page.locator('h1')).not.toHaveText('Colophon');
  },
);

test(
  'evidence renders bespoke as a ledger, and fun facts not at all',
  { tag: '@defaults', annotation: [ROOT, READ_ONLY] },
  async ({ page }) => {
    await page.goto('/');
    const evidence = page.locator('[data-kind="evidence"]');
    expect(await evidence.count(), 'evidence sections').toBeGreaterThan(0);
    for (const section of await evidence.all()) {
      await expect(section).toHaveAttribute('data-renderer', 'bespoke');
      await expect(section.locator('dl.acme-ledger')).toHaveCount(1);
      // Each term says something: a statement, as markdown through the kit, or a title.
      await expect(section.locator('dt:empty')).toHaveCount(0);
      // And each pair is whole, a term with its figure or source: no dt without its dd.
      await expect(section.locator('dl.acme-ledger > div:not(:has(> dt + dd))')).toHaveCount(0);
    }
    expect(await page.locator('dl.acme-ledger dt > .pf-rich-text').count()).toBeGreaterThan(0);
    await expect(page.locator('[data-kind="fun-facts"]')).toHaveCount(0);
  },
);

test(
  'the compact control is off by default',
  { tag: '@defaults', annotation: [ROOT, READ_ONLY] },
  async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('main')).toHaveAttribute('data-density', 'comfortable');
    expect(await sectionGap(page)).toBe(3);
  },
);

test(
  "the badge loads once the page hydrates, from a chunk the page doesn't name",
  { tag: '@defaults', annotation: [ROOT, READ_ONLY] },
  async ({ page, request }) => {
    const html = await (await request.get('/')).text();
    expect(html, 'the server never renders the badge').not.toContain('data-acme-badge');

    const chunks: Promise<{ path: string; text: string }>[] = [];
    page.on('response', (response) => {
      const { pathname } = new URL(response.url());
      if (/^\/_next\/static\/chunks\/.+\.js$/.test(pathname)) {
        chunks.push(response.text().then((text) => ({ path: pathname, text })));
      }
    });
    await page.goto('/');
    await expect(page.locator('[data-acme-badge]')).toHaveAttribute(
      'data-acme-badge',
      REFERENCE_ID,
    );

    const badge = (await Promise.all(chunks)).filter(({ text }) =>
      text.includes('data-acme-badge'),
    );
    expect(badge.length, 'chunks with the badge').toBeGreaterThan(0);
    for (const { path } of badge) {
      expect(html, `the page names ${path}`).not.toContain(path);
    }
  },
);

test.describe('without JavaScript', () => {
  test.use({ javaScriptEnabled: false });

  test(
    'the colophon view renders, and the badge never does',
    { tag: '@defaults', annotation: [VIEW, READ_ONLY] },
    async ({ page }) => {
      expect((await page.goto('/colophon'))?.status()).toBe(200);
      await expect(page.locator('h1')).toHaveText('Colophon');
      await page.goto('/');
      await expect(page.locator('h1')).toHaveCount(1);
      await expect(page.locator('[data-acme-badge]')).toHaveCount(0);
    },
  );
});

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

test(
  "the platform's fallback packs render the reference variant in every display mode, its text readable on its canvas (#19, Slice 4)",
  { tag: '@defaults', annotation: [ROOT, READ_ONLY] },
  async ({ page, app }, testInfo) => {
    for (const [mode, os] of [
      ['system', 'light'],
      ['system', 'dark'],
      ['light', 'light'],
      ['dark', 'light'],
      ['high-contrast', 'light'],
    ] as const) {
      await page.emulateMedia({ colorScheme: os });
      await page
        .context()
        .addCookies([{ name: 'portfolio_appearance', value: `mode=${mode}`, url: app.origin }]);
      await page.goto('/');
      const boundary = page.locator('[data-appearance-boundary="document"]');
      await expect(boundary).toHaveAttribute('data-variant', REFERENCE_ID);
      await expect(boundary).toHaveAttribute('data-color-scheme', 'warm-parchment');
      await expect(boundary).toHaveAttribute('data-display-mode', mode);
      // The navigation is the primitive's, which the platform styles.
      await expect(page.locator('nav[data-ui-slot="navigation"]')).toHaveCount(1);
      const { text, canvas } = await page.evaluate(() => ({
        text: getComputedStyle(document.querySelector('h1')!).color,
        canvas: getComputedStyle(document.documentElement).backgroundColor,
      }));
      expect(contrast(text, canvas), `${mode} ${os}`).toBeGreaterThanOrEqual(
        mode === 'high-contrast' ? 7 : 4.5,
      );
      await testInfo.attach(`reference-${mode}-${os}.png`, {
        body: await page.screenshot({ fullPage: true }),
        contentType: 'image/png',
      });
    }
  },
);

test(
  'the compact control on brings the sections closer',
  { tag: '@compact', annotation: [ROOT, READ_ONLY] },
  async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('main')).toHaveAttribute('data-density', 'compact');
    expect(await sectionGap(page)).toBe(1);
  },
);

test.describe('on the bundled sample', () => {
  test(
    'the colophon view renders under /sample and links back to it',
    { tag: '@sample', annotation: [{ type: 'route', description: '/sample/[[...path]]' }, DEMO] },
    async ({ page, app }) => {
      const view = `/sample/colophon?variant=${REFERENCE_ID}`;
      expect((await page.goto(view))?.status()).toBe(200);
      await expect(page.locator('[data-variant]')).toHaveAttribute('data-variant', REFERENCE_ID);
      await expect(page.locator('h1')).toHaveText('Colophon');
      await page.getByRole('link', { name: 'Home' }).click();
      await expect(page).toHaveURL(`${app.origin}/sample?variant=${REFERENCE_ID}`);
    },
  );
});
