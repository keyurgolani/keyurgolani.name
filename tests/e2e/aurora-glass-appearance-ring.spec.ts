import { readFileSync } from 'node:fs';
import path from 'node:path';
import type { Locator, Page } from '@playwright/test';
import { loadThresholds } from '../../quality/thresholds';
import { fixtureSiteSelecting } from '../../packages/variant-contract/src/contract-fixtures';
import { contractFixture } from '../../packages/variant-contract/src/node/fixtures';
import { expect, test } from '../harness/fixtures';
import {
  centreLineChange,
  clipAround,
  focusFindings,
  ringCentreLine,
} from '../quality/lib/a11y/interaction';
import { inPage, type Active } from '../quality/lib/a11y/probe';
import { decodePng } from '../quality/lib/pixels';
import { ringContrast } from './horizontal-cinema-model';

// Aurora Glass's ornament holds the visitor's Appearance control on its own surface, a pill. On
// utility-dense, warm-parchment, humanist-ui and the system display mode at 1440x900, its summary,
// focused from the keyboard, read 198 of its ring's 258 points at 3:1: the summary took the control
// radius when focused, and round the pill's ends the slot's surface curved inside the ring's corners
// and short sides, so there the ring met the sky. Light and dark, at 1440, 1024 and 390: the focus
// check passes the ring, and every point of its centre line, as the check lays it out, changes to 3:1
// across the ring's width. At 1024 and 390 the summary's box sits at a fractional y, and there a 2px
// ring's round ends antialias so that a point read alone can change under 3:1 though the same ring
// holds at a whole-pixel y: at those two widths the round ends are the focus check's to judge, and
// each arc point set aside is printed. The straight runs, at every width, and all of 1440 stay
// point by point.

const FIXTURE = contractFixture('complete');
const DIR = path.dirname(FIXTURE.files.portfolio);
const TARGET = '#appearance > summary:nth-child(1)';
const READ_ONLY = { type: 'profile', description: 'read-only' };
const tag = '@interaction';
const WIDTHS = [
  { width: 1440, height: 900, arcsByCheck: false },
  { width: 1024, height: 768, arcsByCheck: true },
  { width: 390, height: 844, arcsByCheck: true },
] as const;

test.use({
  appOptions: {
    portfolio: FIXTURE.files.portfolio,
    siteText: fixtureSiteSelecting(readFileSync(FIXTURE.files.site, 'utf8'), 'aurora-glass')
      .replace(/designLanguage: .*/, 'designLanguage: utility-dense')
      .replace(/colorScheme: .*/, 'colorScheme: warm-parchment')
      .replace(/typography: .*/, 'typography: humanist-ui')
      .replace(/displayMode: .*/, 'displayMode: system'),
    sourceFiles: Object.fromEntries(
      FIXTURE.unitFiles.map((file) => [file, readFileSync(path.join(DIR, file), 'utf8')]),
    ),
  },
});

const twoFrames = (page: Page) =>
  page.evaluate(
    () => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done))),
  );

/** The summary focused as from the keyboard, so it is :focus-visible, read as the walk reads it. */
async function keyboardFocus(page: Page): Promise<Active> {
  const target = page.locator(TARGET);
  await expect(target).toHaveCount(1);
  await target.scrollIntoViewIfNeeded();
  await page.keyboard.press('Shift');
  await target.focus();
  expect(await target.evaluate((el) => el.matches(':focus-visible'))).toBe(true);
  const active = await inPage<Active>(page, { kind: 'active' });
  expect(active.path).toBe(TARGET);
  return active;
}

/**
 * Every point of the ring's centre line as the focus check lays it out round the box and its radii,
 * each read alone across the ring's width on a focused and a blurred shot: how many are in the shots,
 * and the ones that don't change to 3:1, those on a straight run and those on an arc apart. Focus
 * goes back to the summary after.
 */
async function everyPoint(page: Page, locator: Locator, active: Active) {
  const rounding = active.rounding!;
  const width = rounding.width ?? 0;
  const clip = clipAround(active.box, Math.ceil(active.reach) + 1, page.viewportSize()!)!;
  const shot = async () =>
    decodePng(await page.screenshot({ clip, animations: 'disabled', caret: 'hide' }));
  await twoFrames(page);
  const focused = await shot();
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  await twoFrames(page);
  const blurred = await shot();
  await locator.evaluate((element: HTMLElement) => element.focus());
  const line = ringCentreLine(active.box, rounding.corners, rounding.offset + width / 2);
  const ratio = loadThresholds().contrast.nonText;
  let points = 0;
  const weak: string[] = [];
  const weakArcs: string[] = [];
  for (const point of line) {
    const read = centreLineChange(focused, blurred, clip, [point], ratio, width / 2);
    if (read.total === 0) continue;
    points += 1;
    if (read.strong > 0) continue;
    const straight = Math.abs(point.nx) === 1 || Math.abs(point.ny) === 1;
    (straight ? weak : weakArcs).push(`${point.x.toFixed(1)},${point.y.toFixed(1)}`);
  }
  return { points, weak, weakArcs };
}

for (const colorScheme of ['light', 'dark'] as const) {
  test(
    `in ${colorScheme}, the Appearance control's summary in the ornament rings whole when focused, every point of its ring at 3:1, at 1440, 1024 and 390`,
    { annotation: [{ type: 'route', description: '/' }, READ_ONLY], tag },
    async ({ page }) => {
      await page.emulateMedia({ colorScheme });
      const reads: Record<number, { findings: unknown[]; weak: string[]; inShots: boolean }> = {};
      for (const size of WIDTHS) {
        await page.setViewportSize(size);
        await page.goto('/', { waitUntil: 'networkidle' });
        const boundary = page.locator('[data-variant]').first();
        await expect(boundary).toHaveAttribute('data-variant', 'aurora-glass');
        await expect(boundary).toHaveAttribute('data-design-language', 'utility-dense');
        await expect(boundary).toHaveAttribute('data-display-mode', 'system');
        await page.evaluate(() => document.fonts.ready);
        expect(
          await page.evaluate(
            () => getComputedStyle(document.querySelector('[data-variant]')!).colorScheme,
          ),
          'the boundary renders the emulated scheme',
        ).toBe(colorScheme);
        const summary = page.locator(TARGET);
        expect(
          await summary.evaluate(
            (el) => !!el.closest('.ag-ornament > [data-visitor-control-slot]'),
          ),
          "the summary is in the ornament's control slot",
        ).toBe(true);
        const active = await keyboardFocus(page);
        expect(active.rounding?.width ?? 0, 'its ring is an outline').toBeGreaterThan(0);
        const ring = await ringContrast(page, summary);
        const each = await everyPoint(page, summary, active);
        console.log(
          `appearance ring ${colorScheme} ${size.width}: box ${JSON.stringify(active.box)}, rounding ${JSON.stringify(active.rounding)}, centre line ${each.points} points, weak on straight runs ${JSON.stringify(each.weak)}, weak on arcs ${JSON.stringify(each.weakArcs)}; painted bands ${JSON.stringify(ring)}`,
        );
        if (size.arcsByCheck && each.weakArcs.length > 0)
          console.log(
            `appearance ring ${colorScheme} ${size.width}: set aside ${each.weakArcs.length} arc point(s), the focus check's to judge at a box y of ${active.box.y}: ${each.weakArcs.join(' ')}`,
          );
        reads[size.width] = {
          findings: await focusFindings(page, active),
          weak: size.arcsByCheck ? each.weak : [...each.weak, ...each.weakArcs],
          inShots: each.points > 0,
        };
        await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
      }
      expect(reads, 'the focus check, and every centre line point at 3:1, at each width').toEqual(
        Object.fromEntries(
          WIDTHS.map(({ width }) => [width, { findings: [], weak: [], inShots: true }]),
        ),
      );
    },
  );
}
