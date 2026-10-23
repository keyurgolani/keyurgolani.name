import { isSectionId, parseMediaDocument, RENDITION_TYPES } from '@portfolio/schema';

// Which blob a rendition URL names (#10, slice 2 item 5), for /media and
// /preview-assets/<grant>: `<assetId>/<sha256>/<name>.<ext>` below the media
// base. It answers only for an asset the view keeps (public, and placed by
// something visible), at exactly the revision the media document holds, and
// a rendition that record lists. The original's hash is never a rendition's
// (the schema refuses one), so no original serves. The content type is the
// record's, never the URL's. Anything else is null, which a route answers
// with 404, so an asset's existence never shows through a private one.

export interface RenditionBlob {
  /** The rendition's blob, as the store names it. */
  readonly blob: `sha256:${string}`;
  /** The record's Content-Type for it. */
  readonly mime: string;
  readonly bytes: number;
  readonly assetId: string;
}

const HEX = /^[0-9a-f]{64}$/;
const FILE = /^([a-z0-9]+(?:-[a-z0-9]+)*)\.([a-z0-9]{1,8})$/;

/**
 * The rendition `segments` name, below the media base, in `media` (a media
 * document), when `visible` holds its asset: or null.
 */
export function resolveRendition(
  media: unknown,
  visible: ReadonlySet<string>,
  segments: readonly string[],
): RenditionBlob | null {
  if (segments.length !== 3) return null;
  const [assetId, sha256, file] = segments as [string, string, string];
  if (!isSectionId(assetId) || !HEX.test(sha256)) return null;
  const match = FILE.exec(file);
  if (!match) return null;
  const [, name, ext] = match;
  if (!visible.has(assetId)) return null;
  const parsed = parseMediaDocument(media);
  if (!parsed.ok) return null;
  const record = parsed.value.assets.find((entry) => entry.assetId === assetId);
  if (!record || record.sha256 !== sha256) return null;
  const rendition = record.renditions.find((entry) => entry.name === name && entry.ext === ext);
  if (!rendition || rendition.sha256 === record.sha256) return null;
  // An image type alone, whatever a document that got past the schema says.
  if (!(RENDITION_TYPES as readonly string[]).includes(rendition.mime)) return null;
  return {
    blob: `sha256:${rendition.sha256}`,
    mime: rendition.mime,
    bytes: rendition.bytes,
    assetId,
  };
}
