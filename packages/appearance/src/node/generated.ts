// The generated schemes' reference records and the owner's acceptance (#20
// PR 3), in Node. Each first-party generator scheme has one reference
// input, and `pnpm catalog:generated` writes what its generator makes of
// it to `<package>/generated/<id>.json`, beside packs/, so the record is
// reviewable and pinned:
//
// - check:appearance runs each generator again and fails when the bytes
//   differ: at the same generator version, the generator changed and its
//   version has to go up; at another, the record is stale.
// - An image-derived scheme stays out of every build (registry
//   generation's exclusion, #117) until `<package>/generated/acceptance.json`
//   pins the SHA-256 of its current record, which only the owner writes.
//   A new record makes the acceptance stale, and the scheme is out again.
//
// Images are read here with a first-party PNG reader (node:zlib), which
// takes the 8-bit RGB and RGBA PNGs this repository's example media are and
// refuses the rest, and lists the chunks, so a test can hold the images to
// carrying no metadata. The pixel hash is SHA-256 over the decoded RGB rows
// for an opaque image (example-media/provenance.json's pixelsSha256), or
// RGBA rows for one with any transparency.

import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { inflateSync } from 'node:zlib';
import { runGenerator, type GeneratorResult, type Raster } from '../generators/index';

/** A decoded PNG and the chunk types it carried, in order. */
export interface DecodedPng {
  readonly raster: Raster;
  readonly chunks: readonly string[];
}

const SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

function paeth(left: number, up: number, corner: number): number {
  const estimate = left + up - corner;
  const toLeft = Math.abs(estimate - left);
  const toUp = Math.abs(estimate - up);
  const toCorner = Math.abs(estimate - corner);
  if (toLeft <= toUp && toLeft <= toCorner) return left;
  return toUp <= toCorner ? up : corner;
}

/** Decodes a non-interlaced 8-bit RGB or RGBA PNG to RGBA, or throws naming what it can't read. */
export function readPng(bytes: Uint8Array): DecodedPng {
  const buffer = Buffer.from(bytes);
  if (buffer.length < 8 || !buffer.subarray(0, 8).equals(SIGNATURE)) {
    throw new TypeError('This is not a PNG.');
  }
  const chunks: string[] = [];
  const data: Buffer[] = [];
  let width = 0;
  let height = 0;
  let channels = 0;
  for (let at = 8; at + 8 <= buffer.length; ) {
    const length = buffer.readUInt32BE(at);
    const type = buffer.toString('latin1', at + 4, at + 8);
    const body = buffer.subarray(at + 8, at + 8 + length);
    chunks.push(type);
    if (type === 'IHDR') {
      width = body.readUInt32BE(0);
      height = body.readUInt32BE(4);
      const [depth, color, , , interlace] = body.subarray(8, 13);
      if (depth !== 8 || (color !== 2 && color !== 6) || interlace !== 0) {
        throw new TypeError('This reads 8-bit, non-interlaced RGB or RGBA PNGs only.');
      }
      channels = color === 6 ? 4 : 3;
    } else if (type === 'IDAT') data.push(body);
    else if (type === 'IEND') break;
    at += 12 + length;
  }
  if (!channels || width < 1 || height < 1) throw new TypeError('The PNG has no image header.');
  const raw = inflateSync(Buffer.concat(data));
  const stride = width * channels;
  if (raw.length !== height * (stride + 1)) throw new TypeError("The PNG's image data is short.");
  const rows = Buffer.alloc(height * stride);
  for (let row = 0; row < height; row += 1) {
    const filter = raw[row * (stride + 1)]!;
    const line = raw.subarray(row * (stride + 1) + 1, (row + 1) * (stride + 1));
    for (let index = 0; index < stride; index += 1) {
      const left = index >= channels ? rows[row * stride + index - channels]! : 0;
      const up = row > 0 ? rows[(row - 1) * stride + index]! : 0;
      const corner = row > 0 && index >= channels ? rows[(row - 1) * stride + index - channels]! : 0;
      const predicted =
        filter === 0
          ? 0
          : filter === 1
            ? left
            : filter === 2
              ? up
              : filter === 3
                ? (left + up) >> 1
                : filter === 4
                  ? paeth(left, up, corner)
                  : -1;
      if (predicted < 0) throw new TypeError(`The PNG has an unknown row filter ${filter}.`);
      rows[row * stride + index] = (line[index]! + predicted) & 0xff;
    }
  }
  const rgba = new Uint8Array(width * height * 4);
  for (let pixel = 0; pixel < width * height; pixel += 1) {
    for (let channel = 0; channel < 3; channel += 1)
      rgba[pixel * 4 + channel] = rows[pixel * channels + channel]!;
    rgba[pixel * 4 + 3] = channels === 4 ? rows[pixel * channels + 3]! : 255;
  }
  return { raster: { width, height, data: rgba }, chunks };
}

/** SHA-256 of the decoded pixels: RGB rows when every pixel is opaque, else RGBA rows. */
export function pixelsSha256(raster: Raster): string {
  const opaque = raster.data.every((value, index) => index % 4 !== 3 || value === 255);
  const hash = createHash('sha256');
  if (!opaque) return hash.update(raster.data).digest('hex');
  const rgb = new Uint8Array(raster.width * raster.height * 3);
  for (let pixel = 0; pixel < raster.width * raster.height; pixel += 1) {
    rgb.set(raster.data.subarray(pixel * 4, pixel * 4 + 3), pixel * 3);
  }
  return hash.update(rgb).digest('hex');
}

/** Where a package keeps its generated schemes' reference records and the owner's acceptance. */
export const GENERATED_DIR = 'generated';
export const ACCEPTANCE_FILE = 'acceptance.json';

/** A reference input: a seed color, or a media asset id and the repository file it's drawn from. */
export type ReferenceSource =
  | { readonly seedColor: string }
  | { readonly sourceAsset: string; readonly file: string };

/** Each first-party generator scheme's reference input. The images are this repository's own example media. */
export const REFERENCE_SOURCES: Readonly<Record<string, ReferenceSource>> = Object.freeze({
  'brand-seed': { seedColor: '#5b5bd6' },
  'hct-tonal': { seedColor: '#6750a4' },
  'profile-image': { sourceAsset: 'portrait', file: 'example-media/anamika/portrait.png' },
  'portfolio-artwork': { sourceAsset: 'looking-dusk', file: 'example-media/gallery/looking-1.png' },
});

/** A reference record as committed: the scheme, its source, and its generator's result. */
export interface ReferenceRecord {
  readonly scheme: string;
  readonly source: ReferenceSource;
  readonly result: GeneratorResult;
}

/** The generator manifest field the record is made for. */
export interface DeclaredGenerator {
  readonly id: string;
  readonly version: number;
  readonly input: 'seed-color' | 'asset';
}

/** What the scheme's generator makes of its source, or why it can't. */
export function referenceRecord(
  root: string,
  scheme: string,
  declared: DeclaredGenerator,
  source: ReferenceSource,
): { readonly ok: true; readonly record: ReferenceRecord } | { readonly ok: false; readonly problem: string } {
  let asset;
  if ('file' in source) {
    try {
      const { raster } = readPng(readFileSync(path.join(root, source.file)));
      asset = { raster, pixelsSha256: pixelsSha256(raster) };
    } catch (error) {
      return { ok: false, problem: `${source.file} can't be read: ${(error as Error).message}` };
    }
  }
  const input = 'file' in source ? { sourceAsset: source.sourceAsset } : source;
  const run = runGenerator(declared, input, asset);
  if (!run.ok) return { ok: false, problem: run.problem };
  return { ok: true, record: { scheme, source, result: run.result } };
}

const PAIRS = '"__contrast_report_pairs__"';

/** A record's committed text: two-space JSON, each report pair on its own line, and a newline. */
export function renderReference(record: ReferenceRecord): string {
  const { pairs } = record.result.contrastReport;
  const shell = {
    ...record,
    result: {
      ...record.result,
      contrastReport: { ...record.result.contrastReport, pairs: '__contrast_report_pairs__' },
    },
  };
  const text = JSON.stringify(shell, null, 2);
  const indent = /^( *)"pairs": "__contrast_report_pairs__"/m.exec(text)![1]!;
  const lines = pairs.map((pair) => `${indent}  ${JSON.stringify(pair)}`).join(',\n');
  return `${text.replace(PAIRS, `[\n${lines}\n${indent}]`)}\n`;
}

/** The SHA-256 the owner's acceptance pins: of the record file's bytes. */
export function recordDigest(text: string): string {
  return `sha256-${createHash('sha256').update(text).digest('hex')}`;
}

/** The owner's acceptance of one image-derived scheme's reference record. */
export interface Acceptance {
  readonly record: string;
  readonly acceptedBy: string;
  readonly acceptedAt: string;
}

/** The record file for a scheme in a pack package, relative to the package's directory. */
export const referenceFile = (scheme: string) => path.join(GENERATED_DIR, `${scheme}.json`);

/** A pack package's acceptance file, read, or empty when it has none or it doesn't parse. */
export function readAcceptance(packageDir: string): Readonly<Record<string, Acceptance>> {
  const file = path.join(packageDir, GENERATED_DIR, ACCEPTANCE_FILE);
  if (!existsSync(file)) return {};
  try {
    const parsed = JSON.parse(readFileSync(file, 'utf8')) as unknown;
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as Record<string, Acceptance>)
      : {};
  } catch {
    return {};
  }
}

/**
 * Why an image-derived scheme is left out of the build, or null when it may
 * ship: the owner has accepted its current reference record. `packDir` is
 * the pack's directory, packs/<id> in its package. Any other pack is null.
 */
export function reviewExclusion(
  manifest: { readonly id: string; readonly generator?: DeclaredGenerator },
  packDir: string,
): string | null {
  if (manifest.generator?.input !== 'asset') return null;
  const packageDir = path.resolve(packDir, '..', '..');
  const file = path.join(packageDir, referenceFile(manifest.id));
  const show = `pnpm catalog show ${manifest.id}`;
  if (!existsSync(file)) {
    return `it's image-derived and has no reference record for the owner to review, so it waits. Run pnpm catalog:generated.`;
  }
  const accepted = readAcceptance(packageDir)[manifest.id];
  if (!accepted) {
    return `it's image-derived and waits for the owner to accept its reference record (${show}).`;
  }
  if (accepted.record !== recordDigest(readFileSync(file, 'utf8'))) {
    return `it's image-derived, and the owner accepted an earlier reference record, so it waits for the owner to accept the current one (${show}).`;
  }
  return null;
}
