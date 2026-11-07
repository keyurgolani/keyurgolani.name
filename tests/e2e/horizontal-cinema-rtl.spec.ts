import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fixtureSiteSelecting } from '../../packages/variant-contract/src/contract-fixtures';
import { contractFixture } from '../../packages/variant-contract/src/node/fixtures';
import { expect, test } from '../harness/fixtures';
import type { Page } from '@playwright/test';
import {
  arrivedAt,
  crowdRail,
  expectAt,
  load,
  railClashes,
  read,
  tabIntoLaterScenes,
  widenRailYears,
} from './horizontal-cinema-model';

// Horizontal Cinema right to left: the rtl contract fixture (Hebrew, dir=rtl). The fit check measures
// the rail under the stage in the bar's own inline direction, so a right-to-left rail that holds its
// labels pins the strip as a left-to-right one does, and one that can't still stacks it.

const FIXTURE = contractFixture('rtl');
const DIR = path.dirname(FIXTURE.files.portfolio);
const READ_ONLY = { type: 'profile', description: 'read-only' };
const annotation = [{ type: 'route', description: '/' }, READ_ONLY];
const tag = '@interaction';

test.use({
  appOptions: {
    portfolio: FIXTURE.files.portfolio,
    siteText: fixtureSiteSelecting(readFileSync(FIXTURE.files.site, 'utf8'), 'horizontal-cinema'),
    sourceFiles: Object.fromEntries(
      FIXTURE.unitFiles.map((file) => [file, readFileSync(path.join(DIR, file), 'utf8')]),
    ),
  },
  viewport: { width: 1440, height: 900 },
});

test(
  'right to left at 1440 by 900, the strip pins with its rail whole',
  { annotation },
  async ({ page }) => {
    await load(page);
    await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
    await expect
      .poll(async () => {
        const { layout, pinned, fit } = await read(page);
        return { layout, pinned, fit };
      })
      .toEqual({ layout: 'horizontal', pinned: true, fit: null });
    expect(await railClashes(page)).toEqual([]);
  },
);

test(
  "right to left, a rail that can't hold its labels still stacks the strip top to bottom",
  { annotation },
  async ({ page }) => {
    await crowdRail(page);
    await load(page);
    await expect
      .poll(async () => {
        const { layout, pinned, fit } = await read(page);
        return { layout, pinned, fit };
      })
      .toEqual({ layout: 'vertical', pinned: false, fit: 'over' });
  },
);

test(
  'right to left, a label over the one before it, inside the bar and clear of its other parts, still stacks the strip',
  { annotation },
  async ({ page }) => {
    // Only the label-over-label check can catch this rail. The fixture's five chapters each take
    // 221.9 px of the bar's 50..1390, 15 px apart, read from the right: Prologue's text ends
    // (on its left) near 1152, and Origins' label starts (on its right) at 973.1. Moved 230 px to
    // the right, a transform the fit's boxes read but nothing lays out, Origins starts at 1203.1:
    // about 50 px into Prologue, still 67 px short of the transport (1270..1390), and nowhere near
    // the position text and credits (50..424) or the bar's ends. Its years hidden, the words
    // still start there, so the short rail doesn't hold it either.
    await page.addInitScript(() => {
      document.addEventListener('DOMContentLoaded', () => {
        const style = document.createElement('style');
        style.textContent =
          '.hc-minimap__chapter:nth-child(2) .hc-minimap__label { transform: translateX(230px); }';
        document.head.append(style);
      });
    });
    await load(page);
    await expect
      .poll(async () => {
        const { layout, pinned, fit } = await read(page);
        return { layout, pinned, fit };
      })
      .toEqual({ layout: 'vertical', pinned: false, fit: 'over' });
  },
);

test(
  "right to left at 1440 by 900, a rail whose years don't fit shortens them and keeps the strip pinned, its labels clear",
  { annotation },
  async ({ page }) => {
    // This fixture's one dated chapter, Origins ("2015–now", 8 glyphs, 68.6 px), holds 1.5em
    // (235.4 px, so about 111 px an em) and its whole rail still clears the bar's end: its
    // chapters have 126 to 175 px to spare past their labels, and 60 px lie between the rail and
    // .hc-scrub__end. The full rail meets the end once the years grow about 186 to 235 px more,
    // from 3.2 to 3.6em; at 5em it runs at least 154 px into it, and with the years hidden the
    // labels are narrower than the plain rail's, which clears the end by 115 px.
    await widenRailYears(page, '5em');
    await load(page);
    await expect
      .poll(async () => {
        const { layout, pinned, fit } = await read(page);
        const rail = await page.locator('.hc-shell').getAttribute('data-rail');
        return { layout, pinned, fit, rail };
      })
      .toEqual({ layout: 'horizontal', pinned: true, fit: null, rail: 'short' });
    expect(await railClashes(page)).toEqual([]);
  },
);

/** Every scene a Tab can set out from, holding a link, with a scene to go on (or back) into. */
const linkedScenes = async (page: Page, back: boolean): Promise<number[]> => {
  const { scenes } = await read(page);
  return page.evaluate(
    ([ids, back]) =>
      ids.flatMap((id, index) =>
        (back ? index > 0 : index < ids.length - 1) &&
        document.getElementById(id)?.querySelector('a[href]')
          ? [index]
          : [],
      ),
    [scenes, back] as const,
  );
};

test(
  'right to left, a Tab into a later scene steps the strip there at once: what it reached holds still in view, and the status names its scene once the strip rests',
  { annotation, tag },
  async ({ page }) => {
    await load(page);
    const from = await linkedScenes(page, false);
    expect(await tabIntoLaterScenes(page, { from })).toBeGreaterThanOrEqual(2);
  },
);

test(
  'right to left, a Shift+Tab back into an earlier scene steps the strip there at once too: what it reached holds still in view, and the status names its scene once the strip rests',
  { annotation, tag },
  async ({ page }) => {
    await load(page);
    const from = await linkedScenes(page, true);
    expect(await tabIntoLaterScenes(page, { back: true, from })).toBeGreaterThanOrEqual(2);
  },
);

test(
  'right to left, a slow wheel, a notch at a time with the page at rest between, travels on scene by scene and never back',
  { annotation, tag },
  async ({ page }) => {
    await load(page);
    await page.mouse.move(720, 450);
    // As left to right: the next notch goes the moment the snap arrives, read in the page, and the
    // page's scroll down travels the strip on the way it reads, here to the left.
    for (const index of [1, 2]) {
      await page.mouse.wheel(0, 200);
      expect(await arrivedAt(page, index), `the snap reaches scene ${index}`).toBe(true);
    }
    await page.mouse.wheel(0, -200);
    await expectAt(page, 1);
    expect((await read(page)).along).toBeGreaterThan(0);
  },
);
