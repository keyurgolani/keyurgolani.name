// `anchor-v2` (#20 PR 2c): anchor-v1's set, then the roles that read on
// canvas and the surfaces re-solved to the targets a textured design
// language sets, so every language, textured or not, passes with every
// scheme. `high-contrast-v2` does the same on top of high-contrast-v1.
//
// The texture raise (#19's gate) multiplies the targets on canvas and the
// surfaces by 1.1: 4.95:1 for text, 3.3:1 for non-text and the large-text
// signature fill, and 7.7:1 and 4.95:1 in a high-contrast set. Pairs on
// fills (on-accent, on-status, on-scrim) keep theirs, so the accent
// states, the statuses, and information stay anchor-v1's.
//
// A role moves only when it fails its raised target, by the least step
// that reaches the target plus anchor-v1's 0.1 headroom, so a scheme keeps
// its character:
//
// - text-muted, text-secondary, accent-text, focus, and border-strong move
//   toward text in anchor-v1's 2% steps, from anchor-v1's value. Toward
//   text only adds contrast, and text-secondary still keeps clear of
//   text-muted.
// - The signature fill moves the fewest of its two ends toward text in 2%
//   steps: one end by the least step (the start on a tie), else both by
//   the least total of their steps (the start's the lesser at that total),
//   until every tenth of the way between them passes on canvas and every
//   surface. The accent and secondary
//   anchors themselves never move.
// - The categorical walk: the six categorical colors start from accent,
//   secondary, the three solved statuses, and text-secondary, and resolve
//   in that order. Each takes the smallest move in 2% OKLCH lightness steps
//   (darker first on a light set, lighter first on a dark one, chroma
//   clipped to sRGB) that passes on surface-default and stays
//   CATEGORICAL_DELTA from every earlier one.
//
// Like anchor-v1 it's pure and outputs concrete hex, so the server, the
// compiler, and Demo Studio's browser get the same bytes.

import { contrast, lightness, mix, withLightness } from './color';
import {
  anchorV1,
  apart,
  apartTowardText,
  HEADROOM,
  highContrastV1,
  passesOn,
  towardText,
  type Anchors,
} from './derive';
import type { BaseMode } from './axes';
import type { ColorRole, ColorTokens } from './roles';

/** The targets anchor-v2 and high-contrast-v2 solve to. */
export interface SolveTargets {
  /** Text on canvas and every surface. */
  readonly text: number;
  /** Focus, border-strong, and the categorical colors. */
  readonly nonText: number;
  /** The signature fill, which every approved profile sets as WCAG large text. */
  readonly signature: number;
}

/**
 * The textured targets in a light or dark set: GATE_TARGETS' text,
 * non-text, and large text, each times its textureRaise, which
 * anchor-v2.test.ts holds them to. They're literal here because the gate
 * imports the sets, which import this file.
 */
export const ANCHOR_V2_TARGETS: SolveTargets = Object.freeze({
  text: 4.95,
  nonText: 3.3,
  signature: 3.3,
});

/** The same in a high-contrast set. The gate paints the signature fill text-primary there, so it isn't solved. */
export const HIGH_CONTRAST_V2_TARGETS: SolveTargets = Object.freeze({
  text: 7.7,
  nonText: 4.95,
  signature: 4.95,
});

/**
 * The least OKLab distance the categorical walk keeps between a categorical
 * color and every earlier one. It's under the closest pair anchor-v1 gives
 * any shipping scheme (blue-orange-color-safe's high-contrast light,
 * 0.0152), so the walk never asks more apart than anchor-v1 already had.
 * The refined body's 0.08 and simulated color-vision minimums are the
 * backlog's contrast table additions.
 */
export const CATEGORICAL_DELTA = 0.015;

/** How far a lightness step goes, and how many the walk takes before it gives up. */
const LIGHTNESS_STEP = 0.02;
const LIGHTNESS_STEPS = 50;

const GROUNDS = [
  'canvas',
  'surface-subtle',
  'surface-default',
  'surface-prominent',
  'surface-overlay',
] as const satisfies readonly ColorRole[];

/** The colors the gate reads a two-color fill through: every tenth of the way. */
export function fillStops(start: string, end: string): string[] {
  return Array.from({ length: 11 }, (_, step) => mix(start, end, step * 10));
}

const fillPasses = (start: string, end: string, grounds: readonly string[], limit: number) =>
  fillStops(start, end).every((color) => passesOn(color, grounds, limit));

/**
 * The signature fill's two ends: as they are when the fill passes `limit`,
 * else one end moved toward `text` by the least 2% step that reaches
 * `limit` plus 0.1 (start first on a tie), else both, by the least total.
 */
export function solveSignature(
  start: string,
  end: string,
  text: string,
  grounds: readonly string[],
  limit: number,
): readonly [string, string] {
  if (fillPasses(start, end, grounds, limit)) return [start, end];
  const target = limit + HEADROOM;
  for (let percent = 2; percent <= 100; percent += 2) {
    const movedStart = mix(start, text, percent);
    if (fillPasses(movedStart, end, grounds, target)) return [movedStart, end];
    const movedEnd = mix(end, text, percent);
    if (fillPasses(start, movedEnd, grounds, target)) return [start, movedEnd];
  }
  for (let total = 4; total <= 200; total += 2) {
    for (let first = Math.max(2, total - 100); first <= Math.min(100, total - 2); first += 2) {
      const pair = [mix(start, text, first), mix(end, text, total - first)] as const;
      if (fillPasses(pair[0], pair[1], grounds, target)) return pair;
    }
  }
  return [text, text];
}

/**
 * One categorical color of the walk: `start` when it passes `limit` on
 * `ground` and is `least` from each of `earlier`, else the first 2% OKLCH
 * lightness step that reaches `limit` plus 0.1 and keeps apart, nearer
 * steps first and, at each distance, away from the ground before toward
 * it. No step passing, `text`.
 */
export function walkCategorical(
  start: string,
  ground: string,
  limit: number,
  earlier: readonly string[],
  text: string,
  least: number = CATEGORICAL_DELTA,
): string {
  if (contrast(start, ground) >= limit && apart(start, earlier, least)) return start;
  const from = lightness(start);
  const away = lightness(text) < lightness(ground) ? -1 : 1;
  for (let step = 1; step <= LIGHTNESS_STEPS; step += 1) {
    for (const direction of [away, -away]) {
      const value = from + direction * LIGHTNESS_STEP * step;
      if (value < 0 || value > 1) continue;
      const candidate = withLightness(start, value);
      if (contrast(candidate, ground) >= limit + HEADROOM && apart(candidate, earlier, least))
        return candidate;
    }
  }
  return text;
}

/** The walk over the six starting colors, in order, each held apart from those before it. */
export function categoricalWalk(
  starts: readonly string[],
  ground: string,
  limit: number,
  text: string,
): string[] {
  const solved: string[] = [];
  for (const start of starts) solved.push(walkCategorical(start, ground, limit, solved, text));
  return solved;
}

/**
 * `set` with the roles on canvas and the surfaces re-solved to `targets`,
 * from their values in `set` (anchor-v1's or high-contrast-v1's), and the
 * categorical colors walked from `starts` and the solved text-secondary.
 * Every other role is `set`'s.
 */
function solveRaised(
  set: ColorTokens,
  targets: SolveTargets,
  starts: readonly string[],
  signature: boolean,
): ColorTokens {
  const text = set['text-primary'];
  const grounds = GROUNDS.map((role) => set[role]);
  const toward = (role: ColorRole, limit: number) => towardText(set[role], text, grounds, limit, 2);
  const textMuted = toward('text-muted', targets.text);
  const textSecondary = apartTowardText(toward('text-secondary', targets.text), text, textMuted);
  const [signatureStart, signatureEnd] = signature
    ? solveSignature(set['signature-start'], set['signature-end'], text, grounds, targets.signature)
    : [set['signature-start'], set['signature-end']];
  const walked = categoricalWalk(
    [...starts, textSecondary],
    set['surface-default'],
    targets.nonText,
    text,
  );
  return {
    ...set,
    'text-secondary': textSecondary,
    'text-muted': textMuted,
    'border-strong': toward('border-strong', targets.nonText),
    'accent-text': toward('accent-text', targets.text),
    focus: toward('focus', targets.nonText),
    'data-categorical-1': walked[0]!,
    'data-categorical-2': walked[1]!,
    'data-categorical-3': walked[2]!,
    'data-categorical-4': walked[3]!,
    'data-categorical-5': walked[4]!,
    'data-categorical-6': walked[5]!,
    'signature-start': signatureStart,
    'signature-end': signatureEnd,
  };
}

/** One mode's complete color set from its anchors: anchor-v1's, re-solved as the file comment says. */
export function anchorV2(
  anchors: Anchors,
  mode: BaseMode,
  targets: SolveTargets = ANCHOR_V2_TARGETS,
): ColorTokens {
  const set = anchorV1(anchors, mode);
  return solveRaised(
    set,
    targets,
    [anchors.accent, anchors.secondary, set.positive, set.warning, set.danger],
    true,
  );
}

/**
 * A scheme's high-contrast set of one polarity: high-contrast-v1's from
 * the anchor-v2 base sets, with accent-text re-solved to 7.7:1 and the
 * categorical walk at 4.95:1. Text, borders, and focus are already the
 * text color, and the gate paints the signature fill text-primary.
 */
export function highContrastV2(
  sets: { readonly light?: ColorTokens; readonly dark?: ColorTokens },
  polarity: BaseMode,
  targets: SolveTargets = HIGH_CONTRAST_V2_TARGETS,
): ColorTokens {
  const set = highContrastV1(sets, polarity);
  return solveRaised(
    set,
    targets,
    [set.accent, set.information, set.positive, set.warning, set.danger],
    false,
  );
}

/** A rendered set's moves: role to [anchor-v1's value, anchor-v2's]. */
export type SetAdjustments = { readonly [R in ColorRole]?: readonly [string, string] };

/** Each set a scheme renders, with the roles anchor-v2 moved in it, as a manifest records them. */
export interface Adjustments {
  readonly light?: SetAdjustments;
  readonly dark?: SetAdjustments;
  readonly 'high-contrast-light'?: SetAdjustments;
  readonly 'high-contrast-dark'?: SetAdjustments;
}

function moves(before: ColorTokens, after: ColorTokens): SetAdjustments {
  const moved: { [R in ColorRole]?: readonly [string, string] } = {};
  for (const role of Object.keys(after) as ColorRole[]) {
    if (before[role] !== after[role]) moved[role] = [before[role], after[role]];
  }
  return moved;
}

/**
 * What anchor-v2 moves from anchor-v1 on a scheme's anchors: in each base
 * set, and in each high-contrast set the scheme renders (a light one
 * always, since print is light, and a dark one with a dark base). A set
 * with no move is left out.
 */
export function anchorV2Adjustments(anchors: {
  readonly light?: Anchors;
  readonly dark?: Anchors;
}): Adjustments {
  const v1: { light?: ColorTokens; dark?: ColorTokens } = {};
  const v2: { light?: ColorTokens; dark?: ColorTokens } = {};
  for (const mode of ['light', 'dark'] as const) {
    const each = anchors[mode];
    if (!each) continue;
    v1[mode] = anchorV1(each, mode);
    v2[mode] = anchorV2(each, mode);
  }
  const pairs: [keyof Adjustments, ColorTokens | undefined, ColorTokens | undefined][] = [
    ['light', v1.light, v2.light],
    ['dark', v1.dark, v2.dark],
  ];
  if (v1.light || v1.dark) {
    pairs.push(['high-contrast-light', highContrastV1(v1, 'light'), highContrastV2(v2, 'light')]);
    if (v1.dark)
      pairs.push(['high-contrast-dark', highContrastV1(v1, 'dark'), highContrastV2(v2, 'dark')]);
  }
  const out: { -readonly [K in keyof Adjustments]: SetAdjustments } = {};
  for (const [name, before, after] of pairs) {
    if (!before || !after) continue;
    const moved = moves(before, after);
    if (Object.keys(moved).length > 0) out[name] = moved;
  }
  return out;
}
