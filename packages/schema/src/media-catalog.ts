import type { FocalPoint } from './kinds/common';
import type { MediaAsset, MediaKind } from './kinds/records';
import { parseMediaDocument, type MediaAvailability, type MediaRecord } from './media';

// The media catalog (#10, item 5): each authored media entry joined with its
// asset revision from the unit's media document. Authored fields (alt text,
// decorative, credit, rights, focal point) come from the entry; the revision
// (dimensions, aspect ratio, dominant color, renditions, source, and
// availability) from the record ingestion derived. Entries keep the authored
// order, never a filename's or a record's. For the owner's views, such as
// Studio: unlike the visitor view, it keeps private entries. Pure.

export interface MediaCatalogEntry {
  readonly id: string;
  readonly kind: MediaKind;
  readonly visibility: 'public' | 'private';
  /** The authored source: a path under the media root, or an https URL. */
  readonly source: string;
  readonly alt?: string;
  readonly decorative?: boolean;
  readonly credit?: string;
  readonly rights?: MediaAsset['rights'];
  readonly focalPoint?: FocalPoint;
  /** The asset revision in use, or null before one has derived. */
  readonly revision: MediaRecord | null;
  /**
   * The source's state: the revision's, or `pending` when no revision has
   * derived yet. A revision whose source has since gone stays in use.
   */
  readonly availability: MediaAvailability | { readonly state: 'pending' };
}

/** The catalog of `assets` (the portfolio's `media`) over a media document's records. */
export function mediaCatalog(
  assets: readonly MediaAsset[],
  media: unknown,
): readonly MediaCatalogEntry[] {
  const parsed = media === undefined ? undefined : parseMediaDocument(media);
  const records = new Map(
    (parsed?.ok ? parsed.value.assets : []).map((record) => [record.assetId, record]),
  );
  return assets.map((asset) => {
    const revision = records.get(asset.id) ?? null;
    const entry: MediaCatalogEntry = {
      id: asset.id,
      kind: asset.kind,
      visibility: asset.visibility ?? 'public',
      source: asset.source,
      ...(asset.alt === undefined ? {} : { alt: asset.alt }),
      ...(asset.decorative === undefined ? {} : { decorative: asset.decorative }),
      ...(asset.credit === undefined ? {} : { credit: asset.credit }),
      ...(asset.rights === undefined ? {} : { rights: asset.rights }),
      ...(asset.focalPoint === undefined ? {} : { focalPoint: asset.focalPoint }),
      revision,
      availability: revision?.availability ?? { state: 'pending' },
    };
    return entry;
  });
}
