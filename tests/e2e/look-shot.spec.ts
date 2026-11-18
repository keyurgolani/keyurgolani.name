import { expect, test } from '@playwright/test';
import { PNG } from 'pngjs';
import { elementShot } from '../harness/look-shot';

// tests/harness/look-shot.ts's element shot is the element as the page lays it out, never the
// window's own boxes over it: on a page with a fixed pin and a sticky bar at the window's top and a
// plate far down, the plate's shot holds the plate and none of the pin's or the bar's colour, where
// the shot scrolled the plate to the window's top under them.

const PAGE = `<!doctype html>
<html lang="en">
  <head>
    <style>
      body { margin: 0; background: #fff; }
      .pin { position: fixed; inset-block-start: 8px; inset-inline-end: 8px; inline-size: 96px; block-size: 44px; background: #f0f; }
      .bar { position: sticky; inset-block-start: 0; block-size: 40px; background: #0ff; }
      .tall { block-size: 2400px; }
      .plate { inline-size: 280px; block-size: 300px; margin: 16px; background: #e0d8c8; }
    </style>
  </head>
  <body>
    <div class="pin"></div>
    <div class="bar"></div>
    <div class="tall"></div>
    <div class="plate" id="plate"></div>
    <div class="tall"></div>
  </body>
</html>`;

/** How many of `png`'s pixels are exactly `rgb`. */
function pixels(png: Buffer, [r, g, b]: readonly [number, number, number]): number {
  const image = PNG.sync.read(png);
  let count = 0;
  for (let at = 0; at < image.data.length; at += 4) {
    if (image.data[at] === r && image.data[at + 1] === g && image.data[at + 2] === b) count += 1;
  }
  return count;
}

test("a look shot of an element holds none of the window's fixed or sticky boxes", async ({
  page,
}) => {
  await page.setViewportSize({ width: 320, height: 568 });
  await page.setContent(PAGE);
  const png = await elementShot(page, '#plate');
  expect(pixels(png, [0xe0, 0xd8, 0xc8]), 'the plate').toBeGreaterThan(0);
  expect({ pin: pixels(png, [255, 0, 255]), bar: pixels(png, [0, 255, 255]) }).toEqual({
    pin: 0,
    bar: 0,
  });
});
