// CIEDE2000 (ΔE00), the CIE's perceptual color difference, for the color
// scheme guard (LANG-4): pure functions over CIELAB, and sRGB hex into
// CIELAB, so a unit test checks them against Sharma, Wu, and Dalal's
// published reference pairs ("The CIEDE2000 Color-Difference Formula:
// Implementation Notes, Supplementary Test Data, and Mathematical
// Observations", Color Research & Application 30(1), 2005).
//
// The formula follows those notes exactly: hue angles in degrees from 0 to
// 360, h' 0 when a' and b' are both 0, the mean hue and Δh' by the notes'
// cases when |h1' - h2'| passes 180, and the parametric factors kL, kC, kH
// at 1, the reference conditions. A ΔE00 of about 1 is a just noticeable
// difference, and about 2 is the least most viewers see side by side.

/** A color in CIELAB: L* from 0 to 100, a* and b* about -128 to 127. */
export type Lab = readonly [number, number, number];

/** The CIE's D65 white, the white sRGB is defined against (X, Y, Z, Y = 1). */
export const D65_WHITE = [0.95047, 1, 1.08883] as const;

const rad = (degrees: number) => (degrees * Math.PI) / 180;
const deg = (radians: number) => (radians * 180) / Math.PI;

/** An sRGB channel (0..1, gamma-encoded) in linear light, as IEC 61966-2-1 defines it. */
export function srgbToLinear(channel: number): number {
  return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
}

/** A six-digit hex sRGB color in CIE XYZ, D65, Y from 0 to 1. */
export function hexToXyz(hex: string): readonly [number, number, number] {
  if (!/^#[0-9a-f]{6}$/i.test(hex)) throw new RangeError(`${hex} isn't a six-digit hex color`);
  const [r, g, b] = [1, 3, 5].map((start) =>
    srgbToLinear(Number.parseInt(hex.slice(start, start + 2), 16) / 255),
  ) as [number, number, number];
  return [
    0.4124564 * r + 0.3575761 * g + 0.1804375 * b,
    0.2126729 * r + 0.7151522 * g + 0.072175 * b,
    0.0193339 * r + 0.119192 * g + 0.9503041 * b,
  ];
}

const EPSILON = 216 / 24389;
const KAPPA = 24389 / 27;
const f = (t: number) => (t > EPSILON ? Math.cbrt(t) : (KAPPA * t + 16) / 116);

/** CIE XYZ, Y from 0 to 1, in CIELAB against `white` (D65 unless given). */
export function xyzToLab(
  [x, y, z]: readonly [number, number, number],
  white: readonly [number, number, number] = D65_WHITE,
): Lab {
  const [fx, fy, fz] = [f(x / white[0]), f(y / white[1]), f(z / white[2])];
  return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)];
}

/** A six-digit hex sRGB color in CIELAB, D65. */
export const hexToLab = (hex: string): Lab => xyzToLab(hexToXyz(hex));

/** The parametric weighting factors; 1, 1, 1 are the reference conditions. */
export interface Weights {
  readonly kL?: number;
  readonly kC?: number;
  readonly kH?: number;
}

/** A hue angle in degrees from 0 to 360, 0 for a neutral (a' and b' both 0). */
function hueAngle(b: number, a: number): number {
  if (a === 0 && b === 0) return 0;
  const angle = deg(Math.atan2(b, a));
  return angle < 0 ? angle + 360 : angle;
}

/** ΔE00 between two CIELAB colors: 0 for the same color, symmetric. */
export function ciede2000(
  [l1, a1, b1]: Lab,
  [l2, a2, b2]: Lab,
  { kL = 1, kC = 1, kH = 1 }: Weights = {},
): number {
  const c1 = Math.hypot(a1, b1);
  const c2 = Math.hypot(a2, b2);
  const cMean = (c1 + c2) / 2;
  const g = 0.5 * (1 - Math.sqrt(cMean ** 7 / (cMean ** 7 + 25 ** 7)));
  const a1p = (1 + g) * a1;
  const a2p = (1 + g) * a2;
  const c1p = Math.hypot(a1p, b1);
  const c2p = Math.hypot(a2p, b2);
  const h1p = hueAngle(b1, a1p);
  const h2p = hueAngle(b2, a2p);

  const dLp = l2 - l1;
  const dCp = c2p - c1p;
  let dhp = 0;
  if (c1p * c2p !== 0) {
    dhp = h2p - h1p;
    if (dhp > 180) dhp -= 360;
    else if (dhp < -180) dhp += 360;
  }
  const dHp = 2 * Math.sqrt(c1p * c2p) * Math.sin(rad(dhp / 2));

  const lMean = (l1 + l2) / 2;
  const cMeanP = (c1p + c2p) / 2;
  let hMean = h1p + h2p;
  if (c1p * c2p !== 0) {
    if (Math.abs(h1p - h2p) <= 180) hMean = (h1p + h2p) / 2;
    else if (h1p + h2p < 360) hMean = (h1p + h2p + 360) / 2;
    else hMean = (h1p + h2p - 360) / 2;
  }
  const t =
    1 -
    0.17 * Math.cos(rad(hMean - 30)) +
    0.24 * Math.cos(rad(2 * hMean)) +
    0.32 * Math.cos(rad(3 * hMean + 6)) -
    0.2 * Math.cos(rad(4 * hMean - 63));
  const dTheta = 30 * Math.exp(-(((hMean - 275) / 25) ** 2));
  const rC = 2 * Math.sqrt(cMeanP ** 7 / (cMeanP ** 7 + 25 ** 7));
  const sL = 1 + (0.015 * (lMean - 50) ** 2) / Math.sqrt(20 + (lMean - 50) ** 2);
  const sC = 1 + 0.045 * cMeanP;
  const sH = 1 + 0.015 * cMeanP * t;
  const rT = -Math.sin(rad(2 * dTheta)) * rC;

  const l = dLp / (kL * sL);
  const c = dCp / (kC * sC);
  const h = dHp / (kH * sH);
  return Math.sqrt(l * l + c * c + h * h + rT * c * h);
}

/** ΔE00 between two six-digit hex sRGB colors. */
export const deltaE00 = (first: string, second: string, weights: Weights = {}): number =>
  ciede2000(hexToLab(first), hexToLab(second), weights);
