import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import { deriveImage, loadSharp, renditionWidths, type DerivedImage } from './derive';
import { MEDIA_LIMITS, MediaSourceError } from './limits';
import { sniffImageType } from './sniff';
import {
  avif,
  cameraJpeg,
  carries,
  gif,
  jpeg,
  png,
  pngClaiming,
  tiff,
  webp,
} from '../../store/test-support/images';

// Derivation (#10, slice 2 item 4): renditions apply the EXIF orientation
// and carry no EXIF, XMP, IPTC, or GPS; the original is never one of them.
// Only JPEG, PNG, WebP, and AVIF, by their bytes; 100 megapixels at most.

const CANARY = 'gps-canary-5d1e';

async function factory() {
  const loaded = await loadSharp();
  assert.ok(loaded.ok, 'sharp loads in this test run');
  return loaded.sharp;
}

const refusal = (reason: string, code?: string) => (error: unknown) => {
  assert.ok(error instanceof MediaSourceError, String(error));
  assert.equal(error.reason, reason);
  if (code !== undefined) assert.equal(error.code, code);
  return true;
};

test('sharp loads from @portfolio/core, once', async () => {
  const [first, second] = await Promise.all([loadSharp(), loadSharp()]);
  assert.ok(first.ok);
  assert.equal(first, second);
  assert.equal(typeof (first.ok && first.sharp), 'function');
});

test('a GPS-tagged JPEG derives renditions with none of its metadata, turned upright', async () => {
  const source = await cameraJpeg({ width: 640, height: 320 }, { orientation: 6, canary: CANARY });
  const before = await sharp(source).metadata();
  assert.equal(before.orientation, 6, 'the source carries its EXIF orientation');
  assert.ok(before.exif && before.xmp && before.iptc, 'and EXIF, XMP, and IPTC blocks');
  assert.ok(carries(source, CANARY));

  const derived = await deriveImage(await factory(), source);
  // Orientation 6 is a quarter turn: 640 × 320 displays as 320 × 640.
  assert.equal(derived.mime, 'image/jpeg');
  assert.deepEqual([derived.width, derived.height], [320, 640]);
  assert.equal(derived.aspectRatio, 0.5);
  assert.match(derived.dominantColor, /^#[0-9a-f]{6}$/);
  assert.ok(derived.renditions.length > 0);
  for (const rendition of derived.renditions) {
    const meta = await sharp(rendition.bytes).metadata();
    assert.equal(meta.exif, undefined, `${rendition.name}: no EXIF`);
    assert.equal(meta.xmp, undefined, `${rendition.name}: no XMP`);
    assert.equal(meta.iptc, undefined, `${rendition.name}: no IPTC`);
    assert.equal(meta.icc, undefined, `${rendition.name}: no ICC profile`);
    assert.ok(meta.orientation === undefined || meta.orientation === 1, rendition.name);
    assert.ok(!carries(rendition.bytes, CANARY), `${rendition.name}: no canary`);
    assert.ok(!carries(rendition.bytes, 'Exif\0\0'), `${rendition.name}: no Exif block`);
    assert.ok(!carries(rendition.bytes, 'Photoshop 3.0'), `${rendition.name}: no IPTC block`);
    assert.ok(!carries(rendition.bytes, 'ns.adobe.com/xap'), `${rendition.name}: no XMP packet`);
    // Upright: taller than wide, as the source displays.
    assert.ok(rendition.height > rendition.width, rendition.name);
    assert.ok(!Buffer.from(rendition.bytes).equals(Buffer.from(source)), 'never the original');
  }
});

test('a JPEG renders as WebP and JPEG; a PNG with alpha as WebP and PNG', async () => {
  const sharpFn = await factory();
  const opaque = await deriveImage(sharpFn, await jpeg({ width: 1000, height: 500 }));
  assert.deepEqual(
    opaque.renditions.map(({ name, ext, mime, width, height }) => [name, ext, mime, width, height]),
    [
      ['w480-a1', 'webp', 'image/webp', 480, 240],
      ['w480-a1-jpg', 'jpg', 'image/jpeg', 480, 240],
      ['w960-a1', 'webp', 'image/webp', 960, 480],
      ['w960-a1-jpg', 'jpg', 'image/jpeg', 960, 480],
    ],
  );
  for (const rendition of opaque.renditions) {
    assert.equal(sniffImageType(rendition.bytes), rendition.mime);
  }
  const clear = await deriveImage(sharpFn, await png({ width: 300, height: 200, alpha: true }));
  assert.deepEqual(
    clear.renditions.map(({ name, mime, width }) => [name, mime, width]),
    [
      ['w300-a1', 'image/webp', 300],
      ['w300-a1-png', 'image/png', 300],
    ],
  );
});

test('WebP and AVIF sources derive too', async () => {
  const sharpFn = await factory();
  for (const [mime, make] of [
    ['image/webp', webp],
    ['image/avif', avif],
  ] as const) {
    const derived: DerivedImage = await deriveImage(
      sharpFn,
      await make({ width: 500, height: 250 }),
    );
    assert.equal(derived.mime, mime);
    assert.deepEqual([derived.width, derived.height], [500, 250]);
    assert.deepEqual(
      derived.renditions.map(({ name }) => name),
      ['w480-a1', 'w480-a1-jpg'],
    );
  }
});

test('the widths are 480, 960, 1600, and 2400, up to the source width', () => {
  assert.deepEqual(renditionWidths(4000), [480, 960, 1600, 2400]);
  assert.deepEqual(renditionWidths(2400), [480, 960, 1600, 2400]);
  assert.deepEqual(renditionWidths(1599), [480, 960]);
  assert.deepEqual(renditionWidths(480), [480]);
  assert.deepEqual(renditionWidths(300), [300]);
});

test('anything but JPEG, PNG, WebP, and AVIF is refused by its bytes, whatever it is called', async () => {
  const sharpFn = await factory();
  for (const bytes of [
    await gif({ width: 8, height: 8 }),
    await tiff({ width: 8, height: 8 }),
    new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg" width="8" height="8"/>'),
    new TextEncoder().encode('<!doctype html><title>not an image</title>'),
    new Uint8Array(0),
  ]) {
    await assert.rejects(deriveImage(sharpFn, bytes), refusal('refused', 'type'));
  }
});

test('bytes that start like an image but are not one are invalid', async () => {
  const sharpFn = await factory();
  const fake = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, ...new TextEncoder().encode('junk')]);
  await assert.rejects(deriveImage(sharpFn, fake), refusal('invalid'));
  // A PNG signature over JPEG data: the bytes and the decoder disagree.
  const jpegBytes = await jpeg({ width: 8, height: 8 });
  const relabelled = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, ...jpegBytes]);
  await assert.rejects(deriveImage(sharpFn, relabelled), refusal('invalid'));
});

test('a source past 100 megapixels is refused from its header, before it decodes', async () => {
  const sharpFn = await factory();
  // 20000 × 20000 is 400 megapixels, in a file of a few hundred bytes.
  const bomb = await pngClaiming(20_000, 20_000);
  assert.ok(bomb.length < 1024);
  await assert.rejects(deriveImage(sharpFn, bomb), refusal('refused', 'pixels'));
  // Exactly at the cap passes the header check; one pixel over does not.
  const small = await png({ width: 100, height: 50 });
  await deriveImage(sharpFn, small, { maxPixels: 5000 });
  await assert.rejects(
    deriveImage(sharpFn, small, { maxPixels: 4999 }),
    refusal('refused', 'pixels'),
  );
  assert.equal(MEDIA_LIMITS.pixels, 100_000_000);
});

test('the same source derives the same renditions, byte for byte', async () => {
  const sharpFn = await factory();
  const source = await jpeg({ width: 800, height: 600 });
  const first = await deriveImage(sharpFn, source);
  const second = await deriveImage(sharpFn, source);
  assert.deepEqual(
    first.renditions.map(({ bytes }) => Buffer.from(bytes).toString('base64')),
    second.renditions.map(({ bytes }) => Buffer.from(bytes).toString('base64')),
  );
  assert.equal(first.dominantColor, second.dominantColor);
});

type Factory = Awaited<ReturnType<typeof factory>>;

/**
 * `real`, watched: each pipeline's time limit, and how many of its decodes
 * and encodes run at once across every derivation. `change` alters what one
 * call answers, as a source libvips reads differently would.
 */
function watched(
  real: Factory,
  change: { failFirstEncode?: boolean; metadata?: Record<string, unknown> } = {},
) {
  const seen = { timeouts: [] as number[], active: 0, most: 0, encodes: 0 };
  const wrap = (pipeline: object): object =>
    new Proxy(pipeline, {
      get(target, key) {
        const value = Reflect.get(target, key, target) as unknown;
        if (typeof value !== 'function') return value;
        const call = value as (...args: unknown[]) => unknown;
        if (key === 'timeout') {
          return (options: { seconds: number }) => {
            seen.timeouts.push(options.seconds);
            return wrap(call.call(target, options) as object);
          };
        }
        if (key === 'toBuffer' || key === 'metadata' || key === 'stats') {
          return async (...args: unknown[]) => {
            seen.active += 1;
            seen.most = Math.max(seen.most, seen.active);
            try {
              await new Promise((resolve) => setTimeout(resolve, 5));
              if (key === 'toBuffer' && change.failFirstEncode && seen.encodes++ === 0) {
                throw new Error('timeout: 12% complete');
              }
              const answer = await call.apply(target, args);
              return key === 'metadata' && change.metadata
                ? { ...(answer as object), ...change.metadata }
                : answer;
            } finally {
              seen.active -= 1;
            }
          };
        }
        return (...args: unknown[]) => {
          const out = call.apply(target, args);
          return out === target ? wrap(out as object) : out;
        };
      },
    });
  const sharpFn = ((...args: Parameters<Factory>) =>
    wrap(real(...args)) as ReturnType<Factory>) as Factory;
  return { sharp: sharpFn, seen };
}

test('libvips runs one thread, and one derivation runs at a time', async () => {
  const real = await factory();
  assert.equal(sharp.concurrency(), 1);
  const { sharp: sharpFn, seen } = watched(real);
  const sources = await Promise.all([
    jpeg({ width: 1000, height: 600 }),
    png({ width: 900, height: 900, alpha: true }),
    webp({ width: 700, height: 500 }),
  ]);
  await Promise.all(sources.map((source) => deriveImage(sharpFn, source)));
  assert.equal(seen.most, 1, 'no two decodes or encodes ever ran at once');
});

test('every pipeline runs under its time limit, and one past it is refused as a timeout', async () => {
  const real = await factory();
  const source = await jpeg({ width: 1000, height: 600 });
  const { sharp: sharpFn, seen } = watched(real);
  await deriveImage(sharpFn, source);
  // The decode, the stats, and each rendition: every one carries the limit.
  assert.equal(seen.timeouts.length, 2 + 2 * renditionWidths(1000).length);
  assert.ok(seen.timeouts.every((seconds) => seconds === 30));
  const slow = watched(real, { failFirstEncode: true });
  await assert.rejects(deriveImage(slow.sharp, source), refusal('refused', 'timeout'));
});

test('a progressive JPEG or interlaced PNG gets the lower cap, from its header', async () => {
  const sharpFn = await factory();
  const base = await png({ width: 100, height: 50 });
  const progressive = new Uint8Array(await sharp(base).jpeg({ progressive: true }).toBuffer());
  const interlaced = new Uint8Array(await sharp(base).png({ progressive: true }).toBuffer());
  const baseline = new Uint8Array(await sharp(base).jpeg().toBuffer());
  for (const source of [progressive, interlaced]) {
    await deriveImage(sharpFn, source, { maxProgressivePixels: 5000 });
    await assert.rejects(
      deriveImage(sharpFn, source, { maxProgressivePixels: 4999 }),
      refusal('refused', 'pixels'),
    );
  }
  // A baseline JPEG has only the full cap.
  await deriveImage(sharpFn, baseline, { maxProgressivePixels: 4999 });
  assert.equal(MEDIA_LIMITS.progressivePixels, 40_000_000);
});

test('an AVIF gets its own lower cap, from its header, since it decodes whole', async () => {
  const sharpFn = await factory();
  const source = await avif({ width: 100, height: 50 });
  await deriveImage(sharpFn, source, { maxAvifPixels: 5000 });
  await assert.rejects(
    deriveImage(sharpFn, source, { maxAvifPixels: 4999 }),
    refusal('refused', 'pixels'),
  );
  // Another type has only its own caps.
  await deriveImage(sharpFn, await webp({ width: 100, height: 50 }), { maxAvifPixels: 4999 });
  assert.equal(MEDIA_LIMITS.avifPixels, 16_000_000);
});

test('an animated source derives single-frame renditions of its first frame', async () => {
  const sharpFn = await factory();
  const frame = (r: number) =>
    sharp({ create: { width: 64, height: 32, channels: 3, background: { r, g: 0, b: 0 } } })
      .png()
      .toBuffer();
  const animated = new Uint8Array(
    await sharp(await Promise.all([frame(255), frame(0), frame(128)]), {
      join: { animated: true },
    })
      .webp()
      .toBuffer(),
  );
  assert.equal((await sharp(animated).metadata()).pages, 3, 'the source has three frames');
  const derived = await deriveImage(sharpFn, animated);
  assert.deepEqual([derived.width, derived.height], [64, 32]);
  for (const rendition of derived.renditions) {
    const meta = await sharp(rendition.bytes).metadata();
    assert.ok((meta.pages ?? 1) === 1, `${rendition.name}: one frame`);
    assert.deepEqual([rendition.width, rendition.height], [64, 32], rendition.name);
  }
  // The first frame's red, never the other frames' black or dark red.
  assert.ok(Number.parseInt(derived.dominantColor.slice(1, 3), 16) > 0xc0, derived.dominantColor);
});

test('a truncated image is refused, never decoded as far as it goes', async () => {
  const sharpFn = await factory();
  for (const whole of [
    await jpeg({ width: 800, height: 600 }),
    await png({ width: 800, height: 600 }),
  ]) {
    const cut = whole.subarray(0, Math.floor(whole.length * 0.6));
    await assert.rejects(deriveImage(sharpFn, cut), refusal('invalid'));
  }
});

test('HEIF that is not AV1 is refused, as its header says', async () => {
  const real = await factory();
  const source = await avif({ width: 64, height: 64 });
  await deriveImage(real, source);
  const hevc = watched(real, { metadata: { compression: 'hevc' } });
  await assert.rejects(deriveImage(hevc.sharp, source), refusal('refused', 'type'));
});

test('at the caps, a derivation stays under 1 GiB and well inside its time limit', async (t) => {
  // The review's sources at 10000 × 10000, in a process of their own so its
  // peak resident memory is the derivation's: the progressive, the
  // interlaced, and the AVIF one refused from the header, and WebP, an
  // interlaced 16-bit PNG at 40 megapixels, and AVIF at 16, in RGB, with
  // alpha, and with alpha at 12 bits, derived.
  const dir = mkdtempSync(path.join(tmpdir(), 'derive-caps-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const solid = (width: number, height: number, channels: 3 | 4) =>
    sharp({
      create: { width, height, channels, background: { r: 10, g: 200, b: 30, alpha: 0.5 } },
    });
  const sources = {
    'jpeg-progressive': solid(10_000, 10_000, 3).jpeg({ progressive: true, quality: 50 }),
    'png16-interlaced': solid(10_000, 10_000, 4)
      .toColourspace('rgb16')
      .png({ progressive: true, compressionLevel: 9 }),
    webp: solid(10_000, 10_000, 3).webp({ quality: 10, effort: 0 }),
    'png16-interlaced-40mp': solid(6300, 6300, 4)
      .toColourspace('rgb16')
      .png({ progressive: true, compressionLevel: 9 }),
    avif: solid(10_000, 10_000, 3).avif({ effort: 0 }),
    'avif-16mp': solid(4000, 4000, 3).avif({ effort: 0 }),
    'avif-alpha-16mp': solid(4000, 4000, 4).avif({ effort: 0 }),
    'avif-alpha-12bit-16mp': solid(4000, 4000, 4).avif({ effort: 0, bitdepth: 12 }),
  };
  const files: string[] = [];
  for (const [name, pipeline] of Object.entries(sources)) {
    const file = path.join(dir, name);
    writeFileSync(file, await pipeline.toBuffer());
    files.push(file);
  }
  // One process each, as the review measured: a process that has derived
  // one keeps the memory its allocator took, so the next one's peak would
  // be both's.
  const results = files.map((file) => {
    const child = spawnSync(
      process.execPath,
      ['--conditions=react-server', '--import', 'tsx', '--input-type=module', '-e', CAPS_CHILD],
      {
        cwd: fileURLToPath(new URL('../../..', import.meta.url)),
        env: { ...process.env, DERIVE_URL: new URL('./derive.ts', import.meta.url).href },
        input: JSON.stringify([file]),
        encoding: 'utf8',
        timeout: 120_000,
      },
    );
    assert.equal(child.status, 0, child.stderr);
    const {
      results: [result],
      peakMiB,
    } = JSON.parse(child.stdout) as {
      results: { code: string | null; ms: number }[];
      peakMiB: number;
    };
    return { file: path.basename(file), ...result!, peakMiB };
  });
  assert.deepEqual(
    results.map(({ code }) => code),
    ['pixels', 'pixels', null, null, 'pixels', null, null, null],
  );
  for (const { file, ms, peakMiB } of results) {
    assert.ok(ms < 30_000, `${file}: ${ms} ms`);
    assert.ok(peakMiB < 1024, `${file}: peak RSS ${peakMiB} MiB`);
  }
});

/** The child's half: derive each file it's given in turn, and say how each went and the peak RSS. */
const CAPS_CHILD = `
const { deriveImage, loadSharp } = await import(process.env.DERIVE_URL);
const { readFileSync } = await import('node:fs');
const files = JSON.parse(readFileSync(0, 'utf8'));
const loaded = await loadSharp();
if (!loaded.ok) throw new Error('sharp did not load');
let peak = process.memoryUsage().rss;
const tick = setInterval(() => { peak = Math.max(peak, process.memoryUsage().rss); }, 10);
const results = [];
for (const file of files) {
  const started = Date.now();
  let code = null;
  try { await deriveImage(loaded.sharp, new Uint8Array(readFileSync(file))); }
  catch (error) { code = String(error.code); }
  results.push({ code, ms: Date.now() - started });
}
clearInterval(tick);
peak = Math.max(peak, process.memoryUsage().rss);
console.log(JSON.stringify({ results, peakMiB: Math.round(peak / 1048576) }));
`;
