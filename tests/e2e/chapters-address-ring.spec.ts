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
import { contrast, decodePng, pixel, type Image, type Rgb } from '../quality/lib/pixels';
import { ringContrast } from './horizontal-cinema-model';

// Chapters on platform-neutral, coral-lagoon, humanist-ui and the light display mode: the endpaper's
// address, the closing call's mail link, focused from the keyboard, read 335 of its ring's 582 points
// at 3:1 at 1024x768. At 1024, 1440 and 390: the focus check passes its ring, and every point of its
// centre line, as the check lays it out, changes to 3:1 across the ring's width. Each prints its
// ring's and its ground's styles, its line boxes, and its weak points by side with what the ring's
// centre reads focused and blurred there, and a step past the ring.

const FIXTURE = contractFixture('complete');
const DIR = path.dirname(FIXTURE.files.portfolio);
const ADDRESS = '#cta > p:nth-child(2) > a:nth-child(1)';
const WIDTHS = [
  { width: 1024, height: 768 },
  { width: 1440, height: 900 },
  { width: 390, height: 844 },
] as const;
const READ_ONLY = { type: 'profile', description: 'read-only' };
const tag = '@interaction';

test.use({
  appOptions: {
    portfolio: FIXTURE.files.portfolio,
    siteText: fixtureSiteSelecting(readFileSync(FIXTURE.files.site, 'utf8'), 'chapters')
      .replace(/designLanguage: .*/, 'designLanguage: platform-neutral')
      .replace(/colorScheme: .*/, 'colorScheme: coral-lagoon')
      .replace(/typography: .*/, 'typography: humanist-ui')
      .replace(/displayMode: .*/, 'displayMode: light'),
    sourceFiles: Object.fromEntries(
      FIXTURE.unitFiles.map((file) => [file, readFileSync(path.join(DIR, file), 'utf8')]),
    ),
  },
});

const twoFrames = (page: Page) =>
  page.evaluate(
    () => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done))),
  );

/** A link focused as from the keyboard, so it is :focus-visible, read as the walk reads it. */
async function keyboardFocus(page: Page, selector: string): Promise<Active> {
  const target = page.locator(selector);
  await expect(target).toHaveCount(1);
  await target.scrollIntoViewIfNeeded();
  await page.keyboard.press('Shift');
  await target.focus();
  expect(await target.evaluate((el) => el.matches(':focus-visible'))).toBe(true);
  const active = await inPage<Active>(page, { kind: 'active' });
  expect(active.path).toBe(selector);
  return active;
}

/**
 * The outline offset Chromium paints: it keeps a positive outline-offset in whole device pixels,
 * truncated. Measured on the endpaper's address at a device pixel ratio of 1: an offset of 9.75px
 * (the 1024 px space step) paints as 9, so its ring is 55 px tall round a 33 px box, not the 56.5
 * the computed offset lays out, and 9.03px (at 390) paints as 9. A negative offset keeps its
 * computed value: how one paints is unmeasured.
 */
const paintedOffset = (offset: number, ratio: number): number =>
  offset > 0 ? Math.trunc(offset * ratio) / ratio : offset;

/**
 * Every point of the ring's centre line as the focus check lays it out round the box and its radii,
 * at the offset Chromium paints, each read alone across the ring's width on a focused and a blurred
 * shot: how many are in the shots, and the ones that don't change to 3:1, those on a straight run
 * and those on an arc apart. Focus goes back to the link after.
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
  const dpr = await page.evaluate(() => window.devicePixelRatio);
  const painted = paintedOffset(rounding.offset, dpr);
  const line = ringCentreLine(active.box, rounding.corners, painted + width / 2);
  const ratio = loadThresholds().contrast.nonText;
  const scale = focused.width / clip.width;
  const at = (image: Image, x: number, y: number): Rgb | null => {
    const column = Math.floor((x - clip.x) * scale);
    const row = Math.floor((y - clip.y) * scale);
    return column < 0 || row < 0 || column >= image.width || row >= image.height
      ? null
      : pixel(image, row * image.width + column);
  };
  let points = 0;
  const weak: string[] = [];
  const weakArcs: string[] = [];
  const sides: Record<string, [number, number]> = {};
  const samples: string[] = [];
  for (const point of line) {
    const read = centreLineChange(focused, blurred, clip, [point], ratio, width / 2);
    if (read.total === 0) continue;
    points += 1;
    const side =
      point.ny === -1
        ? 'top'
        : point.ny === 1
          ? 'bottom'
          : point.nx === -1
            ? 'left'
            : point.nx === 1
              ? 'right'
              : 'arc';
    const count = (sides[side] ??= [0, 0]);
    count[1] += 1;
    if (read.strong > 0) continue;
    count[0] += 1;
    (side === 'arc' ? weakArcs : weak).push(`${point.x.toFixed(1)},${point.y.toFixed(1)}`);
    if (samples.length < 8 && (samples.length === 0 || count[0] === 1 || count[0] % 25 === 0)) {
      const ring = at(focused, point.x, point.y);
      const under = at(blurred, point.x, point.y);
      const past = at(blurred, point.x + point.nx * (width + 4), point.y + point.ny * (width + 4));
      const inside = at(
        blurred,
        point.x - point.nx * (width + 1),
        point.y - point.ny * (width + 1),
      );
      samples.push(
        `${side} ${point.x.toFixed(1)},${point.y.toFixed(1)}: ring ${ring} over ${under} ${ring && under ? contrast(ring, under).toFixed(2) : '-'}:1, past ${past}, inside ${inside}`,
      );
    }
  }
  return { points, weak, weakArcs, sides, samples, painted, dpr };
}

/** The focused element's ring and fill, and the nearest painted ground behind it. */
const styles = (locator: Locator) =>
  locator.evaluate((element) => {
    const own = getComputedStyle(element);
    let ground = element.parentElement;
    while (ground && getComputedStyle(ground).backgroundColor === 'rgba(0, 0, 0, 0)') {
      if (getComputedStyle(ground).backgroundImage !== 'none') break;
      ground = ground.parentElement;
    }
    const of = ground ? getComputedStyle(ground) : null;
    return {
      outline: `${own.outlineWidth} ${own.outlineStyle} ${own.outlineColor} offset ${own.outlineOffset}`,
      radius: own.borderRadius,
      fill: own.backgroundColor,
      shadow: own.boxShadow,
      ground: ground
        ? `${ground.tagName.toLowerCase()}.${[...ground.classList].join('.')} ${of!.backgroundColor} ${of!.backgroundImage.slice(0, 160)}`
        : null,
    };
  });

for (const viewport of WIDTHS) {
  test(
    `on platform-neutral the endpaper's address rings whole when focused, every point of its ring at 3:1, at ${viewport.width}`,
    { annotation: [{ type: 'route', description: '/' }, READ_ONLY], tag },
    async ({ page }) => {
      await page.setViewportSize(viewport);
      await page.emulateMedia({ colorScheme: 'light' });
      await page.goto('/', { waitUntil: 'networkidle' });
      const boundary = page.locator('[data-variant]').first();
      await expect(boundary).toHaveAttribute('data-variant', 'chapters');
      await expect(boundary).toHaveAttribute('data-design-language', 'platform-neutral');
      await expect(boundary).toHaveAttribute('data-display-mode', 'light');
      await page.evaluate(() => document.fonts.ready);
      const link = page.locator(ADDRESS);
      await expect(link).toHaveText('rowan@rowan.test');
      const active = await keyboardFocus(page, ADDRESS);
      expect(active.rounding?.width ?? 0, "the address's ring is an outline").toBeGreaterThan(0);
      const lines = await link.evaluate((element) =>
        [...element.getClientRects()].map((r) => [r.x, r.y, r.width, r.height].map(Math.round)),
      );
      const ring = await ringContrast(page, link);
      const each = await everyPoint(page, link, active);
      console.log(
        `chapters address ring ${viewport.width}: box ${JSON.stringify(active.box)}, line boxes ${JSON.stringify(lines)}, rounding ${JSON.stringify(active.rounding)}, painted offset ${each.painted} at DPR ${each.dpr}, styles ${JSON.stringify(await styles(link))}, centre line ${each.points} points, weak ${each.weak.length} on straight runs and ${each.weakArcs.length} on arcs, by side (weak, of) ${JSON.stringify(each.sides)}; samples ${JSON.stringify(each.samples)}; painted bands ${JSON.stringify(ring)}`,
      );
      const read = {
        findings: await focusFindings(page, active),
        weak: [...each.weak, ...each.weakArcs],
        inShots: each.points > 0,
      };
      expect(read, 'the focus check, and every centre line point at 3:1').toEqual({
        findings: [],
        weak: [],
        inShots: true,
      });
    },
  );
}
