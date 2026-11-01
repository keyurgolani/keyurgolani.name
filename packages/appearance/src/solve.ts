// The solving steps every derivation shares (anchor-v1 in ./derive, anchor-v2,
// and the roles K-2 added in ./derived-roles): a leaf module, which imports
// only ./color, so none of them imports another to reach these.

import { BLACK, contrast, mix, WHITE } from './color';

/** How far past its limit a moved role stops: anchor-v1, anchor-v2, and the derived roles share it. */
export const HEADROOM = 0.1;

/** What a derivation solves a base set's two focus colors to. */
export interface FocusTargets {
  /** focus, on canvas and every surface. */
  readonly focus: number;
  /** focus-inverse, on its inverse ground, text-primary. */
  readonly focusInverse: number;
}

/**
 * The focus targets a scheme pack's base sets are derived to (lead A's
 * ruling, 11-01): focus at 4.5:1 on its worst ground, canvas or a surface,
 * and focus-inverse at 4.5:1 on text-primary, so a ring reads like body
 * text on every ground it can land on. Above the gate's floors (3:1 for
 * focus, FOCUS_INVERSE_TARGETS for focus-inverse), which stay as they are.
 */
export const FOCUS_TARGETS: FocusTargets = Object.freeze({ focus: 4.5, focusInverse: 4.5 });

/**
 * The focus targets #20's generators shipped version 1 with, frozen there:
 * focus at the 3:1 non-text floor (3.3:1 once anchor-v2 raises it) and
 * focus-inverse at 3.5:1. A generator at version 1 keeps deriving to them,
 * so its records and every set it makes keep their bytes and no generator
 * needs a version bump; a version 2 that moves to FOCUS_TARGETS, with a
 * migration for the stored pins, is its own item.
 */
export const GENERATOR_V1_FOCUS_TARGETS: FocusTargets = Object.freeze({
  focus: 3,
  focusInverse: 3.5,
});

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

/** Black or white, whichever contrasts more with `color`; black on a tie. */
export function onColor(color: string): string {
  return contrast(BLACK, color) >= contrast(WHITE, color) ? BLACK : WHITE;
}
