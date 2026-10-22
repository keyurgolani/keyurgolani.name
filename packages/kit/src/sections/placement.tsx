import type { ReactNode } from 'react';
import type { Placement } from '@portfolio/schema';
import type { PlacedImage } from './media';
import { DateText, Meta, present, TagList, type RenderContext } from './primitives';
import { placedImage } from './view';

// Where a shared renderer places media (#10, slice 1, item 7): one path for
// every placement, a cover, a logo, or an avatar as much as a gallery's
// photograph, so none drops what its author wrote about it.

/**
 * A placement as a shared renderer shows it: its image, with the overrides
 * placedImage() applies, and its caption with when, where, and with what
 * tags it was taken. None when the asset isn't an image the view holds.
 */
export function placedMedia(
  placement: Placement | undefined,
  ctx: RenderContext,
): PlacedImage | undefined {
  if (!placement) return undefined;
  const details: ReactNode[] = [
    placement.takenAt !== undefined && (
      <DateText key="taken" raw={placement.takenAt} ctx={ctx} field="takenAt" />
    ),
    placement.location,
  ];
  const captioned =
    present(placement.caption) ||
    details.some((part) => (typeof part === 'string' ? present(part) : Boolean(part))) ||
    Boolean(placement.tags?.length);
  return placedImage(
    placement,
    ctx.input,
    captioned ? (
      <>
        {present(placement.caption) ? <p className="pf-caption">{placement.caption}</p> : null}
        <Meta parts={details} />
        <TagList items={placement.tags} />
      </>
    ) : undefined,
  );
}
