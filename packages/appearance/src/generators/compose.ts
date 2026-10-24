// What #20's four generators share (PR 3): each one picks a mode's four
// anchors, and compose() makes them a scheme. The one step a generator takes
// itself: when neither black nor white reads at 4.5:1 on the accent, the
// accent moves in 2% OKLCH lightness steps away from on-accent, the one
// that reads better, until it does. Then 2c's anchor-v2 solves every role
// and high-contrast-v2 the high-contrast sets, so a generated scheme passes
// with every shipping language, textured ones included, as an authored
// anchor-v2 scheme does. Every move is recorded: the generator's own on the
// anchors, and anchor-v2's from anchor-v1's values.

import type { BaseMode } from '../axes';
import { anchorV2, anchorV2Adjustments, highContrastV2, type Adjustments } from '../anchor-v2';
import { BLACK, contrast, lightness, WHITE, withLightness } from '../color';
import type { Anchors } from '../derive';
import type { GeneratedScheme } from '../resolve-tokens';

/** The anchors a generator picks, per mode, before its own step. */
export type ModeAnchors = { readonly light: Anchors; readonly dark: Anchors };

/** A color an image generator scored, as its record keeps it. */
export interface ExtractedColor {
  readonly hex: string;
  /** Its cluster's share of the sampled pixels, from 0 to 1, to four places. */
  readonly share: number;
  /** Share times OKLCH chroma, to four places; 0 for a color that can't score. */
  readonly score: number;
}

/** What a generator chose and why, before compose() solves it. */
export interface Composition {
  /** The algorithm, named and versioned, such as hct@1 or image-palette@1. */
  readonly algorithm: string;
  readonly anchors: ModeAnchors;
  /** For an image generator, the colors it scored, best first. */
  readonly extracted?: readonly ExtractedColor[];
  /** Plain-language notes on any fallback it took, such as the approved secondary. */
  readonly notes: readonly string[];
}

/** An anchor a generator moved: [picked, used]. */
export type AnchorMoves = {
  readonly [M in BaseMode]?: { readonly [K in keyof Anchors]?: readonly [string, string] };
};

export interface Composed {
  /** The anchors as used, after the generator's own step. */
  readonly anchors: ModeAnchors;
  readonly adjustments: {
    /** The generator's own moves on its anchors. */
    readonly generator: AnchorMoves;
    /** anchor-v2's moves from anchor-v1's values on the used anchors. */
    readonly 'anchor-v2': Adjustments;
  };
  /** Both base sets and both high-contrast sets, so render derives nothing. */
  readonly tokens: GeneratedScheme;
}

/** What on-accent has to reach on the accent, which its hover and active states only add to. */
export const ON_ACCENT_TARGET = 4.5;
const STEP = 0.02;
const STEPS = 50;

const onAccentReads = (accent: string) =>
  Math.max(contrast(BLACK, accent), contrast(WHITE, accent)) >= ON_ACCENT_TARGET;

/**
 * `accent`, or the first 2% OKLCH lightness step of it, away from whichever
 * of black and white reads better on it, at which that one reads at
 * ON_ACCENT_TARGET.
 */
export function readableAccent(accent: string): string {
  if (onAccentReads(accent)) return accent;
  const lighter = contrast(BLACK, accent) >= contrast(WHITE, accent);
  const from = lightness(accent);
  for (let step = 1; step <= STEPS; step += 1) {
    const candidate = withLightness(accent, lighter ? from + STEP * step : from - STEP * step);
    if (onAccentReads(candidate)) return candidate;
  }
  return lighter ? WHITE : BLACK;
}

/** A composition's scheme: the generator's step, then anchor-v2 and high-contrast-v2. */
export function compose(composition: Composition): Composed {
  const generator: { -readonly [M in BaseMode]?: Record<string, readonly [string, string]> } = {};
  const used = {} as { -readonly [M in BaseMode]: Anchors };
  for (const mode of ['light', 'dark'] as const) {
    const picked = composition.anchors[mode];
    const accent = readableAccent(picked.accent);
    if (accent !== picked.accent) generator[mode] = { accent: [picked.accent, accent] };
    used[mode] = { ...picked, accent };
  }
  const light = anchorV2(used.light, 'light');
  const dark = anchorV2(used.dark, 'dark');
  return {
    anchors: used,
    adjustments: { generator, 'anchor-v2': anchorV2Adjustments(used) },
    tokens: {
      light,
      dark,
      highContrast: {
        light: highContrastV2({ light, dark }, 'light'),
        dark: highContrastV2({ light, dark }, 'dark'),
      },
    },
  };
}
