// Pixels for the accessibility suites (#11, Slice 2): Playwright's PNG
// screenshots decoded in Node, and WCAG 2's contrast on them. The focus
// check diffs a control's focused and blurred clips, and the contrast check
// samples the background under text with its glyphs hidden. pngjs decodes.

import { PNG } from 'pngjs';

export type Rgb = readonly [number, number, number];

export interface Image {
  readonly width: number;
  readonly height: number;
  /** RGBA, 4 bytes a pixel, row by row. */
  readonly data: Uint8Array;
}

/** Decodes a PNG to RGBA with pngjs, which reads every PNG a screenshot makes. */
export function decodePng(png: Uint8Array): Image {
  const { width, height, data } = PNG.sync.read(Buffer.from(png));
  return { width, height, data };
}

/** The pixel at index `i`, alpha dropped (screenshots are opaque). */
export const pixel = (image: Image, i: number): Rgb => [
  image.data[i * 4]!,
  image.data[i * 4 + 1]!,
  image.data[i * 4 + 2]!,
];

/** WCAG 2's relative luminance of an sRGB color. */
export function luminance([r, g, b]: Rgb): number {
  const linear = (c: number) => {
    const s = c / 255;
    return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * linear(r) + 0.7152 * linear(g) + 0.0722 * linear(b);
}

/** WCAG 2's contrast ratio of two colors, from 1 to 21. */
export function contrast(a: Rgb, b: Rgb): number {
  const [x, y] = [luminance(a), luminance(b)];
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
}

/** `rgb(...)` or `rgba(...)`, as getComputedStyle gives a color, with its alpha; null for anything else. */
export function parseCssColor(value: string): { rgb: Rgb; alpha: number } | null {
  const match =
    /^rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)(?:\s*[,/]\s*([\d.]+%?))?\s*\)$/.exec(
      value.trim(),
    );
  if (!match) return null;
  const alpha =
    match[4] === undefined
      ? 1
      : match[4].endsWith('%')
        ? Number.parseFloat(match[4]) / 100
        : Number(match[4]);
  return { rgb: [Number(match[1]), Number(match[2]), Number(match[3])], alpha };
}

/** `top` laid over `under` at `alpha`. */
export const blend = (top: Rgb, alpha: number, under: Rgb): Rgb => [
  top[0] * alpha + under[0] * (1 - alpha),
  top[1] * alpha + under[1] * (1 - alpha),
  top[2] * alpha + under[2] * (1 - alpha),
];
