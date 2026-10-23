// A variant's catalog stills (#6, item 1): the committed images a catalog
// plate shows before, and instead of, a live preview. The manifest lists
// each with its width and height, registry generation reads it from the
// package, checks that it's a PNG or WebP of exactly those dimensions, and
// copies it by content hash to the host's gitignored public/_portfolio/still/,
// and ASSET_MANIFEST lists it with its size, so the plate renders a plain
// <img> with width and height and #6's budgets count its bytes.

import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import type { ServedFile } from './variant-stylesheet';

/** Where the host serves stills from: public/_portfolio/still/. */
export const STILL_URL = '/_portfolio/still/';

/** Larger than any still a plate needs. */
export const MAX_STILL_BYTES = 256 * 1024;

/** A still, copied by content hash, with the dimensions its file has. */
export interface StillFile extends ServedFile {
  readonly width: number;
  readonly height: number;
}

/** A still as the manifest declares it. */
export interface DeclaredStill {
  readonly file: string;
  readonly width: number;
  readonly height: number;
}

export interface StillProblem {
  /** The pointer's tokens under the manifest's `stills`. */
  readonly path: readonly (string | number)[];
  readonly message: string;
  readonly remedy: string;
}

export type ImageFormat = 'png' | 'webp';

/** An image's format and pixel dimensions, read from its header, or null for anything else. */
export function imageSize(
  bytes: Uint8Array,
): { format: ImageFormat; width: number; height: number } | null {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const ascii = (start: number, length: number) =>
    String.fromCharCode(...bytes.subarray(start, start + length));
  // PNG: the signature, then IHDR's width and height, big-endian.
  if (
    bytes.length >= 24 &&
    view.getUint32(0) === 0x89504e47 &&
    view.getUint32(4) === 0x0d0a1a0a &&
    ascii(12, 4) === 'IHDR'
  ) {
    return { format: 'png', width: view.getUint32(16), height: view.getUint32(20) };
  }
  if (bytes.length < 30 || ascii(0, 4) !== 'RIFF' || ascii(8, 4) !== 'WEBP') return null;
  const chunk = ascii(12, 4);
  // Lossy: the frame header's 14-bit dimensions after its start code.
  if (chunk === 'VP8 ') {
    if (bytes[23] !== 0x9d || bytes[24] !== 0x01 || bytes[25] !== 0x2a) return null;
    return {
      format: 'webp',
      width: view.getUint16(26, true) & 0x3fff,
      height: view.getUint16(28, true) & 0x3fff,
    };
  }
  // Lossless: 14 bits each, minus one, after the signature byte.
  if (chunk === 'VP8L') {
    if (bytes[20] !== 0x2f) return null;
    const bits = view.getUint32(21, true);
    return { format: 'webp', width: (bits & 0x3fff) + 1, height: ((bits >> 14) & 0x3fff) + 1 };
  }
  // Extended: 24-bit canvas dimensions, minus one.
  if (chunk === 'VP8X') {
    const width = (bytes[24]! | (bytes[25]! << 8) | (bytes[26]! << 16)) + 1;
    const height = (bytes[27]! | (bytes[28]! << 8) | (bytes[29]! << 16)) + 1;
    return { format: 'webp', width, height };
  }
  return null;
}

/**
 * Reads each still the manifest declares from the package at `dir`, and
 * names its copy `<id>.<sha256-12>.<png|webp>`. A file outside the package,
 * missing, over MAX_STILL_BYTES, of another format, or of other dimensions
 * than declared is a problem, never a skip.
 */
export function readStills(
  id: string,
  dir: string,
  declared: readonly DeclaredStill[],
): { ok: true; stills: StillFile[] } | { ok: false; problems: StillProblem[] } {
  const stills: StillFile[] = [];
  const problems: StillProblem[] = [];
  const root = fs.realpathSync(dir);
  declared.forEach((still, index) => {
    const problem = (message: string, remedy: string) =>
      problems.push({ path: [index, 'file'], message, remedy });
    let real: string;
    try {
      real = fs.realpathSync(path.resolve(dir, still.file));
    } catch {
      problem(
        `names ${still.file}, which the package doesn't have.`,
        'Commit the still, or point the manifest at one the package has.',
      );
      return;
    }
    if (real !== root && !real.startsWith(`${root}${path.sep}`)) {
      problem(
        `names ${still.file}, which resolves outside the package.`,
        "Keep the package's stills inside it, with no link leading out.",
      );
      return;
    }
    const stat = fs.statSync(real);
    if (!stat.isFile()) {
      problem(`names ${still.file}, which isn't a file.`, 'Point it at an image file.');
      return;
    }
    if (stat.size > MAX_STILL_BYTES) {
      problem(
        `names ${still.file}, which is ${Math.ceil(stat.size / 1024)} KB, over the ${MAX_STILL_BYTES / 1024} KB a still may be.`,
        'Compress it, or ship it at a smaller size.',
      );
      return;
    }
    const bytes = new Uint8Array(fs.readFileSync(real));
    const size = imageSize(bytes);
    if (!size) {
      problem(`names ${still.file}, which isn't a PNG or WebP image.`, 'Ship the still as WebP.');
      return;
    }
    if (size.width !== still.width || size.height !== still.height) {
      problems.push({
        path: [index],
        message: `declares ${still.width}x${still.height}, and ${still.file} is ${size.width}x${size.height}.`,
        remedy: "Declare the image's own width and height, so its plate doesn't shift.",
      });
      return;
    }
    const sha256 = createHash('sha256').update(bytes).digest('hex');
    const name = `${id}.${sha256.slice(0, 12)}.${size.format}`;
    stills.push({
      name,
      url: `${STILL_URL}${name}`,
      sha256,
      bytes,
      width: size.width,
      height: size.height,
    });
  });
  return problems.length > 0 ? { ok: false, problems } : { ok: true, stills };
}
