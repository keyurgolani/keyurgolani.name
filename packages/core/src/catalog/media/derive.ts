import { readdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import type { Sharp, SharpOptions } from 'sharp';
import { MEDIA_LIMITS, MediaSourceError, refused, type ImageType } from './limits';
import { sniffImageType } from './sniff';

// Image derivation with sharp (#10, slice 2 item 4), in @portfolio/core:
// owner's draft saves and imports, and read-only's and demo's startup. The bytes say what a source is (sniff.ts), and libvips must
// agree. A source past 100 megapixels is refused from its header, before it
// is decoded. Renditions apply the EXIF orientation and carry no metadata at
// all: EXIF, XMP, IPTC, GPS, and the ICC profile go (pixels are converted
// to sRGB first). Each is checked for metadata again after it is encoded.
// Widths 480, 960, 1600, and 2400, up to the source's, as WebP plus JPEG, or
// WebP plus PNG for a source with alpha. The original is never a rendition.
//
// Memory and time are bounded too (review M2): the source is decoded once,
// shrunk on load to the widest rendition, into a raw buffer every rendition
// and the colour stats come from; each pipeline stops at its time limit; a
// progressive JPEG or interlaced PNG, which libvips decodes whole, gets a
// lower pixel cap; libvips runs one thread; and one derivation runs at a
// time in a process.
//
// sharp loads on first use, through import(), so a process that derives
// nothing never loads it. Outside the server's build, as the bundled CLI at
// /app/bin, a bare import may not find it: the server build's external link,
// `.next/node_modules/sharp-<hash>`, is tried next. When it won't load, as
// on a platform whose binary is missing, loadSharp() says so and ingestion
// keeps every rendition it has.

/** The algorithm's version. Rendition names carry it: a new one names new files. */
export const ALGORITHM_VERSION = 1;
export const RENDITION_WIDTHS: readonly number[] = Object.freeze([480, 960, 1600, 2400]);

type SharpFactory = (input?: Buffer | Uint8Array, options?: SharpOptions) => Sharp;

/** libvips' threads for a pipeline: one, so a derivation's working memory stays small. */
export const SHARP_CONCURRENCY = 1;
/** How long one pipeline may run before it is stopped. */
export const DERIVE_TIMEOUT_SECONDS = 30;

export type SharpLoad =
  | { readonly ok: true; readonly sharp: SharpFactory }
  | { readonly ok: false; readonly code: string };

const loads = new Map<string, Promise<SharpLoad>>();

const ready = (module: unknown): SharpLoad => {
  const sharp = ((module as { default?: unknown }).default ?? module) as SharpFactory & {
    cache(options: boolean): void;
    concurrency(threads: number): number;
  };
  // Every source is read once; libvips' operation cache would only hold memory.
  sharp.cache(false);
  sharp.concurrency(SHARP_CONCURRENCY);
  return { ok: true, sharp };
};

/** sharp from a directory that holds it as `sharp` or a build's `sharp-<hash>` link. */
export function sharpFromDirectory(dir: string): unknown {
  const names = readdirSync(dir).filter((name) => /^sharp(?:-[0-9a-f]+)?$/.test(name));
  if (names.length !== 1) throw Object.assign(new Error('no sharp here'), { code: 'not_found' });
  return createRequire(path.join(dir, 'index.js'))(names[0]!);
}

/**
 * sharp, loaded once per set of places: a bare import first, then each of
 * `directories` in turn, such as the server build's .next/node_modules. Or
 * the code of why it won't load.
 */
export function loadSharp(directories: readonly string[] = []): Promise<SharpLoad> {
  const key = JSON.stringify(directories);
  let loading = loads.get(key);
  if (!loading) {
    loading = (async () => {
      let code = 'load_failed';
      try {
        return ready(await import('sharp'));
      } catch (error) {
        code = String((error as NodeJS.ErrnoException)?.code ?? code);
      }
      for (const dir of directories) {
        try {
          return ready(sharpFromDirectory(dir));
        } catch {
          // The next place, if there is one.
        }
      }
      return { ok: false as const, code };
    })();
    loads.set(key, loading);
  }
  return loading;
}

/** One rendition's bytes, before the AssetStore names them. */
export interface DerivedRendition {
  readonly name: string;
  readonly ext: 'webp' | 'jpg' | 'png';
  readonly mime: 'image/webp' | 'image/jpeg' | 'image/png';
  readonly width: number;
  readonly height: number;
  readonly bytes: Uint8Array;
}

/** What one source derives to. */
export interface DerivedImage {
  readonly mime: ImageType;
  /** As displayed: the EXIF orientation applied. */
  readonly width: number;
  readonly height: number;
  readonly aspectRatio: number;
  /** #rrggbb. */
  readonly dominantColor: string;
  readonly renditions: readonly DerivedRendition[];
}

const LIBVIPS_FORMAT: Readonly<Record<ImageType, string>> = {
  'image/jpeg': 'jpeg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/avif': 'heif',
};

const invalid = (code: string, message: string) => new MediaSourceError('invalid', code, message);

const hex = (value: number) =>
  Math.max(0, Math.min(255, Math.round(value)))
    .toString(16)
    .padStart(2, '0');

/** The widths a source of `width` pixels gets: each standard one it reaches, or its own. */
export function renditionWidths(width: number): number[] {
  const widths = RENDITION_WIDTHS.filter((standard) => standard <= width);
  return widths.length > 0 ? widths : [width];
}

export interface DeriveOptions {
  readonly maxPixels?: number;
  /** The cap for a progressive JPEG or an interlaced PNG, which decode whole. */
  readonly maxProgressivePixels?: number;
  readonly timeoutSeconds?: number;
}

/** A pipeline error: its time limit, or pixels that won't decode. */
const pipelineError = (error: unknown) =>
  /timeout/i.test(String((error as Error)?.message))
    ? refused('timeout', 'The source took too long to derive.')
    : invalid('decode', "The source's pixels can't be decoded.");

let turn: Promise<unknown> = Promise.resolve();

/**
 * Derives the renditions of an image source, or throws a MediaSourceError.
 * One runs at a time in a process: the next waits for the one before.
 */
export function deriveImage(
  sharp: SharpFactory,
  bytes: Uint8Array,
  options: DeriveOptions = {},
): Promise<DerivedImage> {
  const run = turn.then(() => deriveOne(sharp, bytes, options));
  turn = run.catch(() => {});
  return run;
}

async function deriveOne(
  sharp: SharpFactory,
  bytes: Uint8Array,
  {
    maxPixels = MEDIA_LIMITS.pixels,
    maxProgressivePixels = MEDIA_LIMITS.progressivePixels,
    timeoutSeconds = DERIVE_TIMEOUT_SECONDS,
  }: DeriveOptions,
): Promise<DerivedImage> {
  const mime = sniffImageType(bytes);
  if (mime === null) {
    throw refused('type', 'The source is not a JPEG, PNG, WebP, or AVIF image.');
  }
  const input = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const options: SharpOptions = {
    limitInputPixels: maxPixels,
    failOn: 'error',
    // The first frame of an animation, and nothing else.
    animated: false,
  };
  let metadata;
  try {
    // The header alone: metadata() decodes no pixels, so the cap is checked below, by hand.
    metadata = await sharp(input, { ...options, limitInputPixels: false }).metadata();
  } catch {
    throw invalid('decode', "The source's header can't be read as an image.");
  }
  if (metadata.format !== LIBVIPS_FORMAT[mime]) {
    throw invalid('type_mismatch', "The source's bytes and its image data disagree on its type.");
  }
  if (mime === 'image/avif' && metadata.compression !== 'av1') {
    throw refused('type', 'The source is HEIF but not AVIF.');
  }
  const width = metadata.autoOrient?.width ?? metadata.width;
  const height = metadata.autoOrient?.height ?? metadata.height;
  if (!width || !height) throw invalid('dimensions', 'The source has no dimensions.');
  if (width * height > maxPixels) {
    throw refused('pixels', 'The source decodes to more than 100 megapixels.');
  }
  // libvips can't shrink a progressive JPEG or an interlaced PNG as it
  // loads: it holds the whole image.
  if (metadata.isProgressive === true && width * height > maxProgressivePixels) {
    throw refused(
      'pixels',
      'A progressive or interlaced source decodes to more than 40 megapixels.',
    );
  }

  // Decoded once, shrunk on load to the widest rendition, upright, in sRGB.
  const widths = renditionWidths(width);
  let base;
  try {
    base = await sharp(input, { ...options, autoOrient: true })
      .timeout({ seconds: timeoutSeconds })
      .toColourspace('srgb')
      .resize({ width: Math.max(...widths), withoutEnlargement: true })
      .raw()
      .toBuffer({ resolveWithObject: true });
  } catch (error) {
    throw pipelineError(error);
  }
  const { data: pixels, info } = base;
  const raw = {
    raw: { width: info.width, height: info.height, channels: info.channels },
  } as SharpOptions;
  const fromBase = () => sharp(pixels, raw).timeout({ seconds: timeoutSeconds });

  let stats;
  try {
    stats = await fromBase().stats();
  } catch (error) {
    throw pipelineError(error);
  }
  const { dominant } = stats;
  // An alpha channel that is opaque everywhere is no reason for PNG.
  const alpha = metadata.hasAlpha === true && !stats.isOpaque;

  const renditions: DerivedRendition[] = [];
  const fallback = alpha
    ? ({ ext: 'png', mime: 'image/png' } as const)
    : ({ ext: 'jpg', mime: 'image/jpeg' } as const);
  for (const target of widths) {
    for (const format of [{ ext: 'webp', mime: 'image/webp' } as const, fallback]) {
      const pipeline = fromBase().resize({ width: target, withoutEnlargement: true });
      const encoded =
        format.ext === 'webp'
          ? pipeline.webp({ quality: 80, effort: 4 })
          : format.ext === 'png'
            ? pipeline.png({ compressionLevel: 9 })
            : pipeline.jpeg({ quality: 82, mozjpeg: true });
      let out;
      try {
        out = await encoded.toBuffer({ resolveWithObject: true });
      } catch (error) {
        throw pipelineError(error);
      }
      const check = await sharp(out.data).metadata();
      if (check.exif || check.xmp || check.iptc || check.icc) {
        throw invalid('metadata_kept', 'A rendition kept metadata it must not carry.');
      }
      const suffix = format.ext === 'webp' ? '' : `-${format.ext}`;
      renditions.push({
        name: `w${target}-a${ALGORITHM_VERSION}${suffix}`,
        ext: format.ext,
        mime: format.mime,
        width: out.info.width,
        height: out.info.height,
        bytes: new Uint8Array(out.data.buffer, out.data.byteOffset, out.data.byteLength),
      });
    }
  }

  return {
    mime,
    width,
    height,
    aspectRatio: width / height,
    dominantColor: `#${hex(dominant.r)}${hex(dominant.g)}${hex(dominant.b)}`,
    renditions,
  };
}
