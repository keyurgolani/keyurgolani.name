// Test support: checks that each role a derivation moves stopped where the
// refined body says, using this file's own copy of the rules' numbers, so a
// change to a percentage, a step, or the headroom in derive.ts can't move
// the checks with it.

import assert from 'node:assert/strict';
import { BLACK, contrast, lightness, luminance, mix, WHITE, withLightness } from '../color';
import type { Anchors } from '../derive';
import type { ColorTokens } from '../tokens';

const HEADROOM = 0.1;

/** How a role is solved: mixed toward a color in whole-percent steps, or stepped in OKLCH lightness away from one. */
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
    };

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
    mixTo('text-secondary', mix(text, canvas, 28), on, 4.5),
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
    away('accent-hover', mix(accent, text, 12), set['on-accent']),
    away('accent-active', mix(accent, text, 22), set['on-accent']),
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
      by: 'lightness',
      start: mix(set.accent, text, 12),
      away: canvas,
      limit: 7,
    },
    {
      role: 'accent-active',
      by: 'lightness',
      start: mix(set.accent, text, 22),
      away: canvas,
      limit: 7,
    },
  ];
}
