import type { Page } from '@playwright/test';
import { expect, test } from '../harness/fixtures';
import { DEMO_APP } from '../harness/profile-matrix';

// Editorial Evidence's lede in a browser (OWN-7): on one column it reads its
// first paragraph, the rest behind a Read more disclosure that takes focus,
// opens and closes on Enter, and prints open; beside the head column it
// reads whole. On the demo's sample, whose About runs to three paragraphs
// (the complete fixture's lede is one).

test.use({ appOptions: DEMO_APP, viewport: { width: 1440, height: 900 } });

const SAMPLE =
  '/sample?variant=editorial-evidence&language=platform-neutral&scheme=warm-parchment&type=humanist-ui&mode=light';
const annotation = [
  { type: 'route', description: '/sample' },
  { type: 'profile', description: 'demo' },
];

async function load(page: Page): Promise<void> {
  await page.goto(SAMPLE, { waitUntil: 'load' });
  await expect(page.locator('[data-variant]')).toHaveAttribute(
    'data-variant',
    'editorial-evidence',
  );
}

test(
  'on one column the lede reads its first paragraph, and Read more opens the rest and prints open',
  { annotation, tag: '@interaction' },
  async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await load(page);
    const more = page.locator('details.ee-more').first();
    const summary = more.locator('> summary');
    const rest = more.locator('> .ee-prose');
    await expect(summary).toContainText('Read more');
    await expect(rest).toBeHidden();
    await summary.focus();
    await expect(summary).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(rest).toBeVisible();
    await page.keyboard.press('Enter');
    await expect(rest).toBeHidden();
    await page.emulateMedia({ media: 'print' });
    await expect(rest).toBeVisible();
  },
);

test(
  'beside the head column the lede reads whole, its Read more line gone',
  { annotation },
  async ({ page }) => {
    await load(page);
    const more = page.locator('details.ee-more').first();
    await expect(more.locator('> summary')).toBeHidden();
    await expect(more.locator('> .ee-prose')).toBeVisible();
  },
);
