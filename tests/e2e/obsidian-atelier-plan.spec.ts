import { readFileSync } from 'node:fs';
import path from 'node:path';
import type { Page } from '@playwright/test';
import { fixtureSiteSelecting } from '../../packages/variant-contract/src/contract-fixtures';
import { contractFixture } from '../../packages/variant-contract/src/node/fixtures';
import { expect, test } from '../harness/fixtures';

// Obsidian Atelier's plan of the exhibition (redesign, stream C), on the
// complete contract fixture. obsidian-atelier-lights.spec.ts has its
// gallery lights. Index opens the plan in a
// native modal that keeps focus inside it, closes on Escape, and gives focus
// back to Index; a door in it closes it, goes where it goes, and puts focus
// there. With no script Index is a link to the footer's plan and the mark
// shows.

/** The app options that serve a contract fixture through Atelier. */
function serving(name: string) {
  const fixture = contractFixture(name);
  const dir = path.dirname(fixture.files.portfolio);
  return {
    portfolio: fixture.files.portfolio,
    siteText: fixtureSiteSelecting(readFileSync(fixture.files.site, 'utf8'), 'obsidian-atelier'),
    sourceFiles: Object.fromEntries(
      fixture.unitFiles.map((file) => [file, readFileSync(path.join(dir, file), 'utf8')]),
    ),
  };
}

const READ_ONLY = { type: 'profile', description: 'read-only' };
const annotation = [{ type: 'route', description: '/' }, READ_ONLY];
const tag = '@interaction';

test.use({ appOptions: serving('complete'), viewport: { width: 1440, height: 900 } });

async function load(page: Page): Promise<void> {
  await page.goto('/', { waitUntil: 'load' });
  await expect(page.locator('[data-variant]')).toHaveAttribute('data-variant', 'obsidian-atelier');
}

/**
 * Where focus is with the dialog open: on its first or last stop, on
 * another stop inside it, out in the browser's own chrome (the body), or
 * on the page behind it.
 */
const focusAt = (page: Page) =>
  page.evaluate(() => {
    const dialog = document.querySelector('dialog[open]');
    const active = document.activeElement;
    if (!dialog) return 'closed';
    if (active === null || active === document.body) return 'body';
    if (!dialog.contains(active)) return 'behind';
    const stops = [
      ...dialog.querySelectorAll<HTMLElement>(
        'a[href], button:not([disabled]), input, select, textarea, [tabindex]:not([tabindex="-1"])',
      ),
    ].filter((stop) => stop.getClientRects().length > 0);
    if (active === stops[0]) return 'first';
    if (active === stops[stops.length - 1]) return 'last';
    return 'inside';
  });

/**
 * Whether one press kept focus with the dialog: on a stop in it, or out in
 * the browser's chrome only at the wrap, from its last stop going forward
 * or its first going back, and only for that one press.
 */
function keptFocus(before: string, after: string, forward: boolean): boolean {
  if (after === 'body') return before === (forward ? 'last' : 'first');
  return after === 'first' || after === 'last' || after === 'inside';
}

test(
  'Index opens the plan as a modal that keeps focus inside, closes on Escape, and gives focus back to Index',
  { annotation, tag },
  async ({ page }) => {
    await load(page);
    await expect(page.locator('.oa-chrome')).toHaveAttribute('data-oa-script', '');
    const index = page.getByRole('button', { name: 'Index' });
    await index.click();
    await expect(page.locator('dialog[open]')).toBeVisible();
    let at = await focusAt(page);
    expect(['first', 'last', 'inside']).toContain(at);
    // Round the dialog and past its end: focus never reaches the page behind it.
    let wrapped = false;
    for (let step = 0; step < 40; step++) {
      await page.keyboard.press('Tab');
      const next = await focusAt(page);
      expect(keptFocus(at, next, true), `after ${step + 1} tabs: ${at} to ${next}`).toBe(true);
      wrapped ||= at === 'last';
      at = next;
    }
    expect(wrapped, 'forty tabs go round the dialog').toBe(true);
    for (let step = 0; step < 5; step++) {
      await page.keyboard.press('Shift+Tab');
      const next = await focusAt(page);
      expect(keptFocus(at, next, false), `back ${step + 1}: ${at} to ${next}`).toBe(true);
      at = next;
    }
    await page.keyboard.press('Escape');
    await expect(page.locator('dialog[open]')).toHaveCount(0);
    await expect(index).toBeFocused();
  },
);

test(
  'a door in the plan closes the dialog, goes to its room, and puts focus there',
  { annotation, tag },
  async ({ page }) => {
    await load(page);
    await page.getByRole('button', { name: 'Index' }).click();
    const door = page.locator('dialog[open] .oa-plan__room a[href^="#"]').nth(1);
    const href = await door.getAttribute('href');
    expect(href).toBeTruthy();
    await door.click();
    await expect(page.locator('dialog[open]')).toHaveCount(0);
    await expect.poll(() => page.evaluate(() => location.hash)).toBe(href);
    await expect
      .poll(() =>
        page.evaluate(() => (document.activeElement ? `#${document.activeElement.id}` : '')),
      )
      .toBe(href);
  },
);

test(
  'in print the top row keeps each room in the switch readable: no corner lies over its name',
  { annotation, tag },
  async ({ page }) => {
    await load(page);
    await page.emulateMedia({ media: 'print' });
    const covered = await page.evaluate(() =>
      [...document.querySelectorAll<HTMLElement>('.oa-chrome__rooms .oa-chrome__name')]
        .filter((name) => name.checkVisibility())
        .flatMap((name) => {
          const box = name.getBoundingClientRect();
          const link = name.closest('a')!;
          const at = document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2);
          return at && link.contains(at)
            ? []
            : [`${link.getAttribute('aria-label')}: under ${at?.outerHTML.slice(0, 80)}`];
        }),
    );
    expect(covered).toEqual([]);
    // The visitor's Appearance control prints its summary, its panel closed: a form isn't content.
    await expect(
      page.locator('.oa-chrome__appearance [data-ui-slot="disclosure.summary"]'),
    ).toBeVisible();
    await expect(page.locator('.oa-chrome__appearance form')).toBeHidden();
  },
);

test.describe('with no script', () => {
  test.use({ javaScriptEnabled: false });

  test(
    'Index is a link to the footer plan, and the mark shows',
    { annotation, tag },
    async ({ page }) => {
      await page.goto('/', { waitUntil: 'load' });
      const link = page.locator('.oa-chrome__index-link');
      await expect(link).toBeVisible();
      await expect(page.locator('.oa-chrome__index')).toBeHidden();
      await expect(page.locator('.oa-chrome__mark')).toBeVisible();
      const href = await link.getAttribute('href');
      await link.click();
      await expect.poll(() => page.evaluate(() => location.hash)).toBe(href);
      await expect(page.locator(`footer${href}`)).toBeInViewport();
    },
  );
});
