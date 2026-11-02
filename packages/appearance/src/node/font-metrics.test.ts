import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { brotliCompressSync } from 'node:zlib';
import {
  fallbackAliases,
  fallbackOverrides,
  FontMetricsError,
  LATIN_PAGE,
  LATIN_WEIGHTS,
  LEADING_FAMILIES,
  leadingFamily,
  LINUX_FACES,
  mappedCodePoints,
  readFontMetrics,
  stackClass,
  stackTextFace,
  SYSTEM_FONTS,
  systemFont,
  systemVariant,
  TEXT_FACES,
} from './font-metrics';
import { metricTables, minimalWoff2, SAMPLE_METRICS, sfntOf, woff2Of } from '../test-support/woff2';

// The metrics reader behind the compiler's fallback faces: the fixture
// font's real tables, a hand-built WOFF2 whose values the test names, the
// Latin width both sides of a fallback are sized by, held to an
// independent reference, and the ways a file that isn't a readable font
// fails, each saying why.

const FIXTURE = fileURLToPath(
  new URL(
    '../../../appearance-fixtures-typography/packs/fixture-font/geist-latin.woff2',
    import.meta.url,
  ),
);
const SUPPLEMENTAL = '/System/Library/Fonts/Supplemental';

/**
 * capsize's published frequency-weighted Latin widths (`xWidthAvg`, in
 * `next/dist/server/capsize-font-metrics.json` of next 16.4.1): an
 * independent measure of what LATIN_WEIGHTS measures.
 */
const CAPSIZE = {
  geist: { unitsPerEm: 1000, xWidthAvg: 467 },
  arial: { unitsPerEm: 2048, xWidthAvg: 913 },
  timesNewRoman: { unitsPerEm: 2048, xWidthAvg: 832 },
};

const geist = () => readFontMetrics(new Uint8Array(fs.readFileSync(FIXTURE)), 'geist-latin.woff2');

test("it reads the fixture font's head, hhea, OS/2, cmap, and hmtx tables", () => {
  const { latinWidth, basicLatin, ...metrics } = geist();
  // It maps all 95 printable Basic Latin code points.
  assert.equal(basicLatin.length, 95);
  assert.deepEqual(metrics, {
    unitsPerEm: 1000,
    hhea: { ascender: 1005, descender: -295, lineGap: 0 },
    typo: { ascender: 1005, descender: -295, lineGap: 0 },
    xAvgCharWidth: 581,
    xHeight: 530,
    capHeight: 710,
    fullName: 'Geist Regular',
    useTypoMetrics: true,
    // Geist's file is variable, 100 to 900 from a default of 400.
    weightAxis: { min: 100, default: 400, max: 900 },
    instance: null,
  });
  assert.equal(latinWidth!.toFixed(2), '473.33');
});

test("a variable font's widths at a weight come from its HVAR, through fvar and avar", () => {
  const bytes = new Uint8Array(fs.readFileSync(FIXTURE));
  const at = (wght: number) => readFontMetrics(bytes, 'geist-latin.woff2', { wght });
  // The default instance is the font as it is, with no instance.
  assert.equal(at(400).instance, null);
  assert.equal(at(400).latinWidth!.toFixed(2), '473.33');
  // Heavier is wider, lighter narrower, monotonically, and past the axis it's clamped.
  const widths = [100, 300, 400, 500, 700, 900].map((wght) => at(wght).latinWidth!);
  for (let i = 1; i < widths.length; i += 1) assert.ok(widths[i]! > widths[i - 1]!, String(i));
  assert.equal(at(700).instance, 700);
  assert.equal(at(1000).instance, 900);
  assert.equal(at(1000).latinWidth, at(900).latinWidth);
  // Pinned: Geist at 700 is 6.87% wider than at 400 (473.33 to 505.85).
  assert.equal(at(700).latinWidth!.toFixed(2), '505.85');
  // Only the widths move: the vertical metrics are the default instance's.
  assert.deepEqual(at(700).typo, at(400).typo);
  // A static font has no axis, and a weight asked of it changes nothing.
  const sample = readFontMetrics(minimalWoff2(), 'static', { wght: 700 });
  assert.equal(sample.weightAxis, null);
  assert.equal(sample.instance, null);
  assert.equal(sample.latinWidth!.toFixed(6), '500.000000');
});

test('it reads the values a hand-built WOFF2 holds, past tables it skips', () => {
  const { latinWidth, basicLatin, ...sample } = readFontMetrics(minimalWoff2());
  assert.equal(basicLatin.length, 95);
  // A caps-only face maps what it maps, and has no Latin width.
  const caps = readFontMetrics(minimalWoff2({ ...SAMPLE_METRICS, maps: ' ABCXYZ' }));
  assert.deepEqual(caps.basicLatin, [0x20, 0x41, 0x42, 0x43, 0x58, 0x59, 0x5a]);
  assert.equal(caps.latinWidth, null);
  assert.deepEqual(
    readFontMetrics(minimalWoff2({ ...SAMPLE_METRICS, maps: ' ABCXYZ', cmapFormat: 12 }))
      .basicLatin,
    caps.basicLatin,
  );
  assert.deepEqual(sample, {
    unitsPerEm: 1000,
    hhea: { ascender: 900, descender: -250, lineGap: 50 },
    typo: { ascender: 800, descender: -200, lineGap: 200 },
    xAvgCharWidth: 777,
    xHeight: 520,
    capHeight: 700,
    fullName: null,
    useTypoMetrics: false,
    weightAxis: null,
    instance: null,
  });
  assert.equal(latinWidth!.toFixed(6), '500.000000');
  // An sxHeight of 0 is none.
  assert.equal(readFontMetrics(minimalWoff2({ ...SAMPLE_METRICS, xHeight: 0 })).xHeight, null);
  // A table with a tag of its own, and a transformed glyf, ahead of the rest:
  // their stored lengths move every offset after them.
  const spec = { ...SAMPLE_METRICS, unitsPerEm: 2048, xAvgCharWidth: 1100, useTypoMetrics: true };
  const busy = woff2Of([
    ['Zzzz', new Uint8Array(13).fill(7)],
    [10, new Uint8Array(21).fill(9)],
    ...metricTables(spec),
  ]);
  const read = readFontMetrics(busy);
  assert.equal(read.unitsPerEm, 2048);
  assert.equal(read.xAvgCharWidth, 1100);
  assert.equal(read.latinWidth!.toFixed(6), '500.000000');
  assert.equal(read.useTypoMetrics, true);
  // OS/2 version 1 has no sCapHeight.
  assert.equal(readFontMetrics(minimalWoff2({ ...SAMPLE_METRICS, os2Version: 1 })).capHeight, null);
  // The same tables as plain TrueType read the same.
  assert.deepEqual(readFontMetrics(sfntOf()), readFontMetrics(minimalWoff2()));
});

test('the Latin width weights each character by its frequency, through cmap 4 or 12 and plain or transformed hmtx', () => {
  // e alone at 1500, the rest at 500: the weighted mean moves by e's share.
  const weights = Object.values(LATIN_WEIGHTS).reduce((sum, weight) => sum + weight, 0);
  const expected = 500 + (1000 * LATIN_WEIGHTS.e!) / weights;
  const spec = { ...SAMPLE_METRICS, advances: { e: 1500 } };
  for (const variant of [
    spec,
    { ...spec, cmapFormat: 12 as const },
    { ...spec, hmtxTransformed: true },
    { ...spec, cmapFormat: 12 as const, hmtxTransformed: true },
  ]) {
    assert.equal(
      readFontMetrics(minimalWoff2(variant)).latinWidth!.toFixed(6),
      expected.toFixed(6),
      JSON.stringify(variant),
    );
  }
  // A face that doesn't map every one of them has no Latin width, and no fallback sized by it.
  const partial = readFontMetrics(minimalWoff2({ ...SAMPLE_METRICS, withoutZ: true }));
  assert.equal(partial.latinWidth, null);
  assert.equal(fallbackOverrides(partial, systemFont('Arial')), null);
  assert.deepEqual(fallbackAliases(partial, 'sans'), []);
});

test("the fixture's size-adjust is within 1.5% of the one capsize's independent widths give (#review H1)", () => {
  const reference =
    CAPSIZE.geist.xWidthAvg /
    CAPSIZE.geist.unitsPerEm /
    (CAPSIZE.arial.xWidthAvg / CAPSIZE.arial.unitsPerEm);
  const overrides = fallbackOverrides(geist(), systemFont('Arial'))!;
  const size = Number.parseFloat(overrides.sizeAdjust) / 100;
  assert.ok(
    Math.abs(size / reference - 1) < 0.015,
    `size-adjust ${overrides.sizeAdjust} against capsize's ${(reference * 100).toFixed(2)}%`,
  );
  // The OS/2 xAvgCharWidth ratio the first version used was 26% off: 131.62%.
  assert.ok(size < 1.1, overrides.sizeAdjust);
  // Each side's width alone is close to capsize's too.
  assert.ok(Math.abs(geist().latinWidth! / CAPSIZE.geist.xWidthAvg - 1) < 0.015);
  assert.ok(Math.abs(systemFont('Arial').metrics.latinWidth / CAPSIZE.arial.xWidthAvg - 1) < 0.015);
  assert.ok(
    Math.abs(
      systemFont('Times New Roman').metrics.latinWidth / CAPSIZE.timesNewRoman.xWidthAvg - 1,
    ) < 0.015,
  );
});

test("a file that isn't a readable font fails, naming the file and what's wrong", () => {
  const good = minimalWoff2();
  const fails = (bytes: Uint8Array, pattern: RegExp) =>
    assert.throws(
      () => readFontMetrics(bytes, 'face.woff2'),
      (error: unknown) =>
        error instanceof FontMetricsError &&
        error.message.startsWith("face.woff2 can't be read for its metrics: ") &&
        pattern.test(error.message),
    );
  fails(new Uint8Array(4), /too short to be a font/);
  fails(new TextEncoder().encode('plain text, not a font'), /aren't WOFF2's wOF2/);
  const woff1 = good.slice();
  woff1.set([0x77, 0x4f, 0x46, 0x46]);
  fails(woff1, /WOFF 1\.0/);
  fails(good.subarray(0, good.length - 3), /its header says \d+ bytes, and it's \d+/);
  // A changed byte in the Brotli stream.
  const corrupt = good.slice();
  for (let at = 60; at < corrupt.length; at += 1) corrupt[at] = corrupt[at]! ^ 0xff;
  fails(corrupt, /don't decompress as Brotli|runs past/);
  const tables = metricTables(SAMPLE_METRICS);
  // A directory that leaves out OS/2, or cmap.
  fails(woff2Of(tables.filter(([tag]) => tag !== 6)), /no OS\/2 table/);
  fails(woff2Of(tables.filter(([tag]) => tag !== 0)), /no cmap table/);
  // A head whose magic number is wrong.
  const badHead = tables[1]![1].slice();
  badHead[12] = 0;
  fails(woff2Of(tables.map((entry) => (entry[0] === 1 ? [1, badHead] : entry))), /magic number/);
  // A collection.
  const collection = good.slice();
  collection.set([0x74, 0x74, 0x63, 0x66], 4);
  fails(collection, /font collection/);
});

test('a stream that decompresses past what its directory says is refused, not expanded (#review L2)', () => {
  // 16 MiB of zeros compresses to a few hundred bytes; the directory claims 128.
  const bomb = brotliCompressSync(Buffer.alloc(16 * 1024 * 1024));
  const good = minimalWoff2();
  const directoryEnd =
    good.length -
    brotliCompressSync(Buffer.concat(metricTables(SAMPLE_METRICS).map(([, b]) => b))).length;
  const out = new Uint8Array(directoryEnd + bomb.length);
  out.set(good.subarray(0, directoryEnd));
  out.set(bomb, directoryEnd);
  const view = new DataView(out.buffer);
  view.setUint32(8, out.length);
  view.setUint32(20, bomb.length);
  assert.throws(
    () => readFontMetrics(out, 'bomb.woff2'),
    (error: unknown) =>
      error instanceof FontMetricsError && /don't decompress as Brotli/.test(error.message),
  );
});

test('the overrides make the system font take the space the font does', () => {
  const metrics = readFontMetrics(minimalWoff2());
  const arial = systemFont('Arial');
  // size-adjust: the font's Latin width over Arial's, each per em, never OS/2's xAvgCharWidth (777 here).
  const size = 500 / 1000 / (915.39 / 2048);
  const at = (value: number) => `${(Math.round(value * 10000) / 100).toFixed(2)}%`;
  assert.deepEqual(fallbackOverrides(metrics, arial), {
    sizeAdjust: at(size),
    ascentOverride: at(900 / (1000 * size)),
    descentOverride: at(250 / (1000 * size)),
    lineGapOverride: at(50 / (1000 * size)),
  });
  assert.equal(fallbackOverrides(metrics, arial)!.sizeAdjust, '111.86%');
  // With USE_TYPO_METRICS set, the typo metrics are the ones laid out.
  const typo = fallbackOverrides({ ...metrics, useTypoMetrics: true }, arial)!;
  assert.equal(typo.ascentOverride, at(800 / (1000 * size)));
  assert.equal(typo.lineGapOverride, at(200 / (1000 * size)));
});

test('each system face a fallback stands on has the metrics its file on disk has', (t) => {
  if (!fs.existsSync(SUPPLEMENTAL)) {
    t.skip('no macOS system fonts here to read');
    return;
  }
  let measured = 0;
  for (const font of SYSTEM_FONTS) {
    if (!fs.existsSync(font.file)) continue;
    const read = readFontMetrics(
      new Uint8Array(fs.readFileSync(font.file)),
      font.name,
      font.fullName ? { fullName: font.fullName } : {},
    );
    assert.equal(read.unitsPerEm, font.metrics.unitsPerEm, font.name);
    assert.equal(read.latinWidth!.toFixed(2), font.metrics.latinWidth.toFixed(2), font.name);
    assert.equal(read.xHeight, font.metrics.xHeight, font.name);
    measured += 1;
  }
  assert.ok(measured > 0, 'some system face was measured');
});

test("each face a pack's measures may be counted in has the width its file on disk has as 16px body text renders it (R11)", (t) => {
  if (!fs.existsSync(SUPPLEMENTAL)) {
    t.skip('no macOS system fonts here to read');
    return;
  }
  let measured = 0;
  for (const face of TEXT_FACES) {
    if (!fs.existsSync(face.file)) continue;
    // Read as body text renders: weight 400, and an optical size of 16px,
    // which the reader clamps to the axis as the browser does, whatever
    // the table says it measured at.
    const read = readFontMetrics(new Uint8Array(fs.readFileSync(face.file)), face.names[0], {
      ...(face.fullName ? { fullName: face.fullName } : {}),
      wght: 400,
      opsz: 16,
    });
    assert.equal(read.unitsPerEm, face.unitsPerEm, face.names[0]);
    assert.equal(read.latinWidth!.toFixed(2), face.latinWidth.toFixed(2), face.names[0]);
    // And its x-height, for the body aspect (R11.1): sxHeight, or the x's top where OS/2 has none.
    assert.equal(read.xHeight, face.xHeight, face.names[0]);
    measured += 1;
  }
  assert.ok(measured >= TEXT_FACES.length - SYSTEM_FONTS.length, 'the added faces were measured');
  // SF Pro's Text design, not its Display default: the review's M1.
  const sf = TEXT_FACES.find(({ names }) => names.includes('system-ui'))!;
  assert.deepEqual(
    [sf.wght, sf.opsz, (sf.latinWidth / sf.unitsPerEm).toFixed(4)],
    [400, 17, '0.4785'],
  );
});

test('each leading family has the widths, vertical metrics, and Latin coverage its files on disk have', (t) => {
  if (!fs.existsSync(SUPPLEMENTAL)) {
    t.skip('no macOS system fonts here to read');
    return;
  }
  const points = LATIN_PAGE.flatMap(([first, last]) =>
    Array.from({ length: last - first + 1 }, (_, i) => first + i),
  );
  let measured = 0;
  for (const family of LEADING_FAMILIES) {
    let covered = new Set(points);
    for (const [key, face] of Object.entries(family.faces)) {
      if (!fs.existsSync(face.file)) continue;
      const bytes = new Uint8Array(fs.readFileSync(face.file));
      const read = readFontMetrics(bytes, face.file);
      const name = `${family.name} ${key}`;
      assert.equal(read.unitsPerEm, face.unitsPerEm, name);
      assert.equal(read.latinWidth!.toFixed(2), face.latinWidth.toFixed(2), name);
      // hhea's, the metrics Chromium lays it out with while USE_TYPO_METRICS is clear.
      assert.equal(read.useTypoMetrics, false, name);
      assert.deepEqual(read.hhea, face.hhea, name);
      const maps = mappedCodePoints(bytes, points, face.file);
      covered = new Set([...covered].filter((point) => maps.has(point)));
      measured += 1;
    }
    // Its fallbacks' range is exactly what every face draws on a Latin page, so where it's installed they're never reached.
    const ranges: string[] = [];
    for (const point of [...covered].sort((a, b) => a - b)) {
      const hex = (n: number) => n.toString(16).toUpperCase().padStart(4, '0');
      const last = ranges.at(-1);
      const [start, end = start] = last
        ? last
            .slice(2)
            .split('-')
            .map((n) => parseInt(n, 16))
        : [];
      if (last && end! + 1 === point) ranges[ranges.length - 1] = `U+${hex(start!)}-${hex(point)}`;
      else ranges.push(`U+${hex(point)}`);
    }
    assert.equal(ranges.join(', '), family.unicodeRange, family.name);
  }
  assert.equal(measured, 8, 'every leading face was measured');
});

test("each Linux face a leading family's fallback stands on has its file's width, where Linux installs it", (t) => {
  const files: Record<string, string> = {
    'Liberation Sans': '/usr/share/fonts/truetype/liberation/LiberationSans-Regular.ttf',
    'Liberation Sans Bold': '/usr/share/fonts/truetype/liberation/LiberationSans-Bold.ttf',
    'Liberation Sans Italic': '/usr/share/fonts/truetype/liberation/LiberationSans-Italic.ttf',
    'Liberation Sans Bold Italic':
      '/usr/share/fonts/truetype/liberation/LiberationSans-BoldItalic.ttf',
    'DejaVu Sans': '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf',
    'DejaVu Sans Bold': '/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf',
    'DejaVu Sans Oblique': '/usr/share/fonts/truetype/dejavu/DejaVuSans-Oblique.ttf',
    'DejaVu Sans Bold Oblique': '/usr/share/fonts/truetype/dejavu/DejaVuSans-BoldOblique.ttf',
  };
  // Every face is named, and Liberation Sans goes by its own name first, then Arimo and Arial's.
  const [liberation, dejavu] = LINUX_FACES;
  assert.deepEqual(liberation!.faces.regular.locals, [
    'Liberation Sans',
    'Arimo',
    'Arial',
    'ArialMT',
  ]);
  assert.deepEqual(dejavu!.faces.bold.locals, ['DejaVu Sans Bold', 'DejaVuSans-Bold']);
  const present = LINUX_FACES.flatMap((linux) => Object.values(linux.faces)).filter((face) =>
    fs.existsSync(files[face.name]!),
  );
  if (present.length === 0) {
    t.skip('no Liberation Sans or DejaVu Sans here to read');
    return;
  }
  for (const face of present) {
    const read = readFontMetrics(new Uint8Array(fs.readFileSync(files[face.name]!)), face.name);
    // Within 0.2%: Liberation Sans is Arial's metrics, and DejaVu Sans was measured from 2.35's file.
    const error =
      read.latinWidth! / read.unitsPerEm / (face.metrics.latinWidth / face.metrics.unitsPerEm) - 1;
    assert.ok(Math.abs(error) < 0.002, `${face.name}: ${(error * 100).toFixed(2)}%`);
  }
});

test('a leading family is the first entry of a stack, by any name, unless the pack ships it', () => {
  assert.equal(leadingFamily('"Trebuchet MS", "Segoe UI", sans-serif')?.name, 'Trebuchet MS');
  assert.equal(leadingFamily("'trebuchet ms', sans-serif")?.name, 'Trebuchet MS');
  assert.equal(leadingFamily('Verdana, Tahoma, "Segoe UI", sans-serif')?.name, 'Verdana');
  // Further down, it's reached only where the first is missing: no fallback for it.
  assert.equal(leadingFamily('"Space Grotesk", "Avenir Next", Verdana, sans-serif'), null);
  assert.equal(leadingFamily('"Avenir Next", Avenir, sans-serif'), null);
  // A pack that ships a family by the name gets that family's own fallbacks instead.
  assert.equal(leadingFamily('Verdana, sans-serif', ['Verdana']), null);
});

test("a stack's text face is the first one TEXT_FACES has, by any name a stack gives it", () => {
  const advance = (stack: string) => {
    const found = stackTextFace(stack);
    return found && [found.face.names[0], found.advance.toFixed(4)];
  };
  assert.deepEqual(advance('Verdana, Tahoma, "Segoe UI", sans-serif'), ['Verdana', '0.5140']);
  assert.deepEqual(advance('"Iowan Old Style", "Palatino Linotype", Georgia, serif'), [
    'Iowan Old Style',
    '0.4521',
  ]);
  assert.deepEqual(advance('"Trebuchet MS", "Segoe UI", sans-serif'), ['Trebuchet MS', '0.4589']);
  // SF Pro, by the names a system stack gives it.
  assert.deepEqual(advance('system-ui, -apple-system, sans-serif'), ['system-ui', '0.4785']);
  assert.deepEqual(advance('"Segoe UI", "liberation sans"'), ['Arial', '0.4470']);
  assert.equal(advance('"Inter", sans-serif'), null);
  // Each with its aspect, its x-height per em (R11.1).
  const aspect = (stack: string) => stackTextFace(stack)?.aspect.toFixed(4);
  assert.equal(aspect('Verdana, sans-serif'), '0.5454');
  assert.equal(aspect('"Iowan Old Style", serif'), '0.4790');
  assert.equal(aspect('"Trebuchet MS", sans-serif'), '0.5229');
  assert.equal(aspect('Charter, serif'), '0.4810');
  assert.equal(aspect('system-ui, sans-serif'), '0.5078');
});

test("a font whose OS/2 has no x-height takes its x glyph's top, and one with sxHeight keeps it", (t) => {
  const charter = path.join(SUPPLEMENTAL, 'Charter.ttc');
  if (!fs.existsSync(charter)) {
    t.skip('no macOS system fonts here to read');
    return;
  }
  // Charter's OS/2 is version 1, with no sxHeight: the x glyph's yMax, 985 of 2048.
  const read = readFontMetrics(new Uint8Array(fs.readFileSync(charter)), 'Charter', {
    fullName: 'Charter Roman',
  });
  assert.equal(read.xHeight, 985);
  // Verdana has sxHeight, 1117, which it keeps.
  const verdana = readFontMetrics(
    new Uint8Array(fs.readFileSync(path.join(SUPPLEMENTAL, 'Verdana.ttf'))),
    'Verdana',
  );
  assert.equal(verdana.xHeight, 1117);
  // So does a WOFF2 webfont, whose glyf is transformed and never read for this.
  assert.equal(geist().xHeight, 530);
});

test("each system face's medium, semibold, bold, italic, and bold italic have the metrics their files on disk have", (t) => {
  if (!fs.existsSync(SUPPLEMENTAL)) {
    t.skip('no macOS system fonts here to read');
    return;
  }
  let measured = 0;
  for (const font of SYSTEM_FONTS) {
    for (const key of ['medium', 'semibold', 'bold', 'italic', 'boldItalic'] as const) {
      const face = font[key];
      if (!face || !fs.existsSync(face.file)) continue;
      const read = readFontMetrics(
        new Uint8Array(fs.readFileSync(face.file)),
        `${font.name} ${key}`,
        face.fullName ? { fullName: face.fullName } : {},
      );
      assert.equal(read.unitsPerEm, face.metrics.unitsPerEm, `${font.name} ${key}`);
      assert.equal(
        read.latinWidth!.toFixed(2),
        face.metrics.latinWidth.toFixed(2),
        `${font.name} ${key}`,
      );
      assert.equal(read.xHeight, face.metrics.xHeight, `${font.name} ${key}`);
      measured += 1;
    }
  }
  assert.ok(measured > 0, 'some system variant was measured');
  // The one semibold, and where it stands: upright text at 600 to 699.
  const avenir = systemFont('Avenir Next');
  assert.equal(avenir.semibold?.fullName, 'Avenir Next Demi Bold');
  assert.equal(
    systemVariant(avenir, { bold: true, italic: false, semibold: true }),
    avenir.semibold,
  );
  assert.equal(systemVariant(avenir, { bold: true, italic: false }), avenir.bold);
  assert.equal(
    systemVariant(avenir, { bold: true, italic: true, semibold: true }),
    avenir.boldItalic,
  );
  assert.equal(
    systemVariant(systemFont('Verdana'), { bold: true, italic: false, semibold: true }),
    systemFont('Verdana').bold,
  );
  // The one medium, and where it stands: upright text at 500 to 599.
  const helvetica = systemFont('Helvetica Neue');
  assert.equal(helvetica.medium?.fullName, 'Helvetica Neue Medium');
  assert.deepEqual(
    SYSTEM_FONTS.filter((font) => font.medium).map(({ name }) => name),
    ['Helvetica Neue'],
  );
  assert.equal(
    systemVariant(helvetica, { bold: false, italic: false, medium: true }),
    helvetica.medium,
  );
  assert.equal(systemVariant(helvetica, { bold: false, italic: false }), helvetica);
  assert.equal(
    systemVariant(helvetica, { bold: false, italic: true, medium: true }),
    helvetica.italic,
  );
  assert.equal(
    systemVariant(systemFont('Arial'), { bold: false, italic: false, medium: true }),
    systemFont('Arial'),
  );
});

test('a collection is read by the full name of the face asked for', (t) => {
  const file = '/System/Library/Fonts/Palatino.ttc';
  if (!fs.existsSync(file)) {
    t.skip('no Palatino.ttc here to read');
    return;
  }
  const bytes = new Uint8Array(fs.readFileSync(file));
  assert.equal(readFontMetrics(bytes, 'Palatino.ttc').fullName, 'Palatino');
  assert.equal(
    readFontMetrics(bytes, 'Palatino.ttc', { fullName: 'Palatino Bold' }).fullName,
    'Palatino Bold',
  );
  assert.throws(
    () => readFontMetrics(bytes, 'Palatino.ttc', { fullName: 'Palatino Black' }),
    /it has no face named Palatino Black, only Palatino, Palatino Italic, Palatino Bold, Palatino Bold Italic/,
  );
});

/**
 * The web faces packs-plan §3.4 measured (`font-metrics.json`, from next's
 * capsize table): x-height and frequency-weighted width, per em.
 */
const PLAN_FACES = {
  Inter: { kind: 'sans', xHeight: 0.5459, width: 0.4775 },
  Archivo: { kind: 'sans', xHeight: 0.526, width: 0.44 },
  Newsreader: { kind: 'serif', xHeight: 0.426, width: 0.4285 },
  'IBM Plex Mono': { kind: 'mono', xHeight: 0.516, width: 0.6 },
  'JetBrains Mono': { kind: 'mono', xHeight: 0.55, width: 0.6 },
  Fraunces: { kind: 'serif', xHeight: 0.482, width: 0.469 },
  'Space Grotesk': { kind: 'sans', xHeight: 0.486, width: 0.489 },
} as const;

/** Each family's picks and the plan's best-fit error per x-height, in percent. */
const PICKS: Record<keyof typeof PLAN_FACES, [first: string, second: string, planError: number]> = {
  Inter: ['Helvetica Neue', 'Arial', 0],
  Archivo: ['Tahoma', 'Arial', -1.5],
  Newsreader: ['Palatino', 'Palatino', -5.07],
  // The plan's best fit is SF Mono (1.09%), which local() can't reach on a stock Mac.
  'IBM Plex Mono': ['Menlo', 'Menlo', -5.32],
  'JetBrains Mono': ['Menlo', 'Menlo', 0.92],
  Fraunces: ['Palatino', 'Palatino', -1.87],
  'Space Grotesk': ['Avenir Next', 'Verdana', -2.03],
};

test("each family's fallbacks are the system faces whose width per x-height fits best (packs-plan §3.4)", () => {
  for (const [family, face] of Object.entries(PLAN_FACES) as [
    keyof typeof PLAN_FACES,
    (typeof PLAN_FACES)[keyof typeof PLAN_FACES],
  ][]) {
    const metrics = {
      ...readFontMetrics(minimalWoff2()),
      unitsPerEm: 1000,
      latinWidth: face.width * 1000,
      xHeight: face.xHeight * 1000,
    };
    const aliases = fallbackAliases(metrics, face.kind);
    const [first, second, planError] = PICKS[family];
    assert.deepEqual(
      aliases.map(({ face: system }) => system.name),
      [first, second],
      family,
    );
    // The plan's best-fit error, from its own measurements: within a third of a point.
    assert.ok(
      Math.abs(aliases[0]!.xHeightWidthError! * 100 - planError) < 0.35,
      `${family}: ${(aliases[0]!.xHeightWidthError! * 100).toFixed(2)}% against the plan's ${planError}%`,
    );
    // The first is the class's best fit by its error per x-height.
    const best = Math.min(
      ...SYSTEM_FONTS.filter((system) => system.class === face.kind).map((system) =>
        Math.abs(
          system.metrics.latinWidth / system.metrics.xHeight / (face.width / face.xHeight) - 1,
        ),
      ),
    );
    assert.equal(Math.abs(aliases[0]!.xHeightWidthError!).toFixed(9), best.toFixed(9), family);
    // Two aliases at most, four local() names each, the second none of the first's.
    assert.ok(aliases.length <= 2);
    for (const alias of aliases) assert.ok(alias.locals.length >= 1 && alias.locals.length <= 4);
    assert.deepEqual(
      aliases[1]!.locals.filter((local) => aliases[0]!.locals.includes(local)),
      [],
      family,
    );
  }
  const inter = fallbackAliases(
    {
      ...readFontMetrics(minimalWoff2()),
      unitsPerEm: 1000,
      latinWidth: 477.5,
      xHeight: 545.9,
    },
    'sans',
  );
  assert.deepEqual(
    inter.map(({ locals }) => locals),
    [
      ['Helvetica Neue', 'HelveticaNeue'],
      ['Arial', 'ArialMT', 'Liberation Sans', 'Arimo'],
    ],
  );
  // The clones a pick's Windows and Linux names reach, as the plan names them.
  const newsreader = fallbackAliases(
    { ...readFontMetrics(minimalWoff2()), unitsPerEm: 1000, latinWidth: 428.5, xHeight: 426 },
    'serif',
  );
  assert.deepEqual(newsreader[1]!.locals, [
    'Palatino Linotype',
    'PalatinoLinotype-Roman',
    'TeX Gyre Pagella',
    'TeXGyrePagella-Regular',
  ]);
  const jetbrains = fallbackAliases(
    { ...readFontMetrics(minimalWoff2()), unitsPerEm: 1000, latinWidth: 600, xHeight: 550 },
    'mono',
  );
  assert.deepEqual(jetbrains[1]!.locals, [
    'DejaVu Sans Mono',
    'DejaVuSansMono',
    'Bitstream Vera Sans Mono',
  ]);
  // A pick that's itself on Windows, as Archivo's Tahoma is, takes the next fit for its
  // second (Arial, in PICKS), rather than Tahoma again.
  const archivo = fallbackAliases(
    { ...readFontMetrics(minimalWoff2()), unitsPerEm: 1000, latinWidth: 440, xHeight: 526 },
    'sans',
  );
  assert.deepEqual(archivo[0]!.locals, ['Tahoma']);
  assert.deepEqual(archivo[1]!.locals, ['Arial', 'ArialMT', 'Liberation Sans', 'Arimo']);
  // A font with no x-height is fitted by plain width.
  const noX = fallbackAliases(
    { ...readFontMetrics(minimalWoff2()), unitsPerEm: 1000, latinWidth: 447, xHeight: null },
    'sans',
  );
  assert.equal(noX[0]!.face.name, 'Arial');
  assert.equal(noX[0]!.xHeightWidthError, null);
});

/** The real latin files of the variants-10 families, where the lead's pinned packages put them. */
const INSTALLED = fileURLToPath(
  new URL('../../../appearance-typography/node_modules/', import.meta.url),
);
const REAL: [family: string, file: string, kind: 'sans' | 'serif' | 'mono', picks: string[]][] = [
  ['Inter', '@fontsource-variable/inter/files/inter-latin-wght-normal.woff2', 'sans', ['Helvetica Neue', 'Arial']],
  // Archivo's variable file defaults to weight 600 (0.458 per em); at 400, as the compiler
  // picks it, it's 0.441, as the static face capsize measured for the plan, and Tahoma fits.
  ['Archivo', '@fontsource-variable/archivo/files/archivo-latin-wght-normal.woff2', 'sans', ['Tahoma', 'Arial']],
  ['Newsreader', '@fontsource/newsreader/files/newsreader-latin-400-normal.woff2', 'serif', ['Palatino', 'Palatino']],
  ['IBM Plex Mono', '@ibm/plex-mono/fonts/split/woff2/IBMPlexMono-Regular-Latin1.woff2', 'mono', ['Menlo', 'Menlo']],
  ['JetBrains Mono', '@fontsource-variable/jetbrains-mono/files/jetbrains-mono-latin-wght-normal.woff2', 'mono', ['Menlo', 'Menlo']],
  ['Fraunces', '@fontsource/fraunces/files/fraunces-latin-400-normal.woff2', 'serif', ['Palatino', 'Palatino']],
  ['Space Grotesk', '@fontsource-variable/space-grotesk/files/space-grotesk-latin-wght-normal.woff2', 'sans', ['Avenir Next', 'Verdana']],
]; // prettier-ignore

test('the installed font packages read as fonts, map all of Basic Latin, and get the expected picks', (t) => {
  let read = 0;
  for (const [family, file, kind, picks] of REAL) {
    const path = `${INSTALLED}${file}`;
    if (!fs.existsSync(path)) continue;
    // At the weight and optical size most text renders at, as the compiler picks them.
    const metrics = readFontMetrics(new Uint8Array(fs.readFileSync(path)), file, {
      wght: 400,
      opsz: 16,
    });
    assert.equal(metrics.basicLatin.length, 95, family);
    assert.ok(metrics.xHeight !== null && metrics.latinWidth !== null, family);
    assert.deepEqual(
      fallbackAliases(metrics, kind).map(({ face }) => face.name),
      picks,
      family,
    );
    read += 1;
  }
  if (read === 0) t.skip("the font packages aren't installed here");
});

// The files the typography packs ship, which are in the repository, so this always runs.
const SHIPPED: [file: string, kind: 'sans' | 'serif' | 'mono', picks: string[], italic?: boolean][] = [
  ['swiss-grotesque/fonts/archivo-latin-wght-normal.woff2', 'sans', ['Tahoma', 'Arial']],
  // Fitted against the italics: Georgia Italic, then Gelasio Italic elsewhere.
  ['swiss-grotesque/fonts/newsreader-latin-400-italic.woff2', 'serif', ['Georgia', 'Georgia'], true],
  ['swiss-grotesque/fonts/ibmplexmono-medium-latin1.woff2', 'mono', ['Menlo', 'Menlo']],
  ['screen-grotesque/fonts/inter-latin-opsz-normal.woff2', 'sans', ['Helvetica Neue', 'Arial']],
  // paste-up and drafting-grotesk: the plan's Avenir Next for Space Grotesk, then Verdana elsewhere.
  ['paste-up/fonts/archivo-latin-wght-normal.woff2', 'sans', ['Tahoma', 'Arial']],
  ['paste-up/fonts/space-grotesk-latin-wght-normal.woff2', 'sans', ['Avenir Next', 'Verdana']],
  ['paste-up/fonts/ibmplexmono-medium-latin1.woff2', 'mono', ['Menlo', 'Menlo']],
  ['drafting-grotesk/fonts/space-grotesk-latin-wght-normal.woff2', 'sans', ['Avenir Next', 'Verdana']],
  ['drafting-grotesk/fonts/ibmplexmono-regular-latin1.woff2', 'mono', ['Menlo', 'Menlo']],
  // field-serif and shell-mono: the plan's Palatino for Fraunces, then Palatino Linotype elsewhere.
  ['field-serif/fonts/fraunces-latin-600-normal.woff2', 'serif', ['Palatino', 'Palatino']],
  // Fraunces Italic, an italic-only family, fitted against the italics: Times New Roman Italic, then its clones.
  ['field-serif/fonts/fraunces-latin-400-italic.woff2', 'serif', ['Times New Roman', 'Times New Roman'], true],
  ['field-serif/fonts/inter-latin-wght-normal.woff2', 'sans', ['Helvetica Neue', 'Arial']],
  ['shell-mono/fonts/jetbrains-mono-latin-wght-normal.woff2', 'mono', ['Menlo', 'Menlo']],
  // console-mono and book-serif: the same picks for the same files, and Newsreader's upright Palatino.
  ['console-mono/fonts/jetbrains-mono-latin-wght-normal.woff2', 'mono', ['Menlo', 'Menlo']],
  ['console-mono/fonts/inter-latin-wght-normal.woff2', 'sans', ['Helvetica Neue', 'Arial']],
  ['book-serif/fonts/fraunces-latin-600-normal.woff2', 'serif', ['Palatino', 'Palatino']],
  ['book-serif/fonts/newsreader-latin-400-normal.woff2', 'serif', ['Palatino', 'Palatino']],
  // Its italic beside the upright, fitted against the italics as a style of its own: Georgia Italic.
  ['book-serif/fonts/newsreader-latin-400-italic.woff2', 'serif', ['Georgia', 'Georgia'], true],
  // technical-sans-mono: paste-up's Plex Mono 500, so paste-up's picks, and its SemiBold's (Mono (b)).
  ['technical-sans-mono/fonts/ibmplexmono-medium-latin1.woff2', 'mono', ['Menlo', 'Menlo']],
  ['technical-sans-mono/fonts/ibmplexmono-semibold-latin1.woff2', 'mono', ['Menlo', 'Menlo']],
]; // prettier-ignore

test("the typography packs' shipped Latin files map all of Basic Latin and get the expected picks", () => {
  const packs = fileURLToPath(new URL('../../../appearance-typography/packs/', import.meta.url));
  for (const [file, kind, picks, italic] of SHIPPED) {
    const metrics = readFontMetrics(new Uint8Array(fs.readFileSync(`${packs}${file}`)), file, {
      wght: 400,
      opsz: 16,
    });
    assert.equal(metrics.basicLatin.length, 95, file);
    assert.deepEqual(
      fallbackAliases(metrics, kind, { italic }).map(({ face }) => face.name),
      picks,
      file,
    );
  }
});

test("Archivo's and Inter's widths at their heading weights, through HVAR, as the bold fallbacks are sized", () => {
  const packs = fileURLToPath(new URL('../../../appearance-typography/packs/', import.meta.url));
  const width = (file: string, wght: number, opsz?: number) => {
    const bytes = new Uint8Array(fs.readFileSync(`${packs}${file}`));
    const m = readFontMetrics(bytes, file, { wght, ...(opsz === undefined ? {} : { opsz }) });
    return (m.latinWidth! / m.unitsPerEm).toFixed(4);
  };
  const archivo = 'swiss-grotesque/fonts/archivo-latin-wght-normal.woff2';
  // Archivo widens 21% from 400 to 900, and its default instance is 600.
  assert.deepEqual(
    [400, 600, 700, 800, 900].map((wght) => width(archivo, wght)),
    ['0.4407', '0.4582', '0.4746', '0.4994', '0.5340'],
  );
  // Inter's optical size narrows a heading: at 800, 0.5015 per em at 14 px, 0.4780 at 32 px and up.
  const inter = 'screen-grotesque/fonts/inter-latin-opsz-normal.woff2';
  assert.deepEqual(
    [14, 22, 32, 56].map((opsz) => width(inter, 800, opsz)),
    ['0.5015', '0.4911', '0.4780', '0.4780'],
  );
});

test("a stack's generic family gives its class", () => {
  assert.equal(stackClass('Geist, "Segoe UI", sans-serif'), 'sans');
  assert.equal(stackClass('Literata, Georgia, serif'), 'serif');
  assert.equal(stackClass('"Commit Mono", ui-monospace, monospace'), 'mono');
  assert.equal(stackClass('Inter, system-ui'), 'sans');
  assert.equal(stackClass('Inter'), null);
});
