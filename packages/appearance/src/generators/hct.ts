// HCT (#20 PR 3), first-party: hue and chroma from CAM16 (Li et al.,
// "Comprehensive color solutions: CAM16, CAT16, and CAM16-UCS", 2017) under
// the viewing conditions Material Design's HCT color space defines (a D65
// white, an adapting luminance of 200/pi times L* 50's Y, an L* 50
// background, an average surround, no discounting), and tone as CIELAB L*.
// It's written from those published formulas, not from any library's code.
//
// toneOf() and hctOf() read a color, and fromHct() solves for one: the
// color at exactly the asked tone and hue with the most chroma sRGB holds,
// up to the asked chroma. Pure and browser-safe like the rest of
// ./generators, so the server and the browser get the same hex.

/** sRGB's linear components to XYZ, D65, Y from 0 to 100. */
const SRGB_TO_XYZ = [
  [0.41233895, 0.35762064, 0.18051042],
  [0.2126, 0.7152, 0.0722],
  [0.01932141, 0.11916382, 0.95034478],
] as const;

const XYZ_TO_SRGB = [
  [3.2413774792388685, -1.5376652402851851, -0.49885366846268053],
  [-0.9691452513005321, 1.8758853451067872, 0.04156585616912061],
  [0.05562093689691305, -0.20395524564742123, 1.0571799111220335],
] as const;

/** CAT16, XYZ to the cone responses, and its inverse. */
const CAT16 = [
  [0.401288, 0.650173, -0.051461],
  [-0.250268, 1.204414, 0.045854],
  [-0.002079, 0.048952, 0.953127],
] as const;

const CAT16_INVERSE = [
  [1.8620678, -1.0112547, 0.14918678],
  [0.38752654, 0.62144744, -0.00897398],
  [-0.0158415, -0.03412294, 1.0499644],
] as const;

const WHITE_POINT = [95.047, 100, 108.883] as const;

type Vector = readonly [number, number, number];
type Matrix = readonly (readonly [number, number, number])[];

function times(matrix: Matrix, [x, y, z]: Vector): Vector {
  return matrix.map(([a, b, c]) => a * x + b * y + c * z) as unknown as Vector;
}

const EPSILON = 216 / 24389;
const KAPPA = 24389 / 27;

/** CIELAB L* from relative luminance Y, 0 to 100. */
export function lstarFromY(y: number): number {
  const t = y / 100;
  return t > EPSILON ? 116 * Math.cbrt(t) - 16 : KAPPA * t;
}

/** Relative luminance Y, 0 to 100, from CIELAB L*. */
export function yFromLstar(lstar: number): number {
  const ft = (lstar + 16) / 116;
  const cube = ft * ft * ft;
  return 100 * (cube > EPSILON ? cube : (116 * ft - 16) / KAPPA);
}

function linearize(channel: number): number {
  const value = channel / 255;
  return 100 * (value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4);
}

function delinearize(component: number): number {
  const value = component / 100;
  const encoded = value <= 0.0031308 ? value * 12.92 : 1.055 * value ** (1 / 2.4) - 0.055;
  return Math.round(Math.min(1, Math.max(0, encoded)) * 255);
}

function xyzOf(color: string): Vector {
  const rgb = [1, 3, 5].map((at) =>
    linearize(Number.parseInt(color.slice(at, at + 2), 16)),
  ) as unknown as Vector;
  return times(SRGB_TO_XYZ, rgb);
}

/** The viewing conditions, derived once, as CAM16 defines each term. */
const VIEW = (() => {
  const adaptingLuminance = ((200 / Math.PI) * yFromLstar(50)) / 100;
  const surround = 2;
  const f = 0.8 + surround / 10;
  const c = 0.59 + (0.69 - 0.59) * ((f - 0.9) * 10);
  const d = Math.min(
    1,
    Math.max(0, f * (1 - (1 / 3.6) * Math.exp((-adaptingLuminance - 42) / 92))),
  );
  const white = times(CAT16, WHITE_POINT);
  const rgbD = white.map((channel) => d * (100 / channel) + 1 - d) as unknown as Vector;
  const k = 1 / (5 * adaptingLuminance + 1);
  const k4 = k ** 4;
  const fl = k4 * adaptingLuminance + 0.1 * (1 - k4) ** 2 * Math.cbrt(5 * adaptingLuminance);
  const n = yFromLstar(50) / WHITE_POINT[1];
  const z = 1.48 + Math.sqrt(n);
  const nbb = 0.725 / n ** 0.2;
  const rgbA = white.map((channel, index) => {
    const factor = ((fl * rgbD[index]! * channel) / 100) ** 0.42;
    return (400 * factor) / (factor + 27.13);
  });
  const aw = (2 * rgbA[0]! + rgbA[1]! + 0.05 * rgbA[2]!) * nbb;
  return { n, aw, nbb, ncb: nbb, c, nc: f, rgbD, fl, z };
})();

/** A color's HCT: hue in degrees from 0 to 360, CAM16 chroma, and tone as L*. */
export interface Hct {
  readonly hue: number;
  readonly chroma: number;
  readonly tone: number;
}

/** CAM16's lightness J, hue, and chroma of an XYZ color under VIEW. */
function cam16(xyz: Vector): { j: number; hue: number; chroma: number } {
  const [rD, gD, bD] = times(CAT16, xyz).map(
    (channel, index) => channel * VIEW.rgbD[index]!,
  ) as unknown as Vector;
  const adapt = (channel: number) => {
    const factor = ((VIEW.fl * Math.abs(channel)) / 100) ** 0.42;
    return (Math.sign(channel) * 400 * factor) / (factor + 27.13);
  };
  const rA = adapt(rD);
  const gA = adapt(gD);
  const bA = adapt(bD);
  const a = (11 * rA - 12 * gA + bA) / 11;
  const b = (rA + gA - 2 * bA) / 9;
  const u = (20 * rA + 20 * gA + 21 * bA) / 20;
  const p2 = (40 * rA + 20 * gA + bA) / 20;
  const degrees = (Math.atan2(b, a) * 180) / Math.PI;
  const hue = degrees < 0 ? degrees + 360 : degrees >= 360 ? degrees - 360 : degrees;
  const ac = p2 * VIEW.nbb;
  const j = 100 * (ac / VIEW.aw) ** (VIEW.c * VIEW.z);
  const eHue = 0.25 * (Math.cos((hue * Math.PI) / 180 + 2) + 3.8);
  const p1 = (50000 / 13) * eHue * VIEW.nc * VIEW.ncb;
  const t = (p1 * Math.hypot(a, b)) / (u + 0.305);
  const alpha = t ** 0.9 * (1.64 - 0.29 ** VIEW.n) ** 0.73;
  return { j, hue, chroma: alpha * Math.sqrt(j / 100) };
}

/** The XYZ color of CAM16 lightness J, chroma, and hue under VIEW. */
function xyzFromJch(j: number, chroma: number, hue: number): Vector {
  const alpha = chroma === 0 || j === 0 ? 0 : chroma / Math.sqrt(j / 100);
  const t = (alpha / (1.64 - 0.29 ** VIEW.n) ** 0.73) ** (1 / 0.9);
  const radians = (hue * Math.PI) / 180;
  const eHue = 0.25 * (Math.cos(radians + 2) + 3.8);
  const ac = VIEW.aw * (j / 100) ** (1 / VIEW.c / VIEW.z);
  const p1 = eHue * (50000 / 13) * VIEW.nc * VIEW.ncb;
  const p2 = ac / VIEW.nbb;
  const sin = Math.sin(radians);
  const cos = Math.cos(radians);
  const gamma = (23 * (p2 + 0.305) * t) / (23 * p1 + 11 * t * cos + 108 * t * sin);
  const a = gamma * cos;
  const b = gamma * sin;
  const rA = (460 * p2 + 451 * a + 288 * b) / 1403;
  const gA = (460 * p2 - 891 * a - 261 * b) / 1403;
  const bA = (460 * p2 - 220 * a - 6300 * b) / 1403;
  const unadapt = (channel: number) => {
    const base = Math.max(0, (27.13 * Math.abs(channel)) / (400 - Math.abs(channel)));
    return Math.sign(channel) * (100 / VIEW.fl) * base ** (1 / 0.42);
  };
  const cones = [unadapt(rA), unadapt(gA), unadapt(bA)].map(
    (channel, index) => channel / VIEW.rgbD[index]!,
  ) as unknown as Vector;
  return times(CAT16_INVERSE, cones);
}

/** A color's HCT. */
export function hctOf(color: string): Hct {
  const xyz = xyzOf(color);
  const { hue, chroma } = cam16(xyz);
  return { hue, chroma, tone: lstarFromY(xyz[1]) };
}

/** A color's tone: its CIELAB L*, from 0 to 100. */
export function toneOf(color: string): number {
  return lstarFromY(xyzOf(color)[1]);
}

function hexOf(xyz: Vector): string {
  return `#${times(XYZ_TO_SRGB, xyz)
    .map((component) => delinearize(component).toString(16).padStart(2, '0'))
    .join('')}`;
}

/** A gray at the tone: equal channels, Y from L*. */
function gray(tone: number): string {
  const y = yFromLstar(tone);
  return hexOf([(y * WHITE_POINT[0]) / 100, y, (y * WHITE_POINT[2]) / 100]);
}

/** How far a clipped color's tone may land from the asked one, in L*. */
export const CLIP_TONE = 0.5;

/** How far linear sRGB falls outside its cube, 0 inside it. */
function excess(xyz: Vector): number {
  return Math.max(
    0,
    ...times(XYZ_TO_SRGB, xyz).map((component) => Math.max(component - 100, -component)),
  );
}

/** Within the cube, allowing for float error. */
const inGamut = (xyz: Vector) => excess(xyz) <= 1e-7;

/** The J at which hue and chroma give Y, by bisection: Y rises with J at a fixed hue and chroma. */
function solveJ(hue: number, chroma: number, y: number): Vector {
  let low = 0;
  let high = 100;
  for (let step = 0; step < 60; step += 1) {
    const middle = (low + high) / 2;
    if (xyzFromJch(middle, chroma, hue)[1] < y) low = middle;
    else high = middle;
  }
  return xyzFromJch((low + high) / 2, chroma, hue);
}

/**
 * The color at `tone` and `hue` with the most chroma, up to `chroma`, that
 * sRGB holds, found by bisection to 0.01 of chroma. Tone and hue are exact
 * before rounding to hex.
 *
 * Near white and black, CAM16's own gray on some hues isn't in sRGB, so no
 * color has that tone and hue exactly. Then it's the asked color clipped
 * to sRGB when that keeps the tone within CLIP_TONE, or else the chroma
 * whose color falls least outside sRGB, by ternary search, clipped.
 */
export function fromHct(hue: number, chroma: number, tone: number): string {
  if (tone <= 0) return '#000000';
  if (tone >= 100) return '#ffffff';
  if (chroma < 0.01) return gray(tone);
  const normalized = ((hue % 360) + 360) % 360;
  const y = yFromLstar(tone);
  const at = (each: number) => solveJ(normalized, each, y);
  const asked = at(chroma);
  if (inGamut(asked)) return hexOf(asked);
  if (inGamut(at(0.01))) {
    let low = 0.01;
    let high = chroma;
    while (high - low > 0.01) {
      const middle = (low + high) / 2;
      if (inGamut(at(middle))) low = middle;
      else high = middle;
    }
    return hexOf(at(low));
  }
  const clipped = hexOf(asked);
  if (Math.abs(toneOf(clipped) - tone) <= CLIP_TONE) return clipped;
  let low = 0;
  let high = chroma;
  for (let step = 0; step < 60; step += 1) {
    const first = low + (high - low) / 3;
    const second = high - (high - low) / 3;
    if (excess(at(first)) <= excess(at(second))) high = second;
    else low = first;
  }
  return hexOf(at((low + high) / 2));
}

/** A tonal palette: one hue and chroma, any tone. */
export function tone(
  palette: { readonly hue: number; readonly chroma: number },
  at: number,
): string {
  return fromHct(palette.hue, palette.chroma, at);
}
