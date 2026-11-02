import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { expect, test } from '../harness/fixtures';
import { chevron, menuChevrons } from './disclosure-chevron';

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
    const nav = page.getByRole('navigation', { name: 'Site', exact: true });
    // The label is the host's own word, marked English on an Arabic page.
    await expect(
      page.locator(`[id="${await nav.getAttribute('aria-labelledby')}"]`),
    ).toHaveAttribute('lang', 'en');
    // The name comes first, at the right edge, and the destinations follow it leftward.
    const edges = await nav.evaluate((element) => {
      const name = element.querySelector('a')!.getBoundingClientRect();
      const links = [...element.querySelectorAll('[data-ui-slot="navigation.link"]')];
      return {
        links: links.length,
        nav: element.getBoundingClientRect().right,
        name: name.right,
        nameLeft: name.left,
        first: links[0]!.getBoundingClientRect().right,
      };
    });
    expect(edges.links).toBeGreaterThan(1);
    expect(Math.abs(edges.nav - edges.name)).toBeLessThan(2);
    expect(edges.first).toBeLessThan(edges.nameLeft);
    // The render, for the report: the closing evidence for the pair (#4).
    await testInfo.attach('fallback-arabic-rtl', {
      body: await page.screenshot(),
      contentType: 'image/png',
    });
  },
);

test.describe('the Menu on a phone', () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test(
    'a disclosure chevron points down closed and up open in right-to-left text, mirrored before it turns',
    { annotation: [{ type: 'route', description: '/' }, READ_ONLY] },
    async ({ page }, testInfo) => {
      await page.goto('/');
      await menuChevrons(page, 'rtl');
      await page.getByRole('button', { name: 'Menu' }).click();
      const summary = page
        .getByRole('dialog', { name: 'Menu' })
        .locator('.fc-menu__all > [data-ui-slot="disclosure.summary"]');
      await testInfo.attach('fallback-arabic-rtl-menu-390', {
        body: await page.screenshot(),
        contentType: 'image/png',
      });
      // The same chevron in a left-to-right run on this page: no mirror, and
      // still down closed and up open. (The English sample's Menu checks it
      // on a whole left-to-right page, in fallback-navigation.spec.ts.)
      await summary.evaluate((element) => element.setAttribute('dir', 'ltr'));
      await expect.poll(() => chevron(summary)).toBe('up');
      await summary.click();
      await expect.poll(() => chevron(summary)).toBe('down');
      const scale = () => summary.evaluate((element) => getComputedStyle(element, '::after').scale);
      expect(await scale()).toBe('none');
      await summary.evaluate((element) => element.removeAttribute('dir'));
      expect(await scale()).toBe('-1 1');
    },
  );
});
