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

// A composition's focus perimeter on one tuple a spec file (a test's appOptions can't vary inside a
// file): each control focused from the keyboard rings whole, the focus check passes it, and every
// point of its centre line, as the check lays it out, changes to 3:1 across the ring's width, at each
// width and preference row the quality cells read it in. Each test prints the control's ring, its
// fill and shadow, the painted ground behind it, its weak points by side, and samples of what the
// ring's centre reads focused and blurred there, and a step past the ring.

const FIXTURE = contractFixture('complete');
const DIR = path.dirname(FIXTURE.files.portfolio);
const READ_ONLY = { type: 'profile', description: 'read-only' };
const VIEWPORTS = {
  1440: { width: 1440, height: 900 },
  1024: { width: 1024, height: 768 },
  390: { width: 390, height: 844 },
} as const;

/** The preference rows a quality cell emulates for these tests, as run-cell.ts's emulateRow does. */
const ROWS = {
  default: { forcedColors: 'none', contrast: 'no-preference' },
  'contrast-more': { forcedColors: 'none', contrast: 'more' },
  'forced-colors': { forcedColors: 'active', contrast: 'no-preference' },
} as const;

export interface PerimeterCase {
  /** What the control is, for the title. */
  readonly name: string;
  /** The control, by its own classes. */
  readonly selector: string;
  readonly widths: readonly (keyof typeof VIEWPORTS)[];
  readonly rows?: readonly (keyof typeof ROWS)[];
}

/** The variant's site on the tuple, the complete fixture's otherwise: designLanguage/colorScheme/typography/displayMode. */
function tupleOptions(variant: string, tuple: string) {
  const [designLanguage, colorScheme, typography, displayMode] = tuple.split('/');
  return {
    portfolio: FIXTURE.files.portfolio,
    siteText: fixtureSiteSelecting(readFileSync(FIXTURE.files.site, 'utf8'), variant)
      .replace(/designLanguage: .*/, `designLanguage: ${designLanguage}`)
      .replace(/colorScheme: .*/, `colorScheme: ${colorScheme}`)
      .replace(/typography: .*/, `typography: ${typography}`)
      .replace(/displayMode: .*/, `displayMode: ${displayMode}`),
    sourceFiles: Object.fromEntries(
      FIXTURE.unitFiles.map((file) => [file, readFileSync(path.join(DIR, file), 'utf8')]),
    ),
  };
}

const twoFrames = (page: Page) =>
  page.evaluate(
    () => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done))),
  );

/** A control focused as from the keyboard, so it is :focus-visible, read as the walk reads it. */
export async function keyboardFocus(page: Page, target: Locator): Promise<Active> {
  await expect(target).toHaveCount(1);
  await target.scrollIntoViewIfNeeded();
  await page.keyboard.press('Shift');
  await target.focus();
  expect(await target.evaluate((el) => el.matches(':focus-visible'))).toBe(true);
  expect(await target.evaluate((el) => el === document.activeElement)).toBe(true);
  return inPage<Active>(page, { kind: 'active' });
}

/**
 * The outline offset Chromium paints: it keeps a positive outline-offset in whole device pixels,
 * truncated. Measured at a device pixel ratio of 1: an offset of 9.75px (the 1024 px space step)
 * paints as 9, a ring 55 px tall round a 33 px box rather than the 56.5 the computed offset lays
 * out, and 9.03px paints as 9. A negative offset keeps its computed value: how one paints is
 * unmeasured.
 */
export const paintedOffset = (offset: number, ratio: number): number =>
  offset > 0 ? Math.trunc(offset * ratio) / ratio : offset;

/**
 * Every point of the ring's centre line as the focus check lays it out round the box and its radii,
 * at the offset Chromium paints unless one is given, each read alone across the ring's width on a
 * focused and a blurred shot: how many are in the shots, the ones that don't change to 3:1 by side,
 * and samples of the weak ones. Focus goes back after.
 */
export async function everyPoint(page: Page, locator: Locator, active: Active, offset?: number) {
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
  const painted = offset ?? paintedOffset(rounding.offset, dpr);
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
    weak.push(`${point.x.toFixed(1)},${point.y.toFixed(1)}`);
    if (samples.length < 8 && (count[0] === 1 || count[0] % 25 === 0)) {
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
  return { points, weak, sides, samples, painted, dpr };
}

/** The control's ring and fill, and the nearest painted ground behind it. */
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
      classes: `${element.tagName.toLowerCase()}.${[...element.classList].join('.')}`,
      outline: `${own.outlineWidth} ${own.outlineStyle} ${own.outlineColor} offset ${own.outlineOffset}`,
      radius: own.borderRadius,
      border: own.border,
      fill: own.backgroundColor,
      shadow: own.boxShadow,
      overflow: own.overflow,
      after: (() => {
        const after = getComputedStyle(element, '::after');
        return after.content === 'none'
          ? null
          : `${after.outlineWidth} ${after.outlineStyle} ${after.outlineColor} offset ${after.outlineOffset} inset ${after.inset} fill ${after.backgroundColor}`;
      })(),
      clippedBy: (() => {
        for (let up = element.parentElement; up; up = up.parentElement) {
          const o = getComputedStyle(up);
          if (o.overflow !== 'visible' || o.clipPath !== 'none' || o.contain.includes('paint'))
            return `${up.tagName.toLowerCase()}.${[...up.classList].join('.')} overflow ${o.overflow} clip ${o.clipPath} contain ${o.contain}`;
        }
        return null;
      })(),
      ground: ground
        ? `${ground.tagName.toLowerCase()}.${[...ground.classList].join('.')} ${of!.backgroundColor} ${of!.backgroundImage.slice(0, 160)}`
        : null,
      groundEdge: ground
        ? (() => {
            const r = ground.getBoundingClientRect();
            return `box ${[r.x, r.y, r.width, r.height].map((n) => n.toFixed(2)).join(',')} radius ${of!.borderRadius} border ${of!.border} padding ${of!.padding} shadow ${of!.boxShadow} filter ${of!.backdropFilter}`;
          })()
        : null,
      siblings: [...(element.parentElement?.children ?? [])]
        .filter((sibling) => getComputedStyle(sibling).display !== 'none')
        .map((sibling) => {
          const r = sibling.getBoundingClientRect();
          return `${sibling.tagName.toLowerCase()}.${[...sibling.classList].join('.')} ${[r.x, r.y, r.width, r.height].map(Math.round).join(',')}`;
        }),
    };
  });

/** The focus perimeter tests of `variant`'s cases on `tuple`, in one spec file. */
export function focusPerimeter(variant: string, tuple: string, cases: readonly PerimeterCase[]) {
  const [designLanguage, , , displayMode] = tuple.split('/');
  test.use({ appOptions: tupleOptions(variant, tuple) });
  for (const each of cases)
    for (const width of each.widths)
      for (const row of each.rows ?? (['default'] as const))
        test(
          `on ${variant} ${tuple} the ${each.name} rings whole when focused, every point of its ring at 3:1, at ${width}${row === 'default' ? '' : `, ${row}`}`,
          {
            annotation: [{ type: 'route', description: '/' }, READ_ONLY],
            tag: '@interaction',
          },
          async ({ page }) => {
            await page.setViewportSize(VIEWPORTS[width]);
            await page.emulateMedia({ colorScheme: 'light', ...ROWS[row] });
            await page.goto('/', { waitUntil: 'networkidle' });
            const boundary = page.locator('[data-variant]').first();
            await expect(boundary).toHaveAttribute('data-variant', variant);
            await expect(boundary).toHaveAttribute('data-design-language', designLanguage!);
            await expect(boundary).toHaveAttribute('data-display-mode', displayMode!);
            await page.evaluate(() => document.fonts.ready);
            const control = page.locator(each.selector);
            const active = await keyboardFocus(page, control);
            // A control that breaks across lines has no one rounding: the focus check reads its
            // fragments, and so does this test, through the check alone.
            const lines = await control.evaluate((element) =>
              [...element.getClientRects()].map((r) =>
                [r.x, r.y, r.width, r.height].map(Math.round),
              ),
            );
            const rounded = (active.rounding?.width ?? 0) > 0;
            const ring = rounded ? await ringContrast(page, control) : null;
            const read = rounded
              ? await everyPoint(page, control, active)
              : {
                  points: 0,
                  weak: [] as string[],
                  sides: {},
                  samples: [] as string[],
                  painted: null,
                  dpr: null,
                };
            const findings = await focusFindings(page, active);
            console.log(
              `perimeter ${tuple} ${width} ${row} ${each.name}: path ${active.path}, box ${JSON.stringify(active.box)}, line boxes ${JSON.stringify(lines)}, rounding ${JSON.stringify(active.rounding ?? null)}, painted offset ${read.painted} at DPR ${read.dpr}, styles ${JSON.stringify(await styles(control))}, centre line ${read.points} points, weak ${read.weak.length}, by side (weak, of) ${JSON.stringify(read.sides)}; samples ${JSON.stringify(read.samples)}; painted bands ${JSON.stringify(ring)}; findings ${JSON.stringify(findings).slice(0, 600)}`,
            );
            expect(
              rounded ? { findings, weak: read.weak, inShots: read.points > 0 } : { findings },
              'the focus check, and every centre line point at 3:1',
            ).toEqual(rounded ? { findings: [], weak: [], inShots: true } : { findings: [] });
          },
        );
}
