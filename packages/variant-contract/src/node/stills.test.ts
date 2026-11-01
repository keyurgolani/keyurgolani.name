import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { registryMeta, stillFiles, writeServedFiles } from './codegen';
import { readRegistry } from './registry';
import { imageSize, isAnimated, MAX_STILL_BYTES } from './stills';
import { FALLBACK, manifestFor, removeTestHosts, testHost, variantPackage } from './test-hosts';

// A variant's catalog stills (#6, item 1): the header reader, what
// registry generation refuses, and how a still reaches ASSET_MANIFEST and
// public/_portfolio/still/.

test.after(removeTestHosts);

/** A PNG's signature and IHDR, which is all imageSize() reads, then filler. */
function png(width: number, height: number, filler = 8): Uint8Array {
  const bytes = new Uint8Array(33 + filler);
  const view = new DataView(bytes.buffer);
  bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 0);
  view.setUint32(8, 13);
  bytes.set(
    [...'IHDR'].map((c) => c.charCodeAt(0)),
    12,
  );
  view.setUint32(16, width);
  view.setUint32(20, height);
  return bytes;
}

function riff(chunk: string, body: number[]): Uint8Array {
  const bytes = new Uint8Array(20 + Math.max(body.length, 12));
  bytes.set(
    [...'RIFF'].map((c) => c.charCodeAt(0)),
    0,
  );
  new DataView(bytes.buffer).setUint32(4, bytes.length - 8, true);
  bytes.set(
    [...'WEBP'].map((c) => c.charCodeAt(0)),
    8,
  );
  bytes.set(
    [...chunk].map((c) => c.charCodeAt(0)),
    12,
  );
  // The chunk's own size, as a real file has it.
  new DataView(bytes.buffer).setUint32(16, bytes.length - 20, true);
  bytes.set(body, 20);
  return bytes;
}

/** Lossy: a frame tag, the start code, then 14-bit width and height. */
const vp8 = (width: number, height: number) =>
  riff('VP8 ', [0, 0, 0, 0x9d, 0x01, 0x2a, width & 0xff, width >> 8, height & 0xff, height >> 8]);

/** Lossless: the signature byte, then width and height less one, 14 bits each. */
function vp8l(width: number, height: number) {
  const bits = (width - 1) | ((height - 1) << 14);
  return riff('VP8L', [0x2f, bits & 0xff, (bits >> 8) & 0xff, (bits >> 16) & 0xff, bits >>> 24]);
}

/** Extended: flags, then the canvas less one, 24 bits each. */
function vp8x(width: number, height: number, flags = 0) {
  const w = width - 1;
  const h = height - 1;
  return riff('VP8X', [
    flags,
    0,
    0,
    0,
    w & 0xff,
    (w >> 8) & 0xff,
    w >> 16,
    h & 0xff,
    (h >> 8) & 0xff,
    h >> 16,
  ]);
}

/** A PNG chunk: a big-endian length, the type, the data, and a CRC this reader doesn't check. */
function pngChunk(type: string, data: number[]): number[] {
  const length = data.length;
  return [
    (length >>> 24) & 0xff,
    (length >>> 16) & 0xff,
    (length >>> 8) & 0xff,
    length & 0xff,
    ...[...type].map((c) => c.charCodeAt(0)),
    ...data,
    0,
    0,
    0,
    0,
  ];
}

/** A PNG with `chunks` after its IHDR, as an APNG puts acTL there. */
function pngWith(width: number, height: number, chunks: number[][]): Uint8Array {
  const head = png(width, height, 0);
  return new Uint8Array([...head, ...chunks.flat()]);
}

test('a still is one frame: an animated WebP or an APNG is animated, and a plain one is not (#6)', () => {
  assert.equal(isAnimated(vp8x(1440, 900), 'webp'), false);
  assert.equal(isAnimated(vp8x(1440, 900, 0x02), 'webp'), true);
  // An ANIM chunk after the header, with no flag.
  const anim = new Uint8Array([
    ...vp8x(720, 450),
    ...[...'ANIM'].map((c) => c.charCodeAt(0)),
    6,
    0,
    0,
    0,
    0,
    0,
    0,
    0,
    0,
    0,
  ]);
  assert.equal(isAnimated(anim, 'webp'), true);
  assert.equal(isAnimated(vp8(720, 450), 'webp'), false);
  assert.equal(isAnimated(vp8l(720, 450), 'webp'), false);
  assert.equal(isAnimated(pngWith(720, 450, [pngChunk('IDAT', [1, 2, 3])]), 'png'), false);
  assert.equal(
    isAnimated(
      pngWith(720, 450, [pngChunk('acTL', [0, 0, 0, 2, 0, 0, 0, 0]), pngChunk('IDAT', [1])]),
      'png',
    ),
    true,
  );
  // An acTL after the image data isn't an APNG's.
  assert.equal(
    isAnimated(
      pngWith(720, 450, [pngChunk('IDAT', [1]), pngChunk('acTL', [0, 0, 0, 2, 0, 0, 0, 0])]),
      'png',
    ),
    false,
  );
  assert.equal(isAnimated(png(720, 450), 'png'), false);
});

test('imageSize reads a PNG and each WebP encoding, and nothing else', () => {
  assert.deepEqual(imageSize(png(1440, 900)), { format: 'png', width: 1440, height: 900 });
  assert.deepEqual(imageSize(vp8(720, 450)), { format: 'webp', width: 720, height: 450 });
  assert.deepEqual(imageSize(vp8l(1440, 900)), { format: 'webp', width: 1440, height: 900 });
  assert.deepEqual(imageSize(vp8x(2880, 1800)), { format: 'webp', width: 2880, height: 1800 });
  assert.equal(
    imageSize(new TextEncoder().encode('GIF89a and then some bytes to pad it out')),
    null,
  );
  assert.equal(imageSize(png(1, 1).subarray(0, 20)), null);
  // A lossy frame without its start code isn't one.
  const broken = vp8(720, 450);
  broken[23] = 0;
  assert.equal(imageSize(broken), null);
});

const STILLS = [
  { file: './stills/1440.webp', width: 1440, height: 900 },
  { file: './stills/720.png', width: 720, height: 450 },
];

const withStills = (files: Record<string, string | Uint8Array>, stills: unknown = STILLS) =>
  variantPackage('@acme/acme-stills', 'acme-stills', {
    manifest: manifestFor('acme-stills', { stills }),
    files,
  });

test('a variant lists its stills in ASSET_MANIFEST with their size, served from /_portfolio/still/ by content hash', async () => {
  const result = await readRegistry({
    hostDir: testHost([
      FALLBACK,
      withStills({ 'stills/1440.webp': vp8x(1440, 900), 'stills/720.png': png(720, 450) }),
    ]),
  });
  assert.ok(result.ok, JSON.stringify(result.diagnostics));
  const unit = registryMeta(result).ASSET_MANIFEST.find(({ id }) => id === 'acme-stills')!;
  assert.deepEqual(
    unit.stills.map(({ url, width, height, bytes }) => ({ url, width, height, bytes })),
    [
      {
        url: unit.stills[0]!.url,
        width: 1440,
        height: 900,
        bytes: vp8x(1440, 900).length,
      },
      { url: unit.stills[1]!.url, width: 720, height: 450, bytes: png(720, 450).length },
    ],
  );
  assert.match(unit.stills[0]!.url, /^\/_portfolio\/still\/acme-stills\.[0-9a-f]{12}\.webp$/);
  assert.match(unit.stills[1]!.url, /^\/_portfolio\/still\/acme-stills\.[0-9a-f]{12}\.png$/);
  // The fallback composition declares none.
  assert.deepEqual(
    registryMeta(result).ASSET_MANIFEST.find(({ id }) => id === 'fallback')!.stills,
    [],
  );

  const files = stillFiles(result);
  assert.deepEqual(
    files.map(({ url }) => url),
    [...unit.stills.map(({ url }) => url)].sort(),
  );
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'portfolio-stills-'));
  try {
    const target = path.join(dir, 'still');
    const staging = { staging: path.join(dir, 'staging') };
    assert.deepEqual(
      writeServedFiles(target, files, 'still', staging).written,
      files.map(({ name }) => name),
    );
    // Nothing but a still goes there.
    assert.throws(
      () => writeServedFiles(target, [{ ...files[0]!, name: 'acme-stills.css' }], 'still', staging),
      /isn't a still's name/,
    );
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("a still the package can't ship is a record, and the variant doesn't register", async () => {
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'portfolio-outside-'));
  fs.writeFileSync(path.join(outside, 'still.webp'), vp8x(1440, 900));
  try {
    const cases: [Record<string, string | Uint8Array>, unknown, RegExp][] = [
      [
        { 'stills/720.png': png(720, 450) },
        STILLS,
        /names \.\/stills\/1440\.webp, which the package doesn't have/,
      ],
      [
        { 'stills/1440.webp': vp8x(1280, 800), 'stills/720.png': png(720, 450) },
        STILLS,
        /declares 1440x900, and \.\/stills\/1440\.webp is 1280x800/,
      ],
      [
        {
          'stills/1440.webp': 'not an image at all, just some text',
          'stills/720.png': png(720, 450),
        },
        STILLS,
        /isn't a PNG or WebP image/,
      ],
      [
        {
          'stills/1440.webp': vp8x(1440, 900),
          'stills/720.png': png(720, 450, MAX_STILL_BYTES),
        },
        STILLS,
        /over the 256 KB a still may be/,
      ],
      [
        { 'stills/1440.webp': vp8x(1440, 900, 0x02), 'stills/720.png': png(720, 450) },
        STILLS,
        /names \.\/stills\/1440\.webp, which is animated: a still is one frame/,
      ],
      [
        {
          'stills/1440.webp': vp8x(1440, 900),
          'stills/720.png': pngWith(720, 450, [
            pngChunk('acTL', [0, 0, 0, 2, 0, 0, 0, 0]),
            pngChunk('IDAT', [1]),
          ]),
        },
        STILLS,
        /names \.\/stills\/720\.png, which is animated: a still is one frame/,
      ],
    ];
    for (const [files, stills, message] of cases) {
      const result = await readRegistry({
        hostDir: testHost([FALLBACK, withStills(files, stills)]),
      });
      assert.equal(result.ok, false, String(message));
      const record = result.diagnostics.find(({ code }) => code === 'registry.still-invalid');
      assert.ok(record, `${message}: ${JSON.stringify(result.diagnostics)}`);
      assert.match(record.message, message);
      assert.match(record.pointer, /^\/stills\//);
    }

    // A link that leads out of the package.
    const host = testHost([FALLBACK, withStills({ 'stills/720.png': png(720, 450) })]);
    fs.symlinkSync(
      path.join(outside, 'still.webp'),
      path.join(host, 'node_modules', '@acme', 'acme-stills', 'stills', '1440.webp'),
    );
    const linked = await readRegistry({ hostDir: host });
    assert.equal(linked.ok, false);
    assert.match(
      linked.diagnostics.find(({ code }) => code === 'registry.still-invalid')!.message,
      /resolves outside the package/,
    );
  } finally {
    fs.rmSync(outside, { recursive: true, force: true });
  }
});

test("the manifest refuses a still that isn't a PNG or WebP in the package, or of a size a plate can't use", async () => {
  for (const stills of [
    [{ file: '../shared/1440.webp', width: 1440, height: 900 }],
    [{ file: './stills/1440.gif', width: 1440, height: 900 }],
    [{ file: './stills/1440.webp', width: 10, height: 900 }],
    [{ file: './stills/1440.webp', width: 1440, height: 900, alt: 'x' }],
    [],
  ]) {
    const result = await readRegistry({
      hostDir: testHost([FALLBACK, withStills({}, stills)]),
    });
    assert.equal(result.ok, false, JSON.stringify(stills));
    assert.ok(
      result.diagnostics.some(({ pointer }) => pointer.startsWith('/stills')),
      JSON.stringify(result.diagnostics),
    );
  }
});
