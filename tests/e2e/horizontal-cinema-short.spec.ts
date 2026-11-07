import { readFileSync } from 'node:fs';
import type { Page } from '@playwright/test';
import path from 'node:path';
import { fixtureSiteSelecting } from '../../packages/variant-contract/src/contract-fixtures';
import { contractFixture } from '../../packages/variant-contract/src/node/fixtures';
import { expect, test } from '../harness/fixtures';
import { frames, load, read, resizeTo } from './horizontal-cinema-model';

// Horizontal Cinema on a phone with short scenes (redesign): the
// identity-only contract fixture, whose title card and four chapter cards
// are each shorter than the window, so the page's foot comes before most
// of them reach its top. A direct link lands on its scene and keeps it,
// with the URL agreeing, through the settle a small scroll starts.

const SHORT = contractFixture('identity-only');
const SHORT_DIR = path.dirname(SHORT.files.portfolio);
const READ_ONLY = { type: 'profile', description: 'read-only' };
const annotation = [{ type: 'route', description: '/' }, READ_ONLY];
const tag = '@interaction';

test.use({
  appOptions: {
    portfolio: SHORT.files.portfolio,
    siteText: fixtureSiteSelecting(readFileSync(SHORT.files.site, 'utf8'), 'horizontal-cinema'),
    sourceFiles: Object.fromEntries(
      SHORT.unitFiles.map((file) => [file, readFileSync(path.join(SHORT_DIR, file), 'utf8')]),
    ),
  },
  viewport: { width: 390, height: 844 },
  isMobile: true,
  hasTouch: true,
});

test(
  'on a phone, a direct link to each chapter keeps the fragment it names through a small scroll',
  { annotation, tag },
  async ({ page }) => {
    await load(page);
    expect((await read(page)).layout).toBe('vertical');
    const { scenes } = await read(page);
    for (const chapter of ['prologue', 'origins', 'journey', 'craft', 'epilogue']) {
      const card = scenes.indexOf(`chapter-${chapter}`);
      expect(card, `chapter-${chapter} is a scene`).toBeGreaterThanOrEqual(0);
      await load(page, `/#chapter-${chapter}`);
      await expect.poll(() => page.evaluate(() => location.hash)).toBe(`#chapter-${chapter}`);
      // A small scroll down stays on the chapter the link opened, and the URL isn't rewritten past it.
      await page.evaluate(() => window.scrollBy({ top: 40, behavior: 'instant' }));
      await page.waitForTimeout(1200);
      expect(await read(page)).toMatchObject({ current: card, hash: `#chapter-${chapter}` });
    }
  },
);

// The page's first Tab goes to its skip link, wherever the reader is on the page and whatever the
// strip did before it (row 53 r2, 1b): a refit at the top of the page, which a resize brings, takes
// no scroll of its own and leaves the keyboard's starting point where it was. These scenes hold no
// links, so a starting point moved into one sends the Tab past them all, to the foot's first.
const skipLink = (page: Page) => page.getByRole('link', { name: 'Skip to content' });

for (const at of [0, 64]) {
  test(
    `on a phone, the first Tab goes to the skip link with the page at ${at} px`,
    { annotation, tag },
    async ({ page }) => {
      await load(page);
      await frames(page);
      expect(await read(page)).toMatchObject({ layout: 'vertical', scrollY: 0 });
      // The page put there as a visitor's scroll puts it, not by the strip's own refit.
      if (at > 0) {
        await page.evaluate((top) => window.scrollTo({ top, behavior: 'instant' }), at);
        await frames(page);
      }
      expect((await read(page)).scrollY).toBe(at);
      await page.keyboard.press('Tab');
      await expect(skipLink(page)).toBeFocused();
    },
  );
}

test(
  'on a phone, a resize at the top of the page refits the strip in place, and the first Tab goes to the skip link',
  { annotation, tag },
  async ({ page }) => {
    await load(page);
    await frames(page);
    expect(await read(page)).toMatchObject({ layout: 'vertical', scrollY: 0 });
    // A shorter window and back, as the full-page shot's layout or a browser's bar does: each
    // refits the strip once its settle runs out.
    await resizeTo(page, { width: 390, height: 700 });
    await resizeTo(page, { width: 390, height: 844 });
    // Soft, so the Tab below is read either way.
    expect.soft((await read(page)).scrollY, 'the refit keeps the page at the top').toBe(0);
    await page.keyboard.press('Tab');
    await expect(skipLink(page)).toBeFocused();
  },
);
