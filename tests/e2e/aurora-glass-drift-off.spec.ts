import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fixtureSiteSelecting } from '../../packages/variant-contract/src/contract-fixtures';
import { contractFixture } from '../../packages/variant-contract/src/node/fixtures';
import { expect, test } from '../harness/fixtures';

// Aurora Glass with the owner's drift turned off (the delta review's low 7):
// only the bead breathes, so it alone counts toward the stop rule (AG-M7);
// and where the Lens is hidden too, between 48 and 56rem, nothing on screen
// moves, so Pause isn't offered. On the complete fixture, under read-only.
// Its own file: the site's controls are app options, which a describe
// group can't change (they force a new worker).

const FIXTURE = contractFixture('complete');
const DIR = path.dirname(FIXTURE.files.portfolio);
const annotation = [
  { type: 'route', description: '/' },
  { type: 'profile', description: 'read-only' },
];
const SITE_TEXT = fixtureSiteSelecting(readFileSync(FIXTURE.files.site, 'utf8'), 'aurora-glass');

test.use({
  viewport: { width: 1440, height: 900 },
  appOptions: {
    portfolio: FIXTURE.files.portfolio,
    siteText: `${SITE_TEXT.trimEnd()}\nvariantControls:\n  aurora-glass:\n    version: 1\n    values:\n      drift: false\n`,
    sourceFiles: Object.fromEntries(
      FIXTURE.unitFiles.map((file) => [file, readFileSync(path.join(DIR, file), 'utf8')]),
    ),
  },
});

/** The page's infinite animations and whether each is running. */
const loops = () =>
  document
    .getAnimations()
    .filter((animation) => animation.effect?.getTiming().iterations === Infinity)
    .map((animation) => animation.playState);

test(
  'only the bead breathes, and it stops for good after the same time in its own cycles',
  { annotation },
  async ({ page }) => {
    await page.goto('/', { waitUntil: 'networkidle' });
    await expect(page.locator('.ag-sky')).toHaveAttribute('data-ag-drift', 'off');
    const pause = page.getByRole('button', { name: 'Pause the sky' });
    await expect(pause).toBeVisible();
    await expect.poll(() => page.evaluate(loops)).toEqual(['running']);
    // Eight drift half-cycles are twenty-four breaths; twenty-three leave it running.
    const breathe = (times: number) =>
      page.evaluate((n) => {
        const lens = document.querySelector('.ag-lens')!;
        for (let i = 0; i < n; i += 1)
          lens.dispatchEvent(new AnimationEvent('animationiteration', { bubbles: true }));
      }, times);
    await breathe(23);
    await expect(page.locator('.ag')).toHaveAttribute('data-ag-sky', 'drift');
    await breathe(1);
    await expect(page.locator('.ag')).not.toHaveAttribute('data-ag-sky', /.*/);
    await expect(pause).toBeHidden();
    await expect.poll(() => page.evaluate(loops)).toEqual([]);
  },
);

// From 56 to 64rem the Lens hangs in the stacked pane (P2, S1), so its bead breathes there:
// the still band is 48 to 56rem.
test.describe('between 48 and 56rem', () => {
  test.use({ viewport: { width: 800, height: 900 } });
  test(
    'nothing on screen moves (the Lens is hidden), so Pause is withdrawn and nothing loops',
    { annotation },
    async ({ page }) => {
      await page.goto('/', { waitUntil: 'networkidle' });
      await expect(page.locator('.ag[data-ag-live]')).toHaveCount(1);
      await expect(page.locator('.ag-lens')).toBeHidden();
      await expect(page.getByRole('button', { name: 'Pause the sky' })).toHaveCount(0);
      await expect(page.locator('[data-ag-pause]:not([hidden])')).toHaveCount(0);
      await expect(page.locator('.ag')).not.toHaveAttribute('data-ag-sky', /.*/);
      expect(await page.evaluate(loops)).toEqual([]);
    },
  );
});
