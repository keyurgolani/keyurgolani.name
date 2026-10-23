import type { Sharp, SharpOptions } from 'sharp';
import { recordOwnerModule } from '../load-trace';
import { MEDIA_LIMITS, MediaSourceError, refused, type ImageType } from './limits';
import { sniffImageType } from './sniff';

// Image derivation with sharp (#10, slice 2 item 4), on @portfolio/core's
// owner side. The bytes say what a source is (sniff.ts), and libvips must
// agree. A source past 100 megapixels is refused from its header, before it
// is decoded. Renditions apply the EXIF orientation and carry no metadata at
// all: EXIF, XMP, IPTC, GPS, and the ICC profile go (pixels are converted
// to sRGB first). Each is checked for metadata again after it is encoded.
// Widths 480, 960, 1600, and 2400, up to the source's, as WebP plus JPEG, or
// WebP plus PNG for a source with alpha. The original is never a rendition.
//
// sharp loads on first use, through import(), so read-only and demo, which
// never derive, never load it. When it won't load, as on a platform whose
// binary is missing, loadSharp() says so once and ingestion keeps every
// rendition it has.

recordOwnerModule('core/media/derive');

/** The algorithm's version. Rendition names carry it: a new one names new files. */
export const ALGORITHM_VERSION = 1;
export const RENDITION_WIDTHS: readonly number[] = Object.freeze([480, 960, 1600, 2400]);

type SharpFactory = (input?: Buffer | Uint8Array, options?: SharpOptions) => Sharp;

export type SharpLoad =
  | { readonly ok: true; readonly sharp: SharpFactory }
  | { readonly ok: false; readonly code: string };

let loading: Promise<SharpLoad> | undefined;

/** sharp, loaded once, or the code of why it won't load. */
export function loadSharp(): Promise<SharpLoad> {
  loading ??= import('sharp').then(
    (module) => {
      const sharp = (module.default ?? module) as unknown as SharpFactory & {
        cache(options: boolean): void;
      };
      // Every source is read once; libvips' operation cache would only hold memory.
      sharp.cache(false);
      return { ok: true as const, sharp };
    },
    (error: unknown) => ({
      ok: false as const,
      code: String((error as NodeJS.ErrnoException)?.code ?? 'load_failed'),
    }),
  );
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
}

/** Derives the renditions of an image source, or throws a MediaSourceError. */
export async function deriveImage(
  sharp: SharpFactory,
  bytes: Uint8Array,
  { maxPixels = MEDIA_LIMITS.pixels }: DeriveOptions = {},
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
  let stats;
  try {
    stats = await sharp(input, { ...options, autoOrient: true })
      .toColourspace('srgb')
      .stats();
  } catch {
    throw invalid('decode', "The source's pixels can't be decoded.");
  }
  const { dominant } = stats;
  // An alpha channel that is opaque everywhere is no reason for PNG.
  const alpha = metadata.hasAlpha === true && !stats.isOpaque;

  const renditions: DerivedRendition[] = [];
  const fallback = alpha
    ? ({ ext: 'png', mime: 'image/png' } as const)
    : ({ ext: 'jpg', mime: 'image/jpeg' } as const);
  for (const target of renditionWidths(width)) {
    for (const format of [{ ext: 'webp', mime: 'image/webp' } as const, fallback]) {
      const pipeline = sharp(input, { ...options, autoOrient: true })
        .toColourspace('srgb')
        .resize({ width: target, withoutEnlargement: true });
      const encoded =
        format.ext === 'webp'
          ? pipeline.webp({ quality: 80, effort: 4 })
          : format.ext === 'png'
            ? pipeline.png({ compressionLevel: 9 })
            : pipeline.jpeg({ quality: 82, mozjpeg: true });
      let out;
      try {
        out = await encoded.toBuffer({ resolveWithObject: true });
      } catch {
        throw invalid('decode', "The source's pixels can't be decoded.");
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
