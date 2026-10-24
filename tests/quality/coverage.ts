// The interim covering array (#11, Slice 1, item 3): a deterministic
// pairwise array over the variant, design language, color scheme,
// typography, and display mode, from only the tuples the #19 resolver
// renders as asked, with every fixture pack at least once against the
// fallback composition. #20's `full` plan replaces it once `pnpm
// catalog:plan` exists. Rendering covers only this array; `pnpm
// check:appearance` computes the full cross-product on every PR.
//
// It's greedy and deterministic: each axis's values sorted, every accepted
// tuple enumerated in that order, each fixture pack's best tuple on the
// fallback composition first, then, until every pair some accepted tuple
// holds is covered, the tuple that covers the most pairs still uncovered,
// the earliest on a tie. The same registry gives the same rows, whatever
// order it lists its packs in.

import type { PlannedTest } from './cells';
import { SWEEP_CHECKS, sweepChecksOf } from './lib/sweep';

/** The five values a tuple sets, in the resolver's axis order. */
export const TUPLE_AXES = [
  'variant',
  'designLanguage',
  'colorScheme',
  'typography',
  'displayMode',
] as const;
export type TupleAxis = (typeof TUPLE_AXES)[number];

export type Tuple = Readonly<Record<TupleAxis, string>>;

export interface CoverageInput {
  /** The values each axis takes. Order doesn't matter; each is sorted. */
  readonly values: Readonly<Record<TupleAxis, readonly string[]>>;
  /** Whether the #19 resolver renders `tuple` as asked. */
  readonly accepts: (tuple: Tuple) => boolean;
  /** The composition every fixture pack must meet at least once. */
  readonly fallbackVariant: string;
  /** Fixture packs, by axis and id, each needing a row on the fallback composition. */
  readonly fixturePacks: readonly { readonly axis: TupleAxis; readonly id: string }[];
}

export interface Coverage {
  /** The array's rows, in the order they were picked. */
  readonly rows: readonly Tuple[];
  /** How many tuples the cross-product has, and how many the resolver accepts. */
  readonly tuples: number;
  readonly accepted: number;
  /** Pairs no accepted tuple holds, such as a one-mode scheme in the mode it lacks. */
  readonly uncoverable: readonly string[];
}

/** A tuple as one stable string: its values in axis order. */
export const tupleKey = (tuple: Tuple) => TUPLE_AXES.map((axis) => tuple[axis]).join('/');

const pairKey = (a: TupleAxis, x: string, b: TupleAxis, y: string) => `${a}=${x} × ${b}=${y}`;

/** Every pair of values a tuple holds, one per pair of axes. */
function pairsOf(tuple: Tuple): string[] {
  const pairs: string[] = [];
  for (let i = 0; i < TUPLE_AXES.length; i += 1) {
    for (let j = i + 1; j < TUPLE_AXES.length; j += 1) {
      const a = TUPLE_AXES[i]!;
      const b = TUPLE_AXES[j]!;
      pairs.push(pairKey(a, tuple[a], b, tuple[b]));
    }
  }
  return pairs;
}

const byCodePoint = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

/** The cross-product of `values`, each axis sorted, in lexicographic order. */
function* crossProduct(values: CoverageInput['values']): Generator<Tuple> {
  const sorted = TUPLE_AXES.map((axis) => [...new Set(values[axis])].sort(byCodePoint));
  if (sorted.some((list) => list.length === 0)) return;
  const index = TUPLE_AXES.map(() => 0);
  for (;;) {
    yield Object.fromEntries(TUPLE_AXES.map((axis, i) => [axis, sorted[i]![index[i]!]!])) as Tuple;
    let axis = TUPLE_AXES.length - 1;
    while (axis >= 0 && index[axis] === sorted[axis]!.length - 1) {
      index[axis] = 0;
      axis -= 1;
    }
    if (axis < 0) return;
    index[axis] = index[axis]! + 1;
  }
}

/** The covering array for `input`. */
export function pairwise(input: CoverageInput): Coverage {
  const accepted: { tuple: Tuple; pairs: string[] }[] = [];
  const all = new Set<string>();
  let tuples = 0;
  for (const tuple of crossProduct(input.values)) {
    tuples += 1;
    const pairs = pairsOf(tuple);
    for (const pair of pairs) all.add(pair);
    if (input.accepts(tuple)) accepted.push({ tuple, pairs });
  }
  const uncovered = new Set(accepted.flatMap(({ pairs }) => pairs));
  const uncoverable = [...all].filter((pair) => !uncovered.has(pair)).sort(byCodePoint);

  const rows: Tuple[] = [];
  const picked = new Set<string>();
  /** Picks the candidate covering the most uncovered pairs, the earliest on a tie. */
  const pick = (candidates: typeof accepted) => {
    let best: (typeof accepted)[number] | undefined;
    let bestGain = -1;
    for (const candidate of candidates) {
      if (picked.has(tupleKey(candidate.tuple))) continue;
      const gain = candidate.pairs.filter((pair) => uncovered.has(pair)).length;
      if (gain > bestGain) {
        best = candidate;
        bestGain = gain;
      }
    }
    if (!best) return false;
    picked.add(tupleKey(best.tuple));
    rows.push(best.tuple);
    for (const pair of best.pairs) uncovered.delete(pair);
    return true;
  };

  const packs = [...input.fixturePacks].sort(
    (a, b) => byCodePoint(a.axis, b.axis) || byCodePoint(a.id, b.id),
  );
  for (const { axis, id } of packs) {
    const met = (tuple: Tuple) => tuple.variant === input.fallbackVariant && tuple[axis] === id;
    if (rows.some(met)) continue;
    const candidates = accepted.filter(({ tuple }) => met(tuple));
    if (candidates.length === 0) {
      throw new Error(
        `No tuple the resolver accepts puts the fixture pack ${id} on the fallback composition.`,
      );
    }
    pick(candidates);
  }
  while (uncovered.size > 0 && pick(accepted)) {
    // Each pick covers at least one pair, or the loop ends.
  }
  return { rows, tuples, accepted: accepted.length, uncoverable };
}

/**
 * The [37] rule's coverage in a plan (#11 and #20): every changed pack
 * against every registered variant, in each of the five checks the sweep
 * runs (lib/sweep.ts's SWEEP_CHECKS), counted from the planned tests, so a
 * pack, a variant, or a check the planner left out is missing here and
 * fails the plan. A planned test that then doesn't run fails the run's
 * plan-coverage (lib/verdict.ts), which counts each of these tests on its
 * own. Each triple reads `<axis> <pack> × <variant> × <check>`.
 */
export function sweepCoverage(input: {
  readonly changes: readonly { readonly axis: string; readonly id: string }[];
  readonly variants: readonly string[];
  readonly tests: readonly Pick<PlannedTest, 'cell' | 'viewport' | 'row' | 'conditions'>[];
}): { readonly planned: readonly string[]; readonly missing: readonly string[] } {
  const key = (axis: string, id: string, variant: string, check: string) =>
    `${axis} ${id} × ${variant} × ${check}`;
  const seen = new Set<string>();
  for (const test of input.tests) {
    const changed = test.cell.changed?.filter((by) => by.axis !== 'variant') ?? [];
    if (changed.length === 0) continue;
    for (const check of sweepChecksOf(test)) {
      for (const by of changed) seen.add(key(by.axis, by.id, test.cell.target, check));
    }
  }
  const planned: string[] = [];
  const missing: string[] = [];
  for (const { axis, id } of input.changes) {
    for (const variant of input.variants) {
      for (const { name } of SWEEP_CHECKS) {
        const triple = key(axis, id, variant, name);
        (seen.has(triple) ? planned : missing).push(triple);
      }
    }
  }
  return { planned, missing };
}
