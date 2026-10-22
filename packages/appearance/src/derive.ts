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

import { BLACK, contrast, lightness, luminance, mix, WHITE, withLightness } from './color';
import type { BaseMode } from './axes';
import type { ColorTokens } from './tokens';

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
const HEADROOM = 0.1;

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

const passesOn = (color: string, grounds: readonly string[], target: number) =>
  grounds.every((ground) => contrast(color, ground) >= target);

/**
 * `start`, or, when it fails `limit` on any of `grounds`, the first mix of it
 * toward `text` in `step`-percent steps that reaches `limit` plus 0.1. Every
 * step failing, the text color itself.
 */
function towardText(
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
  const textSecondary = towardText(mix(text, canvas, 28), text, grounds, TEXT, 2);
  const categorical = (color: string) => towardText(color, text, [surface], NON_TEXT, 2);

  return {
    canvas,
    'surface-subtle': subtle,
    'surface-default': surface,
    'surface-prominent': prominent,
    'surface-overlay': overlay,
    'text-primary': text,
    'text-secondary': textSecondary,
    'text-muted': towardText(mix(text, canvas, rules.muted), text, grounds, TEXT, 2),
    'text-inverse': canvas,
    'border-subtle': borderSubtle,
    'border-default': borderDefault,
    'border-strong': towardText(borderStrong, text, grounds, NON_TEXT, 2),
    accent,
    'accent-hover': awayFrom(mix(accent, text, 12), onAccent, TEXT),
    'accent-active': awayFrom(mix(accent, text, 22), onAccent, TEXT),
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
    'accent-hover': awayFrom(mix(accent, text, 12), canvas, HIGH_CONTRAST_TEXT),
    'accent-active': awayFrom(mix(accent, text, 22), canvas, HIGH_CONTRAST_TEXT),
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
