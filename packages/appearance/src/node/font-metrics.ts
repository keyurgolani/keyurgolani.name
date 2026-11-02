// The metrics a fallback face is matched to: a small reader of the head,
// hhea, OS/2, cmap, and hmtx tables of a WOFF2 font, or of a plain TrueType
// or OpenType one, with no dependency. WOFF2 (W3C, WOFF File Format 2.0) is
// a 48-byte header, a table directory, and one Brotli stream holding every
// table in directory order; Node's zlib has Brotli. Only glyf, loca, and
// hmtx can be transformed. The reader needs neither glyf nor loca, and a
// transformed hmtx (WOFF2 §5.4) still holds every advanceWidth after its
// flags byte, with only the side bearings dropped, so the reader takes the
// advances from it as they are: nothing is reconstructed or guessed.
//
// The width a fallback is sized by is measured from the glyphs, the same
// way for the webfont and the system font: the advance of the Latin
// lowercase letters and the space, each weighted by how often it occurs in
// English text (LATIN_WEIGHTS), read through cmap to glyph ids and hmtx to
// advances. OS/2's xAvgCharWidth can't stand in for it: older fonts such as
// Arial store a frequency-weighted lowercase average there and newer ones
// such as Geist the mean of every glyph, so a ratio of the two is off by a
// quarter (#review H1).
//
// fallbackOverrides() turns a font's metrics into the size-adjust and the
// ascent, descent, and line-gap overrides a local system font needs to take
// the same space, so the swap to the webfont moves nothing (CLS).

import { brotliDecompressSync } from 'node:zlib';

/** A font's vertical metrics, in its own units. */
export interface VerticalMetrics {
  readonly ascender: number;
  /** Below the baseline, so zero or less. */
  readonly descender: number;
  readonly lineGap: number;
}

export interface FontMetrics {
  /** head.unitsPerEm. */
  readonly unitsPerEm: number;
  readonly hhea: VerticalMetrics;
  /** OS/2's sTypoAscender, sTypoDescender, and sTypoLineGap. */
  readonly typo: VerticalMetrics;
  /** OS/2's xAvgCharWidth, as the font stores it: read, never sized by (see the top of this file). */
  readonly xAvgCharWidth: number;
  /**
   * The frequency-weighted advance of a to z and the space (LATIN_WEIGHTS),
   * in the font's units, from cmap and hmtx. Null when the font doesn't map
   * all 27, as a Greek or Cyrillic subset doesn't: such a face gets no
   * fallback rather than one sized by a guess.
   */
  readonly latinWidth: number | null;
  /** The printable Basic Latin code points, U+0020 to U+007E, its cmap maps, ascending. */
  readonly basicLatin: readonly number[];
  /**
   * OS/2's sxHeight, which only version 2 and later of the table have, or,
   * for a font whose OS/2 has none, the top of its x glyph in glyf, where it
   * has TrueType outlines stored plainly (an sfnt's, not WOFF2's transformed
   * glyf): Trebuchet MS, Charter, and Iowan Old Style have OS/2 version 1.
   * Null when it has neither.
   */
  readonly xHeight: number | null;
  /** OS/2's sCapHeight, which only version 2 and later of the table have. */
  readonly capHeight: number | null;
  /** The name table's full name, such as "Helvetica Neue", or null. */
  readonly fullName: string | null;
  /** OS/2 fsSelection bit 7: browsers take the typo metrics over hhea's. */
  readonly useTypoMetrics: boolean;
  /** A variable font's weight axis, from fvar, or null for a static font or one with no wght axis. */
  readonly weightAxis: {
    readonly min: number;
    readonly default: number;
    readonly max: number;
  } | null;
  /**
   * The weight latinWidth was measured at: the `wght` readFontMetrics was
   * asked for, clamped to the axis, when the font is variable and its HVAR
   * gives the advances there; null for the default instance or a static font.
   */
  readonly instance: number | null;
}

/** A font the reader can't read, with what's wrong with it. */
export class FontMetricsError extends Error {
  constructor(name: string, problem: string) {
    super(`${name} can't be read for its metrics: ${problem}`);
    this.name = 'FontMetricsError';
  }
}

/** WOFF2's known-table tags, by the index a directory entry's flags give (WOFF2 §5.1). */
const KNOWN_TAGS = [
  'cmap', 'head', 'hhea', 'hmtx', 'maxp', 'name', 'OS/2', 'post', 'cvt ', 'fpgm', 'glyf', 'loca',
  'prep', 'CFF ', 'VORG', 'EBDT', 'EBLC', 'gasp', 'hdmx', 'kern', 'LTSH', 'PCLT', 'VDMX', 'vhea',
  'vmtx', 'BASE', 'GDEF', 'GPOS', 'GSUB', 'EBSC', 'JSTF', 'MATH', 'CBDT', 'CBLC', 'COLR', 'CPAL',
  'SVG ', 'sbix', 'acnt', 'avar', 'bdat', 'bloc', 'bsln', 'cvar', 'fdsc', 'feat', 'fmtx', 'fvar',
  'gvar', 'hsty', 'just', 'lcar', 'mort', 'morx', 'opbd', 'prop', 'trak', 'Zapf', 'Silf', 'Glat',
  'Gloc', 'Feat', 'Sill',
] as const; // prettier-ignore

/** The tables the metrics come from, and the fewest bytes each must have. */
const NEEDED = { head: 54, hhea: 36, 'OS/2': 78, cmap: 4, hmtx: 1 } as const;
type Needed = keyof typeof NEEDED;

const WOFF2_HEADER = 48;
const HEAD_MAGIC = 0x5f0f3cf5;
/** The most a WOFF2's tables may decompress to: far past any subset, short of a decompression bomb. */
const MAX_TABLE_BYTES = 64 * 1024 * 1024;

/**
 * How often each character the width is measured by occurs in English
 * text: the letters' frequencies (Lewand, "Cryptological Mathematics",
 * 2000), in percent of letters, and the space at 18, about one character in
 * 6.5, for words of 4.7 letters on average. Sized by these, Geist's latin
 * subset measures 473.33/1000, Arial 915.39/2048, and Times New Roman
 * 829.61/2048, within 1.5% of the frequency-weighted averages capsize
 * publishes (467, 913, and 832), and the fixture's size-adjust is 105.90%,
 * within 1.1% of the 104.76% capsize's figures give (font-metrics.test.ts).
 */
export const LATIN_WEIGHTS: Readonly<Record<string, number>> = {
  ' ': 18,
  a: 8.167, b: 1.492, c: 2.782, d: 4.253, e: 12.702, f: 2.228, g: 2.015, h: 6.094, i: 6.966,
  j: 0.153, k: 0.772, l: 4.025, m: 2.406, n: 6.749, o: 7.507, p: 1.929, q: 0.095, r: 5.987,
  s: 6.327, t: 9.056, u: 2.758, v: 0.978, w: 2.36, x: 0.15, y: 1.974, z: 0.074,
}; // prettier-ignore

/** A font's tables by tag, and the tags WOFF2 stored transformed. */
interface Tables {
  readonly tables: Map<string, Uint8Array>;
  readonly transformed: ReadonlySet<string>;
}

const tagAt = (view: DataView, at: number) =>
  String.fromCharCode(
    view.getUint8(at),
    view.getUint8(at + 1),
    view.getUint8(at + 2),
    view.getUint8(at + 3),
  );

/**
 * Reads `bytes`, a WOFF2 file or a TrueType or OpenType one, for the
 * metrics a fallback face is matched to. `name` is how an error names it.
 * `wght` measures a variable font's widths at that weight, through its fvar,
 * avar, and HVAR tables, as a heading at 800 renders; a static font, or one
 * with no HVAR, is measured as it is. Throws a FontMetricsError naming
 * what's wrong.
 */
export function readFontMetrics(
  bytes: Uint8Array,
  name = 'The font',
  options: { readonly fullName?: string; readonly wght?: number; readonly opsz?: number } = {},
): FontMetrics {
  if (bytes.length < 12)
    throw new FontMetricsError(name, `it's ${bytes.length} bytes, too short to be a font.`);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const signature = tagAt(view, 0);
  // A TrueType collection, as macOS ships Helvetica Neue and Palatino: the face
  // whose full name `fullName` gives, else its first. No pack ships one.
  if (signature === 'ttcf') return collectionFace(bytes, view, name, options.fullName);
  const tables =
    signature === 'wOF2'
      ? woff2Tables(bytes, view, name)
      : signature === '\0\x01\0\0' || signature === 'OTTO' || signature === 'true'
        ? sfntTables(bytes, view, name)
        : null;
  if (!tables) {
    throw new FontMetricsError(
      name,
      `its first bytes aren't WOFF2's wOF2 or a TrueType or OpenType signature${signature === 'wOFF' ? ' (it is WOFF 1.0, which no pack ships)' : ''}.`,
    );
  }
  return metricsOf(tables, name, options.wght, options.opsz);
}

/**
 * Which of `points` a WOFF2 or sfnt font's cmap maps to a glyph, so a
 * compiled unicode-range can send a code point to the subset that draws it
 * (review L-1). A collection isn't read: no pack ships one.
 */
export function mappedCodePoints(
  bytes: Uint8Array,
  points: readonly number[],
  name = 'The font',
): ReadonlySet<number> {
  if (bytes.length < 12)
    throw new FontMetricsError(name, `it's ${bytes.length} bytes, too short to be a font.`);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const signature = tagAt(view, 0);
  const tables =
    signature === 'wOF2'
      ? woff2Tables(bytes, view, name)
      : signature === '\0\x01\0\0' || signature === 'OTTO' || signature === 'true'
        ? sfntTables(bytes, view, name)
        : null;
  const cmap = tables?.tables.get('cmap');
  if (!cmap) throw new FontMetricsError(name, 'it has no cmap to read.');
  const glyphs = glyphIds(viewOf(cmap), points, name);
  return new Set(points.filter((_, index) => glyphs[index]! > 0));
}

function collectionFace(
  bytes: Uint8Array,
  view: DataView,
  name: string,
  fullName: string | undefined,
): FontMetrics {
  const count = view.getUint32(8);
  if (count === 0 || 12 + count * 4 > bytes.length) {
    throw new FontMetricsError(name, 'its collection header is cut short.');
  }
  const faces: FontMetrics[] = [];
  for (let i = 0; i < count; i += 1) {
    const offset = view.getUint32(12 + i * 4);
    if (offset + 12 > bytes.length)
      throw new FontMetricsError(name, `its face ${i} runs past its end.`);
    const face = metricsOf(sfntTables(bytes, view, name, offset), name);
    if (fullName === undefined || face.fullName === fullName) return face;
    faces.push(face);
  }
  throw new FontMetricsError(
    name,
    `it has no face named ${fullName}, only ${faces.map((face) => face.fullName).join(', ')}.`,
  );
}

/** WOFF2's UIntBase128 at `at`: its value and where the next field starts. */
function base128(bytes: Uint8Array, at: number, name: string): [number, number] {
  let value = 0;
  for (let i = 0; i < 5; i += 1) {
    if (at + i >= bytes.length)
      throw new FontMetricsError(name, 'its table directory is cut short.');
    const byte = bytes[at + i]!;
    if (i === 0 && byte === 0x80)
      throw new FontMetricsError(name, 'its table directory has a malformed length.');
    if (value & 0xfe000000)
      throw new FontMetricsError(name, 'its table directory has a length past 32 bits.');
    value = value * 128 + (byte & 0x7f);
    if ((byte & 0x80) === 0) return [value, at + i + 1];
  }
  throw new FontMetricsError(name, 'its table directory has a length longer than 5 bytes.');
}

function woff2Tables(bytes: Uint8Array, view: DataView, name: string): Tables {
  if (bytes.length < WOFF2_HEADER)
    throw new FontMetricsError(name, 'its WOFF2 header is cut short.');
  const flavor = tagAt(view, 4);
  const length = view.getUint32(8);
  const numTables = view.getUint16(12);
  const compressed = view.getUint32(20);
  if (length !== bytes.length) {
    throw new FontMetricsError(name, `its header says ${length} bytes, and it's ${bytes.length}.`);
  }
  if (flavor === 'ttcf')
    throw new FontMetricsError(name, "it's a font collection, which no pack ships.");
  if (numTables === 0) throw new FontMetricsError(name, 'its header lists no tables.');

  const entries: { tag: string; length: number; transformed: boolean }[] = [];
  let at = WOFF2_HEADER;
  for (let i = 0; i < numTables; i += 1) {
    if (at >= bytes.length) throw new FontMetricsError(name, 'its table directory is cut short.');
    const flags = bytes[at]!;
    at += 1;
    const index = flags & 0x3f;
    let tag: string;
    if (index === 63) {
      if (at + 4 > bytes.length)
        throw new FontMetricsError(name, 'its table directory is cut short.');
      tag = tagAt(view, at);
      at += 4;
    } else {
      const known = KNOWN_TAGS[index];
      if (!known)
        throw new FontMetricsError(
          name,
          `its table directory names table index ${index}, which WOFF2 doesn't define.`,
        );
      tag = known;
    }
    const version = flags >> 6;
    let origLength: number;
    [origLength, at] = base128(bytes, at, name);
    // glyf and loca are transformed at version 0; every other table at any version but 0.
    const transformed = tag === 'glyf' || tag === 'loca' ? version === 0 : version !== 0;
    let stored = origLength;
    if (transformed) [stored, at] = base128(bytes, at, name);
    entries.push({ tag, length: stored, transformed });
  }
  if (at + compressed > bytes.length) {
    throw new FontMetricsError(
      name,
      `its compressed tables run past its end (${compressed} bytes from ${at}).`,
    );
  }
  const expected = entries.reduce((sum, entry) => sum + entry.length, 0);
  if (expected > MAX_TABLE_BYTES) {
    throw new FontMetricsError(
      name,
      `its directory says its tables take ${expected} bytes, past the ${MAX_TABLE_BYTES} a font may.`,
    );
  }
  let stream: Buffer;
  try {
    // No more than the directory says: a stream that would decompress past it is refused, not expanded.
    stream = brotliDecompressSync(bytes.subarray(at, at + compressed), {
      maxOutputLength: Math.max(1, expected),
    });
  } catch (error) {
    throw new FontMetricsError(
      name,
      `its tables don't decompress as Brotli (${(error as Error).message}).`,
    );
  }
  const tables = new Map<string, Uint8Array>();
  const transformed = new Set<string>();
  let offset = 0;
  for (const entry of entries) {
    if (offset + entry.length > stream.length) {
      throw new FontMetricsError(
        name,
        `its ${entry.tag.trim()} table runs past its decompressed tables.`,
      );
    }
    tables.set(entry.tag, stream.subarray(offset, offset + entry.length));
    if (entry.transformed) transformed.add(entry.tag);
    offset += entry.length;
  }
  return { tables, transformed };
}

/** An sfnt's tables, from its offset table at `start`: 0, or a collection face's. Table offsets count from the file's start. */
function sfntTables(bytes: Uint8Array, view: DataView, name: string, start = 0): Tables {
  const numTables = view.getUint16(start + 4);
  if (start + 12 + numTables * 16 > bytes.length)
    throw new FontMetricsError(name, 'its table directory is cut short.');
  const tables = new Map<string, Uint8Array>();
  for (let i = 0; i < numTables; i += 1) {
    const record = start + 12 + i * 16;
    const tag = tagAt(view, record);
    const offset = view.getUint32(record + 8);
    const length = view.getUint32(record + 12);
    if (offset + length > bytes.length) {
      throw new FontMetricsError(name, `its ${tag.trim()} table runs past its end.`);
    }
    tables.set(tag, bytes.subarray(offset, offset + length));
  }
  return { tables, transformed: new Set() };
}

/** The glyph id `cmap` maps each of `points` to, 0 for none, from its format 12 or format 4 Unicode subtable. */
function glyphIds(cmap: DataView, points: readonly number[], name: string): number[] {
  const count = cmap.getUint16(2);
  if (4 + count * 8 > cmap.byteLength) throw new FontMetricsError(name, 'its cmap is cut short.');
  const found: { format: number; offset: number }[] = [];
  for (let i = 0; i < count; i += 1) {
    const platform = cmap.getUint16(4 + i * 8);
    const encoding = cmap.getUint16(6 + i * 8);
    const offset = cmap.getUint32(8 + i * 8);
    // Unicode: platform 0, or Windows' BMP (1) and full repertoire (10).
    if (!(platform === 0 || (platform === 3 && (encoding === 1 || encoding === 10)))) continue;
    if (offset + 2 > cmap.byteLength) throw new FontMetricsError(name, 'its cmap is cut short.');
    found.push({ format: cmap.getUint16(offset), offset });
  }
  const subtable =
    found.find(({ format }) => format === 12) ?? found.find(({ format }) => format === 4);
  if (!subtable) {
    throw new FontMetricsError(name, 'its cmap has no Unicode subtable of format 4 or 12.');
  }
  const at = subtable.offset;
  const u16 = (offset: number) => {
    if (offset + 2 > cmap.byteLength) throw new FontMetricsError(name, 'its cmap is cut short.');
    return cmap.getUint16(offset);
  };
  const u32 = (offset: number) => {
    if (offset + 4 > cmap.byteLength) throw new FontMetricsError(name, 'its cmap is cut short.');
    return cmap.getUint32(offset);
  };
  if (subtable.format === 12) {
    const groups = u32(at + 12);
    return points.map((point) => {
      for (let i = 0; i < groups; i += 1) {
        const group = at + 16 + i * 12;
        const start = u32(group);
        const end = u32(group + 4);
        if (point >= start && point <= end) return u32(group + 8) + (point - start);
      }
      return 0;
    });
  }
  const segments = u16(at + 6) / 2;
  const ends = at + 14;
  const starts = ends + segments * 2 + 2;
  const deltas = starts + segments * 2;
  const ranges = deltas + segments * 2;
  return points.map((point) => {
    for (let i = 0; i < segments; i += 1) {
      if (point > u16(ends + i * 2)) continue;
      const start = u16(starts + i * 2);
      if (point < start) return 0;
      const delta = u16(deltas + i * 2);
      const range = u16(ranges + i * 2);
      if (range === 0) return (point + delta) & 0xffff;
      const glyph = u16(ranges + i * 2 + range + (point - start) * 2);
      return glyph === 0 ? 0 : (glyph + delta) & 0xffff;
    }
    return 0;
  });
}

/**
 * The frequency-weighted advance of LATIN_WEIGHTS' characters, from cmap
 * and hmtx, or null when the font doesn't map every one of them. A WOFF2
 * transformed hmtx holds its advances after one flags byte.
 */
function latinWidth(
  cmap: DataView,
  hmtx: DataView,
  metricsCount: number,
  transformed: boolean,
  name: string,
  delta: (glyph: number) => number = () => 0,
): number | null {
  const characters = Object.keys(LATIN_WEIGHTS);
  const glyphs = glyphIds(
    cmap,
    characters.map((character) => character.codePointAt(0)!),
    name,
  );
  if (glyphs.some((glyph) => glyph === 0)) return null;
  if (metricsCount === 0) throw new FontMetricsError(name, 'its hhea lists no horizontal metrics.');
  const base = transformed ? 1 : 0;
  const stride = transformed ? 2 : 4;
  const advance = (glyph: number) => {
    const at = base + Math.min(glyph, metricsCount - 1) * stride;
    if (at + 2 > hmtx.byteLength) {
      throw new FontMetricsError(name, `its hmtx is cut short of glyph ${glyph}'s advance.`);
    }
    return hmtx.getUint16(at);
  };
  let sum = 0;
  let weights = 0;
  characters.forEach((character, index) => {
    sum += (advance(glyphs[index]!) + delta(glyphs[index]!)) * LATIN_WEIGHTS[character]!;
    weights += LATIN_WEIGHTS[character]!;
  });
  return sum / weights;
}

/**
 * The name table's full name (name ID 4), from a Windows Unicode record, or
 * a Macintosh Roman one, in English where it has one. Null with no name
 * table or no full name: the reader never needs it but to pick a face out
 * of a collection.
 */
function fullNameOf(table: Uint8Array | undefined): string | null {
  if (!table || table.length < 6) return null;
  const view = new DataView(table.buffer, table.byteOffset, table.byteLength);
  const count = view.getUint16(2);
  const strings = view.getUint16(4);
  let best: { rank: number; text: string } | null = null;
  for (let i = 0; i < count; i += 1) {
    const record = 6 + i * 12;
    if (record + 12 > table.length) break;
    const platform = view.getUint16(record);
    const language = view.getUint16(record + 4);
    if (view.getUint16(record + 6) !== 4) continue;
    const length = view.getUint16(record + 8);
    const at = strings + view.getUint16(record + 10);
    if (at + length > table.length) continue;
    const raw = table.subarray(at, at + length);
    let text: string;
    let rank: number;
    if (platform === 3 || platform === 0) {
      text = String.fromCharCode(
        ...Array.from({ length: length >> 1 }, (_, j) => (raw[j * 2]! << 8) | raw[j * 2 + 1]!),
      );
      rank = platform === 3 && language === 0x409 ? 0 : 1;
    } else if (platform === 1) {
      text = String.fromCharCode(...raw);
      rank = language === 0 ? 2 : 3;
    } else continue;
    if (!best || rank < best.rank) best = { rank, text };
  }
  return best?.text ?? null;
}

/** Printable Basic Latin: U+0020 to U+007E, which a face's declared range is held to its cmap over. */
export const BASIC_LATIN: readonly [number, number] = [0x20, 0x7e];

/**
 * What a Latin page's text is made of, for a gate with no text of its own
 * to read: printable Basic Latin, Latin-1's letters and signs (U+00A0 to
 * U+00FF), the hyphen, dashes, curly quotes, bullet, and ellipsis of
 * General Punctuation, the euro sign, and the trade mark sign: text points
 * of Google Fonts' latin subset. A face whose range meets any of them is one
 * a Latin page may load (review R3-L1). They're points, not all of U+2010 to
 * U+2027, since Google's latin-ext range names U+2020, the dagger, which an
 * ordinary page never sets.
 */
export const LATIN_PAGE: readonly (readonly [number, number])[] = [
  BASIC_LATIN,
  [0xa0, 0xff],
  [0x2010, 0x2010],
  [0x2013, 0x2014],
  [0x2018, 0x2019],
  [0x201c, 0x201d],
  [0x2022, 0x2022],
  [0x2026, 0x2026],
  [0x20ac, 0x20ac],
  [0x2122, 0x2122],
];

function mappedBasicLatin(cmap: DataView, name: string): number[] {
  const points = Array.from(
    { length: BASIC_LATIN[1] - BASIC_LATIN[0] + 1 },
    (_, i) => BASIC_LATIN[0] + i,
  );
  const glyphs = glyphIds(cmap, points, name);
  return points.filter((_, i) => glyphs[i] !== 0);
}

const viewOf = (table: Uint8Array) =>
  new DataView(table.buffer, table.byteOffset, table.byteLength);

/** fvar's wght axis, in user units, or null when the font has no fvar or no wght axis. */
function axisOf(
  fvar: Uint8Array | undefined,
  name: string,
  tag: 'wght' | 'opsz',
): { min: number; default: number; max: number; index: number; count: number } | null {
  if (!fvar || fvar.length < 16) return null;
  const view = viewOf(fvar);
  const offset = view.getUint16(4);
  const count = view.getUint16(8);
  const size = view.getUint16(10);
  if (size < 20 || offset + count * size > fvar.length)
    throw new FontMetricsError(name, 'its fvar table is cut short.');
  for (let i = 0; i < count; i += 1) {
    const at = offset + i * size;
    if (tagAt(view, at) !== tag) continue;
    const fixed = (where: number) => view.getInt32(where) / 65536;
    return { min: fixed(at + 4), default: fixed(at + 8), max: fixed(at + 12), index: i, count };
  }
  return null;
}

/** `value` normalized to -1..1 on the axis, then through avar's segment map for it, if any (OpenType 1.9 avar 1). */
function normalized(
  value: number,
  axis: { min: number; default: number; max: number; index: number },
  avar: Uint8Array | undefined,
  name: string,
): number {
  const v = Math.min(axis.max, Math.max(axis.min, value));
  let n =
    v < axis.default
      ? (v - axis.default) / (axis.default - axis.min)
      : v > axis.default
        ? (v - axis.default) / (axis.max - axis.default)
        : 0;
  if (avar && avar.length >= 8) {
    const view = viewOf(avar);
    let at = 8;
    const axes = view.getUint16(6);
    for (let i = 0; i < axes; i += 1) {
      if (at + 2 > avar.length) throw new FontMetricsError(name, 'its avar table is cut short.');
      const pairs = view.getUint16(at);
      at += 2;
      if (at + pairs * 4 > avar.length)
        throw new FontMetricsError(name, 'its avar table is cut short.');
      if (i === axis.index && pairs > 0) {
        const map = Array.from({ length: pairs }, (_, j) => [
          view.getInt16(at + j * 4) / 16384,
          view.getInt16(at + j * 4 + 2) / 16384,
        ]) as [number, number][];
        for (let j = 1; j < map.length; j += 1) {
          const [from0, to0] = map[j - 1]!;
          const [from1, to1] = map[j]!;
          if (n <= from1) {
            n = from1 === from0 ? to1 : to0 + ((n - from0) * (to1 - to0)) / (from1 - from0);
            break;
          }
        }
      }
      at += pairs * 4;
    }
  }
  // Coordinates are F2DOT14.
  return Math.round(n * 16384) / 16384;
}

/**
 * Each glyph's advance delta at `coords`, from HVAR's item variation store
 * (OpenType HVAR and Item Variation Store), or null when the font has no
 * HVAR to read them from.
 */
function hvarDeltas(
  hvar: Uint8Array | undefined,
  coords: readonly number[],
  name: string,
): ((glyph: number) => number) | null {
  if (!hvar || hvar.length < 20) return null;
  const view = viewOf(hvar);
  const cut = () => new FontMetricsError(name, 'its HVAR table is cut short.');
  const u16 = (at: number) => {
    if (at + 2 > hvar.length) throw cut();
    return view.getUint16(at);
  };
  const u32 = (at: number) => {
    if (at + 4 > hvar.length) throw cut();
    return view.getUint32(at);
  };
  const store = u32(4);
  const mapping = u32(8);
  if (u16(store) !== 1)
    throw new FontMetricsError(name, "its HVAR's item variation store isn't format 1.");
  // The regions, and each one's scalar at `coords`.
  const regionList = store + u32(store + 2);
  const axisCount = u16(regionList);
  const regionCount = u16(regionList + 2);
  const scalars = Array.from({ length: regionCount }, (_, r) => {
    let scalar = 1;
    for (let a = 0; a < axisCount; a += 1) {
      const at = regionList + 4 + (r * axisCount + a) * 6;
      if (at + 6 > hvar.length) throw cut();
      const [start, peak, end] = [at, at + 2, at + 4].map(
        (where) => view.getInt16(where) / 16384,
      ) as [number, number, number];
      const coord = coords[a] ?? 0;
      if (start > peak || peak > end || (start < 0 && end > 0 && peak !== 0) || peak === 0)
        continue;
      if (coord < start || coord > end) return 0;
      if (coord === peak) continue;
      scalar *= coord < peak ? (coord - start) / (peak - start) : (end - coord) / (end - peak);
    }
    return scalar;
  });
  const dataCount = u16(store + 6);
  const deltaOf = (outer: number, inner: number): number => {
    if (outer >= dataCount) return 0;
    const data = store + u32(store + 8 + outer * 4);
    const itemCount = u16(data);
    if (inner >= itemCount) return 0;
    const wordField = u16(data + 2);
    const longWords = (wordField & 0x8000) !== 0;
    const words = wordField & 0x7fff;
    const regions = u16(data + 4);
    const wide = longWords ? 4 : 2;
    const narrow = longWords ? 2 : 1;
    const rowSize = words * wide + (regions - words) * narrow;
    const row = data + 6 + regions * 2 + inner * rowSize;
    if (row + rowSize > hvar.length) throw cut();
    let total = 0;
    for (let k = 0; k < regions; k += 1) {
      const region = u16(data + 6 + k * 2);
      const at = k < words ? row + k * wide : row + words * wide + (k - words) * narrow;
      const delta =
        k < words
          ? longWords
            ? view.getInt32(at)
            : view.getInt16(at)
          : longWords
            ? view.getInt16(at)
            : view.getInt8(at);
      total += delta * (scalars[region] ?? 0);
    }
    return total;
  };
  if (mapping === 0) return (glyph) => deltaOf(0, glyph);
  // A delta-set index map: format 0 counts entries in 16 bits, format 1 in 32.
  const format = hvar[mapping];
  const entryFormat = hvar[mapping + 1];
  if (format === undefined || entryFormat === undefined) throw cut();
  const mapCount = format === 0 ? u16(mapping + 2) : u32(mapping + 2);
  const entries = mapping + (format === 0 ? 4 : 6);
  const entrySize = ((entryFormat & 0x30) >> 4) + 1;
  const innerBits = (entryFormat & 0x0f) + 1;
  return (glyph) => {
    if (mapCount === 0) return 0;
    const at = entries + Math.min(glyph, mapCount - 1) * entrySize;
    if (at + entrySize > hvar.length) throw cut();
    let entry = 0;
    for (let b = 0; b < entrySize; b += 1) entry = entry * 256 + hvar[at + b]!;
    return deltaOf(Math.floor(entry / 2 ** innerBits), entry % 2 ** innerBits);
  };
}

/**
 * The top of the x glyph, its glyf header's yMax, for a font whose OS/2
 * gives no x-height: null where it has no plain glyf and loca (a CFF font,
 * or WOFF2's transformed glyf), maps no x, or draws an empty one.
 */
function xGlyphTop(
  { tables, transformed }: Tables,
  cmap: DataView,
  head: DataView,
  name: string,
): number | null {
  const glyf = tables.get('glyf');
  const loca = tables.get('loca');
  if (!glyf || !loca || transformed.has('glyf') || transformed.has('loca')) return null;
  const [glyph] = glyphIds(cmap, [0x78], name);
  if (!glyph) return null;
  const view = viewOf(loca);
  const long = head.getInt16(50) === 1;
  const size = long ? 4 : 2;
  if ((glyph + 2) * size > loca.byteLength)
    throw new FontMetricsError(name, 'its loca is cut short.');
  const at = (index: number) => (long ? view.getUint32(index * 4) : view.getUint16(index * 2) * 2);
  const [start, end] = [at(glyph), at(glyph + 1)];
  if (end <= start) return null;
  if (start + 10 > glyf.byteLength) throw new FontMetricsError(name, 'its glyf is cut short.');
  return viewOf(glyf).getInt16(start + 8);
}

function metricsOf(
  { tables, transformed }: Tables,
  name: string,
  wght?: number,
  opsz?: number,
): FontMetrics {
  const views = {} as Record<Needed, DataView>;
  for (const tag of Object.keys(NEEDED) as Needed[]) {
    const table = tables.get(tag);
    if (!table) throw new FontMetricsError(name, `it has no ${tag} table.`);
    if (table.length < NEEDED[tag]) {
      throw new FontMetricsError(
        name,
        `its ${tag} table is ${table.length} bytes, under the ${NEEDED[tag]} it needs.`,
      );
    }
    views[tag] = new DataView(table.buffer, table.byteOffset, table.byteLength);
  }
  const head = views.head;
  if (head.getUint32(12) !== HEAD_MAGIC)
    throw new FontMetricsError(name, "its head table's magic number is wrong.");
  const unitsPerEm = head.getUint16(18);
  if (unitsPerEm < 16 || unitsPerEm > 16384) {
    throw new FontMetricsError(
      name,
      `its unitsPerEm is ${unitsPerEm}, outside the 16 to 16384 a font may have.`,
    );
  }
  const hhea = views.hhea;
  const os2 = views['OS/2'];
  const version = os2.getUint16(0);
  // A variable font at `wght`: HVAR's advance deltas there, on fvar's axes, all others at their default.
  // An optical-size axis is set where the text renders, as font-optical-sizing: auto does.
  const axis = axisOf(tables.get('fvar'), name, 'wght');
  const optical = axisOf(tables.get('fvar'), name, 'opsz');
  let delta: ((glyph: number) => number) | undefined;
  let instance: number | null = null;
  if ((axis && wght !== undefined) || (optical && opsz !== undefined)) {
    const at = axis && wght !== undefined ? Math.min(axis.max, Math.max(axis.min, wght)) : null;
    const size =
      optical && opsz !== undefined ? Math.min(optical.max, Math.max(optical.min, opsz)) : null;
    const count = (axis ?? optical)!.count;
    const coords = Array.from({ length: count }, (_, i) =>
      axis && at !== null && i === axis.index
        ? normalized(at, axis, tables.get('avar'), name)
        : optical && size !== null && i === optical.index
          ? normalized(size, optical, tables.get('avar'), name)
          : 0,
    );
    const deltas = hvarDeltas(tables.get('HVAR'), coords, name);
    if (deltas && coords.some((coord) => coord !== 0)) {
      delta = deltas;
      instance = at !== null && at !== axis!.default ? at : null;
    }
  }
  return {
    unitsPerEm,
    hhea: { ascender: hhea.getInt16(4), descender: hhea.getInt16(6), lineGap: hhea.getInt16(8) },
    typo: { ascender: os2.getInt16(68), descender: os2.getInt16(70), lineGap: os2.getInt16(72) },
    xAvgCharWidth: os2.getInt16(2),
    latinWidth: latinWidth(
      views.cmap,
      views.hmtx,
      hhea.getUint16(34),
      transformed.has('hmtx'),
      name,
      delta,
    ),
    basicLatin: mappedBasicLatin(views.cmap, name),
    xHeight:
      version >= 2 && os2.byteLength >= 90 && os2.getInt16(86) > 0
        ? os2.getInt16(86)
        : xGlyphTop({ tables, transformed }, views.cmap, head, name),
    capHeight: version >= 2 && os2.byteLength >= 90 ? os2.getInt16(88) : null,
    fullName: fullNameOf(tables.get('name')),
    useTypoMetrics: (os2.getUint16(62) & 0x80) !== 0,
    weightAxis: axis ? { min: axis.min, default: axis.default, max: axis.max } : null,
    instance,
  };
}

/** A font's class: the system faces its fallbacks are chosen from. */
export type FontClass = 'sans' | 'serif' | 'mono';

/** A local system face a fallback face can stand on, with its own metrics. */
export interface SystemFont {
  /** Its name, as the table and the docs give it. */
  readonly name: string;
  readonly class: FontClass;
  /** Where it was measured on macOS, and the face's full name in a collection. */
  readonly file: string;
  readonly fullName?: string;
  /** The names local() takes for it on macOS. */
  readonly mac: readonly string[];
  /**
   * The names it goes by on Windows and Linux: the face itself where
   * Windows ships it, then its metric-compatible clones, such as Liberation
   * Sans and Arimo for Arial. Empty for a face only macOS has.
   */
  readonly elsewhere: readonly string[];
  /** Its unitsPerEm, its latinWidth measured as a webfont's is, and its x-height, in its units. */
  readonly metrics: SystemMetrics;
  /**
   * Its bold, italic, and bold italic faces, each measured from its own file
   * the same way, for the fallback faces of a heading at 600 or more, or of
   * an italic family. One that's missing falls back to the face nearest it.
   */
  readonly bold?: SystemFace;
  /**
   * Its semibold upright, where it has one, for the fallback faces of a
   * heading at 600 to 699: Avenir Next's Demi Bold, so Space Grotesk at 600
   * doesn't fall back to a bolder 700. Without one, those take `bold`.
   */
  readonly semibold?: SystemFace;
  /**
   * Its medium upright, where it has one, for the fallback faces of upright
   * text at 500 to 599: Helvetica Neue's Medium, so Inter at 500 doesn't
   * fall back to the lighter Regular. Without one, those take the regular.
   */
  readonly medium?: SystemFace;
  readonly italic?: SystemFace;
  readonly boldItalic?: SystemFace;
}

export interface SystemMetrics {
  readonly unitsPerEm: number;
  readonly latinWidth: number;
  readonly xHeight: number;
}

/** One of a system font's other faces: where it was measured, its local() names, and its metrics. */
export interface SystemFace {
  readonly file: string;
  readonly fullName?: string;
  readonly mac: readonly string[];
  readonly elsewhere: readonly string[];
  readonly metrics: SystemMetrics;
}

/**
 * The face of `font` a fallback at `bold` and `italic` stands on: the
 * variant, else the nearest one it has. An upright `semibold`, text at 600
 * to 699, takes the semibold where the font has one, and an upright
 * `medium`, text at 500 to 599, the medium.
 */
export function systemVariant(
  font: SystemFont,
  {
    bold,
    italic,
    semibold = false,
    medium = false,
  }: {
    readonly bold: boolean;
    readonly italic: boolean;
    readonly semibold?: boolean;
    readonly medium?: boolean;
  },
): SystemFace {
  const regular: SystemFace = font;
  if (bold && italic) return font.boldItalic ?? font.bold ?? font.italic ?? regular;
  if (bold && semibold && font.semibold) return font.semibold;
  if (bold) return font.bold ?? regular;
  if (italic) return font.italic ?? regular;
  if (medium && font.medium) return font.medium;
  return regular;
}

const SUPPLEMENTAL = '/System/Library/Fonts/Supplemental/';
const FONTS = '/System/Library/Fonts/';

/**
 * The system faces fallbacks are chosen from (packs-plan §3.4), by class.
 *
 * Method: readFontMetrics() over the regular face of each file below, on
 * this Mac (macOS, 2026-10-25), once, so each latinWidth is measured exactly
 * as a webfont's is (LATIN_WEIGHTS through cmap and hmtx), rounded to two
 * places, and each xHeight is OS/2's sxHeight. In font units:
 *
 * | Face | File | unitsPerEm | latinWidth | xHeight |
 * | --- | --- | --- | --- | --- |
 * | Helvetica Neue | HelveticaNeue.ttc, "Helvetica Neue" | 1000 | 452.76 | 517 |
 * | Arial | Supplemental/Arial.ttf | 2048 | 915.39 | 1062 |
 * | Avenir Next | Avenir Next.ttc, "Avenir Next Regular" | 1000 | 461.96 | 468 |
 * | Tahoma | Supplemental/Tahoma.ttf | 2048 | 921.14 | 1117 |
 * | Verdana | Supplemental/Verdana.ttf | 2048 | 1052.62 | 1117 |
 * | Georgia | Supplemental/Georgia.ttf | 2048 | 912.94 | 986 |
 * | Palatino | Palatino.ttc, "Palatino" | 2048 | 922.62 | 965 |
 * | Times New Roman | Supplemental/Times New Roman.ttf | 2048 | 829.61 | 916 |
 * | Menlo | Menlo.ttc, "Menlo Regular" | 2048 | 1233 | 1120 |
 * | Courier New | Supplemental/Courier New.ttf | 2048 | 1229 | 866 |
 *
 * They agree with packs-plan's font-metrics.json within 0.2%.
 * font-metrics.test.ts measures each file again wherever it's installed.
 *
 * Each face's bold, italic, and bold italic (2026-10-26, the same method,
 * each from its own file or collection face; latinWidth, then xHeight):
 *
 * | Face | Bold | Italic | Bold italic |
 * | --- | --- | --- | --- |
 * | Helvetica Neue | 484.13, 517 | 449.71, 517 | 485.66, 517 |
 * | Arial | 991.30, 1062 | 915.39, 1062 | 991.30, 1062 |
 * | Avenir Next | 493.80, 498 | 456.71, 468 | 488.68, 498 |
 * | Tahoma | 1049.75, 1123 | none | none |
 * | Verdana | 1177.49, 1123 | 1052.48, 1117 | 1177.35, 1123 |
 * | Georgia | 1065.35, 992 | 932.50, 1009 | 1087.77, 1015 |
 * | Palatino | 951.16, 965 | 828.33, 976 | 925.65, 977 |
 * | Times New Roman | 883.73, 935 | 832.84, 881 | 853.40, 899 |
 * | Menlo | 1233, 1120 | 1233, 1120 | 1233, 1120 |
 * | Courier New | 1229, 908 | 1229, 866 | 1229, 908 |
 *
 * Avenir Next also has its Demi Bold, the one semibold here, measured the
 * same way from its collection face "Avenir Next Demi Bold" (2026-10-26):
 * 469.28, 498. It stands under 600 to 699, where Space Grotesk's 600
 * headings were falling back to the heavier Bold. Helvetica Neue has its
 * Medium, the one medium, from its collection face "Helvetica Neue Medium"
 * (2026-10-26, the same way): 468.56, 517. It stands under upright 500 to
 * 599, where Inter's 500 quotes and captions were falling back to the
 * lighter Regular.
 *
 * Their elsewhere names are the same faces' on Windows and their metric
 * clones' bold and italic (Liberation, Arimo, Tinos, Cousine, DejaVu, TeX
 * Gyre Pagella, Gelasio), which keep the regular's metrics compatibility.
 *
 * Every name in `mac` resolves through local() in Chromium on a stock
 * macOS (checked 2026-10-26). SF Mono isn't here, though it fits IBM Plex
 * Mono best: macOS keeps it as a hidden system face, ".SF NS Mono", which
 * local() can't reach, and "SF Mono Regular" or "SFMono-Regular" resolve
 * only where someone installed Apple's download. Menlo does resolve, so
 * a mono fallback is Menlo on macOS. So does every bold, italic, and bold
 * italic name in `mac` (checked 2026-10-26, 56 names), and Helvetica Neue
 * Medium's two, "Helvetica Neue Medium" and "HelveticaNeue-Medium" (the same day).
 */
export const SYSTEM_FONTS: readonly SystemFont[] = [
  {
    name: 'Helvetica Neue',
    class: 'sans',
    file: `${FONTS}HelveticaNeue.ttc`,
    fullName: 'Helvetica Neue',
    mac: ['Helvetica Neue', 'HelveticaNeue'],
    elsewhere: [],
    metrics: { unitsPerEm: 1000, latinWidth: 452.76, xHeight: 517 },
    medium: {
      file: `${FONTS}HelveticaNeue.ttc`,
      fullName: 'Helvetica Neue Medium',
      mac: ['Helvetica Neue Medium', 'HelveticaNeue-Medium'],
      elsewhere: [],
      metrics: { unitsPerEm: 1000, latinWidth: 468.56, xHeight: 517 },
    },
    bold: {
      file: `${FONTS}HelveticaNeue.ttc`,
      fullName: 'Helvetica Neue Bold',
      mac: ['Helvetica Neue Bold', 'HelveticaNeue-Bold'],
      elsewhere: [],
      metrics: { unitsPerEm: 1000, latinWidth: 484.13, xHeight: 517 },
    },
    italic: {
      file: `${FONTS}HelveticaNeue.ttc`,
      fullName: 'Helvetica Neue Italic',
      mac: ['Helvetica Neue Italic', 'HelveticaNeue-Italic'],
      elsewhere: [],
      metrics: { unitsPerEm: 1000, latinWidth: 449.71, xHeight: 517 },
    },
    boldItalic: {
      file: `${FONTS}HelveticaNeue.ttc`,
      fullName: 'Helvetica Neue Bold Italic',
      mac: ['Helvetica Neue Bold Italic', 'HelveticaNeue-BoldItalic'],
      elsewhere: [],
      metrics: { unitsPerEm: 1000, latinWidth: 485.66, xHeight: 517 },
    },
  },
  {
    name: 'Arial',
    class: 'sans',
    file: `${SUPPLEMENTAL}Arial.ttf`,
    mac: ['Arial', 'ArialMT'],
    elsewhere: ['Arial', 'ArialMT', 'Liberation Sans', 'Arimo'],
    metrics: { unitsPerEm: 2048, latinWidth: 915.39, xHeight: 1062 },
    bold: {
      file: `${SUPPLEMENTAL}Arial Bold.ttf`,
      mac: ['Arial Bold', 'Arial-BoldMT'],
      elsewhere: ['Arial Bold', 'Arial-BoldMT', 'Liberation Sans Bold', 'Arimo Bold'],
      metrics: { unitsPerEm: 2048, latinWidth: 991.3, xHeight: 1062 },
    },
    italic: {
      file: `${SUPPLEMENTAL}Arial Italic.ttf`,
      mac: ['Arial Italic', 'Arial-ItalicMT'],
      elsewhere: ['Arial Italic', 'Arial-ItalicMT', 'Liberation Sans Italic', 'Arimo Italic'],
      metrics: { unitsPerEm: 2048, latinWidth: 915.39, xHeight: 1062 },
    },
    boldItalic: {
      file: `${SUPPLEMENTAL}Arial Bold Italic.ttf`,
      mac: ['Arial Bold Italic', 'Arial-BoldItalicMT'],
      elsewhere: [
        'Arial Bold Italic',
        'Arial-BoldItalicMT',
        'Liberation Sans Bold Italic',
        'Arimo Bold Italic',
      ],
      metrics: { unitsPerEm: 2048, latinWidth: 991.3, xHeight: 1062 },
    },
  },
  {
    name: 'Avenir Next',
    class: 'sans',
    file: `${FONTS}Avenir Next.ttc`,
    fullName: 'Avenir Next Regular',
    mac: ['Avenir Next Regular', 'AvenirNext-Regular'],
    elsewhere: [],
    metrics: { unitsPerEm: 1000, latinWidth: 461.96, xHeight: 468 },
    semibold: {
      file: `${FONTS}Avenir Next.ttc`,
      fullName: 'Avenir Next Demi Bold',
      mac: ['Avenir Next Demi Bold', 'AvenirNext-DemiBold'],
      elsewhere: [],
      metrics: { unitsPerEm: 1000, latinWidth: 469.28, xHeight: 498 },
    },
    bold: {
      file: `${FONTS}Avenir Next.ttc`,
      fullName: 'Avenir Next Bold',
      mac: ['Avenir Next Bold', 'AvenirNext-Bold'],
      elsewhere: [],
      metrics: { unitsPerEm: 1000, latinWidth: 493.8, xHeight: 498 },
    },
    italic: {
      file: `${FONTS}Avenir Next.ttc`,
      fullName: 'Avenir Next Italic',
      mac: ['Avenir Next Italic', 'AvenirNext-Italic'],
      elsewhere: [],
      metrics: { unitsPerEm: 1000, latinWidth: 456.71, xHeight: 468 },
    },
    boldItalic: {
      file: `${FONTS}Avenir Next.ttc`,
      fullName: 'Avenir Next Bold Italic',
      mac: ['Avenir Next Bold Italic', 'AvenirNext-BoldItalic'],
      elsewhere: [],
      metrics: { unitsPerEm: 1000, latinWidth: 488.68, xHeight: 498 },
    },
  },
  {
    name: 'Tahoma',
    class: 'sans',
    file: `${SUPPLEMENTAL}Tahoma.ttf`,
    mac: ['Tahoma'],
    elsewhere: ['Tahoma'],
    metrics: { unitsPerEm: 2048, latinWidth: 921.14, xHeight: 1117 },
    // Tahoma has no italic: an italic fallback over it is the browser's slant of the upright.
    bold: {
      file: `${SUPPLEMENTAL}Tahoma Bold.ttf`,
      mac: ['Tahoma Bold', 'Tahoma-Bold'],
      elsewhere: ['Tahoma Bold', 'Tahoma-Bold'],
      metrics: { unitsPerEm: 2048, latinWidth: 1049.75, xHeight: 1123 },
    },
  },
  {
    name: 'Verdana',
    class: 'sans',
    file: `${SUPPLEMENTAL}Verdana.ttf`,
    mac: ['Verdana'],
    elsewhere: ['Verdana'],
    metrics: { unitsPerEm: 2048, latinWidth: 1052.62, xHeight: 1117 },
    bold: {
      file: `${SUPPLEMENTAL}Verdana Bold.ttf`,
      mac: ['Verdana Bold', 'Verdana-Bold'],
      elsewhere: ['Verdana Bold', 'Verdana-Bold'],
      metrics: { unitsPerEm: 2048, latinWidth: 1177.49, xHeight: 1123 },
    },
    italic: {
      file: `${SUPPLEMENTAL}Verdana Italic.ttf`,
      mac: ['Verdana Italic', 'Verdana-Italic'],
      elsewhere: ['Verdana Italic', 'Verdana-Italic'],
      metrics: { unitsPerEm: 2048, latinWidth: 1052.48, xHeight: 1117 },
    },
    boldItalic: {
      file: `${SUPPLEMENTAL}Verdana Bold Italic.ttf`,
      mac: ['Verdana Bold Italic', 'Verdana-BoldItalic'],
      elsewhere: ['Verdana Bold Italic', 'Verdana-BoldItalic'],
      metrics: { unitsPerEm: 2048, latinWidth: 1177.35, xHeight: 1123 },
    },
  },
  {
    name: 'Georgia',
    class: 'serif',
    file: `${SUPPLEMENTAL}Georgia.ttf`,
    mac: ['Georgia'],
    elsewhere: ['Georgia', 'Gelasio'],
    metrics: { unitsPerEm: 2048, latinWidth: 912.94, xHeight: 986 },
    bold: {
      file: `${SUPPLEMENTAL}Georgia Bold.ttf`,
      mac: ['Georgia Bold', 'Georgia-Bold'],
      elsewhere: ['Georgia Bold', 'Georgia-Bold', 'Gelasio Bold', 'Gelasio-Bold'],
      metrics: { unitsPerEm: 2048, latinWidth: 1065.35, xHeight: 992 },
    },
    italic: {
      file: `${SUPPLEMENTAL}Georgia Italic.ttf`,
      mac: ['Georgia Italic', 'Georgia-Italic'],
      elsewhere: ['Georgia Italic', 'Georgia-Italic', 'Gelasio Italic', 'Gelasio-Italic'],
      metrics: { unitsPerEm: 2048, latinWidth: 932.5, xHeight: 1009 },
    },
    boldItalic: {
      file: `${SUPPLEMENTAL}Georgia Bold Italic.ttf`,
      mac: ['Georgia Bold Italic', 'Georgia-BoldItalic'],
      elsewhere: [
        'Georgia Bold Italic',
        'Georgia-BoldItalic',
        'Gelasio Bold Italic',
        'Gelasio-BoldItalic',
      ],
      metrics: { unitsPerEm: 2048, latinWidth: 1087.77, xHeight: 1015 },
    },
  },
  {
    name: 'Palatino',
    class: 'serif',
    file: `${FONTS}Palatino.ttc`,
    fullName: 'Palatino',
    mac: ['Palatino', 'Palatino-Roman'],
    elsewhere: [
      'Palatino Linotype',
      'PalatinoLinotype-Roman',
      'TeX Gyre Pagella',
      'TeXGyrePagella-Regular',
    ],
    metrics: { unitsPerEm: 2048, latinWidth: 922.62, xHeight: 965 },
    bold: {
      file: `${FONTS}Palatino.ttc`,
      fullName: 'Palatino Bold',
      mac: ['Palatino Bold', 'Palatino-Bold'],
      elsewhere: [
        'Palatino Linotype Bold',
        'PalatinoLinotype-Bold',
        'TeX Gyre Pagella Bold',
        'TeXGyrePagella-Bold',
      ],
      metrics: { unitsPerEm: 2048, latinWidth: 951.16, xHeight: 965 },
    },
    italic: {
      file: `${FONTS}Palatino.ttc`,
      fullName: 'Palatino Italic',
      mac: ['Palatino Italic', 'Palatino-Italic'],
      elsewhere: [
        'Palatino Linotype Italic',
        'PalatinoLinotype-Italic',
        'TeX Gyre Pagella Italic',
        'TeXGyrePagella-Italic',
      ],
      metrics: { unitsPerEm: 2048, latinWidth: 828.33, xHeight: 976 },
    },
    boldItalic: {
      file: `${FONTS}Palatino.ttc`,
      fullName: 'Palatino Bold Italic',
      mac: ['Palatino Bold Italic', 'Palatino-BoldItalic'],
      elsewhere: [
        'Palatino Linotype Bold Italic',
        'PalatinoLinotype-BoldItalic',
        'TeX Gyre Pagella Bold Italic',
        'TeXGyrePagella-BoldItalic',
      ],
      metrics: { unitsPerEm: 2048, latinWidth: 925.65, xHeight: 977 },
    },
  },
  {
    name: 'Times New Roman',
    class: 'serif',
    file: `${SUPPLEMENTAL}Times New Roman.ttf`,
    mac: ['Times New Roman', 'TimesNewRomanPSMT'],
    elsewhere: ['Times New Roman', 'TimesNewRomanPSMT', 'Liberation Serif', 'Tinos'],
    metrics: { unitsPerEm: 2048, latinWidth: 829.61, xHeight: 916 },
    bold: {
      file: `${SUPPLEMENTAL}Times New Roman Bold.ttf`,
      mac: ['Times New Roman Bold', 'TimesNewRomanPS-BoldMT'],
      elsewhere: [
        'Times New Roman Bold',
        'TimesNewRomanPS-BoldMT',
        'Liberation Serif Bold',
        'Tinos Bold',
      ],
      metrics: { unitsPerEm: 2048, latinWidth: 883.73, xHeight: 935 },
    },
    italic: {
      file: `${SUPPLEMENTAL}Times New Roman Italic.ttf`,
      mac: ['Times New Roman Italic', 'TimesNewRomanPS-ItalicMT'],
      elsewhere: [
        'Times New Roman Italic',
        'TimesNewRomanPS-ItalicMT',
        'Liberation Serif Italic',
        'Tinos Italic',
      ],
      metrics: { unitsPerEm: 2048, latinWidth: 832.84, xHeight: 881 },
    },
    boldItalic: {
      file: `${SUPPLEMENTAL}Times New Roman Bold Italic.ttf`,
      mac: ['Times New Roman Bold Italic', 'TimesNewRomanPS-BoldItalicMT'],
      elsewhere: [
        'Times New Roman Bold Italic',
        'TimesNewRomanPS-BoldItalicMT',
        'Liberation Serif Bold Italic',
        'Tinos Bold Italic',
      ],
      metrics: { unitsPerEm: 2048, latinWidth: 853.4, xHeight: 899 },
    },
  },
  {
    name: 'Menlo',
    class: 'mono',
    file: `${FONTS}Menlo.ttc`,
    fullName: 'Menlo Regular',
    mac: ['Menlo Regular', 'Menlo-Regular'],
    // Menlo is drawn from Bitstream Vera Sans Mono, as DejaVu Sans Mono is: one set of metrics.
    elsewhere: ['DejaVu Sans Mono', 'DejaVuSansMono', 'Bitstream Vera Sans Mono'],
    metrics: { unitsPerEm: 2048, latinWidth: 1233, xHeight: 1120 },
    bold: {
      file: `${FONTS}Menlo.ttc`,
      fullName: 'Menlo Bold',
      mac: ['Menlo Bold', 'Menlo-Bold'],
      elsewhere: ['DejaVu Sans Mono Bold', 'DejaVuSansMono-Bold'],
      metrics: { unitsPerEm: 2048, latinWidth: 1233, xHeight: 1120 },
    },
    italic: {
      file: `${FONTS}Menlo.ttc`,
      fullName: 'Menlo Italic',
      mac: ['Menlo Italic', 'Menlo-Italic'],
      // DejaVu Sans Mono's italic is an oblique.
      elsewhere: ['DejaVu Sans Mono Oblique', 'DejaVuSansMono-Oblique'],
      metrics: { unitsPerEm: 2048, latinWidth: 1233, xHeight: 1120 },
    },
    boldItalic: {
      file: `${FONTS}Menlo.ttc`,
      fullName: 'Menlo Bold Italic',
      mac: ['Menlo Bold Italic', 'Menlo-BoldItalic'],
      elsewhere: ['DejaVu Sans Mono Bold Oblique', 'DejaVuSansMono-BoldOblique'],
      metrics: { unitsPerEm: 2048, latinWidth: 1233, xHeight: 1120 },
    },
  },
  {
    name: 'Courier New',
    class: 'mono',
    file: `${SUPPLEMENTAL}Courier New.ttf`,
    mac: ['Courier New', 'CourierNewPSMT'],
    elsewhere: ['Courier New', 'CourierNewPSMT', 'Liberation Mono', 'Cousine'],
    metrics: { unitsPerEm: 2048, latinWidth: 1229, xHeight: 866 },
    bold: {
      file: `${SUPPLEMENTAL}Courier New Bold.ttf`,
      mac: ['Courier New Bold', 'CourierNewPS-BoldMT'],
      elsewhere: [
        'Courier New Bold',
        'CourierNewPS-BoldMT',
        'Liberation Mono Bold',
        'Cousine Bold',
      ],
      metrics: { unitsPerEm: 2048, latinWidth: 1229, xHeight: 908 },
    },
    italic: {
      file: `${SUPPLEMENTAL}Courier New Italic.ttf`,
      mac: ['Courier New Italic', 'CourierNewPS-ItalicMT'],
      elsewhere: [
        'Courier New Italic',
        'CourierNewPS-ItalicMT',
        'Liberation Mono Italic',
        'Cousine Italic',
      ],
      metrics: { unitsPerEm: 2048, latinWidth: 1229, xHeight: 866 },
    },
    boldItalic: {
      file: `${SUPPLEMENTAL}Courier New Bold Italic.ttf`,
      mac: ['Courier New Bold Italic', 'CourierNewPS-BoldItalicMT'],
      elsewhere: [
        'Courier New Bold Italic',
        'CourierNewPS-BoldItalicMT',
        'Liberation Mono Bold Italic',
        'Cousine Bold Italic',
      ],
      metrics: { unitsPerEm: 2048, latinWidth: 1229, xHeight: 908 },
    },
  },
];

/** The system face `name` names in SYSTEM_FONTS. */
export function systemFont(name: string): SystemFont {
  const found = SYSTEM_FONTS.find((font) => font.name === name);
  if (!found) throw new Error(`No system face is named ${name}.`);
  return found;
}

/** A system face a pack's body text may render in, for its measures: the names a stack calls it by, and its width. */
export interface TextFace {
  /** The family names a font-family stack gives it by, such as `system-ui` for SF Pro. */
  readonly names: readonly string[];
  /** Where it was measured, and the collection face, for a test to measure it again. */
  readonly file: string;
  readonly fullName?: string;
  readonly unitsPerEm: number;
  /** Its latinWidth, measured as a webfont's is, at `wght` and `opsz` where it has those axes. */
  readonly latinWidth: number;
  /** Its x-height, as readFontMetrics() reads one, for the body aspect a measure is rendered at (R11.1). */
  readonly xHeight: number;
  /** For a variable face: the weight it was measured at, the body's 400. */
  readonly wght?: number;
  /**
   * For a face with an optical-size axis: the size it was measured at, the
   * one 16px body text renders in under font-optical-sizing: auto, clamped
   * to the axis, as the browser clamps it.
   */
  readonly opsz?: number;
}

/**
 * The faces whose average advance resolves an OS-stack pack's measures
 * (R11): every SYSTEM_FONTS face, by its name and its local() names, then
 * the faces an OS-stack pack's body stack lists first that no fallback is
 * chosen from. They're kept out of SYSTEM_FONTS, so they size no fallback.
 *
 * Measured like SYSTEM_FONTS, on the same Mac (macOS, 2026-10-26), once,
 * with readFontMetrics(). SF Pro, SFNS.ttf, is variable, with an optical
 * size axis from 17 to 96 that defaults to 28, its Display design; 16px
 * body text renders at opsz 17, its Text design, 14% wider, so it's measured
 * at wght 400 and opsz 17 (lead A's review, M1). Each x-height is
 * OS/2's sxHeight, or, for the three whose OS/2 is version 1, the top of
 * the x glyph in glyf (2026-10-26, R11.1). In font units:
 *
 * | Face | File | unitsPerEm | latinWidth | Per em | xHeight | Aspect |
 * | --- | --- | --- | --- | --- | --- | --- |
 * | Trebuchet MS | Supplemental/Trebuchet MS.ttf | 2048 | 939.81 | 0.4589 | 1071, the x's top | 0.523 |
 * | Charter | Supplemental/Charter.ttc, "Charter Roman" | 2048 | 909.06 | 0.4439 | 985, the x's top | 0.481 |
 * | Iowan Old Style | Supplemental/Iowan Old Style.ttc, "Iowan Old Style Roman" | 2048 | 925.86 | 0.4521 | 981, the x's top | 0.479 |
 * | SF Pro (system-ui) | SFNS.ttf, "System Font", wght 400, opsz 17 | 2048 | 980.06 | 0.4785 | 1040 | 0.508 |
 *
 * Every face is the macOS one, so on another platform a stack's first face
 * may be another one (Segoe UI for system-ui on Windows), whose width the
 * measure doesn't follow. font-metrics.test.ts measures each file again,
 * at its wght and opsz, wherever it's installed.
 */
export const TEXT_FACES: readonly TextFace[] = [
  ...SYSTEM_FONTS.map((face): TextFace => ({
    names: [...new Set([face.name, ...face.mac, ...face.elsewhere])],
    file: face.file,
    ...(face.fullName === undefined ? {} : { fullName: face.fullName }),
    unitsPerEm: face.metrics.unitsPerEm,
    latinWidth: face.metrics.latinWidth,
    xHeight: face.metrics.xHeight,
  })),
  {
    names: ['Trebuchet MS', 'TrebuchetMS'],
    file: `${SUPPLEMENTAL}Trebuchet MS.ttf`,
    unitsPerEm: 2048,
    latinWidth: 939.81,
    xHeight: 1071,
  },
  {
    names: ['Charter', 'Charter Roman'],
    file: `${SUPPLEMENTAL}Charter.ttc`,
    fullName: 'Charter Roman',
    unitsPerEm: 2048,
    latinWidth: 909.06,
    xHeight: 985,
  },
  {
    names: ['Iowan Old Style', 'Iowan Old Style Roman'],
    file: `${SUPPLEMENTAL}Iowan Old Style.ttc`,
    fullName: 'Iowan Old Style Roman',
    unitsPerEm: 2048,
    latinWidth: 925.86,
    xHeight: 981,
  },
  {
    names: ['system-ui', '-apple-system', 'BlinkMacSystemFont', 'SF Pro', 'SF Pro Text'],
    file: `${FONTS}SFNS.ttf`,
    unitsPerEm: 2048,
    latinWidth: 980.06,
    xHeight: 1040,
    wght: 400,
    opsz: 17,
  },
];

/**
 * The first face in `stack` TEXT_FACES has, with its average advance per
 * em and its aspect, its x-height per em, or null when it has none of
 * them, as a stack of webfonts alone.
 */
export function stackTextFace(
  stack: string,
): { face: TextFace; advance: number; aspect: number } | null {
  for (const entry of stack.split(',')) {
    const name = entry
      .trim()
      .replace(/^["'](.*)["']$/, '$1')
      .toLowerCase();
    const face = TEXT_FACES.find((each) => each.names.some((one) => one.toLowerCase() === name));
    if (face) {
      return {
        face,
        advance: face.latinWidth / face.unitsPerEm,
        aspect: face.xHeight / face.unitsPerEm,
      };
    }
  }
  return null;
}

/** The four faces a family has, by the style and weight text inside a role sets: 400 and 700, upright and italic. */
export type FaceKey = 'regular' | 'bold' | 'italic' | 'boldItalic';
export const FACE_KEYS: readonly FaceKey[] = ['regular', 'bold', 'italic', 'boldItalic'];

/** One face of a family a system stack leads with, as macOS installs it. */
export interface LeadingFace {
  readonly file: string;
  readonly unitsPerEm: number;
  /** Its latinWidth, measured as a webfont's is. */
  readonly latinWidth: number;
  /** hhea's ascender, descender, and line gap: what Chromium lays it out with, since its USE_TYPO_METRICS bit is clear. */
  readonly hhea: VerticalMetrics;
}

/**
 * A family a system-stack pack leads a role with, which macOS, Windows, and
 * iOS install and Linux doesn't: Ubuntu, CI's Playwright image among them,
 * renders the stack in Liberation Sans, Arial's metric clone, or in DejaVu
 * Sans. The compiler gives such a role two metric fallbacks right behind it
 * (compile.ts), sized to its faces, so text set there takes the room it
 * takes on a Mac.
 *
 * Measured with readFontMetrics() from each file below, on this Mac (macOS,
 * 2026-11-02), once; `unicodeRange` is the LATIN_PAGE code points all four
 * faces map (Verdana has no U+2010). In font units:
 *
 * | Face | latinWidth | hhea ascender, descender, line gap |
 * | --- | --- | --- |
 * | Trebuchet MS | 939.81 | 1923, -455, 0 |
 * | Trebuchet MS Bold | 981.46 | 1923, -455, 0 |
 * | Trebuchet MS Italic | 950.08 | 1923, -455, 0 |
 * | Trebuchet MS Bold Italic | 997.50 | 1923, -455, 0 |
 * | Verdana | 1052.62 | 2059, -430, 0 |
 * | Verdana Bold | 1177.49 | 2059, -430, 0 |
 * | Verdana Italic | 1052.48 | 2059, -430, 0 |
 * | Verdana Bold Italic | 1177.35 | 2059, -430, 0 |
 *
 * The fallbacks' unicode-range is that coverage, so where the family is
 * installed every code point they could draw is drawn by it first, and
 * they're never used: macOS, Windows, and iOS render as before.
 * font-metrics.test.ts measures each file again wherever it's installed.
 */
export interface LeadingFamily {
  readonly name: string;
  /** The names a font-family stack gives it by. */
  readonly names: readonly string[];
  readonly unicodeRange: string;
  readonly faces: Readonly<Record<FaceKey, LeadingFace>>;
}

const leadingFaces = (
  name: string,
  widths: readonly [number, number, number, number],
  hhea: VerticalMetrics,
): Record<FaceKey, LeadingFace> =>
  Object.fromEntries(
    FACE_KEYS.map((key, i) => [
      key,
      {
        file: `${SUPPLEMENTAL}${name}${['', ' Bold', ' Italic', ' Bold Italic'][i]}.ttf`,
        unitsPerEm: 2048,
        latinWidth: widths[i]!,
        hhea,
      },
    ]),
  ) as Record<FaceKey, LeadingFace>;

export const LEADING_FAMILIES: readonly LeadingFamily[] = [
  {
    name: 'Trebuchet MS',
    names: ['Trebuchet MS', 'TrebuchetMS'],
    unicodeRange:
      'U+0020-007E, U+00A0-00FF, U+2010, U+2013-2014, U+2018-2019, U+201C-201D, U+2022, U+2026, U+20AC, U+2122',
    faces: leadingFaces('Trebuchet MS', [939.81, 981.46, 950.08, 997.5], {
      ascender: 1923,
      descender: -455,
      lineGap: 0,
    }),
  },
  {
    name: 'Verdana',
    names: ['Verdana'],
    unicodeRange:
      'U+0020-007E, U+00A0-00FF, U+2013-2014, U+2018-2019, U+201C-201D, U+2022, U+2026, U+20AC, U+2122',
    faces: leadingFaces('Verdana', [1052.62, 1177.49, 1052.48, 1177.35], {
      ascender: 2059,
      descender: -430,
      lineGap: 0,
    }),
  },
];

/** A Linux face a leading family's fallback stands on: its four faces' local() names and metrics. */
export interface LinuxFace {
  /** The suffix of the fallback's family name: "<pack id> <family> <suffix>". */
  readonly suffix: string;
  readonly faces: Readonly<
    Record<
      FaceKey,
      { readonly name: string; readonly locals: readonly string[]; readonly metrics: SystemMetrics }
    >
  >;
}

/** Liberation Sans' face `key`: Arial's, by its clones' names first, then Arial's own. */
function liberation(key: FaceKey): LinuxFace['faces'][FaceKey] {
  const face = systemVariant(systemFont('Arial'), {
    bold: key === 'bold' || key === 'boldItalic',
    italic: key === 'italic' || key === 'boldItalic',
  });
  return {
    name: `Liberation Sans${{ regular: '', bold: ' Bold', italic: ' Italic', boldItalic: ' Bold Italic' }[key]}`,
    locals: [
      ...face.elsewhere.filter((name) => !name.startsWith('Arial')),
      ...face.elsewhere.filter((name) => name.startsWith('Arial')),
    ],
    metrics: face.metrics,
  };
}

/**
 * The faces a leading family's fallbacks stand on, in stack order. First
 * Liberation Sans, which Ubuntu installs and CI renders in, by its name and
 * its other Arial-metric names (Arimo, then Arial itself, which some Linux
 * installs add): one set of metrics, Arial's in SYSTEM_FONTS. Then DejaVu
 * Sans, where a desktop Linux has no Arial clone, as its own face, since its
 * widths aren't Arial's.
 *
 * DejaVu Sans isn't installed on macOS. It was measured with
 * readFontMetrics() from the copy of DejaVu Sans 2.35 that matplotlib
 * bundles, already on this Mac (2026-11-02), not from Ubuntu's 2.37, whose
 * Latin advances are the same design's; font-metrics.test.ts measures the
 * Linux file wherever it's installed, so a CI runner checks it. In font
 * units, at 2048 to the em: 1050.85 regular and oblique, 1187.34 bold and
 * bold oblique, x-height 1120.
 */
export const LINUX_FACES: readonly LinuxFace[] = [
  {
    suffix: 'Linux Fallback',
    faces: {
      regular: liberation('regular'),
      bold: liberation('bold'),
      italic: liberation('italic'),
      boldItalic: liberation('boldItalic'),
    },
  },
  {
    suffix: 'DejaVu Fallback',
    faces: {
      regular: {
        name: 'DejaVu Sans',
        locals: ['DejaVu Sans', 'DejaVuSans'],
        metrics: { unitsPerEm: 2048, latinWidth: 1050.85, xHeight: 1120 },
      },
      bold: {
        name: 'DejaVu Sans Bold',
        locals: ['DejaVu Sans Bold', 'DejaVuSans-Bold'],
        metrics: { unitsPerEm: 2048, latinWidth: 1187.34, xHeight: 1120 },
      },
      italic: {
        name: 'DejaVu Sans Oblique',
        locals: ['DejaVu Sans Oblique', 'DejaVuSans-Oblique'],
        metrics: { unitsPerEm: 2048, latinWidth: 1050.85, xHeight: 1120 },
      },
      boldItalic: {
        name: 'DejaVu Sans Bold Oblique',
        locals: ['DejaVu Sans Bold Oblique', 'DejaVuSans-BoldOblique'],
        metrics: { unitsPerEm: 2048, latinWidth: 1187.34, xHeight: 1120 },
      },
    },
  },
];

/**
 * The family `stack` leads with, when LEADING_FAMILIES has it and the pack
 * doesn't ship it (`shipped`, its fontAssets' families), else null. Only
 * the first entry: a family further down is reached only where the one
 * before it is missing anyway.
 */
export function leadingFamily(
  stack: string,
  shipped: readonly string[] = [],
): LeadingFamily | null {
  const first = stack
    .split(',')[0]!
    .trim()
    .replace(/^["'](.*)["']$/, '$1')
    .toLowerCase();
  if (shipped.some((family) => family.toLowerCase() === first)) return null;
  return (
    LEADING_FAMILIES.find((family) => family.names.some((name) => name.toLowerCase() === first)) ??
    null
  );
}

/** The overrides that make a Linux face take the room a leading family's face does. */
export function leadingOverrides(
  face: LeadingFace,
  system: { readonly metrics: SystemMetrics },
): FallbackOverrides {
  return fallbackOverrides({ ...face, typo: face.hhea, useTypoMetrics: false }, system)!;
}

/** One fallback alias: the system face it stands on, the local() names, its overrides, and how well it fits. */
export interface FallbackAlias {
  readonly face: SystemFont;
  /** Up to four names, as local() takes them, in order. */
  readonly locals: readonly string[];
  readonly overrides: FallbackOverrides;
  /**
   * Its width error once a composition applies font-size-adjust, which
   * scales every face to one x-height: the face's width per x-height over
   * the font's, less 1. What the alias is chosen by. Null for a font with no
   * x-height, which is chosen by `widthError` instead.
   */
  readonly xHeightWidthError: number | null;
  /** Its plain width error, the face's average width per em over the font's, less 1, which size-adjust corrects. */
  readonly widthError: number;
}

const MAX_LOCALS = 4;

/**
 * The fallback aliases for a font of class `kind`, at most two (packs-plan
 * §3.4): first the class's system face whose width fits the font's best,
 * with its macOS names; then the best-fitting face that resolves on Windows
 * and Linux, by the names it goes by there, less any the first already
 * lists. Fit is the smallest width error per x-height, which is the error
 * that's left once a composition applies font-size-adjust (whatever aspect
 * it sets, since that scales the font and the face alike); a font with no
 * x-height is fitted by plain width. None for a font with no latinWidth.
 */
export function fallbackAliases(
  font: FontMetrics,
  kind: FontClass,
  options: { readonly italic?: boolean } = {},
): FallbackAlias[] {
  if (font.latinWidth === null || font.latinWidth <= 0) return [];
  const own = font.latinWidth / font.unitsPerEm;
  const ownX = font.xHeight === null ? null : font.latinWidth / font.xHeight;
  // An italic family is fitted against each face's italic, the face its fallback stands on.
  const variant = { bold: false, italic: options.italic ?? false };
  const fit = (face: SystemFont) => {
    const { metrics } = systemVariant(face, variant);
    const widthError = metrics.latinWidth / metrics.unitsPerEm / own - 1;
    const xHeightWidthError =
      ownX === null ? null : metrics.latinWidth / metrics.xHeight / ownX - 1;
    return { face, widthError, xHeightWidthError, rank: Math.abs(xHeightWidthError ?? widthError) };
  };
  const ranked = SYSTEM_FONTS.filter((face) => face.class === kind)
    .map(fit)
    .sort((a, b) => a.rank - b.rank);
  const alias = (entry: (typeof ranked)[number], locals: readonly string[]): FallbackAlias => ({
    face: entry.face,
    locals: locals.slice(0, MAX_LOCALS),
    overrides: fallbackOverrides(font, systemVariant(entry.face, variant))!,
    xHeightWidthError: entry.xHeightWidthError,
    widthError: entry.widthError,
  });
  const [best] = ranked;
  if (!best) return [];
  const first = alias(best, best.face.mac);
  for (const entry of ranked) {
    const locals = entry.face.elsewhere.filter((name) => !first.locals.includes(name));
    if (locals.length > 0) return [first, alias(entry, locals)];
  }
  return [first];
}

/** One fallback alias's face at a weight and style: the system face it stands on there, and how it's sized. */
export interface FallbackFace {
  /** The system face's name, such as "Helvetica Neue Bold". */
  readonly name: string;
  readonly locals: readonly string[];
  readonly overrides: FallbackOverrides;
  readonly xHeightWidthError: number | null;
  readonly widthError: number;
}

const VARIANT_SUFFIX = {
  regular: '',
  medium: ' Medium',
  semibold: ' Demi Bold',
  bold: ' Bold',
  italic: ' Italic',
  boldItalic: ' Bold Italic',
};

/**
 * `aliases[index]`'s face for text at `bold` and `italic`, sized to `font`,
 * the webfont as that text renders it (a variable font at the weight, read
 * through its HVAR): the system face's bold, italic, or bold italic where
 * it has one, else its nearest, by the same names the alias goes by (macOS'
 * for the first, Windows' and Linux's for the second, less the first's).
 * Null when it has no such names, or `font` no latinWidth.
 */
export function fallbackFace(
  aliases: readonly FallbackAlias[],
  index: number,
  font: FontMetrics,
  variant: {
    readonly bold: boolean;
    readonly italic: boolean;
    readonly semibold?: boolean;
    readonly medium?: boolean;
  },
): FallbackFace | null {
  const alias = aliases[index];
  const first = aliases[0];
  if (!alias || !first || font.latinWidth === null || font.latinWidth <= 0) return null;
  const system = systemVariant(alias.face, variant);
  const names =
    index === 0
      ? system.mac
      : system.elsewhere.filter((name) => !systemVariant(first.face, variant).mac.includes(name));
  if (names.length === 0) return null;
  const key = (Object.keys(VARIANT_SUFFIX) as (keyof typeof VARIANT_SUFFIX)[]).find(
    (k) => (k === 'regular' ? alias.face : alias.face[k]) === system,
  )!;
  const own = font.latinWidth / font.unitsPerEm;
  return {
    name: `${alias.face.name}${VARIANT_SUFFIX[key]}`,
    locals: names.slice(0, MAX_LOCALS),
    overrides: fallbackOverrides(font, system)!,
    xHeightWidthError:
      font.xHeight === null
        ? null
        : system.metrics.latinWidth / system.metrics.xHeight / (font.latinWidth / font.xHeight) - 1,
    widthError: system.metrics.latinWidth / system.metrics.unitsPerEm / own - 1,
  };
}

/** The descriptors a fallback face takes, as CSS percentages. */
export interface FallbackOverrides {
  readonly sizeAdjust: string;
  readonly ascentOverride: string;
  readonly descentOverride: string;
  readonly lineGapOverride: string;
}

const percent = (value: number) => `${(Math.round(value * 10000) / 100).toFixed(2)}%`;

/**
 * The overrides that make `system` take the space `font` does, or null
 * when the font has no latinWidth to size by. size-adjust scales the
 * system font so its weighted Latin character is as wide as the font's,
 * both measured the same way; the overrides then give the font's own
 * ascent, descent, and line gap, as a share of the adjusted size. The
 * vertical metrics are the ones a browser lays the font out with: the typo
 * metrics when its USE_TYPO_METRICS bit is set, hhea's otherwise.
 */
export function fallbackOverrides(
  font: Pick<FontMetrics, 'unitsPerEm' | 'latinWidth' | 'hhea' | 'typo' | 'useTypoMetrics'>,
  system: { readonly metrics: SystemMetrics },
): FallbackOverrides | null {
  if (font.latinWidth === null || font.latinWidth <= 0) return null;
  const own = font.latinWidth / font.unitsPerEm;
  const theirs = system.metrics.latinWidth / system.metrics.unitsPerEm;
  const size = own / theirs;
  const vertical = font.useTypoMetrics ? font.typo : font.hhea;
  const em = font.unitsPerEm * size;
  return {
    sizeAdjust: percent(size),
    ascentOverride: percent(vertical.ascender / em),
    descentOverride: percent(Math.abs(vertical.descender) / em),
    lineGapOverride: percent(Math.max(0, vertical.lineGap) / em),
  };
}

/** The class a role stack's generic family gives, or null when it ends in none this knows. */
export function stackClass(stack: string): FontClass | null {
  for (const entry of stack
    .split(',')
    .map((family) => family.trim().toLowerCase())
    .reverse()) {
    if (entry === 'monospace' || entry === 'ui-monospace') return 'mono';
    if (entry === 'serif' || entry === 'ui-serif') return 'serif';
    if (
      entry === 'sans-serif' ||
      entry === 'ui-sans-serif' ||
      entry === 'system-ui' ||
      entry === 'ui-rounded'
    )
      return 'sans';
  }
  return null;
}
