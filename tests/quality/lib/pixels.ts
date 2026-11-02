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

/** An alpha as CSS writes it, a number or a percentage; 1 when there's none. */
const alphaOf = (value: string | undefined): number =>
  value === undefined ? 1 : value.endsWith('%') ? Number.parseFloat(value) / 100 : Number(value);

/** A channel from 0 to 1 in sRGB's gamma, clamped into it, as 0 to 255. */
const byte = (value: number): number => Math.round(255 * Math.min(1, Math.max(0, value)));

/** Linear-light sRGB to sRGB's transfer curve. */
const gamma = (value: number): number =>
  Math.abs(value) <= 0.0031308
    ? 12.92 * value
    : Math.sign(value) * (1.055 * Math.abs(value) ** (1 / 2.4) - 0.055);

/** Oklab to sRGB, clamped into its gamut, as Björn Ottosson's reference conversion has it. */
function oklabToRgb(l: number, a: number, b: number): Rgb {
  const l1 = (l + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m1 = (l - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s1 = (l - 0.0894841775 * a - 1.291485548 * b) ** 3;
  return [
    byte(gamma(4.0767416621 * l1 - 3.3077115913 * m1 + 0.2309699292 * s1)),
    byte(gamma(-1.2684380046 * l1 + 2.6097574011 * m1 - 0.3413193965 * s1)),
    byte(gamma(-0.0041960863 * l1 - 0.7034186147 * m1 + 1.707614701 * s1)),
  ];
}

/** sRGB to Oklab, as Björn Ottosson's reference conversion has it. */
export function rgbToOklab([r, g, b]: Rgb): readonly [number, number, number] {
  const linear = (c: number) => {
    const s = c / 255;
    return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  const [lr, lg, lb] = [linear(r), linear(g), linear(b)];
  const l = Math.cbrt(0.4122214708 * lr + 0.5363325363 * lg + 0.0514459929 * lb);
  const m = Math.cbrt(0.2119034982 * lr + 0.6806995451 * lg + 0.1073969566 * lb);
  const s = Math.cbrt(0.0883024619 * lr + 0.2817188376 * lg + 0.6299787005 * lb);
  return [
    0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  ];
}

/**
 * The distance of two sRGB colors in Oklab, times 100, so about 2 is the least a person sees
 * side by side: a line of 2 tells grounds and inks of different hues apart, where an RGB
 * equality with a tolerance called (36,44,36) and (44,36,28), 2.8 apart, the same (A P2-A).
 */
export function deltaEOk(a: Rgb, b: Rgb): number {
  const [x, y] = [rgbToOklab(a), rgbToOklab(b)];
  return 100 * Math.hypot(x[0] - y[0], x[1] - y[1], x[2] - y[2]);
}

const NUMBER = '(-?[\\d.]+(?:e-?\\d+)?%?|none)';
const SPACED = new RegExp(
  `^(oklab|oklch|color)\\(\\s*(?:(srgb)\\s+)?${NUMBER}\\s+${NUMBER}\\s+${NUMBER}(?:\\s*/\\s*${NUMBER})?\\s*\\)$`,
);

/**
 * A computed color, with its alpha: `rgb(...)` or `rgba(...)`, and the
 * forms Chromium computes a color-mix() or a relative color to, `oklab()`,
 * `oklch()`, and `color(srgb ...)`, in sRGB, an Oklab one clamped into its
 * gamut as the screenshot is. Null for anything else, such as a wider
 * gamut's color(), which an sRGB screenshot can't be held against.
 */
export function parseCssColor(value: string): { rgb: Rgb; alpha: number } | null {
  const text = value.trim();
  const match =
    /^rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)(?:\s*[,/]\s*([\d.]+%?))?\s*\)$/.exec(text);
  if (match) {
    return {
      rgb: [Number(match[1]), Number(match[2]), Number(match[3])],
      alpha: alphaOf(match[4]),
    };
  }
  const spaced = SPACED.exec(text);
  if (!spaced) return null;
  const [, fn, space, x = '0', y = '0', z = '0', alpha] = spaced;
  if ((fn === 'color') !== (space === 'srgb')) return null;
  // `none` is a missing channel, which computes as zero; a percentage is of the channel's reference range.
  const channel = (raw: string, range: number) =>
    raw === 'none' ? 0 : raw.endsWith('%') ? (Number.parseFloat(raw) / 100) * range : Number(raw);
  const a = alpha === 'none' ? 0 : alphaOf(alpha);
  if (fn === 'color') {
    return { rgb: [byte(channel(x, 1)), byte(channel(y, 1)), byte(channel(z, 1))], alpha: a };
  }
  if (fn === 'oklab') {
    return { rgb: oklabToRgb(channel(x, 1), channel(y, 0.4), channel(z, 0.4)), alpha: a };
  }
  const hue = (Number.parseFloat(z) * Math.PI) / 180 || 0;
  const chroma = channel(y, 0.4);
  return {
    rgb: oklabToRgb(channel(x, 1), chroma * Math.cos(hue), chroma * Math.sin(hue)),
    alpha: a,
  };
}

/** `top` laid over `under` at `alpha`. */
export const blend = (top: Rgb, alpha: number, under: Rgb): Rgb => [
  top[0] * alpha + under[0] * (1 - alpha),
  top[1] * alpha + under[1] * (1 - alpha),
  top[2] * alpha + under[2] * (1 - alpha),
];
