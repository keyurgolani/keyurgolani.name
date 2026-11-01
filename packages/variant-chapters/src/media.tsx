import type { Placement } from '@portfolio/schema';
import { MediaFigure, placedImage, renderContext, safeHref } from '@portfolio/kit/sections';
import type { Input } from './text';

/**
 * A placement's picture alone, through the kit (its renditions, alt, focal
 * point, and the box it keeps until a rendition exists), with no caption:
 * the book captions its own plates. Nothing for an asset the view lacks.
 */
export function Picture({
  placement,
  input,
  className,
  eager = false,
  sizes,
}: {
  placement: Placement | undefined;
  input: Input;
  className?: string;
  eager?: boolean;
  sizes?: string;
}) {
  const placed = placedImage(placement, input);
  if (!placed) return null;
  const ctx = renderContext(input, { id: placed.asset }, 2);
  return (
    <MediaFigure
      placed={placed}
      ctx={ctx}
      className={className}
      eager={eager}
      sizes={sizes ?? '(width < 60rem) 100vw, 44rem'}
      inline
    />
  );
}

/** Whether the placement shows a picture the view holds. */
export const hasPicture = (placement: Placement | undefined, input: Input) =>
  placedImage(placement, input) !== undefined;

/**
 * A document placement's file, as the view publishes it, for a link to open it: none until the
 * media pipeline has derived it. The kit draws images alone, so a document is the book's to link.
 */
export function documentHref(placement: Placement, input: Input): string | undefined {
  const asset = Object.hasOwn(input.media, placement.asset)
    ? input.media[placement.asset]
    : undefined;
  if (!asset || asset.kind === 'image' || asset.derived.state !== 'ready') return undefined;
  const file = asset.derived.value.renditions[0];
  return file ? safeHref(file.url) : undefined;
}
