import type { CSSProperties, ReactNode } from 'react';
import type { Derived, ViewMediaValue, ViewRendition } from '@portfolio/schema';
import { cn } from '../cn';
import { present, Ui, type RenderContext } from './primitives';

// How a shared renderer shows an image placement (#10, slice 1, item 7).
// Everything about the picture itself comes from derived data: its
// renditions, width, and height. Until a rendition exists, a placement that
// isn't decorative keeps its box, its caption, and its credit, and says
// "Image unavailable"; a decorative one renders nothing. Every placement
// goes through placedMedia() in placement.tsx, so each shows its caption,
// and when, where, and with what tags it was taken. Alt text is the owner's
// alone, never a title or a caption. The focal point is the one inline style
// a shared renderer sets: two custom properties, which the stylesheet's
// object-position reads.

/** One rendition of an image, as the view lists it, its URL under the view's media base. */
export type ImageRendition = ViewRendition;

/** What derivation knows about a picture: its size and renditions. */
export type DerivedImage = ViewMediaValue;

/** An image's derived value: ready, or why it isn't (#10's Derived). */
export type ImageState = Derived<ViewMediaValue>;

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
  /** Who holds its rights and under what license, shown after the credit (#10). */
  readonly rights?: {
    readonly holder?: string;
    readonly license?: string;
    readonly attributionRequired?: boolean;
  };
  /** Decoration: an empty alt when ready, and nothing at all when not. */
  readonly decorative: boolean;
  /** Where the subject sits, 0 to 1 from the start and the top. */
  readonly focalPoint?: { readonly x: number; readonly y: number };
  readonly image: ImageState;
}

/** A focal coordinate as the style takes it: a finite number, held to 0 through 1. */
function coordinate(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value)
    ? Math.min(1, Math.max(0, value))
    : undefined;
}

/**
 * The two custom properties the stylesheet's object-position reads. Each is
 * a number from 0 to 1, so the attribute holds nothing else: a point that
 * isn't two finite numbers gets no style at all.
 */
export function focalStyle(focalPoint: PlacedImage['focalPoint']): CSSProperties | undefined {
  if (!focalPoint) return undefined;
  const x = coordinate(focalPoint.x);
  const y = coordinate(focalPoint.y);
  if (x === undefined || y === undefined) return undefined;
  return { '--focal-x': x, '--focal-y': y } as CSSProperties;
}

/** The renditions of one type that say how wide they are, narrowest first, as a srcset. */
function srcset(renditions: readonly ImageRendition[]): string | undefined {
  const sized = renditions
    .filter(
      (rendition): rendition is ImageRendition & { width: number } => rendition.width !== undefined,
    )
    .sort((a, b) => a.width - b.width);
  return sized.length > 0
    ? sized.map((rendition) => `${rendition.url} ${rendition.width}w`).join(', ')
    : undefined;
}

/**
 * The rendition an `<img>` falls back to without srcset: the widest at or
 * under 960 pixels, else the narrowest, else the first one listed.
 */
function fallbackRendition(renditions: readonly ImageRendition[]): ImageRendition {
  const sized = renditions
    .filter((rendition) => rendition.width !== undefined)
    .sort((a, b) => a.width! - b.width!);
  return sized.filter((rendition) => rendition.width! <= 960).at(-1) ?? sized[0] ?? renditions[0]!;
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
  for (const rendition of image.renditions.filter(({ mime }) => mime.startsWith('image/'))) {
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
  const set = srcset(imgRenditions);
  const img = (
    // eslint-disable-next-line @next/next/no-img-element -- renditions are already sized; next/image would proxy them through /_next/image
    <img
      className={className}
      src={fallbackRendition(imgRenditions).url}
      srcSet={set}
      sizes={set === undefined ? undefined : sizes}
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
      {sources.map(([mime, renditions]) => {
        const sourceSet = srcset(renditions) ?? fallbackRendition(renditions).url;
        return <source key={mime} type={mime} srcSet={sourceSet} sizes={sizes} />;
      })}
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

/**
 * The rights holder and the license, as authored and nothing added; when the
 * credit is required, the line says so in an attribute a stylesheet or a
 * variant may read. Null when neither is authored.
 */
function rightsLine(rights: PlacedImage['rights']): ReactNode {
  if (!rights || (!present(rights.holder) && !present(rights.license))) return null;
  return (
    <small
      className="pf-rights"
      {...(rights.attributionRequired === true ? { 'data-attribution-required': 'true' } : {})}
    >
      {present(rights.holder) ? <span className="pf-rights-holder">{rights.holder}</span> : null}
      {present(rights.license) ? <span className="pf-rights-license">{rights.license}</span> : null}
    </small>
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
  /** A logo or avatar beside text: no figure, its caption and credit right after it. */
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
  // A ready value with no image rendition has nothing to point an <img> at.
  const image =
    placed.image.state === 'ready' &&
    placed.image.value.renditions.some(({ mime }) => mime.startsWith('image/'))
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
  const rights = rightsLine(placed.rights);
  const caption = placed.caption ?? null;
  if (inline) {
    return (
      <>
        {picture}
        {caption}
        {credit}
        {rights}
      </>
    );
  }
  return (
    <figure
      className={cn('pf-figure', !ready && 'pf-figure--unavailable')}
      data-media-asset={placed.asset}
    >
      {picture}
      {caption !== null || credit !== null || rights !== null ? (
        <figcaption>
          {caption}
          {credit}
          {rights}
        </figcaption>
      ) : null}
    </figure>
  );
}
