// HC evidence only, not for merge (row 53 r2): retries-0 copies of r2's pins, each x10, for the landing evidence.
import { readFileSync } from 'node:fs';
import type { Page } from '@playwright/test';
import path from 'node:path';
import { fixtureSiteSelecting } from '../../packages/variant-contract/src/contract-fixtures';
import { contractFixture } from '../../packages/variant-contract/src/node/fixtures';
import { expect, test } from '../harness/fixtures';
import { read, load, frames, resizeTo } from './horizontal-cinema-model';

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

test.describe.configure({ retries: 0 });

const skipLink = (page: Page) => page.getByRole('link', { name: 'Skip to content' });

for (const at of [0, 64]) {
  for (let run = 1; run <= 10; run++) {
    test(
      `on a phone, the first Tab goes to the skip link with the page at ${at} px (zz-kgn x10 run ${String(run).padStart(2, '0')})`,
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
}

for (let run = 1; run <= 10; run++) {
  test(
    `on a phone, a resize at the top of the page refits the strip in place, and the first Tab goes to the skip link (zz-kgn x10 run ${String(run).padStart(2, '0')})`,
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
}

for (let run = 1; run <= 10; run++) {
  test(
    `on a phone, a direct link to each chapter keeps the fragment it names through a small scroll (zz-kgn x10 run ${String(run).padStart(2, '0')})`,
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
}
