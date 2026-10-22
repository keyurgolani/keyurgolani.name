import type { CSSProperties, ReactNode } from 'react';
import { cn } from '../cn';
import { present, Ui, type RenderContext } from './primitives';

// How a shared renderer shows an image placement (#10, slice 1, item 7).
// Everything about the picture itself comes from derived data: its
// renditions, width, and height. Until a rendition exists, a placement that
// isn't decorative keeps its box, its caption, and its credit, and says
// "Image unavailable"; a decorative one renders nothing. Alt text is the
// owner's alone, never a title or a caption. The focal point is the one
// inline style a shared renderer sets: two custom properties, which the
// stylesheet's object-position reads.

/** One rendition of an image, as derived data lists it. */
export interface ImageRendition {
  /** Under the view's media base, as `<mediaBase>/<assetId>/<sha256>/<rendition>.<ext>`. */
  readonly url: string;
  /** Its width in pixels. */
  readonly width: number;
  /** Its type, such as image/webp. */
  readonly mime: string;
}

/** What derivation knows about a picture: its size and renditions. */
export interface DerivedImage {
  readonly width: number;
  readonly height: number;
  readonly renditions: readonly ImageRendition[];
}

/** An image ready to render, or why it isn't. */
export type ImageState =
  | { readonly state: 'ready'; readonly value: DerivedImage }
  | { readonly state: 'unavailable'; readonly reason: string };

/** A placement, its overrides applied: what the figure renders. */
export interface PlacedImage {
  /** The media asset's id. */
  readonly asset: string;
  /** The owner's words for what it shows. Absent when not authored. */
  readonly alt?: string;
  /** The placement's caption, already rendered. */
  readonly caption?: ReactNode;
  /** Who made it, shown beside it. */
  readonly credit?: string;
  /** Decoration: an empty alt when ready, and nothing at all when not. */
  readonly decorative: boolean;
  /** Where the subject sits, 0 to 1 from the start and the top. */
  readonly focalPoint?: { readonly x: number; readonly y: number };
  readonly image: ImageState;
}

/** The two custom properties the stylesheet's object-position reads. */
export function focalStyle(focalPoint: PlacedImage['focalPoint']): CSSProperties | undefined {
  if (!focalPoint) return undefined;
  return { '--focal-x': focalPoint.x, '--focal-y': focalPoint.y } as CSSProperties;
}

/** The renditions of one type, narrowest first, as a srcset. */
function srcset(renditions: readonly ImageRendition[]): string {
  return [...renditions]
    .sort((a, b) => a.width - b.width)
    .map((rendition) => `${rendition.url} ${rendition.width}w`)
    .join(', ');
}

/**
 * The rendition an `<img>` falls back to without srcset: the widest at or
 * under 960 pixels, else the narrowest.
 */
function fallbackRendition(renditions: readonly ImageRendition[]): ImageRendition {
  const sorted = [...renditions].sort((a, b) => a.width - b.width);
  return sorted.filter((rendition) => rendition.width <= 960).at(-1) ?? sorted[0]!;
}

/** WebP, AVIF, and other modern types go in a `<source>`; JPEG or PNG is the `<img>`'s own. */
const FALLBACK_TYPES = new Set(['image/jpeg', 'image/png', 'image/gif']);

/**
 * The picture: one `<img>` for one type of rendition, or a `<picture>` with a
 * `<source>` for each modern type and the `<img>` in JPEG or PNG.
 */
function Picture({
  placed,
  image,
  className,
  eager,
  sizes,
}: {
  placed: PlacedImage;
  image: DerivedImage;
  className?: string;
  eager: boolean;
  sizes: string;
}) {
  const byType = new Map<string, ImageRendition[]>();
  for (const rendition of image.renditions) {
    const list = byType.get(rendition.mime) ?? [];
    list.push(rendition);
    byType.set(rendition.mime, list);
  }
  const fallbackType = [...byType.keys()].find((mime) => FALLBACK_TYPES.has(mime));
  const imgRenditions = byType.get(fallbackType ?? [...byType.keys()][0]!)!;
  const sources = [...byType].filter(
    ([mime]) => fallbackType !== undefined && mime !== fallbackType,
  );
  // alt="" is decoration. Without the owner's alt text the image has none
  // at all, so an accessibility audit finds it; #10's publish gate refuses it.
  const alt = placed.decorative ? '' : present(placed.alt) ? placed.alt.trim() : undefined;
  const img = (
    // eslint-disable-next-line @next/next/no-img-element -- renditions are already sized; next/image would proxy them through /_next/image
    <img
      className={className}
      src={fallbackRendition(imgRenditions).url}
      srcSet={srcset(imgRenditions)}
      sizes={sizes}
      width={image.width}
      height={image.height}
      alt={alt}
      loading={eager ? undefined : 'lazy'}
      decoding="async"
      style={focalStyle(placed.focalPoint)}
    />
  );
  if (sources.length === 0) return img;
  return (
    <picture>
      {sources.map(([mime, renditions]) => (
        <source key={mime} type={mime} srcSet={srcset(renditions)} sizes={sizes} />
      ))}
      {img}
    </picture>
  );
}

/** The box an image that isn't there yet keeps, with its label. */
function UnavailableBox({
  placed,
  ctx,
  small,
}: {
  placed: PlacedImage;
  ctx: RenderContext;
  small: boolean;
}) {
  return (
    <span
      className={cn('pf-media-box', small && 'pf-media-box--small')}
      data-media-state="unavailable"
      data-media-reason={placed.image.state === 'unavailable' ? placed.image.reason : undefined}
    >
      <span className="pf-media-box__label">
        <Ui ctx={ctx}>Image unavailable</Ui>
      </span>
    </span>
  );
}

export interface MediaFigureProps {
  readonly placed: PlacedImage;
  readonly ctx: RenderContext;
  readonly className?: string;
  /** Loads at once: the signature work's cover alone. Every other image loads lazily. */
  readonly eager?: boolean;
  /** How wide it shows, for the renditions a browser picks. */
  readonly sizes?: string;
  /** A logo or avatar beside text: no figure, the credit right after it. */
  readonly inline?: boolean;
}

/**
 * An image placement: the picture when it's ready, its box and label when
 * it isn't, and nothing for decoration that isn't there. A caption or a
 * credit puts it in a figure.
 */
export function MediaFigure({
  placed,
  ctx,
  className,
  eager = false,
  sizes = '100vw',
  inline = false,
}: MediaFigureProps) {
  // A ready value with no rendition has nothing to point an <img> at.
  const image =
    placed.image.state === 'ready' && placed.image.value.renditions.length > 0
      ? placed.image.value
      : undefined;
  const ready = image !== undefined;
  if (!ready && placed.decorative) return null;
  const picture = image ? (
    <Picture placed={placed} image={image} className={className} eager={eager} sizes={sizes} />
  ) : (
    <UnavailableBox placed={placed} ctx={ctx} small={inline} />
  );
  const credit = present(placed.credit) ? (
    <small className="pf-credit">{placed.credit}</small>
  ) : null;
  if (inline) {
    return (
      <>
        {picture}
        {credit}
      </>
    );
  }
  const caption = placed.caption ?? null;
  return (
    <figure
      className={cn('pf-figure', !ready && 'pf-figure--unavailable')}
      data-media-asset={placed.asset}
    >
      {picture}
      {caption !== null || credit !== null ? (
        <figcaption>
          {caption}
          {credit}
        </figcaption>
      ) : null}
    </figure>
  );
}
