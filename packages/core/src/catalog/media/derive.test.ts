import test from 'node:test';
import assert from 'node:assert/strict';
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
