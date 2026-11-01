// A hand-built WOFF2 for the font tests: the head, hhea, OS/2, cmap, and
// hmtx tables the metrics reader reads, with the values a test names,
// behind a WOFF2 header and directory, Brotli-compressed as WOFF2 stores
// them. It maps printable Basic Latin (or the characters a test names) to
// glyphs from 1, in order, and holds no outlines, so no browser renders it; the reader and the compiler
// only need its tables.

import { brotliCompressSync } from 'node:zlib';

export interface Woff2Spec {
  readonly unitsPerEm: number;
  readonly hhea: {
    readonly ascender: number;
    readonly descender: number;
    readonly lineGap: number;
  };
  readonly typo: {
    readonly ascender: number;
    readonly descender: number;
    readonly lineGap: number;
  };
  readonly xAvgCharWidth: number;
  /** Written only in an OS/2 table of version 2 or later. */
  readonly capHeight: number;
  /** sxHeight, written only in an OS/2 table of version 2 or later; 0 when left out. */
  readonly xHeight?: number;
  readonly useTypoMetrics: boolean;
  /** OS/2's version: 4 by default; 1 has no sCapHeight. */
  readonly os2Version?: number;
  /** Every mapped glyph's advance, unless `advances` gives a character its own. */
  readonly advance: number;
  readonly advances?: Readonly<Record<string, number>>;
  /** cmap's Unicode subtable: format 4 by default, or 12. */
  readonly cmapFormat?: 4 | 12;
  /** The characters its cmap maps, in glyph order from glyph 1: printable Basic Latin, U+0020 to U+007E, by default. */
  readonly maps?: string;
  /** Leaves z unmapped, as a subset without Latin lowercase would. */
  readonly withoutZ?: boolean;
  /** Stores hmtx as WOFF2's transformed hmtx: a flags byte, then the advances alone. */
  readonly hmtxTransformed?: boolean;
}

export const SAMPLE_METRICS: Woff2Spec = {
  unitsPerEm: 1000,
  hhea: { ascender: 900, descender: -250, lineGap: 50 },
  typo: { ascender: 800, descender: -200, lineGap: 200 },
  xAvgCharWidth: 777,
  capHeight: 700,
  xHeight: 520,
  useTypoMetrics: false,
  advance: 500,
};

/** A table: its known-tag index or four-letter tag, its stored bytes, and, when WOFF2 transformed it, its original length. */
export type Woff2Table = readonly [tag: number | string, bytes: Uint8Array, origLength?: number];

function table(length: number, write: (view: DataView) => void): Uint8Array {
  const bytes = new Uint8Array(length);
  write(new DataView(bytes.buffer));
  return bytes;
}

/** WOFF2's UIntBase128 of `value`. */
function base128(value: number): number[] {
  const out = [value & 0x7f];
  for (let rest = Math.floor(value / 128); rest > 0; rest = Math.floor(rest / 128)) {
    out.unshift((rest & 0x7f) | 0x80);
  }
  return out;
}

/** Printable Basic Latin, U+0020 to U+007E. */
export const BASIC_LATIN = String.fromCharCode(...Array.from({ length: 0x5f }, (_, i) => 0x20 + i));

/** The characters `spec` maps, in glyph order from glyph 1. */
function mapped(spec: Woff2Spec): string[] {
  return [...new Set(spec.maps ?? BASIC_LATIN)].filter((char) => !(spec.withoutZ && char === 'z'));
}

/** The mapped characters as runs of consecutive code points: [first, last, first glyph]. */
function runs(spec: Woff2Spec): [number, number, number][] {
  const out: [number, number, number][] = [];
  mapped(spec).forEach((char, index) => {
    const point = char.codePointAt(0)!;
    const glyph = index + 1;
    const last = out.at(-1);
    if (last && point === last[1] + 1 && glyph === last[2] + (point - last[0])) last[1] = point;
    else out.push([point, point, glyph]);
  });
  return out;
}

function cmapTable(spec: Woff2Spec): Uint8Array {
  if (spec.cmapFormat === 12) {
    const groups = runs(spec);
    const length = 16 + groups.length * 12;
    return table(12 + length, (view) => {
      view.setUint16(2, 1);
      view.setUint16(4, 3);
      view.setUint16(6, 10);
      view.setUint32(8, 12);
      view.setUint16(12, 12);
      view.setUint32(16, length);
      view.setUint32(24, groups.length);
      groups.forEach(([start, end, glyph], i) => {
        view.setUint32(28 + i * 12, start);
        view.setUint32(32 + i * 12, end);
        view.setUint32(36 + i * 12, glyph);
      });
    });
  }
  // Format 4: a segment per run, by idDelta, and the closing 0xFFFF segment.
  const segments: [number, number, number][] = [
    ...runs(spec).map(([start, end, glyph]): [number, number, number] => [
      start,
      end,
      glyph - start,
    ]),
    [0xffff, 0xffff, 1],
  ];
  const count = segments.length;
  const length = 16 + count * 8;
  return table(12 + length, (view) => {
    view.setUint16(2, 1);
    view.setUint16(4, 3);
    view.setUint16(6, 1);
    view.setUint32(8, 12);
    const at = 12;
    view.setUint16(at, 4);
    view.setUint16(at + 2, length);
    view.setUint16(at + 6, count * 2);
    segments.forEach(([start, end, delta], i) => {
      view.setUint16(at + 14 + i * 2, end);
      view.setUint16(at + 16 + count * 2 + i * 2, start);
      view.setUint16(at + 16 + count * 4 + i * 2, delta & 0xffff);
      view.setUint16(at + 16 + count * 6 + i * 2, 0);
    });
  });
}

/** hmtx: one advance per glyph, .notdef's 0, as longHorMetrics or as WOFF2's transformed table. */
function hmtxTable(spec: Woff2Spec): Woff2Table {
  const advances = [0, ...mapped(spec).map((char) => spec.advances?.[char] ?? spec.advance)];
  const glyphs = advances.length;
  if (spec.hmtxTransformed) {
    const bytes = table(1 + glyphs * 2, (view) => {
      view.setUint8(0, 0x03); // Both side-bearing arrays left out.
      advances.forEach((advance, i) => view.setUint16(1 + i * 2, advance));
    });
    return [3, bytes, glyphs * 4];
  }
  return [3, table(glyphs * 4, (view) => advances.forEach((a, i) => view.setUint16(i * 4, a)))];
}

/** The five tables, by WOFF2 known-tag index: cmap 0, head 1, hhea 2, hmtx 3, OS/2 6. */
export function metricTables(spec: Woff2Spec): Woff2Table[] {
  const version = spec.os2Version ?? 4;
  const head = table(54, (view) => {
    view.setUint16(0, 1);
    view.setUint32(12, 0x5f0f3cf5);
    view.setUint16(18, spec.unitsPerEm);
  });
  const hhea = table(36, (view) => {
    view.setUint16(0, 1);
    view.setInt16(4, spec.hhea.ascender);
    view.setInt16(6, spec.hhea.descender);
    view.setInt16(8, spec.hhea.lineGap);
    view.setUint16(34, mapped(spec).length + 1);
  });
  const os2 = table(version >= 2 ? 96 : 86, (view) => {
    view.setUint16(0, version);
    view.setInt16(2, spec.xAvgCharWidth);
    view.setUint16(4, 400);
    view.setUint16(62, spec.useTypoMetrics ? 0x80 | 0x40 : 0x40);
    view.setInt16(68, spec.typo.ascender);
    view.setInt16(70, spec.typo.descender);
    view.setInt16(72, spec.typo.lineGap);
    if (version >= 2) {
      view.setInt16(86, spec.xHeight ?? 0);
      view.setInt16(88, spec.capHeight);
    }
  });
  return [[0, cmapTable(spec)], [1, head], [2, hhea], hmtxTable(spec), [6, os2]];
}

/**
 * A WOFF2 file of `tables`, in that order: each by its known-tag index, or
 * by a four-letter tag, which the directory spells out (index 63). A
 * glyf table (index 10) is written transformed, with a transformLength,
 * as WOFF2 writes one by default, and so is any table given its original
 * length (hmtx, at transform version 1).
 */
export function woff2Of(tables: readonly Woff2Table[]): Uint8Array {
  const directory = tables.flatMap(([tag, bytes, origLength]) => {
    if (typeof tag === 'string') {
      return [63, ...[...tag].map((char) => char.charCodeAt(0)), ...base128(bytes.length)];
    }
    // glyf at transform version 0 is transformed: an origLength, then its stored length.
    if (tag === 10) return [tag, ...base128(bytes.length * 2), ...base128(bytes.length)];
    if (origLength !== undefined) {
      return [tag | (1 << 6), ...base128(origLength), ...base128(bytes.length)];
    }
    return [tag, ...base128(bytes.length)];
  });
  const stream = Buffer.concat(tables.map(([, bytes]) => bytes));
  const compressed = brotliCompressSync(stream);
  const total = 48 + directory.length + compressed.length;
  const out = new Uint8Array(total);
  const view = new DataView(out.buffer);
  out.set([0x77, 0x4f, 0x46, 0x32]); // wOF2
  view.setUint32(4, 0x00010000);
  view.setUint32(8, total);
  view.setUint16(12, tables.length);
  view.setUint32(16, stream.length + 12 + 16 * tables.length);
  view.setUint32(20, compressed.length);
  view.setUint16(24, 1);
  out.set(directory, 48);
  out.set(compressed, 48 + directory.length);
  return out;
}

/** A minimal WOFF2 with `spec`'s metrics. */
export function minimalWoff2(spec: Woff2Spec = SAMPLE_METRICS): Uint8Array {
  return woff2Of(metricTables(spec));
}

const KNOWN: Record<number, string> = { 0: 'cmap', 1: 'head', 2: 'hhea', 3: 'hmtx', 6: 'OS/2' };

/** The same tables as a plain TrueType file: the offset table, the records, then each table. */
export function sfntOf(spec: Woff2Spec = SAMPLE_METRICS): Uint8Array {
  const tables = metricTables({ ...spec, hmtxTransformed: false });
  const header = 12 + tables.length * 16;
  const total = tables.reduce((sum, [, bytes]) => sum + bytes.length, header);
  const out = new Uint8Array(total);
  const view = new DataView(out.buffer);
  view.setUint32(0, 0x00010000);
  view.setUint16(4, tables.length);
  let offset = header;
  tables.forEach(([index, bytes], i) => {
    const record = 12 + i * 16;
    [...KNOWN[index as number]!].forEach((char, at) =>
      view.setUint8(record + at, char.charCodeAt(0)),
    );
    view.setUint32(record + 8, offset);
    view.setUint32(record + 12, bytes.length);
    out.set(bytes, offset);
    offset += bytes.length;
  });
  return out;
}
