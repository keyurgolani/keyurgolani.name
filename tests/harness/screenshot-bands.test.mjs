import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import {
  createWriteStream,
  existsSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
} from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { Readable } from 'node:stream';
import { crc32, createDeflate, createInflate, deflateSync } from 'node:zlib';
import { BAND_ROWS, compareScreenshots, openPng } from './screenshot-bands.mjs';
import { SCREENSHOT_COMPARISON } from './screenshots.mjs';

// The banded comparison (#5, Slice 6) holds to Playwright's: the rows it
// decodes are the ones pngjs decodes, from every committed baseline and
// from PNGs written with each row filter, and its verdict and diff are
// toHaveScreenshot's comparator's, byte for byte, at band heights down to
// one row. And what it holds stays a few bands, however tall the page.

const HERE = path.dirname(fileURLToPath(import.meta.url));
const BASELINES = path.join(HERE, '..', 'variants', '__screenshots__');
const require = createRequire(import.meta.url);
const fromPlaywright = createRequire(require.resolve('playwright/package.json'));
const { getComparator } = fromPlaywright('playwright-core/lib/utils');
const { PNG } = fromPlaywright('playwright-core/lib/utilsBundle');
const compare = getComparator('image/png');

const BAND_HEIGHTS = [1, 2, 3, 5, 64, BAND_ROWS];

/** A PNG chunk: length, type, body, CRC. */
function chunk(type, body) {
  const bytes = Buffer.alloc(body.length + 12);
  bytes.writeUInt32BE(body.length, 0);
  bytes.write(type, 4, 'latin1');
  body.copy(bytes, 8);
  bytes.writeUInt32BE(crc32(bytes.subarray(4, bytes.length - 4)), bytes.length - 4);
  return bytes;
}

const SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

function header(width, height, { depth = 8, color = 6, interlace = 0 } = {}) {
  const body = Buffer.alloc(13);
  body.writeUInt32BE(width, 0);
  body.writeUInt32BE(height, 4);
  body[8] = depth;
  body[9] = color;
  body[12] = interlace;
  return chunk('IHDR', body);
}

function predictor(filter, left, up, corner) {
  if (filter === 0) return 0;
  if (filter === 1) return left;
  if (filter === 2) return up;
  if (filter === 3) return (left + up) >> 1;
  const estimate = left + up - corner;
  const [toLeft, toUp, toCorner] = [left, up, corner].map((v) => Math.abs(estimate - v));
  if (toLeft <= toUp && toLeft <= toCorner) return left;
  return toUp <= toCorner ? up : corner;
}

/**
 * The rows of RGBA `pixels` as a PNG's filtered scanlines, RGB when
 * `channels` is 3, with row y filtered by `filter(y)`.
 */
function scanlines(pixels, width, height, channels, filter) {
  const stride = width * channels;
  const raw = Buffer.alloc(height * (stride + 1));
  const sample = (y, at) =>
    y < 0 || at < 0 ? 0 : pixels[(y * width + Math.floor(at / channels)) * 4 + (at % channels)];
  for (let y = 0; y < height; y++) {
    const type = filter(y);
    raw[y * (stride + 1)] = type;
    for (let at = 0; at < stride; at++) {
      const value = sample(y, at);
      const guess = predictor(
        type,
        sample(y, at - channels),
        sample(y - 1, at),
        sample(y - 1, at - channels),
      );
      raw[y * (stride + 1) + 1 + at] = (value - guess) & 0xff;
    }
  }
  return raw;
}

/** RGBA `pixels` as a PNG of `channels`, its rows filtered by `filter(y)`, its data in IDATs of `split` bytes. */
function encode(pixels, width, height, { channels = 4, filter = () => 0, split = 1000 } = {}) {
  const data = deflateSync(scanlines(pixels, width, height, channels, filter));
  const idats = [];
  for (let at = 0; at < data.length; at += split)
    idats.push(chunk('IDAT', data.subarray(at, at + split)));
  return Buffer.concat([
    SIGNATURE,
    header(width, height, { color: channels === 4 ? 6 : 2 }),
    ...idats,
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

/** A seeded generator of numbers in [0, 1), so every run draws the same pictures. */
function random(seed) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * A page-like RGBA picture: a background, antialiased discs and bars, as
 * text and rules render, a patch of noise, and with `alpha`, translucent
 * pixels. `shift` moves the shapes by a fraction of a pixel, which turns
 * their edges into the antialiasing pixelmatch tells from a real change.
 */
function scene(width, height, { seed = 1, shift = 0, alpha = false } = {}) {
  const next = random(seed);
  const pixels = new Uint8Array(width * height * 4);
  const background = [245, 243, 238];
  const shapes = Array.from({ length: 6 }, () => ({
    x: next() * width,
    y: next() * height,
    r: 1 + next() * Math.min(width, height) * 0.2,
    color: [next() * 255, next() * 255, next() * 255].map(Math.floor),
    bar: next() < 0.4,
  }));
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let color = background;
      for (const shape of shapes) {
        const dx = x + 0.5 - (shape.x + shift);
        const dy = y + 0.5 - (shape.y + shift / 2);
        const distance = shape.bar ? Math.abs(dy) - shape.r / 4 : Math.hypot(dx, dy) - shape.r;
        const cover = Math.min(1, Math.max(0, 0.5 - distance));
        if (cover > 0)
          color = color.map((c, i) => Math.round(c * (1 - cover) + shape.color[i] * cover));
      }
      const at = (y * width + x) * 4;
      pixels.set(color, at);
      pixels[at + 3] = alpha && (x + y) % 3 === 0 ? Math.floor(next() * 256) : 255;
    }
  }
  const [nx, ny] = [Math.floor(width * 0.6), Math.floor(height * 0.6)];
  for (let y = ny; y < Math.min(height, ny + 4); y++) {
    for (let x = nx; x < Math.min(width, nx + 5); x++) {
      for (let c = 0; c < 3; c++) pixels[(y * width + x) * 4 + c] = Math.floor(next() * 256);
    }
  }
  return pixels;
}

/** `bytes` decoded a band at a time and put back together. */
async function decodeBanded(bytes, rows) {
  const png = openPng(bytes);
  const parts = [];
  let y = 0;
  for await (const band of png.bands(rows)) {
    assert.equal(band.y, y, 'bands come in order');
    assert.ok(band.rows <= rows);
    parts.push(Buffer.from(band.data));
    y += band.rows;
  }
  assert.equal(y, png.height);
  return Buffer.concat(parts);
}

const FILTERS = {
  none: () => 0,
  sub: () => 1,
  up: () => 2,
  average: () => 3,
  paeth: () => 4,
  'each in turn': (y) => y % 5,
  'one at random': (y) => Math.floor(random(y + 99)() * 5),
};
const SIZES = [
  [1, 1],
  [1, 7],
  [5, 2],
  [17, 33],
  [64, 129],
];

test('a band at a time, the rows are the ones pngjs decodes: each filter, RGB and RGBA, odd sizes', async () => {
  for (const channels of [3, 4]) {
    for (const [name, filter] of Object.entries(FILTERS)) {
      for (const [width, height] of SIZES) {
        const pixels = scene(width, height, { seed: width * height, alpha: channels === 4 });
        const bytes = encode(pixels, width, height, { channels, filter, split: 7 });
        const whole = PNG.sync.read(bytes).data;
        for (const rows of BAND_HEIGHTS) {
          const where = `${channels} channels, ${name}, ${width}x${height}, ${rows}-row bands`;
          assert.ok((await decodeBanded(bytes, rows)).equals(whole), where);
        }
      }
    }
  }
});

test("a band at a time, pngjs's own PNGs, with its adaptive filters, decode to their pixels", async () => {
  for (const [width, height] of SIZES) {
    const image = new PNG({ width, height });
    image.data.set(scene(width, height, { seed: 7, alpha: true }));
    const bytes = PNG.sync.write(image);
    for (const rows of BAND_HEIGHTS) {
      assert.ok(
        (await decodeBanded(bytes, rows)).equals(image.data),
        `${width}x${height}, ${rows}`,
      );
    }
  }
});

/** The same pictures, changed as a page changes between runs. */
function pairs() {
  const [width, height] = [61, 67];
  const png = (pixels, w = width, h = height, channels = 4) =>
    encode(pixels, w, h, { channels, filter: (y) => y % 5 });
  const base = scene(width, height, { seed: 3 });
  const one = (x, y) => {
    const pixels = base.slice();
    pixels[(y * width + x) * 4] ^= 0xff;
    return png(pixels);
  };
  const crop = (w, h) => {
    const pixels = new Uint8Array(w * h * 4);
    for (let y = 0; y < Math.min(h, height); y++) {
      pixels.set(base.subarray(y * width * 4, (y * width + Math.min(w, width)) * 4), y * w * 4);
    }
    return png(pixels, w, h);
  };
  const expected = png(base);
  return {
    'the same picture': [expected, png(base)],
    'the same pixels as RGB': [png(base, width, height, 3), expected],
    'one pixel changed on the top row': [one(5, 0), expected],
    'one pixel changed on the bottom row': [one(5, height - 1), expected],
    // Rows 63 and 64 straddle a 64-row band's edge, and 4 and 5 a 5-row band's.
    'one pixel changed each side of a band edge': [one(30, 63), one(30, 64)],
    'one pixel changed at a small band edge': [one(0, 4), one(width - 1, 5)],
    'the shapes moved by half a pixel': [
      png(scene(width, height, { seed: 3, shift: 0.5 })),
      expected,
    ],
    'the shapes moved by three pixels': [
      png(scene(width, height, { seed: 3, shift: 3 })),
      expected,
    ],
    'translucent pixels': [png(scene(width, height, { seed: 3, alpha: true })), expected],
    'a narrower actual image': [crop(width - 4, height), expected],
    'a taller actual image': [crop(width, height + 9), expected],
    'a smaller expected image': [expected, crop(width - 1, height - 1)],
    'an actual image wider and shorter': [crop(width + 3, height - 6), expected],
  };
}

const OPTIONS = [
  SCREENSHOT_COMPARISON,
  {},
  { threshold: 0 },
  { threshold: 0.5, maxDiffPixels: 0 },
  { maxDiffPixels: 10 },
  { maxDiffPixelRatio: 0.01 },
  { maxDiffPixels: 50, maxDiffPixelRatio: 0.002 },
];

test("the banded verdict and diff are toHaveScreenshot's comparator's, at every band height", async () => {
  for (const [name, [actual, expected]] of Object.entries(pairs())) {
    for (const options of OPTIONS) {
      const want = compare(actual, expected, options);
      for (const rows of BAND_HEIGHTS) {
        const got = await compareScreenshots(actual, expected, options, { rows });
        assert.deepEqual(got, want, `${name}, ${JSON.stringify(options)}, ${rows}-row bands`);
      }
    }
  }
});

test('the pairs fail and pass as each kind of change should', async () => {
  const cases = pairs();
  const verdict = async (name, options = SCREENSHOT_COMPARISON) =>
    (await compareScreenshots(...cases[name], options))?.errorMessage ?? null;
  assert.equal(await verdict('the same picture'), null);
  assert.equal(await verdict('the same pixels as RGB'), null);
  assert.match(await verdict('one pixel changed on the bottom row'), /^1 pixels/);
  assert.match(
    await verdict('a taller actual image'),
    /^Expected an image 61px by 67px, received 61px by 76px/,
  );
  assert.equal(await verdict('one pixel changed on the bottom row', { maxDiffPixels: 1 }), null);
  // A half-pixel move's edges read as antialiasing at the specs' threshold;
  // at 0, the diff draws some of them yellow, not counted, and some red.
  const moved = cases['the shapes moved by half a pixel'];
  assert.equal(await verdict('the shapes moved by half a pixel'), null);
  const { errorMessage, diff } = await compareScreenshots(...moved, { threshold: 0 });
  assert.match(errorMessage, /^16 pixels/);
  const { data } = PNG.sync.read(diff);
  const drawn = (r, g, b) =>
    data.filter(
      (_, at) => at % 4 === 0 && data[at] === r && data[at + 1] === g && data[at + 2] === b,
    ).length;
  assert.equal(drawn(255, 0, 0), 16, 'counted pixels are red');
  assert.ok(drawn(255, 255, 0) > 0, 'antialiasing is yellow');
});

test("the banded comparison answers a non-Buffer and a non-PNG as Playwright's does", async () => {
  const png = encode(scene(3, 3), 3, 3);
  assert.deepEqual(await compareScreenshots('text', png), compare('text', png));
  assert.throws(() => compare(png, Buffer.from('nope')), /Could not decode expected image as PNG/);
  await assert.rejects(
    compareScreenshots(png, Buffer.from('nope')),
    /Could not decode expected image as PNG/,
  );
  await assert.rejects(
    compareScreenshots(png, png, { comparator: 'other' }),
    /unknown comparator "other"/,
  );
  await assert.rejects(
    compareScreenshots(png, png, { comparator: 'ssim-cie94' }),
    /pixelmatch only/,
  );
});

test('the reader refuses what a screenshot never is, and a PNG that is broken anywhere', async () => {
  const pixels = scene(4, 4);
  const good = encode(pixels, 4, 4);
  const data = deflateSync(scanlines(pixels, 4, 4, 4, () => 0));
  const end = chunk('IEND', Buffer.alloc(0));
  const made = (...chunks) => Buffer.concat([SIGNATURE, ...chunks]);
  const idat = (bytes) => chunk('IDAT', bytes);
  const opens = {
    'not a PNG': [Buffer.from('not a png'), /not a PNG/],
    'a bad CRC': [
      Buffer.concat([good.subarray(0, 30), Buffer.from([good[30] ^ 1]), good.subarray(31)]),
      /IHDR chunk fails its CRC/,
    ],
    'data first': [made(idat(data), header(4, 4), end), /start with its image header/],
    'two headers': [made(header(4, 4), header(4, 4), idat(data), end), /only one/],
    'a short header': [made(chunk('IHDR', Buffer.alloc(12)), end), /isn't 13 bytes/],
    '16-bit': [
      made(header(4, 4, { depth: 16 }), idat(data), end),
      /8-bit, non-interlaced RGB or RGBA/,
    ],
    'a palette': [
      made(header(4, 4, { color: 3 }), idat(data), end),
      /8-bit, non-interlaced RGB or RGBA/,
    ],
    grey: [made(header(4, 4, { color: 0 }), idat(data), end), /8-bit, non-interlaced RGB or RGBA/],
    interlaced: [
      made(header(4, 4, { interlace: 1 }), idat(data), end),
      /8-bit, non-interlaced RGB or RGBA/,
    ],
    'no pixels': [made(header(0, 4), end), /PNGs of 1 to/],
    'too wide': [made(header(16385, 1), end), /PNGs of 1 to/],
    'a tRNS chunk': [made(header(4, 4), chunk('tRNS', Buffer.alloc(6)), idat(data), end), /tRNS/],
    'no end chunk': [made(header(4, 4), idat(data)), /ends before its end chunk/],
    'a chunk cut short': [good.subarray(0, good.length - 20), /ends inside a chunk|ends before/],
    'data after the end': [Buffer.concat([good, Buffer.from([0])]), /data after its end chunk/],
  };
  for (const [name, [bytes, refusal]] of Object.entries(opens)) {
    assert.throws(() => openPng(bytes), refusal, name);
  }
  const reads = {
    'no image data': [made(header(4, 4), end), /image data is short|doesn't inflate to its rows/],
    'too few rows': [made(header(4, 5), idat(data), end), /image data is short/],
    'too many rows': [made(header(4, 3), idat(data), end), /doesn't inflate to its rows/],
    'a row filter of 5': [
      made(header(4, 4), idat(deflateSync(Buffer.alloc(4 * 17, 5))), end),
      /unknown row filter 5/,
    ],
    'data that is not deflate': [
      made(header(4, 4), idat(Buffer.alloc(40, 7)), end),
      /doesn't inflate to its rows/,
    ],
    'deflate cut short': [
      made(header(4, 4), idat(data.subarray(0, data.length - 6)), end),
      /doesn't inflate|short/,
    ],
  };
  for (const [name, [bytes, refusal]] of Object.entries(reads)) {
    await assert.rejects(decodeBanded(bytes, 2), refusal, name);
    await assert.rejects(compareScreenshots(bytes, good), refusal, `${name}, as the actual image`);
    await assert.rejects(
      compareScreenshots(good, bytes),
      refusal,
      `${name}, as the expected image`,
    );
  }
  // A fault past the last row a comparison needs still fails it, as a whole decode would.
  const long = made(
    header(4, 4),
    idat(deflateSync(Buffer.concat([scanlines(pixels, 4, 4, 4, () => 0), Buffer.alloc(1)]))),
    end,
  );
  await assert.rejects(compareScreenshots(long, good), /doesn't inflate to its rows|long/);
});

const names = existsSync(BASELINES)
  ? readdirSync(BASELINES)
      .filter((name) => name.endsWith('.png'))
      .sort()
  : [];

/**
 * pngjs's decode of the PNG `bytes`, a stretch of at least `least` rows at
 * a time, so no stretch costs what pngjs's whole decode of a tall page does
 * (over 1 GB for the tallest baseline). Each stretch starts at a row
 * filtered none or sub, which reads no row above it, so pngjs decodes the
 * stretch on its own, re-deflated under its own header, to the rows its
 * whole decode has. Yields each stretch's RGBA.
 */
async function* pngjsStretches(bytes, least = 1024) {
  const ihdr = Buffer.from(bytes.subarray(16, 29));
  const [width, color] = [ihdr.readUInt32BE(0), ihdr[9]];
  const stride = width * (color === 6 ? 4 : 3) + 1;
  const data = [];
  for (let at = 8; at < bytes.length; at += 12 + bytes.readUInt32BE(at)) {
    if (bytes.toString('latin1', at + 4, at + 8) === 'IDAT') {
      data.push(bytes.subarray(at + 8, at + 8 + bytes.readUInt32BE(at)));
    }
  }
  const decode = (rows) => {
    ihdr.writeUInt32BE(rows.length, 4);
    const png = Buffer.concat([
      SIGNATURE,
      chunk('IHDR', ihdr),
      chunk('IDAT', deflateSync(Buffer.concat(rows), { level: 1 })),
      chunk('IEND', Buffer.alloc(0)),
    ]);
    return PNG.sync.read(png).data;
  };
  const inflate = createInflate();
  Readable.from(data, { objectMode: false }).pipe(inflate);
  let rows = [];
  let pending = Buffer.alloc(0);
  for await (const piece of inflate) {
    pending = Buffer.concat([pending, piece]);
    for (; pending.length >= stride; pending = pending.subarray(stride)) {
      if (rows.length >= least && pending[0] <= 1) {
        yield decode(rows);
        rows = [];
      }
      rows.push(Buffer.from(pending.subarray(0, stride)));
    }
  }
  yield decode(rows);
}

test('every committed baseline decodes, a band at a time, to the pixels pngjs decodes', async () => {
  assert.ok(names.length > 0, `no PNG in ${BASELINES}`);
  for (const name of names) {
    const bytes = readFileSync(path.join(BASELINES, name));
    const want = pngjsStretches(bytes);
    let stretch = Buffer.alloc(0);
    let y = 0;
    for await (const band of openPng(bytes).bands()) {
      for (let from = 0; from < band.data.length;) {
        if (stretch.length === 0) stretch = (await want.next()).value;
        const take = Math.min(band.data.length - from, stretch.length);
        const same = Buffer.compare(
          band.data.subarray(from, from + take),
          stretch.subarray(0, take),
        );
        assert.equal(same, 0, `${name}: the band from row ${band.y}`);
        [from, stretch] = [from + take, stretch.subarray(take)];
      }
      y += band.rows;
    }
    assert.equal(stretch.length, 0, name);
    assert.ok((await want.next()).done, `${name}: pngjs decodes rows past ${y}`);
  }
});

// The memory bound. A child process compares two tall PNGs, written here a
// row at a time, and reports how far its peak resident set grew past where
// it was before the comparison: the OS's high-water mark, so a whole-image
// allocation shows however briefly it lived. The bound is the band's: a
// fixed allowance for the runtime, plus BAND_FACTOR bands of RGBA, plus,
// when the comparison fails, a few times the compressed diff it returns.
// Decoding either page whole is over 200 MB.

const RUNTIME = 64 * 2 ** 20;
const BAND_FACTOR = 16;
const WIDTH = 1440;

/**
 * Writes a WIDTH-wide RGB PNG of `height` rows of page-like stripes, a row
 * at a time into a streaming deflate, each deflate chunk its own IDAT; with
 * `changed`, one pixel differs.
 */
async function writeTall(file, height, changed) {
  const out = createWriteStream(file);
  const write = async (bytes) => {
    if (!out.write(bytes)) await once(out, 'drain');
  };
  await write(Buffer.concat([SIGNATURE, header(WIDTH, height, { color: 2 })]));
  const deflate = createDeflate({ level: 1 });
  const pending = [];
  deflate.on('data', (data) => pending.push(data));
  const ended = once(deflate, 'end');
  let above = Buffer.alloc(WIDTH * 3);
  for (let y = 0; y < height; y++) {
    const row = Buffer.alloc(WIDTH * 3, 250);
    if (y % 40 < 14) {
      for (let x = 40 + (y % 7); x < WIDTH - 40; x += 9) row.fill(20 + (y & 63), x * 3, x * 3 + 3);
    }
    if (changed === y) row[700 * 3] ^= 0xff;
    // A row like the one above is filtered up, to zeros; of the rest, one
    // in three is filtered sub, and the others not at all.
    const line = Buffer.alloc(WIDTH * 3 + 1);
    if (y > 0 && row.equals(above)) line[0] = 2;
    else if (y % 3 === 1) {
      line[0] = 1;
      for (let at = 0; at < row.length; at++) line[1 + at] = row[at] - (at >= 3 ? row[at - 3] : 0);
    } else row.copy(line, 1);
    above = row;
    if (!deflate.write(line)) await once(deflate, 'drain');
    while (pending.length > 0) await write(chunk('IDAT', pending.shift()));
  }
  deflate.end();
  await ended;
  while (pending.length > 0) await write(chunk('IDAT', pending.shift()));
  await write(chunk('IEND', Buffer.alloc(0)));
  out.end();
  await once(out, 'finish');
}

const CHILD = `
import { readFileSync } from 'node:fs';
const [comparison, actual, expected, options] = process.argv.slice(1);
const { compareScreenshots } = await import(comparison);
const [a, b] = [readFileSync(actual), readFileSync(expected)];
globalThis.gc();
const before = process.resourceUsage().maxRSS;
const result = await compareScreenshots(a, b, JSON.parse(options));
const grown = (process.resourceUsage().maxRSS - before) * 1024;
process.stdout.write(JSON.stringify({ grown, error: result?.errorMessage ?? null, diff: result?.diff?.length ?? 0 }));
`;

async function peakGrowth(actual, expected, options) {
  const comparison = pathToFileURL(path.join(HERE, 'screenshot-bands.mjs')).href;
  const child = spawn(
    process.execPath,
    [
      '--expose-gc',
      '--input-type=module',
      '-e',
      CHILD,
      comparison,
      actual,
      expected,
      JSON.stringify(options),
    ],
    { stdio: ['ignore', 'pipe', 'inherit'] },
  );
  let output = '';
  child.stdout.on('data', (data) => (output += data));
  const [code] = await once(child, 'exit');
  assert.equal(code, 0);
  return JSON.parse(output);
}

const bound = (diff = 0) => RUNTIME + BAND_FACTOR * BAND_ROWS * WIDTH * 4 + 4 * diff;
const mb = (bytes) => `${(bytes / 2 ** 20).toFixed(1)} MB`;

test(`comparing two ${WIDTH} by 40,000 pages holds a few bands, not the pages`, async (t) => {
  const dir = mkdtempSync(path.join(tmpdir(), 'screenshot-bands-'));
  try {
    const [expected, actual] = [path.join(dir, 'expected.png'), path.join(dir, 'actual.png')];
    await Promise.all([writeTall(expected, 40000), writeTall(actual, 40000, 39990)]);
    // One pixel differs, and one may: the pages pass, so no diff is drawn.
    const { grown, error } = await peakGrowth(actual, expected, {
      ...SCREENSHOT_COMPARISON,
      maxDiffPixels: 1,
    });
    assert.equal(error, null);
    t.diagnostic(`peak grew ${mb(grown)}, of ${mb(bound())}`);
    assert.ok(grown < bound(), `peak grew ${mb(grown)}, over ${mb(bound())}`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test(`a failing comparison of ${WIDTH} by 10,000 pages draws its diff a band at a time`, async (t) => {
  const dir = mkdtempSync(path.join(tmpdir(), 'screenshot-bands-'));
  try {
    const [expected, actual] = [path.join(dir, 'expected.png'), path.join(dir, 'actual.png')];
    await Promise.all([writeTall(expected, 10000), writeTall(actual, 10000, 9990)]);
    const { grown, error, diff } = await peakGrowth(actual, expected, SCREENSHOT_COMPARISON);
    assert.match(error, /^1 pixels/);
    assert.ok(diff > 0);
    t.diagnostic(`peak grew ${mb(grown)}, of ${mb(bound(diff))}, with a ${mb(diff)} diff`);
    assert.ok(grown < bound(diff), `peak grew ${mb(grown)}, over ${mb(bound(diff))}`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
