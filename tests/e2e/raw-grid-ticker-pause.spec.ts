import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fixtureSiteSelecting } from '../../packages/variant-contract/src/contract-fixtures';
import { contractFixture } from '../../packages/variant-contract/src/node/fixtures';
import { expect, test } from '../harness/fixtures';

// Raw Grid's ticker holds still under high contrast, in its display mode, with more contrast or
// with forced colors, so its facts keep their contrast in every frame. There nothing on the page
// moves, so there's nothing to pause: its Pause motion, the kit's control for every effect on the
// page, shows only while the ticker can move. At 1024 by 768, where the belt has the room to run,
// once the page has hydrated: in each of the three, Pause motion isn't shown; in the light mode
// with neither, the ticker runs and Pause motion is there. On the complete contract fixture.

const FIXTURE = contractFixture('complete');
const DIR = path.dirname(FIXTURE.files.portfolio);
const annotation = [
  { type: 'route', description: '/' },
  { type: 'profile', description: 'read-only' },
];

test.use({
  appOptions: {
    portfolio: FIXTURE.files.portfolio,
    siteText: fixtureSiteSelecting(readFileSync(FIXTURE.files.site, 'utf8'), 'raw-grid'),
    sourceFiles: Object.fromEntries(
      FIXTURE.unitFiles.map((file) => [file, readFileSync(path.join(DIR, file), 'utf8')]),
    ),
  },
  viewport: { width: 1024, height: 768 },
  contextOptions: { reducedMotion: 'no-preference' },
});

const ROWS = {
  'the high-contrast display mode': {
    mode: 'high-contrast',
    media: { contrast: 'no-preference', forcedColors: 'none' },
    held: true,
  },
  'prefers-contrast: more': {
    mode: 'light',
    media: { contrast: 'more', forcedColors: 'none' },
    held: true,
  },
  'forced colors': {
    mode: 'light',
    media: { contrast: 'no-preference', forcedColors: 'active' },
    held: true,
  },
  'the light mode, with neither': {
    mode: 'light',
    media: { contrast: 'no-preference', forcedColors: 'none' },
    held: false,
  },
} as const;

for (const [row, { mode, media, held }] of Object.entries(ROWS)) {
  test(
    held
      ? `in ${row} the ticker holds still and its Pause motion isn't shown`
      : `in ${row} the ticker runs and its Pause motion is shown`,
    { annotation },
    async ({ page, app }) => {
      await page.context().addCookies([
        {
          name: 'portfolio_appearance',
          value: new URLSearchParams({ scheme: 'warm-parchment', mode }).toString(),
          url: app.origin,
        },
      ]);
      await page.emulateMedia(media);
      await page.goto('/', { waitUntil: 'networkidle' });
      const ticker = page.locator('.rg-ticker');
      test.skip((await ticker.count()) === 0, 'the fixture has fewer than two facts');
      await expect(page.locator('[data-variant]').first()).toHaveAttribute(
        'data-display-mode',
        mode,
      );
      // The page has hydrated: the client has taken the Index over, which it does as it starts the
      // ticker, and the ticker's state has been set two frames on.
      await expect(page.locator('[data-rg-index][aria-expanded]').first()).toBeAttached();
      await page.evaluate(
        () => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done))),
      );
      const pause = page
        .locator('.rg-ticker__toggle')
        .getByRole('button', { name: 'Pause motion' });
      if (held) {
        await expect(ticker, row).not.toHaveAttribute('data-ticker', 'running');
        await expect(pause, row).toBeHidden();
      } else {
        await expect(ticker, row).toHaveAttribute('data-ticker', 'running');
        await expect(pause, row).toBeVisible();
      }
    },
  );
}
