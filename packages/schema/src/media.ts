import { z } from 'zod';
import { isSectionId } from './ids';
import { checked, parseJsonFile, type UnitFileResult } from './snapshots';
import { TimestampSchema } from './timestamp';

// The unit's media document (#10, slice 2 item 2): one derived record per
// asset revision the unit references, which media ingestion writes and a
// published revision freezes as media/media.json. Slice 1 defines the shape
// and how a view reads it; nothing produces one yet, so every image the
// slice 1 runtime renders is unavailable. Pure and browser-safe.

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
}

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
  })
  .strict();

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

/** A media document's data, checked. */
export function parseMediaDocument(data: unknown): UnitFileResult<MediaDocument> {
  return checked(MediaDocumentSchema, data);
}

/** media/media.json's text, through #4's pre-parse guards, then checked. */
export function parseMediaDocumentText(text: string): UnitFileResult<MediaDocument> {
  return parseJsonFile(text, parseMediaDocument);
}
