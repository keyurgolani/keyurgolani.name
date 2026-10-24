// The color derivations (#19): `anchor-v1` turns four anchors into one
// mode's complete set (Slice 1, item 2), and `high-contrast-v1` derives a
// scheme's high-contrast sets (Slice 2, item 2; only the values live here,
// the compiler and the gate stay in Slice 2). Both are pure and output
// concrete hex, so the server, the compiler, and Demo Studio's browser all
// get the same bytes.
//
// A derived role moves only when it fails its gate pair (4.5:1 for text and
// 3:1 for non-text, 7:1 and 4.5:1 in a high-contrast set), and then stops at
// the first step at or past the gate limit plus 0.1. Anchors never move.
//
// Slice 2 keeps the reviewed prototype's hierarchy (#19, the owner's lead):
// accent-hover and accent-active mix 12% and 22% away from on-accent, so
// they stay apart from the accent and each other and only gain contrast,
// and text-secondary keeps clear of text-muted, which stays at its contrast
// limit: when the two land closer than QUIET_TEXT_DELTA, text-secondary
// moves further toward text.

import { BLACK, contrast, deltaE, lightness, luminance, mix, WHITE, withLightness } from './color';
import type { BaseMode } from './axes';
import type { ColorRole, ColorTokens } from './roles';

/** The colors an `anchor-v1` mode is derived from. */
export interface Anchors {
  readonly canvas: string;
  readonly text: string;
  readonly accent: string;
  readonly secondary: string;
}

const TEXT = 4.5;
const NON_TEXT = 3;
const HIGH_CONTRAST_TEXT = 7;
/** How far past its limit a moved role stops: anchor-v2 (anchor-v2.ts) shares it. */
export const HEADROOM = 0.1;

/**
 * The least OKLab distance between accent, accent-hover, and accent-active.
 * Every non-Research scheme in the reviewed prototype clears it in every
 * mode it has, generated and single-mode schemes included. The closest is
 * material-hct's dark accent-hover and accent-active, 0.0128 with its
 * color-mix() values rounded to hex and 0.0119 at full precision.
 */
export const ACCENT_DELTA = 0.011;

/**
 * The least OKLab distance between text-secondary and text-muted: the
 * prototype's own closest pair, low-stimulus-warm's dark, at 0.0363 rounded
 * to hex (0.0367 at full precision). No non-Research prototype scheme falls
 * below it.
 */
export const QUIET_TEXT_DELTA = 0.036;

/** The pairs of roles a solved set keeps apart, each with the least distance it holds them. */
export const DISTINCT_PAIRS = [
  ['accent', 'accent-hover', ACCENT_DELTA],
  ['accent', 'accent-active', ACCENT_DELTA],
  ['accent-hover', 'accent-active', ACCENT_DELTA],
  ['text-secondary', 'text-muted', QUIET_TEXT_DELTA],
] as const satisfies readonly (readonly [ColorRole, ColorRole, number])[];

export const apart = (color: string, others: readonly string[], least: number) =>
  others.every((other) => deltaE(color, other) >= least);

/** The percentages and starting colors `anchor-v1` uses, by mode. */
const ANCHOR_V1 = {
  light: {
    surfaces: [3, 6, 10, 2],
    borders: [12, 24, 40],
    muted: 44,
    positive: '#2e8b57',
    warning: '#9b5700',
    danger: '#b53143',
    onStatus: WHITE,
  },
  dark: {
    surfaces: [6, 10, 16, 12],
    borders: [18, 30, 48],
    muted: 34,
    positive: '#78d39b',
    warning: '#ffc264',
    danger: '#ff8e9c',
    onStatus: BLACK,
  },
} as const;

export const passesOn = (color: string, grounds: readonly string[], target: number) =>
  grounds.every((ground) => contrast(color, ground) >= target);

/**
 * `start`, or, when it fails `limit` on any of `grounds`, the first mix of it
 * toward `text` in `step`-percent steps that reaches `limit` plus 0.1. Every
 * step failing, the text color itself.
 */
export function towardText(
  start: string,
  text: string,
  grounds: readonly string[],
  limit: number,
  step: number,
): string {
  if (passesOn(start, grounds, limit)) return start;
  for (let percent = step; percent <= 100; percent += step) {
    const candidate = mix(start, text, percent);
    if (passesOn(candidate, grounds, limit + HEADROOM)) return candidate;
  }
  return text;
}

/**
 * `start`, or, when `on` fails `limit` on it, the first color 2% further
 * away from `on` in OKLCH lightness that reaches `limit` plus 0.1: darker
 * under white, lighter under black.
 */
function awayFrom(start: string, on: string, limit: number): string {
  if (contrast(on, start) >= limit) return start;
  const darker = luminance(on) > luminance(start);
  const from = lightness(start);
  for (let step = 1; step <= 50; step += 1) {
    const candidate = withLightness(start, darker ? from - 0.02 * step : from + 0.02 * step);
    if (contrast(on, candidate) >= limit + HEADROOM) return candidate;
  }
  return darker ? BLACK : WHITE;
}

/** Black or white, whichever contrasts more with `color`; black on a tie. */
function onColor(color: string): string {
  return contrast(BLACK, color) >= contrast(WHITE, color) ? BLACK : WHITE;
}

/**
 * An accent state: `accent` mixed `start` percent away from `on`, toward
 * white under a black `on` and black under a white one, then 2% further at
 * a time until it's ACCENT_DELTA from each of `others` and `on` reads on it
 * at `limit`. Moving away from `on` only adds contrast, so a state never
 * falls below the accent's.
 */
function accentState(
  accent: string,
  on: string,
  start: number,
  others: readonly string[],
  limit: number,
): string {
  const away = contrast(on, WHITE) >= contrast(on, BLACK) ? WHITE : BLACK;
  for (let percent = start; percent <= 100; percent += 2) {
    const candidate = mix(accent, away, percent);
    if (contrast(on, candidate) >= limit && apart(candidate, others, ACCENT_DELTA))
      return candidate;
  }
  return away;
}

/**
 * text-secondary: `color`, or the first 2% step of it toward `text` that's
 * QUIET_TEXT_DELTA from `muted`. Toward text only adds contrast, so it still
 * passes, and text-muted keeps its place at its contrast limit.
 */
export function apartTowardText(color: string, text: string, muted: string): string {
  if (apart(color, [muted], QUIET_TEXT_DELTA)) return color;
  for (let percent = 2; percent <= 100; percent += 2) {
    const candidate = mix(color, text, percent);
    if (apart(candidate, [muted], QUIET_TEXT_DELTA)) return candidate;
  }
  return text;
}

/**
 * One mode's complete color set from its anchors. Surfaces and borders mix
 * canvas toward text, text-secondary and text-muted mix text toward canvas,
 * accent states mix accent toward text, and selection and the sequential
 * ramp mix canvas toward accent; then the roles that fail their gate move,
 * as the file comment says.
 */
export function anchorV1(anchors: Anchors, mode: BaseMode): ColorTokens {
  const rules = ANCHOR_V1[mode];
  const { canvas, text, accent, secondary } = anchors;
  const [subtle, surface, prominent, overlay] = rules.surfaces.map((percent) =>
    mix(canvas, text, percent),
  ) as [string, string, string, string];
  const grounds = [canvas, subtle, surface, prominent, overlay];
  const [borderSubtle, borderDefault, borderStrong] = rules.borders.map((percent) =>
    mix(canvas, text, percent),
  ) as [string, string, string];

  const onAccent = onColor(accent);
  const onStatus = rules.onStatus;
  const positive = awayFrom(rules.positive, onStatus, TEXT);
  const warning = awayFrom(rules.warning, onStatus, TEXT);
  const danger = awayFrom(rules.danger, onStatus, TEXT);
  const textMuted = towardText(mix(text, canvas, rules.muted), text, grounds, TEXT, 2);
  const textSecondary = apartTowardText(
    towardText(mix(text, canvas, 28), text, grounds, TEXT, 2),
    text,
    textMuted,
  );
  const accentHover = accentState(accent, onAccent, 12, [accent], TEXT);
  const accentActive = accentState(accent, onAccent, 22, [accent, accentHover], TEXT);
  const categorical = (color: string) => towardText(color, text, [surface], NON_TEXT, 2);

  return {
    canvas,
    'surface-subtle': subtle,
    'surface-default': surface,
    'surface-prominent': prominent,
    'surface-overlay': overlay,
    'text-primary': text,
    'text-secondary': textSecondary,
    'text-muted': textMuted,
    'text-inverse': canvas,
    'border-subtle': borderSubtle,
    'border-default': borderDefault,
    'border-strong': towardText(borderStrong, text, grounds, NON_TEXT, 2),
    accent,
    'accent-hover': accentHover,
    'accent-active': accentActive,
    'accent-text': towardText(accent, text, grounds, TEXT, 2),
    'on-accent': onAccent,
    focus: towardText(accent, text, grounds, NON_TEXT, 2),
    selection: mix(canvas, accent, 34),
    positive,
    warning,
    danger,
    information: awayFrom(secondary, onStatus, TEXT),
    'on-status': onStatus,
    'data-categorical-1': categorical(accent),
    'data-categorical-2': categorical(secondary),
    'data-categorical-3': categorical(positive),
    'data-categorical-4': categorical(warning),
    'data-categorical-5': categorical(danger),
    'data-categorical-6': categorical(textSecondary),
    'data-sequential-start': mix(canvas, accent, 28),
    'data-sequential-middle': mix(canvas, accent, 58),
    'data-sequential-end': mix(canvas, accent, 88),
    'signature-start': accent,
    'signature-end': secondary,
    emphasis: accent,
    scrim: BLACK,
    'on-scrim': WHITE,
    shadow: BLACK,
  };
}

/**
 * A scheme's high-contrast set of one polarity: black canvas and white text
 * for dark, the reverse for light. Accent, the statuses, and information
 * start from the scheme's set of that polarity, or its only set, and mix
 * toward text in 5% steps to 7.1:1 on canvas and every surface. Borders,
 * focus, and the text roles are the text color; text-inverse, on-accent, and
 * on-status are the canvas. The other roles follow `anchor-v1`, held to the
 * high-contrast targets.
 */
export function highContrastV1(
  sets: { readonly light?: ColorTokens; readonly dark?: ColorTokens },
  polarity: BaseMode,
): ColorTokens {
  const source = sets[polarity] ?? sets.light ?? sets.dark;
  if (!source) throw new TypeError('A high-contrast set needs a base set to start from.');
  const canvas = polarity === 'dark' ? BLACK : WHITE;
  const text = polarity === 'dark' ? WHITE : BLACK;
  const [subtle, surface, prominent, overlay] = [4, 8, 12, 0].map((percent) =>
    mix(canvas, text, percent),
  ) as [string, string, string, string];
  const grounds = [canvas, subtle, surface, prominent, overlay];
  const solve = (color: string) => towardText(color, text, grounds, HIGH_CONTRAST_TEXT, 5);
  const accent = solve(source.accent);
  // on-accent is the canvas, so away from it is toward the text color.
  const accentHover = accentState(accent, canvas, 12, [accent], HIGH_CONTRAST_TEXT);
  const accentActive = accentState(accent, canvas, 22, [accent, accentHover], HIGH_CONTRAST_TEXT);
  const positive = solve(source.positive);
  const warning = solve(source.warning);
  const danger = solve(source.danger);
  const information = solve(source.information);

  return {
    canvas,
    'surface-subtle': subtle,
    'surface-default': surface,
    'surface-prominent': prominent,
    'surface-overlay': overlay,
    'text-primary': text,
    'text-secondary': text,
    'text-muted': text,
    'text-inverse': canvas,
    'border-subtle': text,
    'border-default': text,
    'border-strong': text,
    accent,
    'accent-hover': accentHover,
    'accent-active': accentActive,
    'accent-text': towardText(accent, text, grounds, HIGH_CONTRAST_TEXT, 2),
    'on-accent': canvas,
    focus: text,
    selection: mix(canvas, accent, 34),
    positive,
    warning,
    danger,
    information,
    'on-status': canvas,
    'data-categorical-1': accent,
    'data-categorical-2': information,
    'data-categorical-3': positive,
    'data-categorical-4': warning,
    'data-categorical-5': danger,
    'data-categorical-6': text,
    'data-sequential-start': mix(canvas, accent, 28),
    'data-sequential-middle': mix(canvas, accent, 58),
    'data-sequential-end': mix(canvas, accent, 88),
    'signature-start': accent,
    'signature-end': information,
    emphasis: accent,
    scrim: BLACK,
    'on-scrim': WHITE,
    shadow: BLACK,
  };
}
