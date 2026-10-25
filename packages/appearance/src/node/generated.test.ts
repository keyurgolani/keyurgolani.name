import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { crc32, deflateSync } from 'node:zlib';
import { gateLanguage, gateTypography } from '../gate';
import { STRICTEST_READINGS } from '../generators/index';
import {
  ACCEPTANCE_FILE,
  GENERATED_DIR,
  MAX_PNG_PIXELS,
  pixelsSha256,
  readPng,
  recordDigest,
  inputsHash,
  REFERENCE_SOURCES,
  referenceFile,
  referenceRecord,
  renderReference,
  reviewExclusion,
  seedInputsHash,
} from './generated';

// #20 PR 3: the reference records' inputs and the owner's acceptance gate.

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../..');
const provenance = JSON.parse(
  fs.readFileSync(path.join(ROOT, 'example-media/provenance.json'), 'utf8'),
) as { images: { file: string; width: number; height: number; pixelsSha256: string }[] };

const SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/** One PNG chunk, with its CRC. */
function chunk(type: string, body: Buffer): Buffer {
  const head = Buffer.alloc(8);
  head.writeUInt32BE(body.length, 0);
  head.write(type, 4, 'latin1');
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([head.subarray(4), body])), 0);
  return Buffer.concat([head, body, crc]);
}

/** An image header: `width` by `height`, 8-bit, `color` 2 (RGB) unless it says otherwise. */
function header(width: number, height: number, { color = 2, interlace = 0, depth = 8 } = {}) {
  const body = Buffer.alloc(13);
  body.writeUInt32BE(width, 0);
  body.writeUInt32BE(height, 4);
  body[8] = depth;
  body[9] = color;
  body[12] = interlace;
  return body;
}

/** A PNG of one row of `pixels`, RGB or RGBA, with the chunks `extra` adds before IDAT. */
function png(pixels: number[][], { alpha = false, extra = [] as [string, Buffer][] } = {}): Buffer {
  const row = Buffer.from([0, ...pixels.flat()]);
  return Buffer.concat([
    SIGNATURE,
    chunk('IHDR', header(pixels.length, 1, { color: alpha ? 6 : 2 })),
    ...extra.map(([type, body]) => chunk(type, body)),
    chunk('IDAT', deflateSync(row)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

test('every example image decodes to its recorded size and pixels, and the reference images carry no metadata', () => {
  for (const image of provenance.images) {
    const { raster, chunks } = readPng(
      fs.readFileSync(path.join(ROOT, 'example-media', image.file)),
    );
    assert.equal(raster.width, image.width, image.file);
    assert.equal(raster.height, image.height, image.file);
    assert.equal(pixelsSha256(raster), image.pixelsSha256, image.file);
    // No EXIF, text, or any other ancillary chunk: nothing about where or when.
    assert.deepEqual(chunks, ['IHDR', 'IDAT', 'IEND'], image.file);
  }
  const images = Object.values(REFERENCE_SOURCES).flatMap((source) =>
    'file' in source ? [source.file] : [],
  );
  assert.deepEqual(images, [
    'example-media/anamika/portrait.png',
    'example-media/gallery/looking-1.png',
  ]);
});

test('the PNG reader takes 8-bit RGB and RGBA in every row filter, names its chunks, and refuses the rest', () => {
  const rgb = readPng(
    png([
      [255, 0, 0],
      [0, 255, 0],
    ]),
  );
  assert.deepEqual([...rgb.raster.data], [255, 0, 0, 255, 0, 255, 0, 255]);
  const rgba = readPng(png([[1, 2, 3, 4]], { alpha: true }));
  assert.deepEqual([...rgba.raster.data], [1, 2, 3, 4]);
  const tagged = readPng(png([[1, 2, 3]], { extra: [['tEXt', Buffer.from('Comment\0hi')]] }));
  assert.ok(
    tagged.chunks.includes('tEXt'),
    'an ancillary chunk is listed, so a test can refuse it',
  );
  assert.throws(() => readPng(Buffer.from('not a png')), /not a PNG/);
  const one = deflateSync(Buffer.from([0, 1, 2, 3]));
  const image = (ihdr: Buffer) =>
    Buffer.concat([
      SIGNATURE,
      chunk('IHDR', ihdr),
      chunk('IDAT', one),
      chunk('IEND', Buffer.alloc(0)),
    ]);
  assert.throws(() => readPng(image(header(1, 1, { depth: 16 }))), /8-bit/);
  // Palette, grayscale, and interlaced images are refused, each by its header.
  for (const ihdr of [
    header(1, 1, { color: 3 }),
    header(1, 1, { color: 0 }),
    header(1, 1, { interlace: 1 }),
  ]) {
    assert.throws(() => readPng(image(ihdr)), /8-bit, non-interlaced RGB or RGBA PNGs only/);
  }
  // Paeth, up, average, and sub filters: the example images use them all, and decode to their hashes above.
});

test('the PNG reader reads its input as untrusted: CRCs, chunk order, a size cap, and an inflate bound (#20 PR 3)', () => {
  const good = png([[1, 2, 3]]);
  assert.equal(readPng(good).raster.width, 1);
  const refuses = (bytes: Buffer, reason: RegExp) =>
    assert.throws(
      () => readPng(bytes),
      (error: unknown) => error instanceof TypeError && reason.test(error.message),
    );
  // A chunk whose CRC doesn't match, the last byte of IEND's CRC flipped.
  const flipped = Buffer.from(good);
  flipped.writeUInt8(flipped.readUInt8(flipped.length - 1) ^ 0xff, flipped.length - 1);
  refuses(flipped, /IEND chunk fails its CRC/);
  const idat = chunk('IDAT', deflateSync(Buffer.from([0, 1, 2, 3])));
  const ihdr = chunk('IHDR', header(1, 1));
  const end = chunk('IEND', Buffer.alloc(0));
  // The header first, and only once; the end chunk last.
  refuses(Buffer.concat([SIGNATURE, idat, ihdr, end]), /start with its image header/);
  refuses(Buffer.concat([SIGNATURE, ihdr, ihdr, idat, end]), /only one/);
  refuses(Buffer.concat([SIGNATURE, ihdr, idat]), /ends before its end chunk/);
  refuses(
    Buffer.concat([SIGNATURE, ihdr, idat, end, Buffer.from([0])]),
    /data after its end chunk/,
  );
  refuses(
    Buffer.concat([SIGNATURE, ihdr, idat.subarray(0, idat.length - 6)]),
    /ends inside a chunk/,
  );
  // A header cut short is a named refusal, not a RangeError.
  refuses(
    Buffer.concat([SIGNATURE, chunk('IHDR', header(1, 1).subarray(0, 12)), idat, end]),
    /isn't 13 bytes/,
  );
  // Over the cap, refused from the header alone; at the cap's side, a 4096 by 4096 header is read.
  assert.equal(MAX_PNG_PIXELS, 4096 * 4096);
  refuses(
    Buffer.concat([SIGNATURE, chunk('IHDR', header(4097, 4096)), idat, end]),
    /of 1 to 16777216 pixels only/,
  );
  refuses(
    Buffer.concat([SIGNATURE, chunk('IHDR', header(0, 1)), idat, end]),
    /of 1 to 16777216 pixels only/,
  );
  refuses(
    Buffer.concat([SIGNATURE, chunk('IHDR', header(4096, 4096)), idat, end]),
    /doesn't inflate to its rows|short/,
  );
  // A small file that would inflate far past its one row stops at the row's size.
  const bomb = deflateSync(Buffer.alloc(64 * 1024 * 1024));
  assert.ok(bomb.length < 128 * 1024, `${bomb.length} bytes`);
  refuses(
    Buffer.concat([SIGNATURE, ihdr, chunk('IDAT', bomb), end]),
    /doesn't inflate to its rows/,
  );
  // Data that isn't zlib at all.
  refuses(
    Buffer.concat([SIGNATURE, ihdr, chunk('IDAT', Buffer.from('not zlib')), end]),
    /doesn't inflate to its rows/,
  );
  // Paeth, up, average, and sub filters: the example images use them all, and decode to their hashes above.
});

test('the pixel hash is over RGB rows for an opaque image and RGBA rows for one with transparency', () => {
  const opaque = { width: 1, height: 1, data: new Uint8Array([1, 2, 3, 255]) };
  const clear = { width: 1, height: 1, data: new Uint8Array([1, 2, 3, 254]) };
  assert.notEqual(pixelsSha256(opaque), pixelsSha256(clear));
  assert.equal(
    pixelsSha256(opaque),
    createHash('sha256')
      .update(Buffer.from([1, 2, 3]))
      .digest('hex'),
  );
  assert.equal(
    pixelsSha256(clear),
    createHash('sha256')
      .update(Buffer.from([1, 2, 3, 254]))
      .digest('hex'),
  );
});

test("each reference record is its generator's output on its input, the same each time, and reads back as written", () => {
  for (const [scheme, source] of Object.entries(REFERENCE_SOURCES)) {
    const manifest = JSON.parse(
      fs.readFileSync(
        path.join(ROOT, 'packages/appearance-schemes/packs', scheme, 'manifest.json'),
        'utf8',
      ),
    ) as { generator: { id: string; version: number; input: 'seed-color' | 'asset' } };
    const first = referenceRecord(ROOT, scheme, manifest.generator, source);
    const again = referenceRecord(ROOT, scheme, manifest.generator, source);
    assert.ok(first.ok && again.ok, scheme);
    const text = renderReference(first.record);
    assert.equal(text, renderReference(again.record));
    assert.deepEqual(JSON.parse(text), JSON.parse(JSON.stringify(first.record)));
    assert.equal(first.record.result.contrastReport.passes, true, scheme);
  }
  const missing = referenceRecord(
    ROOT,
    'profile-image',
    { id: 'profile-image', version: 1, input: 'asset' },
    {
      sourceAsset: 'portrait',
      file: 'example-media/no-such.png',
    },
  );
  assert.equal(missing.ok, false);
});

test("an image-derived scheme waits until the owner's acceptance pins its current record, and any other pack never waits", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'kgn-review-'));
  try {
    const packDir = path.join(root, 'packs', 'profile-image');
    const manifest = {
      id: 'profile-image',
      generator: { id: 'profile-image', version: 1, input: 'asset' as const },
    };
    assert.match(reviewExclusion(manifest, packDir)!, /no reference record/);
    fs.mkdirSync(path.join(root, GENERATED_DIR), { recursive: true });
    fs.writeFileSync(path.join(root, referenceFile('profile-image')), '{"a":1}\n');
    assert.match(reviewExclusion(manifest, packDir)!, /waits for the owner to accept/);
    const accept = (record: string) =>
      fs.writeFileSync(
        path.join(root, GENERATED_DIR, ACCEPTANCE_FILE),
        JSON.stringify({
          'profile-image': { record, acceptedBy: 'keyurgolani', acceptedAt: '2026-10-24' },
        }),
      );
    accept(recordDigest('{"a":1}\n'));
    assert.equal(reviewExclusion(manifest, packDir), null);
    fs.writeFileSync(path.join(root, referenceFile('profile-image')), '{"a":2}\n');
    assert.match(reviewExclusion(manifest, packDir)!, /accepted an earlier reference record/);
    fs.writeFileSync(path.join(root, GENERATED_DIR, ACCEPTANCE_FILE), 'not json');
    assert.match(reviewExclusion(manifest, packDir)!, /waits for the owner/);
    assert.equal(
      reviewExclusion(
        { id: 'brand-seed', generator: { id: 'brand-seed', version: 1, input: 'seed-color' } },
        packDir,
      ),
      null,
    );
    assert.equal(reviewExclusion({ id: 'warm-parchment' }, packDir), null);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("the strictest readings are no laxer than any shipping language's, and every shipping profile sets the signature fill as large text", () => {
  const [textured, translucent] = STRICTEST_READINGS.map(({ language }) => language);
  const dir = path.join(ROOT, 'packages/appearance-languages/packs');
  const read = fs.readdirSync(dir).map((id) => {
    const manifest = JSON.parse(fs.readFileSync(path.join(dir, id, 'manifest.json'), 'utf8'));
    const gate = gateLanguage(manifest.tokens);
    assert.ok(gate.ok, id);
    return { id, language: gate.language };
  });
  for (const { id, language } of read) {
    if (language.textured) assert.equal(language.surfaceOpacity, 1, `${id} is textured, so opaque`);
    assert.ok(language.surfaceOpacity >= translucent!.surfaceOpacity, id);
    assert.ok(language.focusWidth >= textured!.focusWidth, id);
    assert.ok(
      language.borderControl === 'border-strong' || language.borderControl === 'text-primary',
      `${id}'s control border is no weaker than border-strong`,
    );
  }
  assert.equal(
    Math.min(...read.map(({ language }) => language.surfaceOpacity)),
    translucent!.surfaceOpacity,
    'the translucent reading is the lowest shipping opacity',
  );
  const profiles = path.join(ROOT, 'packages/appearance-typography/packs');
  for (const id of fs.readdirSync(profiles)) {
    const manifest = JSON.parse(fs.readFileSync(path.join(profiles, id, 'manifest.json'), 'utf8'));
    assert.equal(gateTypography(manifest.roles).largeSignature, true, id);
  }
});

test("the inputs hash is a seed's SHA-256, lowercased, or an image's pixel hash, as #10 stores it", () => {
  const seed = createHash('sha256').update('#3366ff').digest('hex');
  assert.equal(seedInputsHash('#3366FF'), seed);
  assert.equal(inputsHash({ seedColor: '#3366ff' }), seed);
  assert.equal(
    inputsHash({ sourceAsset: 'portrait', pixelsSha256: 'a'.repeat(64) }),
    'a'.repeat(64),
  );
  assert.equal(inputsHash({ sourceAsset: 'portrait' }), null);
});
