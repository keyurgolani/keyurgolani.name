import type { Page } from '@playwright/test';
import { expect, test } from '../harness/fixtures';
import { READ_ONLY, readOnlyApp } from './apps';

// The document key binding (K-4 (d)), with the site selecting fixture-notes,
// whose manifest declares `mod+k` and `/` for its palette. The host listens
// on the document and hands the palette the action; the host's visitor
// controls show the Single-key shortcuts toggle, which turns `/` off
// (WCAG 2.1.4) for good, and leaves `mod+k`.

test.use({ appOptions: readOnlyApp('fixture-notes') });

/** How many times the palette has opened. */
const opens = async (page: Page) =>
  Number(await page.locator('[data-palette-opens]').textContent());

/** The page once it's hydrated and the host's binding listens: one `mod+k` opens the palette. */
async function ready(page: Page): Promise<number> {
  await expect(page.locator('[data-palette-ready]')).toBeAttached();
  await page.locator('main h1').click();
  await expect
    .poll(async () => {
      await page.keyboard.press('ControlOrMeta+k');
      return opens(page);
    })
    .toBeGreaterThan(0);
  return opens(page);
}

test(
  "/ and mod+k open the variant's palette, and the visitor's Single-key shortcuts toggle turns / off for good",
  { annotation: [{ type: 'route', description: '/' }, READ_ONLY] },
  async ({ page }) => {
    expect((await page.goto('/'))?.status()).toBe(200);
    let count = await ready(page);
    await page.keyboard.press('/');
    await expect.poll(() => opens(page)).toBe(count + 1);
    count += 1;

    // The host's toggle, on until the visitor turns it off.
    const toggle = page.getByRole('button', { name: 'Single-key shortcuts' });
    await expect(toggle).toHaveAttribute('aria-pressed', 'true');
    await toggle.click();
    await expect(toggle).toHaveAttribute('aria-pressed', 'false');
    await expect(
      page.getByRole('status').filter({ hasText: 'Single-key shortcuts are off.' }),
    ).toBeVisible();

    // / does nothing now, and mod+k still opens the palette.
    await page.locator('main h1').click();
    await page.keyboard.press('/');
    await page.keyboard.press('ControlOrMeta+k');
    await expect.poll(() => opens(page)).toBe(count + 1);
    count += 1;

    // The choice lasts: after a reload, / still does nothing.
    await page.reload();
    count = await ready(page);
    await expect(page.getByRole('button', { name: 'Single-key shortcuts' })).toHaveAttribute(
      'aria-pressed',
      'false',
    );
    await page.keyboard.press('/');
    await page.keyboard.press('ControlOrMeta+k');
    await expect.poll(() => opens(page)).toBe(count + 1);
  },
);

test(
  'the binding never fires while a field has focus',
  { annotation: [{ type: 'route', description: '/' }, READ_ONLY] },
  async ({ page }) => {
    expect((await page.goto('/'))?.status()).toBe(200);
    const count = await ready(page);
    // A text field on the page, as a search box would be.
    await page.evaluate(() => {
      const field = document.createElement('input');
      field.type = 'text';
      field.setAttribute('aria-label', 'Search');
      document.querySelector('main')!.append(field);
    });
    const field = page.getByRole('textbox', { name: 'Search' });
    await field.click();
    await page.keyboard.press('/');
    await page.keyboard.press('ControlOrMeta+k');
    await expect(field).toHaveValue('/');
    await page.locator('main h1').click();
    await page.keyboard.press('ControlOrMeta+k');
    // Only the last, outside the field, opened it.
    await expect.poll(() => opens(page)).toBe(count + 1);
  },
);
