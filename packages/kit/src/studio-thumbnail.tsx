import type { ReactNode } from 'react';

// What a variant's Studio thumbnail is drawn with (`@portfolio/kit/studio-thumbnail`): the
// palette Studio hands it, and the few SVG helpers the drawings share. A variant package's
// `./studio-thumbnail` export default-exports a StudioThumbnail, a pure function from the
// palette to the drawing's SVG children, 136 by 85 (16:10). Studio sets the <svg> around it,
// and a variant with no such export gets Studio's generic plate. No frame, script, clock,
// randomness, or network: the same palette always draws the same picture.

/** The colours a thumbnail is drawn in: a scheme's anchors in one mode, and tones mixed from them. */
export interface StudioPalette {
  readonly canvas: string;
  readonly text: string;
  readonly accent: string;
  readonly secondary: string;
  readonly surface: string;
  readonly rule: string;
  readonly muted: string;
  readonly strong: string;
}

/** A variant's Studio thumbnail: its structure drawn in `palette`, as an SVG's children. */
export type StudioThumbnail = (palette: StudioPalette) => ReactNode;

const HEX = /^#[0-9a-f]{6}$/i;
const rgbOf = (hex: string) => [1, 3, 5].map((at) => Number.parseInt(hex.slice(at, at + 2), 16));

/** `from`'s channels moved toward `to`'s by `t`, as #rrggbb. */
const toward = (from: readonly number[], to: readonly number[], t: number) =>
  `#${from
    .map((value, at) =>
      Math.round(Math.max(0, Math.min(255, value + (to[at]! - value) * t)))
        .toString(16)
        .padStart(2, '0'),
    )
    .join('')}`;

/** `a` mixed toward `b` by `t`, both #rrggbb; `a` itself for anything else. */
export function mix(a: string, b: string, t: number): string {
  if (!HEX.test(a) || !HEX.test(b)) return a;
  return toward(rgbOf(a), rgbOf(b), t);
}

/**
 * `color` lightened toward white by `t`, as light falls on a palette's own colour: a
 * drawing's highlight, never a colour of its own. `color` itself for anything but #rrggbb.
 */
export function tint(color: string, t: number): string {
  return HEX.test(color) ? toward(rgbOf(color), [255, 255, 255], t) : color;
}

/** `color` darkened toward black by `t`, a palette colour in shadow; `color` itself for anything else. */
export function shade(color: string, t: number): string {
  return HEX.test(color) ? toward(rgbOf(color), [0, 0, 0], t) : color;
}

/** A rectangle, rounded by `rx` when it's given. */
export const Box = ({
  x,
  y,
  w,
  h,
  fill,
  rx,
}: {
  x: number;
  y: number;
  w: number;
  h: number;
  fill: string;
  rx?: number;
}) => <rect x={x} y={y} width={w} height={h} fill={fill} {...(rx ? { rx } : {})} />;

/**
 * A headline as the concepts draw it at thumbnail size: a solid bar at the
 * headline's x-height, the word's width unless the composition runs it
 * across the measure. A thumbnail is a picture, so it sets no text a reader
 * would try to read at 6px.
 */
export const Headline = ({
  x,
  y,
  size,
  fill,
  w,
}: {
  x: number;
  y: number;
  size: number;
  fill: string;
  w?: number;
}) => (
  <rect
    x={x}
    y={(y - 0.62 * size).toFixed(2)}
    width={(w ?? 3.4 * size).toFixed(2)}
    height={(0.62 * size).toFixed(2)}
    rx={(0.08 * size).toFixed(2)}
    fill={fill}
  />
);
