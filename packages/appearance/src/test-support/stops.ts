// Test support: checks that each role a derivation moves stopped where the
// refined body says, using this file's own copy of the rules' numbers, so a
// change to a percentage, a step, or the headroom in derive.ts can't move
// the checks with it.

import assert from 'node:assert/strict';
import { BLACK, contrast, deltaE, lightness, luminance, mix, WHITE, withLightness } from '../color';
import type { Anchors } from '../derive';
import type { ColorTokens } from '../tokens';

const HEADROOM = 0.1;
/** The hierarchy's least OKLab distances (Slice 2), this file's own copies. */
const ACCENT_DISTINCT = 0.011;
const QUIET_TEXT_DISTINCT = 0.036;

/**
 * How a role is solved: mixed toward a color in whole-percent steps,
 * stepped in OKLCH lightness away from one, or, for the roles Slice 2 keeps
 * apart, the one value this file's copy of that rule gives.
 */
export type Stop =
  | {
      readonly role: keyof ColorTokens;
      readonly by: 'mix';
      readonly start: string;
      readonly toward: string;
      readonly on: readonly string[];
      readonly limit: number;
      readonly step: number;
    }
  | {
      readonly role: keyof ColorTokens;
      readonly by: 'lightness';
      readonly start: string;
      readonly away: string;
      readonly limit: number;
    }
  | {
      readonly role: keyof ColorTokens;
      readonly by: 'exact';
      readonly value: string;
      readonly rule: string;
    };

const apart = (color: string, others: readonly string[], least: number) =>
  others.every((other) => deltaE(color, other) >= least);

/** The mix rule: `start` if it passes, else its first whole-percent step toward `toward` that reaches the limit plus 0.1. */
function solvedMix(
  start: string,
  toward: string,
  on: readonly string[],
  limit: number,
  step: number,
) {
  if (worst(start, on) >= limit) return start;
  for (let percent = step; percent <= 100; percent += step) {
    const candidate = mix(start, toward, percent);
    if (worst(candidate, on) >= limit + HEADROOM) return candidate;
  }
  return toward;
}

/** text-secondary's last move: 2% steps toward text until it's apart from text-muted. */
function apartToward(color: string, toward: string, others: readonly string[]) {
  if (apart(color, others, QUIET_TEXT_DISTINCT)) return color;
  for (let percent = 2; percent <= 100; percent += 2) {
    const candidate = mix(color, toward, percent);
    if (apart(candidate, others, QUIET_TEXT_DISTINCT)) return candidate;
  }
  return toward;
}

/** An accent state: the accent mixed `start`% away from on-accent, then 2% further until on-accent reads and it's apart. */
function accentState(
  accent: string,
  on: string,
  start: number,
  others: readonly string[],
  limit: number,
) {
  const away = contrast(on, WHITE) >= contrast(on, BLACK) ? WHITE : BLACK;
  for (let percent = start; percent <= 100; percent += 2) {
    const candidate = mix(accent, away, percent);
    if (contrast(on, candidate) >= limit && apart(candidate, others, ACCENT_DISTINCT))
      return candidate;
  }
  return away;
}

const worst = (color: string, on: readonly string[]) =>
  Math.min(...on.map((ground) => contrast(color, ground)));

const grounds = (set: ColorTokens) => [
  set.canvas,
  set['surface-subtle'],
  set['surface-default'],
  set['surface-prominent'],
  set['surface-overlay'],
];

/**
 * A role that passes its limit where it starts stays there. One that fails
 * it is a step of the rule from its start: the first that reaches the limit
 * plus 0.1, so the step before still falls short. A mix that never gets
 * there ends on the color it mixes toward.
 */
export function assertStops(set: ColorTokens, stops: readonly Stop[], label: string): void {
  for (const stop of stops) {
    const value = set[stop.role];
    const where = `${label} ${stop.role} ${value}`;
    if (stop.by === 'exact') {
      assert.equal(value, stop.value, `${where}: ${stop.rule}`);
      continue;
    }
    const passes = (color: string, target: number) =>
      stop.by === 'mix' ? worst(color, stop.on) >= target : contrast(stop.away, color) >= target;
    if (passes(stop.start, stop.limit)) {
      assert.equal(value, stop.start, `${where}: it passes where it starts, so it doesn't move`);
      continue;
    }
    const candidates: string[] = [];
    if (stop.by === 'mix') {
      for (let percent = stop.step; percent <= 100; percent += stop.step) {
        candidates.push(mix(stop.start, stop.toward, percent));
      }
    } else {
      const darker = luminance(stop.away) > luminance(stop.start);
      const from = lightness(stop.start);
      for (let step = 1; step <= 50; step += 1) {
        candidates.push(
          withLightness(stop.start, darker ? from - 0.02 * step : from + 0.02 * step),
        );
      }
    }
    const index = candidates.indexOf(value);
    assert.notEqual(index, -1, `${where}: not a step of its rule from ${stop.start}`);
    if (passes(value, stop.limit + HEADROOM)) {
      if (index > 0) {
        assert.ok(
          !passes(candidates[index - 1]!, stop.limit + HEADROOM),
          `${where}: the step before already passes`,
        );
      }
    } else {
      // Only a mix none of whose steps gets there may end short, on the color it mixes toward.
      assert.ok(
        stop.by === 'mix' &&
          value === stop.toward &&
          candidates.every((candidate) => !passes(candidate, stop.limit + HEADROOM)),
        `${where}: it stopped short of ${stop.limit} + 0.1`,
      );
    }
  }
}

/** What anchor-v1 solves in one mode's set, from the refined body. */
export function anchorStops(anchors: Anchors, mode: 'light' | 'dark', set: ColorTokens): Stop[] {
  const light = mode === 'light';
  const { canvas, text, accent, secondary } = anchors;
  const on = grounds(set);
  const surface = [set['surface-default']];
  const onStatus = light ? WHITE : BLACK;
  const mixTo = (
    role: keyof ColorTokens,
    start: string,
    over: readonly string[],
    limit: number,
  ): Stop => ({
    role,
    by: 'mix',
    start,
    toward: text,
    on: over,
    limit,
    step: 2,
  });
  const away = (role: keyof ColorTokens, start: string, from: string): Stop => ({
    role,
    by: 'lightness',
    start,
    away: from,
    limit: 4.5,
  });
  return [
    {
      role: 'text-secondary',
      by: 'exact',
      value: apartToward(solvedMix(mix(text, canvas, 28), text, on, 4.5, 2), text, [
        set['text-muted'],
      ]),
      rule: 'its 28% mix solved toward text, then moved apart from text-muted',
    },
    mixTo('text-muted', mix(text, canvas, light ? 44 : 34), on, 4.5),
    mixTo('accent-text', accent, on, 4.5),
    mixTo('border-strong', mix(canvas, text, light ? 40 : 48), on, 3),
    mixTo('focus', accent, on, 3),
    mixTo('data-categorical-1', accent, surface, 3),
    mixTo('data-categorical-2', secondary, surface, 3),
    mixTo('data-categorical-3', set.positive, surface, 3),
    mixTo('data-categorical-4', set.warning, surface, 3),
    mixTo('data-categorical-5', set.danger, surface, 3),
    mixTo('data-categorical-6', set['text-secondary'], surface, 3),
    {
      role: 'accent-hover',
      by: 'exact',
      value: accentState(accent, set['on-accent'], 12, [accent], 4.5),
      rule: 'the accent mixed 12% away from on-accent, then apart from the accent',
    },
    {
      role: 'accent-active',
      by: 'exact',
      value: accentState(accent, set['on-accent'], 22, [accent, set['accent-hover']], 4.5),
      rule: 'the accent mixed 22% away from on-accent, then apart from the accent and hover',
    },
    away('positive', light ? '#2e8b57' : '#78d39b', onStatus),
    away('warning', light ? '#9b5700' : '#ffc264', onStatus),
    away('danger', light ? '#b53143' : '#ff8e9c', onStatus),
    away('information', secondary, onStatus),
  ];
}

/** What high-contrast-v1 solves in one polarity's set, from the refined body. */
export function highContrastStops(
  source: ColorTokens,
  polarity: 'light' | 'dark',
  set: ColorTokens,
): Stop[] {
  const canvas = polarity === 'dark' ? BLACK : WHITE;
  const text = polarity === 'dark' ? WHITE : BLACK;
  const on = grounds(set);
  const mixTo = (role: keyof ColorTokens, start: string, step: number): Stop => ({
    role,
    by: 'mix',
    start,
    toward: text,
    on,
    limit: 7,
    step,
  });
  return [
    mixTo('accent', source.accent, 5),
    mixTo('positive', source.positive, 5),
    mixTo('warning', source.warning, 5),
    mixTo('danger', source.danger, 5),
    mixTo('information', source.information, 5),
    mixTo('accent-text', set.accent, 2),
    {
      role: 'accent-hover',
      by: 'exact',
      value: accentState(set.accent, canvas, 12, [set.accent], 7),
      rule: 'the accent mixed 12% away from on-accent, the canvas, then apart from the accent',
    },
    {
      role: 'accent-active',
      by: 'exact',
      value: accentState(set.accent, canvas, 22, [set.accent, set['accent-hover']], 7),
      rule: 'the accent mixed 22% away from on-accent, then apart from the accent and hover',
    },
  ];
}
