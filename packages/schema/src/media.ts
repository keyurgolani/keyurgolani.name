import { z } from 'zod';
import { isSectionId } from './ids';
import { isHttpsMediaUrl, isMediaRootPath } from './media-source';
import { checked, parseJsonFile, type UnitFileResult } from './snapshots';
import { TimestampSchema } from './timestamp';

// The unit's media document (#10, item 5): one derived record per asset the
// unit references, which owner's media ingestion writes at draft save and a
// published revision freezes as media/media.json. A record is one immutable
// asset revision: the source's SHA-256, what was derived from those bytes,
// where they came from, and whether that source was there when last read.
// The authored half of the catalog (alt text, decorative, credit, rights,
// focal point) stays on the portfolio's media entry; mediaCatalog() joins
// the two. Pure and browser-safe.

/** One file derived from a source: a resized image, or an audio, video, or PDF file served as is. */
export interface MediaRendition {
  /**
   * The rendition's key, lowercase words joined by hyphens: it names the
   * file in the rendition URL and includes the algorithm version, such as
   * `w960-a1`. Audio, video, captions, and PDFs serve as `source-a1`.
   */
  readonly name: string;
  /** The file extension, such as webp, jpg, png, mp3, or pdf. */
  readonly ext: string;
  /** The exact Content-Type it serves with, such as image/webp. */
  readonly mime: string;
  readonly bytes: number;
  readonly width?: number;
  readonly height?: number;
  /** The rendition's SHA-256, lowercase hex: its blob in the AssetStore. */
  readonly sha256: string;
}

/** Where an asset revision's bytes came from: a path under the media root, or an https URL. */
export type MediaRecordSource =
  | { readonly kind: 'local'; readonly path: string }
  | { readonly kind: 'remote'; readonly url: string };

/**
 * Why a source couldn't be read when it was last ingested: gone (`missing`),
 * not answering or not reachable from here (`unreachable`), refused by a
 * media rule such as a path escape, a private address, or a size cap
 * (`refused`), or read but not a valid image (`invalid`).
 */
export type MediaUnavailableReason = 'missing' | 'unreachable' | 'refused' | 'invalid';

/**
 * The source's state when it was last read. While a source is unavailable
 * the record keeps the last revision that derived, and `since` says when it
 * first went missing, so saving again with nothing changed changes nothing.
 */
export type MediaAvailability =
  | { readonly state: 'available' }
  | {
      readonly state: 'unavailable';
      readonly reason: MediaUnavailableReason;
      readonly since: string;
    };

export const MEDIA_UNAVAILABLE_REASONS: readonly MediaUnavailableReason[] = Object.freeze([
  'missing',
  'unreachable',
  'refused',
  'invalid',
]);

/** What ingestion derived for one asset revision. */
export interface MediaRecord {
  /** The portfolio's media id. */
  readonly assetId: string;
  /** The source's SHA-256, lowercase hex: the asset revision. */
  readonly sha256: string;
  readonly mime: string;
  readonly bytes: number;
  /** Pixel dimensions, for images and video. */
  readonly width?: number;
  readonly height?: number;
  /** width / height. */
  readonly aspectRatio?: number;
  /** #rrggbb. */
  readonly dominantColor?: string;
  readonly renditions: readonly MediaRendition[];
  /** When it was derived, as an ISO 8601 timestamp. */
  readonly derivedAt: string;
  /** The derivation algorithm's version; an older one is re-derived by `media check`. */
  readonly algorithmVersion: number;
  /** Where this revision's bytes were read from. */
  readonly source: MediaRecordSource;
  readonly availability: MediaAvailability;
}

/** The unit's media document: the derived media catalog, one record per asset. */
export interface MediaDocument {
  readonly assets: readonly MediaRecord[];
}

const SHA256 = /^[0-9a-f]{64}$/;
const RENDITION_NAME = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const EXTENSION = /^[a-z0-9]{1,8}$/;
const MIME = /^[a-z]+\/[a-z0-9.+-]+$/;

const Dimension = z.number().finite().int().positive();

export const MediaRenditionSchema = z
  .object({
    name: z.string().regex(RENDITION_NAME, {
      message: 'must be lowercase letters and digits in hyphen-separated words, such as w960-a1.',
    }),
    ext: z
      .string()
      .regex(EXTENSION, { message: 'must be a lowercase file extension, such as webp.' }),
    mime: z.string().regex(MIME, { message: 'must be a MIME type, such as image/webp.' }),
    bytes: z.number().finite().int().nonnegative(),
    width: Dimension.optional(),
    height: Dimension.optional(),
    sha256: z.string().regex(SHA256, { message: 'must be 64 lowercase hex digits.' }),
  })
  .strict();

const MediaRecordSourceSchema = z.discriminatedUnion('kind', [
  z
    .object({
      kind: z.literal('local'),
      path: z.string().refine(isMediaRootPath, { message: 'must be a path under the media root.' }),
    })
    .strict(),
  z
    .object({
      kind: z.literal('remote'),
      url: z.string().refine(isHttpsMediaUrl, { message: 'must be an https URL.' }),
    })
    .strict(),
]);

const MediaAvailabilitySchema = z.discriminatedUnion('state', [
  z.object({ state: z.literal('available') }).strict(),
  z
    .object({
      state: z.literal('unavailable'),
      reason: z.enum(['missing', 'unreachable', 'refused', 'invalid']),
      since: TimestampSchema,
    })
    .strict(),
]);

export const MediaRecordSchema = z
  .object({
    assetId: z.string().refine(isSectionId, {
      message: 'must be a media id: lowercase words joined by hyphens, such as atlas-cover.',
    }),
    sha256: z.string().regex(SHA256, { message: 'must be 64 lowercase hex digits.' }),
    mime: z.string().regex(MIME, { message: 'must be a MIME type, such as image/jpeg.' }),
    bytes: z.number().finite().int().nonnegative(),
    width: Dimension.optional(),
    height: Dimension.optional(),
    aspectRatio: z.number().finite().positive().optional(),
    dominantColor: z
      .string()
      .regex(/^#[0-9a-f]{6}$/, { message: 'must be a lowercase #rrggbb color.' })
      .optional(),
    renditions: z.array(MediaRenditionSchema),
    derivedAt: TimestampSchema,
    algorithmVersion: z.number().finite().int().positive(),
    source: MediaRecordSourceSchema,
    availability: MediaAvailabilitySchema,
  })
  .strict()
  .superRefine((record, ctx) => {
    const names = new Set<string>();
    record.renditions.forEach((rendition, index) => {
      if (names.has(rendition.name)) {
        ctx.addIssue({
          code: 'custom',
          path: ['renditions', index, 'name'],
          message: 'repeats an earlier rendition name.',
        });
      }
      names.add(rendition.name);
      // A rendition is derived from the source, never the source itself:
      // the original keeps its metadata, and originals are never served.
      if (rendition.sha256 === record.sha256) {
        ctx.addIssue({
          code: 'custom',
          path: ['renditions', index, 'sha256'],
          message: "is the source's own hash: a rendition is derived, and originals never serve.",
        });
      }
    });
  });

export const MediaDocumentSchema = z
  .object({ assets: z.array(MediaRecordSchema) })
  .strict()
  .superRefine((document, ctx) => {
    const seen = new Set<string>();
    document.assets.forEach((record, index) => {
      if (seen.has(record.assetId)) {
        ctx.addIssue({
          code: 'custom',
          path: ['assets', index, 'assetId'],
          message: 'repeats an earlier record: a media document holds one revision per asset.',
        });
      }
      seen.add(record.assetId);
    });
  }) as z.ZodType<MediaDocument, z.ZodTypeDef, unknown>;

/**
 * A rendition's URL: `<mediaBase>/<assetId>/<sha256>/<rendition>.<ext>`
 * (slice 2 item 5). `mediaBase` is `/media`, or `/preview-assets/<grant>`
 * in a draft preview (#7).
 */
export function renditionUrl(
  mediaBase: string,
  record: Pick<MediaRecord, 'assetId' | 'sha256'>,
  rendition: Pick<MediaRendition, 'name' | 'ext'>,
): string {
  return `${normalizeMediaBase(mediaBase)}/${record.assetId}/${record.sha256}/${rendition.name}.${rendition.ext}`;
}

/** A media base without its trailing slash. Throws unless it's a path from the root, such as /media. */
export function normalizeMediaBase(mediaBase: string): string {
  const base = mediaBase.replace(/\/+$/, '');
  if (!/^\/[A-Za-z0-9._~/-]*$/.test(`${base}/`) || base === '' || base.includes('//')) {
    throw new TypeError('A media base is a path from the root, such as /media.');
  }
  return base;
}

/**
 * The blobs a media document references, as the store names them
 * (`sha256:<hex>`): each record's source, which the AssetStore keeps but
 * never serves, and each of its renditions. Sorted, each once. A document
 * that doesn't check references nothing.
 */
export function mediaBlobs(data: unknown): readonly `sha256:${string}`[] {
  const parsed = parseMediaDocument(data);
  if (!parsed.ok) return [];
  const blobs = new Set<`sha256:${string}`>();
  for (const record of parsed.value.assets) {
    blobs.add(`sha256:${record.sha256}`);
    for (const rendition of record.renditions) blobs.add(`sha256:${rendition.sha256}`);
  }
  return [...blobs].sort();
}

/** A media document's data, checked. */
export function parseMediaDocument(data: unknown): UnitFileResult<MediaDocument> {
  return checked(MediaDocumentSchema, data);
}

/** media/media.json's text, through #4's pre-parse guards, then checked. */
export function parseMediaDocumentText(text: string): UnitFileResult<MediaDocument> {
  return parseJsonFile(text, parseMediaDocument);
}
