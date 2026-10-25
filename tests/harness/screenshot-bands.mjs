// toHaveScreenshot's comparison (#5, Slice 6), a band of rows at a time.
// Playwright's comparator decodes the actual and expected PNGs whole and
// allocates a diff the size of both, so a 1440 by 58,798 baseline costs
// over 1 GB each time it's compared. This one inflates each PNG's image
// data as a stream, unfilters it row by row, and compares BAND_ROWS rows at
// a time, so what it holds is a few bands, whatever the page's height.
//
// The verdict is Playwright 1.58's for the same pixels: pixelmatch at the
// options' threshold, each image padded with transparent black to the
// larger size, the same maxDiffPixels and maxDiffPixelRatio arithmetic and
// error message, and the same diff PNG, byte for byte. pixelmatch's
// antialiasing check looks two rows past a pixel, so each band is compared
// with the two rows above and below it in hand. The diff is only drawn when
// the comparison fails: a second pass draws it band by band into a
// streaming deflate with pngjs's filters and deflate options, which pngjs's
// packer would have made of the whole image. screenshot-bands.test.mjs
// holds all of this to Playwright's comparator.
//
// The reader takes the 8-bit, non-interlaced RGB and RGBA PNGs a
// screenshot is, and refuses the rest, as packages/appearance's readPng
// does for its input: every chunk's CRC is checked, the header comes first
// and once and the end chunk last, nothing follows it, and the image data
// inflates to exactly its rows. A tRNS chunk, which pngjs would apply and
// Chromium never writes, is refused rather than ignored. Only pixelmatch,
// the comparator SCREENSHOT_COMPARISON uses, is banded here.

import { once } from 'node:events';
import { Readable } from 'node:stream';
import { crc32, createDeflate, createInflate } from 'node:zlib';
import filterRows from 'pngjs/lib/filter-pack.js';

/** Rows compared at a time: a 1440-pixel-wide band is under 1.5 MB of RGBA. */
export const BAND_ROWS = 256;

/** The widest PNG it reads, and the most pixels: 16,384 by 16,384. */
export const MAX_PNG_WIDTH = 16384;
export const MAX_PNG_PIXELS = 16384 * 16384;

/** Rows past a pixel pixelmatch's antialiasing check reads, on either side. */
const HALO = 2;

const SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/** Whether `bytes` starts with the PNG signature, as Playwright checks the expected image. */
function isPng(bytes) {
  return bytes.length >= 8 && SIGNATURE.equals(bytes.subarray(0, 8));
}

function paeth(left, up, corner) {
  const estimate = left + up - corner;
  const toLeft = Math.abs(estimate - left);
  const toUp = Math.abs(estimate - up);
  const toCorner = Math.abs(estimate - corner);
  if (toLeft <= toUp && toLeft <= toCorner) return left;
  return toUp <= toCorner ? up : corner;
}

/** Reverses row `line`'s filter into `row`, given the row above (zeros for the first). */
function unfilter(filter, line, row, above, channels) {
  const length = row.length;
  switch (filter) {
    case 0:
      row.set(line);
      return;
    case 1:
      for (let at = 0; at < length; at++) {
        row[at] = line[at] + (at >= channels ? row[at - channels] : 0);
      }
      return;
    case 2:
      for (let at = 0; at < length; at++) row[at] = line[at] + above[at];
      return;
    case 3:
      for (let at = 0; at < length; at++) {
        row[at] = line[at] + (((at >= channels ? row[at - channels] : 0) + above[at]) >> 1);
      }
      return;
    case 4:
      for (let at = 0; at < length; at++) {
        row[at] =
          line[at] +
          (at >= channels ? paeth(row[at - channels], above[at], above[at - channels]) : above[at]);
      }
      return;
    default:
      throw new TypeError(`The PNG has an unknown row filter ${filter}.`);
  }
}

/**
 * Reads `bytes`' chunks and header, and returns its size and a reader of
 * its rows a band at a time, or throws naming what it can't read.
 */
export function openPng(bytes) {
  const buffer = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.length);
  if (!isPng(buffer)) throw new TypeError('This is not a PNG.');
  const data = [];
  let header = null;
  let at = 8;
  for (;;) {
    if (at + 12 > buffer.length) throw new TypeError('The PNG ends before its end chunk.');
    const length = buffer.readUInt32BE(at);
    if (length > buffer.length - at - 12) throw new TypeError('The PNG ends inside a chunk.');
    const type = buffer.toString('latin1', at + 4, at + 8);
    const body = buffer.subarray(at + 8, at + 8 + length);
    if (crc32(buffer.subarray(at + 4, at + 8 + length)) !== buffer.readUInt32BE(at + 8 + length)) {
      throw new TypeError(`The PNG's ${type} chunk fails its CRC.`);
    }
    if ((header === null) !== (type === 'IHDR')) {
      throw new TypeError('The PNG has to start with its image header, and have only one.');
    }
    at += 12 + length;
    if (type === 'IHDR') {
      if (length !== 13) throw new TypeError("The PNG's image header isn't 13 bytes.");
      const [depth, color, compression, filtering, interlace] = body.subarray(8, 13);
      if (depth !== 8 || (color !== 2 && color !== 6) || interlace !== 0) {
        throw new TypeError('This reads 8-bit, non-interlaced RGB or RGBA PNGs only.');
      }
      if (compression !== 0 || filtering !== 0) {
        throw new TypeError("The PNG's compression or filter method isn't PNG's.");
      }
      const width = body.readUInt32BE(0);
      const height = body.readUInt32BE(4);
      if (width < 1 || height < 1 || width > MAX_PNG_WIDTH || width * height > MAX_PNG_PIXELS) {
        throw new TypeError(
          `This reads PNGs of 1 to ${MAX_PNG_WIDTH} pixels wide and 1 to ${MAX_PNG_PIXELS} pixels only.`,
        );
      }
      header = { width, height, channels: color === 6 ? 4 : 3 };
    } else if (type === 'tRNS') {
      throw new TypeError('The PNG has a tRNS chunk, which a screenshot never has.');
    } else if (type === 'IDAT') data.push(body);
    else if (type === 'IEND') break;
  }
  if (at !== buffer.length) throw new TypeError('The PNG has data after its end chunk.');
  return {
    width: header.width,
    height: header.height,
    bands: (rows = BAND_ROWS) => bands(data, header, rows),
  };
}

/**
 * Yields `{ y, rows, data }` for each band of up to `rows` rows from the
 * top: `data` is the band's RGBA, in a buffer reused for the next band.
 * The image data is inflated as a stream and never past its rows.
 */
async function* bands(data, { width, height, channels }, rows) {
  const stride = width * channels;
  const size = height * (stride + 1);
  const line = new Uint8Array(stride + 1);
  let row = new Uint8Array(stride);
  let above = new Uint8Array(stride);
  const band = new Uint8Array(Math.min(rows, height) * width * 4);
  let filled = 0;
  let y = 0;
  let top = 0;
  let inflated = 0;
  const source = Readable.from(data, { objectMode: false });
  const inflate = createInflate({ chunkSize: 64 * 1024 });
  source.pipe(inflate);
  try {
    for await (const chunk of inflate) {
      inflated += chunk.length;
      if (inflated > size) throw new TypeError("The PNG's image data doesn't inflate to its rows.");
      for (let from = 0; from < chunk.length;) {
        const take = Math.min(chunk.length - from, line.length - filled);
        line.set(chunk.subarray(from, from + take), filled);
        filled += take;
        from += take;
        if (filled < line.length) break;
        filled = 0;
        unfilter(line[0], line.subarray(1), row, above, channels);
        const out = (y - top) * width * 4;
        if (channels === 4) band.set(row, out);
        else {
          for (let pixel = 0; pixel < width; pixel++) {
            band[out + pixel * 4] = row[pixel * 3];
            band[out + pixel * 4 + 1] = row[pixel * 3 + 1];
            band[out + pixel * 4 + 2] = row[pixel * 3 + 2];
            band[out + pixel * 4 + 3] = 255;
          }
        }
        [row, above] = [above, row];
        y++;
        if (y - top === rows || y === height) {
          yield { y: top, rows: y - top, data: band.subarray(0, (y - top) * width * 4) };
          top = y;
        }
      }
    }
  } catch (error) {
    if (error instanceof TypeError) throw error;
    throw new TypeError("The PNG's image data doesn't inflate to its rows.", { cause: error });
  } finally {
    source.destroy();
    inflate.destroy();
  }
  if (y !== height || filled !== 0) throw new TypeError("The PNG's image data is short.");
}

/**
 * Rows of one image, padded to `width` and to `height` rows with
 * transparent black as Playwright pads an image to the larger size, held a
 * band and its halo at a time: row `y` is at `(y - origin) * width * 4`.
 */
class RowWindow {
  constructor(png, width, height, rows) {
    this.png = png;
    this.height = height;
    this.rowBytes = width * 4;
    this.data = new Uint8Array((rows + 2 * HALO) * this.rowBytes);
    this.origin = 0;
    this.end = 0;
    this.source = png.bands(rows);
    this.band = null;
    this.at = 0;
  }

  /** Reads rows until row `until` is in hand. */
  async fill(until) {
    const own = this.png.width * 4;
    while (this.end < until) {
      const to = (this.end - this.origin) * this.rowBytes;
      if (this.end < this.png.height) {
        if (this.band === null || this.at === this.band.rows) {
          const next = await this.source.next();
          if (next.done) throw new TypeError("The PNG's image data is short.");
          this.band = next.value;
          this.at = 0;
        }
        this.data.set(this.band.data.subarray(this.at * own, (this.at + 1) * own), to);
        this.data.fill(0, to + own, to + this.rowBytes);
        this.at++;
      } else this.data.fill(0, to, to + this.rowBytes);
      this.end++;
    }
  }

  /** Lets rows above `origin` go. */
  slide(origin) {
    const from = (origin - this.origin) * this.rowBytes;
    this.data.copyWithin(0, from, (this.end - this.origin) * this.rowBytes);
    this.origin = origin;
  }

  /** Reads the PNG to its end, so a fault past its last row still throws, as a whole decode does. */
  async finish() {
    if (!(await this.source.next()).done) throw new TypeError("The PNG's image data is long.");
  }

  async close() {
    await this.source.return();
  }
}

function chunk(type, body) {
  const bytes = Buffer.alloc(body.length + 12);
  bytes.writeUInt32BE(body.length, 0);
  bytes.write(type, 4, 'latin1');
  body.copy(bytes, 8);
  bytes.writeUInt32BE(crc32(bytes.subarray(4, bytes.length - 4)), bytes.length - 4);
  return bytes;
}

/**
 * The diff image, as pngjs's PNG.sync.write makes it: an 8-bit RGBA PNG
 * with one IDAT chunk, each row's filter the one with the lowest sum, and
 * the rows deflated at level 9 with the RLE strategy in 32 KiB chunks. The
 * rows go through the deflate a band at a time.
 */
class DiffPng {
  constructor(width, height, rows) {
    this.width = width;
    this.height = height;
    this.rowBytes = width * 4;
    // The band's rows, after the band before's last row, which its first is filtered against.
    this.rows = Buffer.alloc((rows + 1) * this.rowBytes);
    this.written = 0;
    this.compressed = [];
    this.deflate = createDeflate({ chunkSize: 32 * 1024, level: 9, strategy: 3 });
    this.deflate.on('data', (data) => this.compressed.push(data));
    this.ended = once(this.deflate, 'end');
  }

  async write(band, count) {
    this.rows.set(band, this.rowBytes);
    const first = this.written === 0 ? 1 : 0;
    const pixels = this.rows.subarray(first * this.rowBytes, (count + 1) * this.rowBytes);
    const filtered = filterRows(pixels, this.width, count + 1 - first, {}, 4);
    this.rows.copyWithin(0, count * this.rowBytes, (count + 1) * this.rowBytes);
    this.written += count;
    if (!this.deflate.write(filtered.subarray((1 - first) * (this.rowBytes + 1)))) {
      await once(this.deflate, 'drain');
    }
  }

  async end() {
    this.deflate.end();
    await this.ended;
    const header = Buffer.alloc(13);
    header.writeUInt32BE(this.width, 0);
    header.writeUInt32BE(this.height, 4);
    header[8] = 8;
    header[9] = 6;
    return Buffer.concat([
      SIGNATURE,
      chunk('IHDR', header),
      chunk('IDAT', Buffer.concat(this.compressed)),
      chunk('IEND', Buffer.alloc(0)),
    ]);
  }

  destroy() {
    this.deflate.destroy();
  }
}

// pixelmatch's per-pixel check, as playwright-core/lib/third_party/pixelmatch.js
// has it, with Playwright's options (no includeAA, alpha 0.1, the default
// colours, no diffColorAlt or diffMask). Each image is a RowWindow's rows,
// so the pixel at (x, y) is at ((y - origin) * width + x) * 4; the image's
// edges are still its own, rows 0 and height - 1.

const ALPHA = 0.1;

function antialiased(img, x1, y1, width, height, img2, origin) {
  const x0 = Math.max(x1 - 1, 0);
  const y0 = Math.max(y1 - 1, 0);
  const x2 = Math.min(x1 + 1, width - 1);
  const y2 = Math.min(y1 + 1, height - 1);
  const pos = ((y1 - origin) * width + x1) * 4;
  let zeroes = x1 === x0 || x1 === x2 || y1 === y0 || y1 === y2 ? 1 : 0;
  let min = 0;
  let max = 0;
  let minX, minY, maxX, maxY;
  for (let x = x0; x <= x2; x++) {
    for (let y = y0; y <= y2; y++) {
      if (x === x1 && y === y1) continue;
      const delta = colorDelta(img, img, pos, ((y - origin) * width + x) * 4, true);
      if (delta === 0) {
        zeroes++;
        if (zeroes > 2) return false;
      } else if (delta < min) {
        min = delta;
        minX = x;
        minY = y;
      } else if (delta > max) {
        max = delta;
        maxX = x;
        maxY = y;
      }
    }
  }
  if (min === 0 || max === 0) return false;
  return (
    (hasManySiblings(img, minX, minY, width, height, origin) &&
      hasManySiblings(img2, minX, minY, width, height, origin)) ||
    (hasManySiblings(img, maxX, maxY, width, height, origin) &&
      hasManySiblings(img2, maxX, maxY, width, height, origin))
  );
}

function hasManySiblings(img, x1, y1, width, height, origin) {
  const x0 = Math.max(x1 - 1, 0);
  const y0 = Math.max(y1 - 1, 0);
  const x2 = Math.min(x1 + 1, width - 1);
  const y2 = Math.min(y1 + 1, height - 1);
  const pos = ((y1 - origin) * width + x1) * 4;
  let zeroes = x1 === x0 || x1 === x2 || y1 === y0 || y1 === y2 ? 1 : 0;
  for (let x = x0; x <= x2; x++) {
    for (let y = y0; y <= y2; y++) {
      if (x === x1 && y === y1) continue;
      const pos2 = ((y - origin) * width + x) * 4;
      if (
        img[pos] === img[pos2] &&
        img[pos + 1] === img[pos2 + 1] &&
        img[pos + 2] === img[pos2 + 2] &&
        img[pos + 3] === img[pos2 + 3]
      )
        zeroes++;
      if (zeroes > 2) return true;
    }
  }
  return false;
}

function colorDelta(img1, img2, k, m, yOnly) {
  let r1 = img1[k + 0];
  let g1 = img1[k + 1];
  let b1 = img1[k + 2];
  let a1 = img1[k + 3];
  let r2 = img2[m + 0];
  let g2 = img2[m + 1];
  let b2 = img2[m + 2];
  let a2 = img2[m + 3];
  if (a1 === a2 && r1 === r2 && g1 === g2 && b1 === b2) return 0;
  if (a1 < 255) {
    a1 /= 255;
    r1 = blend(r1, a1);
    g1 = blend(g1, a1);
    b1 = blend(b1, a1);
  }
  if (a2 < 255) {
    a2 /= 255;
    r2 = blend(r2, a2);
    g2 = blend(g2, a2);
    b2 = blend(b2, a2);
  }
  const y1 = rgb2y(r1, g1, b1);
  const y2 = rgb2y(r2, g2, b2);
  const y = y1 - y2;
  if (yOnly) return y;
  const i = rgb2i(r1, g1, b1) - rgb2i(r2, g2, b2);
  const q = rgb2q(r1, g1, b1) - rgb2q(r2, g2, b2);
  const delta = 0.5053 * y * y + 0.299 * i * i + 0.1957 * q * q;
  return y1 > y2 ? -delta : delta;
}

function rgb2y(r, g, b) {
  return r * 0.29889531 + g * 0.58662247 + b * 0.11448223;
}
function rgb2i(r, g, b) {
  return r * 0.59597799 - g * 0.2741761 - b * 0.32180189;
}
function rgb2q(r, g, b) {
  return r * 0.21147017 - g * 0.52261711 + b * 0.31114694;
}

function blend(c, a) {
  return 255 + (c - 255) * a;
}

function drawPixel(output, pos, r, g, b) {
  output[pos + 0] = r;
  output[pos + 1] = g;
  output[pos + 2] = b;
  output[pos + 3] = 255;
}

/** pixelmatch's drawGrayPixel, reading `img` at `i` and drawing `output` at `o`. */
function drawGrayPixel(img, i, alpha, output, o) {
  const val = blend(rgb2y(img[i + 0], img[i + 1], img[i + 2]), (alpha * img[i + 3]) / 255);
  drawPixel(output, o, val, val, val);
}

/**
 * Counts the pixels of `expected` and `actual`, padded to `width` by
 * `height`, that pixelmatch counts as different, and with `draw`, makes
 * the diff PNG pixelmatch draws.
 */
async function scan(expected, actual, width, height, threshold, rows, draw) {
  const one = new RowWindow(expected, width, height, rows);
  const two = new RowWindow(actual, width, height, rows);
  const diff = draw ? new DiffPng(width, height, rows) : null;
  const output = draw ? new Uint8Array(rows * width * 4) : null;
  const maxDelta = 35215 * threshold * threshold;
  let count = 0;
  try {
    for (let top = 0; top < height; top += rows) {
      const bottom = Math.min(height, top + rows);
      const reach = Math.min(height, bottom + HALO);
      await one.fill(reach);
      await two.fill(reach);
      const origin = one.origin;
      const a = one.data;
      const b = two.data;
      const from = (top - origin) * width * 4;
      const to = (bottom - origin) * width * 4;
      if (Buffer.compare(a.subarray(from, to), b.subarray(from, to)) === 0) {
        // Every pixel's delta is 0: none counts, and each is drawn grey.
        if (output) {
          for (let at = from; at < to; at += 4) drawGrayPixel(a, at, ALPHA, output, at - from);
        }
      } else {
        for (let y = top; y < bottom; y++) {
          for (let x = 0; x < width; x++) {
            const pos = ((y - origin) * width + x) * 4;
            const out = ((y - top) * width + x) * 4;
            const delta = colorDelta(a, b, pos, pos);
            if (Math.abs(delta) > maxDelta) {
              if (
                antialiased(a, x, y, width, height, b, origin) ||
                antialiased(b, x, y, width, height, a, origin)
              ) {
                if (output) drawPixel(output, out, 255, 255, 0);
              } else {
                if (output) drawPixel(output, out, 255, 0, 0);
                count++;
              }
            } else if (output) drawGrayPixel(a, pos, ALPHA, output, out);
          }
        }
      }
      if (diff) await diff.write(output.subarray(0, to - from), bottom - top);
      const keep = Math.max(0, bottom - HALO);
      one.slide(keep);
      two.slide(keep);
    }
    await one.finish();
    await two.finish();
    return { count, diff: diff ? await diff.end() : null };
  } finally {
    diff?.destroy();
    await one.close();
    await two.close();
  }
}

/**
 * Compares the `actual` PNG with the `expected` one as Playwright's
 * getComparator('image/png') does, with `options` its maxDiffPixels,
 * maxDiffPixelRatio, threshold and comparator: null when they match, else
 * `{ errorMessage, diff }`. `rows` is the band height.
 */
export async function compareScreenshots(
  actual,
  expected,
  options = {},
  { rows = BAND_ROWS } = {},
) {
  if (!actual || !(actual instanceof Buffer)) {
    return { errorMessage: 'Actual result should be a Buffer.' };
  }
  if (!isPng(expected)) throw new Error('Could not decode expected image as PNG.');
  const actualPng = openPng(actual);
  const expectedPng = openPng(expected);
  const width = Math.max(expectedPng.width, actualPng.width);
  const height = Math.max(expectedPng.height, actualPng.height);
  let sizesMismatchError = '';
  if (expectedPng.width !== actualPng.width || expectedPng.height !== actualPng.height) {
    sizesMismatchError = `Expected an image ${expectedPng.width}px by ${expectedPng.height}px, received ${actualPng.width}px by ${actualPng.height}px. `;
  }
  const comparator = options.comparator ?? 'pixelmatch';
  if (comparator === 'ssim-cie94') {
    throw new Error('The banded comparison runs pixelmatch only, not ssim-cie94.');
  }
  if (comparator !== 'pixelmatch') {
    throw new Error(`Configuration specifies unknown comparator "${options.comparator}"`);
  }
  const threshold = options.threshold ?? 0.2;
  // A failing comparison returns the diff. It's drawn on the first pass
  // when the sizes already differ, and on a second when the count is over.
  const draw = sizesMismatchError !== '';
  let { count, diff } = await scan(expectedPng, actualPng, width, height, threshold, rows, draw);
  const maxDiffPixels1 = options.maxDiffPixels;
  const maxDiffPixels2 =
    options.maxDiffPixelRatio !== undefined
      ? width * height * options.maxDiffPixelRatio
      : undefined;
  let maxDiffPixels;
  if (maxDiffPixels1 !== undefined && maxDiffPixels2 !== undefined) {
    maxDiffPixels = Math.min(maxDiffPixels1, maxDiffPixels2);
  } else maxDiffPixels = maxDiffPixels1 ?? maxDiffPixels2 ?? 0;
  const ratio = Math.ceil((count / (width * height)) * 100) / 100;
  const pixelsMismatchError =
    count > maxDiffPixels
      ? `${count} pixels (ratio ${ratio.toFixed(2)} of all image pixels) are different.`
      : '';
  if (pixelsMismatchError || sizesMismatchError) {
    diff ??= (await scan(expectedPng, actualPng, width, height, threshold, rows, true)).diff;
    return { errorMessage: sizesMismatchError + pixelsMismatchError, diff };
  }
  return null;
}
