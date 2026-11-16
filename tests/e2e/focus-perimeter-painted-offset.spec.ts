import { expect, test } from '../harness/fixtures';
import { everyPoint, keyboardFocus, paintedOffset } from './focus-perimeter';

// focus-perimeter.ts's every-point read lays the ring's centre line where Chromium paints it: a
// positive outline-offset in whole device pixels, truncated. On a page of its own at 1024, a link at
// a fractional place ringed 2 px wide at a 9.75px offset (the 1024 px space step) paints 9 px out.
// Read at the painted offset, every point of the ring changes to 3:1; read at the computed offset,
// the line runs beside the ring and finds the gap. The test prints both reads.

const PAGE = `<!doctype html><html lang="en"><head><style>
  body { margin: 0; background: #fff; color: #000; font: 16px/33px sans-serif; }
  a { display: inline-block; margin: 100.52px 0 0 75.86px; inline-size: 244.58px; block-size: 33px; color: #000; text-decoration: none; }
  a:focus-visible { outline: 2px solid #000; outline-offset: 9.75px; }
</style></head><body><a href="#mail">rowan@rowan.test</a></body></html>`;

test.use({ viewport: { width: 1024, height: 768 } });

test(
  'the every-point read lays the centre line where Chromium paints a fractional outline offset',
  { tag: '@interaction' },
  async ({ page }) => {
    await page.setContent(PAGE, { waitUntil: 'load' });
    const link = page.getByRole('link', { name: 'rowan@rowan.test' });
    const active = await keyboardFocus(page, link);
    const ratio = await page.evaluate(() => window.devicePixelRatio);
    expect(active.rounding?.offset, 'the computed offset').toBeCloseTo(9.75, 2);
    expect(
      [
        paintedOffset(9.75, 1),
        paintedOffset(9.75, 2),
        paintedOffset(9.03, 1),
        paintedOffset(-2, 1),
      ],
      'whole device pixels, truncated; a negative offset as computed',
    ).toEqual([9, 9.5, 9, -2]);
    expect(ratio, 'the shots are read at a device pixel ratio of 1').toBe(1);
    const painted = await everyPoint(page, link, active);
    const computed = await everyPoint(page, link, active, active.rounding!.offset);
    console.log(
      `painted offset read: offset ${painted.painted} at DPR ${painted.dpr}, ${painted.points} points, weak ${painted.weak.length}, by side ${JSON.stringify(painted.sides)}; computed offset read: offset ${computed.painted}, ${computed.points} points, weak ${computed.weak.length}, by side ${JSON.stringify(computed.sides)}; samples ${JSON.stringify(computed.samples.slice(0, 3))}`,
    );
    expect(
      { weak: painted.weak, inShots: painted.points > 0 },
      'read at the painted offset, every point of the ring at 3:1',
    ).toEqual({ weak: [], inShots: true });
    expect(
      computed.weak.length,
      'read at the computed offset, the line runs beside the painted ring',
    ).toBeGreaterThan(0);
  },
);
