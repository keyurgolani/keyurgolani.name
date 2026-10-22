// Color arithmetic for the scheme derivations (#19, Slices 1 and 2). Colors
// are six-digit lowercase hex in and out. Mixing is in gamma-encoded sRGB,
// as color-mix(in srgb, ...) is, with each channel rounded; contrast is WCAG
// 2's; lightness steps are OKLCH's, at a constant hue, with chroma reduced
// until the color fits sRGB.

export const BLACK = '#000000';
export const WHITE = '#ffffff';

const HEX = /^#[0-9a-f]{6}$/;

/** Whether `value` is a six-digit lowercase hex color, such as #2b241c. */
export function isHex(value: unknown): value is string {
  return typeof value === 'string' && HEX.test(value);
}

type Channels = readonly [number, number, number];

function channels(hex: string): Channels {
  return [
    Number.parseInt(hex.slice(1, 3), 16),
    Number.parseInt(hex.slice(3, 5), 16),
    Number.parseInt(hex.slice(5, 7), 16),
  ];
}

function hex(values: readonly number[]): string {
  return `#${values.map((value) => value.toString(16).padStart(2, '0')).join('')}`;
}

/**
 * `from` moved `percent` percent of the way to `to`, as color-mix(in srgb,
 * from, to percent%) is, each channel rounded half up. `percent` is a whole
 * number, so the arithmetic is exact in integers.
 */
export function mix(from: string, to: string, percent: number): string {
  if (!Number.isInteger(percent) || percent < 0 || percent > 100) {
    throw new RangeError('A mix is a whole percentage from 0 to 100.');
  }
  const a = channels(from);
  const b = channels(to);
  return hex(
    a.map((value, index) => Math.floor((value * (100 - percent) + b[index]! * percent + 50) / 100)),
  );
}

function toLinear(channel: number): number {
  const value = channel / 255;
  return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
}

function toGamma(value: number): number {
  return value <= 0.0031308 ? 12.92 * value : 1.055 * value ** (1 / 2.4) - 0.055;
}

/** WCAG 2 relative luminance. */
export function luminance(color: string): number {
  const [r, g, b] = channels(color).map(toLinear) as unknown as Channels;
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** The WCAG 2 contrast ratio of two colors, from 1 to 21. */
export function contrast(first: string, second: string): number {
  const a = luminance(first);
  const b = luminance(second);
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}

type Lab = readonly [number, number, number];

function oklab(color: string): Lab {
  const [r, g, b] = channels(color).map(toLinear) as unknown as Channels;
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  return [
    0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  ];
}

function linearRgb([lightness, a, b]: Lab): Channels {
  const l = (lightness + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (lightness - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (lightness - 0.0894841775 * a - 1.291485548 * b) ** 3;
  return [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ];
}

const GAMUT_EPSILON = 1e-6;
const fits = (rgb: Channels) =>
  rgb.every((value) => value >= -GAMUT_EPSILON && value <= 1 + GAMUT_EPSILON);

/** OKLab to hex, keeping lightness and hue and reducing chroma until the color is in sRGB. */
function fromOklab([lightness, a, b]: Lab): string {
  if (lightness <= 0) return BLACK;
  if (lightness >= 1) return WHITE;
  let rgb = linearRgb([lightness, a, b]);
  if (!fits(rgb)) {
    // At zero chroma the color is a gray, which always fits.
    let low = 0;
    let high = 1;
    for (let step = 0; step < 32; step += 1) {
      const middle = (low + high) / 2;
      if (fits(linearRgb([lightness, a * middle, b * middle]))) low = middle;
      else high = middle;
    }
    rgb = linearRgb([lightness, a * low, b * low]);
  }
  return hex(rgb.map((value) => Math.round(Math.min(1, Math.max(0, toGamma(value))) * 255)));
}

/** The color's OKLCH lightness, from 0 to 1. */
export function lightness(color: string): number {
  return oklab(color)[0];
}

/** The color at OKLCH lightness `value`, with its hue, in sRGB. */
export function withLightness(color: string, value: number): string {
  const [, a, b] = oklab(color);
  return fromOklab([Math.min(1, Math.max(0, value)), a, b]);
}
