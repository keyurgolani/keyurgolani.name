import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { compareScreenshots, openPng } from './screenshot-bands.mjs';
import { SCREENSHOT_COMPARISON } from './screenshots.mjs';

// The variant specs' screenshot comparison fails a page that lost what it
// shows (#5, Slice 6). For every committed baseline: the baseline matches
// itself, and a page of its background colour alone, or the baseline with
// its first line of text painted over, doesn't. Each baseline is read a
// band of rows at a time, and compared with screenshot-bands.mjs, which
// screenshot-bands.test.mjs holds to the comparator toHaveScreenshot runs,
// from the playwright-core @playwright/test uses. The blank and painted
// checks run that comparator too, and have to get its answer.

const BASELINES = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  'variants',
  '__screenshots__',
);
const require = createRequire(import.meta.url);
const fromPlaywright = createRequire(require.resolve('playwright/package.json'));
const { getComparator } = fromPlaywright('playwright-core/lib/utils');
const { PNG } = fromPlaywright('playwright-core/lib/utilsBundle');
const compare = getComparator('image/png');

/** The RGBA value most of `png`'s pixels have: the page's background. */
async function background(png) {
  const counts = new Map();
  // Counted a run of equal pixels at a time; a run's colour is counted
  // where it first appears, so ties still go to the first seen.
  let run = -1;
  let length = 0;
  for await (const { data } of png.bands()) {
    const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
    for (let at = 0; at < data.length; at += 4) {
      const value = view.getUint32(at);
      if (value === run) length++;
      else {
        if (length > 0) counts.set(run, (counts.get(run) ?? 0) + length);
        run = value;
        length = 1;
      }
    }
  }
  counts.set(run, (counts.get(run) ?? 0) + length);
  return [...counts].reduce((most, entry) => (entry[1] > most[1] ? entry : most))[0];
}

/** Whether the pixel at byte `at` of `data` stands out from `rgba`: a glyph, not its antialiasing. */
function inked(data, at, rgba) {
  const channel = (shift) => Math.abs(data[at + 3 - shift / 8] - ((rgba >>> shift) & 0xff));
  return channel(24) + channel(16) + channel(8) > 192;
}

/** The rows of the first line of text, from its first inked row down 24 rows, or null. */
async function firstLine(png, rgba) {
  for await (const band of png.bands()) {
    for (let row = 0; row < band.rows; row++) {
      for (let column = 0; column < png.width; column++) {
        if (inked(band.data, (row * png.width + column) * 4, rgba)) {
          const at = band.y + row;
          return { from: Math.max(0, at - 2), to: Math.min(png.height, at + 22) };
        }
      }
    }
  }
  return null;
}

/** The top `height` rows of `png`, as RGBA. */
async function topRows(png, height) {
  const data = Buffer.alloc(height * png.width * 4);
  for await (const band of png.bands()) {
    const at = band.y * png.width * 4;
    data.set(band.data.subarray(0, Math.min(band.data.length, data.length - at)), at);
    if (band.y + band.rows >= height) break;
  }
  return { width: png.width, height, data };
}

/** Rows past the first line's that the blank and painted checks keep. */
const BAND_MARGIN = 40;

/** `image` as a PNG, with rows from `from` up to `to` filled with `rgba`. */
function painted(image, rgba, from = 0, to = image.height) {
  const copy = new PNG({ width: image.width, height: image.height });
  image.data.copy(copy.data);
  for (let at = from * image.width * 4; at < to * image.width * 4; at += 4) {
    copy.data.writeUInt32BE(rgba, at);
  }
  return PNG.sync.write(copy);
}

const names = existsSync(BASELINES)
  ? readdirSync(BASELINES)
      .filter((name) => name.endsWith('.png'))
      .sort()
  : [];

test('there are baselines to compare against', () => {
  assert.ok(names.length > 0, `no PNG in ${BASELINES}: CI's variants job writes them`);
});

for (const name of names) {
  test(`${name}: matches itself, and fails blank or short a line of text`, async () => {
    const baseline = readFileSync(path.join(BASELINES, name));
    assert.equal(
      await compareScreenshots(baseline, baseline, SCREENSHOT_COMPARISON),
      null,
      'against itself',
    );
    const png = openPng(baseline);
    const rgba = await background(png);
    const line = await firstLine(png, rgba);
    assert.ok(line, 'the baseline shows nothing but its background');
    // The blank and painted checks run on the band from the top through the
    // first line of text: with maxDiffPixels 0, one changed pixel fails the
    // whole page as it fails the band, and a full-page copy of each tall
    // baseline took the suite past a CI runner's memory.
    const image = await topRows(png, Math.min(png.height, line.to + BAND_MARGIN));
    const band = painted(image, rgba, 0, 0);
    const checks = {
      'a blank page passes': painted(image, rgba),
      [`the page passes with rows ${line.from} to ${line.to} painted over`]: painted(
        image,
        rgba,
        line.from,
        line.to,
      ),
    };
    for (const [failure, page] of Object.entries(checks)) {
      const result = await compareScreenshots(page, band, SCREENSHOT_COMPARISON);
      assert.ok(result, failure);
      assert.deepEqual(
        result,
        compare(page, band, SCREENSHOT_COMPARISON),
        `${failure}: not as Playwright's comparator answers`,
      );
    }
  });
}
