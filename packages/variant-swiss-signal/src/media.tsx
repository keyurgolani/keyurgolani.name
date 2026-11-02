import type { Placement } from '@portfolio/schema';
import { MediaFigure, placedImage, renderContext, type PlacedImage } from '@portfolio/kit/sections';
import type { VariantRenderInput } from '@portfolio/variant-contract';

// Swiss's images: the kit's picture (renditions, srcset, the unavailable
// box) inside the composition's own frames. A thumbnail beside its title
// is decoration, so the title link stays the one name for both.

/** Whether a placement's image is ready to show. */
export function readyImage(
  placement: Placement | undefined,
  input: VariantRenderInput,
): PlacedImage | undefined {
  const placed = placedImage(placement, input);
  return placed && placed.image.state === 'ready' ? placed : undefined;
}

export function Img({
  placed,
  input,
  className,
  sizes,
  eager = false,
  decorative = false,
}: {
  placed: PlacedImage;
  input: VariantRenderInput;
  className?: string;
  sizes: string;
  eager?: boolean;
  decorative?: boolean;
}) {
  const ctx = renderContext(input, { id: placed.asset, title: undefined }, 3);
  const shown: PlacedImage = decorative
    ? {
        ...placed,
        decorative: true,
        alt: undefined,
        caption: undefined,
        credit: undefined,
        rights: undefined,
      }
    : placed;
  return (
    <MediaFigure
      placed={shown}
      ctx={ctx}
      className={className}
      sizes={sizes}
      eager={eager}
      inline
    />
  );
}
