import type { Locator, Page } from '@playwright/test';
import { expect } from '../harness/fixtures';

// The disclosure primitive's chevron (data-marker="chevron"), read from its
// computed geometry rather than its pixels, for the fallback's specs in
// either direction of text.

/**
 * Which way a disclosure's chevron points: the corner its two logical
 * borders meet at, block-end and inline-end, taken through its scale and
 * then its rotation, as CSS applies them.
 */
export async function chevron(summary: Locator): Promise<'down' | 'up' | 'left' | 'right'> {
  return summary.evaluate((element) => {
    const style = getComputedStyle(element, '::after');
    let x = style.direction === 'rtl' ? -1 : 1;
    let y = 1;
    if (style.scale !== 'none') {
      const [sx, sy = sx] = style.scale.split(' ').map(Number);
      x *= sx!;
      y *= sy!;
    }
    const turn = style.rotate === 'none' ? 0 : (parseFloat(style.rotate) * Math.PI) / 180;
    const [px, py] = [
      x * Math.cos(turn) - y * Math.sin(turn),
      x * Math.sin(turn) + y * Math.cos(turn),
    ];
    if (Math.abs(py) > Math.abs(px)) return py > 0 ? 'down' : 'up';
    return px > 0 ? 'right' : 'left';
  });
}

/**
 * On the page as it is, in the phone Menu: the page's direction is `dir`,
 * and every disclosure's chevron points down while closed and up once open.
 */
export async function menuChevrons(page: Page, dir: 'ltr' | 'rtl'): Promise<void> {
  await expect(page.locator('html')).toHaveAttribute('dir', dir);
  await page.getByRole('button', { name: 'Menu' }).click();
  const dialog = page.getByRole('dialog', { name: 'Menu' });
  await expect(dialog).toBeVisible();
  const summary = dialog.locator('.fc-menu__all > [data-ui-slot="disclosure.summary"]');
  await expect.poll(() => chevron(summary)).toBe('down');
  await summary.click();
  await expect.poll(() => chevron(summary)).toBe('up');
  for (const other of await dialog
    .locator('[data-marker="chevron"]:not([open]) > [data-ui-slot="disclosure.summary"]')
    .all()) {
    expect(await chevron(other)).toBe('down');
  }
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
}
