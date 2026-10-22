import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { SCREENSHOT_COMPARISON } from './screenshots.mjs';

// The variant specs' screenshot comparison fails a page that lost what it
// shows (#5, Slice 6). For every committed baseline: the baseline matches
// itself, and a page of its background colour alone, or the baseline with
// its first line of text painted over, doesn't. The comparator is the one
// toHaveScreenshot runs, from the playwright-core @playwright/test uses.

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

/** The RGBA value most of `image`'s pixels have: the page's background. */
function background(image) {
  const counts = new Map();
  for (let at = 0; at < image.data.length; at += 4) {
    const value = image.data.readUInt32BE(at);
    counts.set(value, (counts.get(value) ?? 0) + 1);
  }
  return [...counts].reduce((most, entry) => (entry[1] > most[1] ? entry : most))[0];
}

/** Whether the pixel at byte `at` stands out from `rgba`: a glyph, not its antialiasing. */
function inked(image, at, rgba) {
  const channel = (shift) => Math.abs(image.data[at + 3 - shift / 8] - ((rgba >>> shift) & 0xff));
  return channel(24) + channel(16) + channel(8) > 192;
}

/** The rows of the first line of text, from its first inked row down 24 rows, or null. */
function firstLine(image, rgba) {
  for (let row = 0; row < image.height; row++) {
    for (let column = 0; column < image.width; column++) {
      if (inked(image, (row * image.width + column) * 4, rgba)) {
        return { from: Math.max(0, row - 2), to: Math.min(image.height, row + 22) };
      }
    }
  }
  return null;
}

/** `image` as a PNG with rows from `from` up to `to` filled with `rgba`. */
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
  test(`${name}: matches itself, and fails blank or short a line of text`, () => {
    const baseline = readFileSync(path.join(BASELINES, name));
    const image = PNG.sync.read(baseline);
    assert.equal(compare(baseline, baseline, SCREENSHOT_COMPARISON), null, 'against itself');
    const rgba = background(image);
    assert.ok(
      compare(painted(image, rgba), baseline, SCREENSHOT_COMPARISON),
      'a blank page passes',
    );
    const line = firstLine(image, rgba);
    assert.ok(line, 'the baseline shows nothing but its background');
    assert.ok(
      compare(painted(image, rgba, line.from, line.to), baseline, SCREENSHOT_COMPARISON),
      `the page passes with rows ${line.from} to ${line.to} painted over`,
    );
  });
}
