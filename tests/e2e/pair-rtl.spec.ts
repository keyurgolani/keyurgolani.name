import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { expect, test } from '../harness/fixtures';

// A right-to-left portfolio (#4): the mixed-practice profession pair, in
// Arabic, with its talks hidden by the site document, in the fallback
// composition (#5), whose layout is all logical properties.

const MIXED = fileURLToPath(
  new URL('../../packages/schema/src/__fixtures__/pairs/mixed/yaml/', import.meta.url),
);
const READ_ONLY = { type: 'profile', description: 'read-only' };

test.use({
  appOptions: { portfolio: path.join(MIXED, 'portfolio.yml'), site: path.join(MIXED, 'site.yml') },
});

test(
  '<html lang dir> are the portfolio locale and direction',
  { annotation: [{ type: 'route', description: '/' }, READ_ONLY] },
  async ({ page }, testInfo) => {
    await page.goto('/');
    await expect(page.locator('html')).toHaveAttribute('lang', 'ar');
    await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
    const root = page.locator('[data-variant]');
    await expect(root).toHaveAttribute('data-variant', 'fallback');
    await expect(root).toHaveAttribute('data-requested-variant', 'missing-variant');
    await expect(page.locator('[id="talks"]')).toHaveCount(0);
    await expect(page.locator('[id="podcast"]')).toHaveCount(1);
    // Nothing links to the hidden section either.
    await expect(page.locator('a[href="#talks"]')).toHaveCount(0);
    // The composition's column reads right to left, and its navigation starts at the right.
    const main = page.locator('main');
    expect(await main.evaluate((element) => getComputedStyle(element).direction)).toBe('rtl');
    const edges = await page.locator('nav[aria-label="Sections"] ul').evaluate((list) => ({
      links: list.querySelectorAll('a').length,
      list: list.getBoundingClientRect().right,
      first: list.querySelector('a')!.getBoundingClientRect().right,
    }));
    expect(edges.links).toBeGreaterThan(1);
    expect(Math.abs(edges.list - edges.first)).toBeLessThan(2);
    // The render, for the report: the closing evidence for the pair (#4).
    await testInfo.attach('fallback-arabic-rtl', {
      body: await page.screenshot(),
      contentType: 'image/png',
    });
  },
);
