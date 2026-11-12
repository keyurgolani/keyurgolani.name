// The nightly's scope (row 151, the coordinator's (b1) ruling, 2026-11-11): what quality:full
// -- --night=<date> plans, cut from the reachable plan (cells.ts's `reachable`, the release scope
// (c′)), so a regression in any reachable tuple shows within a week of nights, after v1.0.0 too:
//
// - every public composition on its default packs, in each of the 114 scheme and display mode
//   pairs the resolver accepts on them, at 390 and 1440 in the default row;
// - the whole pairwise array at 1440 in the default row, so every reachable pair is in a test the
//   cycle runs;
// - and, as every night, the harness's specs, the perf cells, and the visual cells.
//
// The whole of (c′) (every viewport and row, the [37] rule's pairs, every route, state and surface
// cell) is the release run's, and `full` stays the harness's regression run. At the release's
// measured weights and pace it's a 7-night cycle at FULL_SHARDS (16) shards of
// NIGHTLY_TIMEOUT_MINUTES (120), and still 7 at 12 (nightly-scope.test.ts).

import { PLATFORM_DEFAULTS } from '../../../packages/appearance/src/index';
import type { Cell, Plan, PlannedTest } from '../cells';
import { tupleKey } from '../coverage';
import { perfCells } from './perf/plan';
import { APPEARANCE_STATE } from './state-fixtures';
import { DEFAULT_ROW, VIEWPORTS } from './matrix';
import { visualCells } from './visual';

/** The viewports a default-pack pair runs at, by id: the narrowest and the widest. */
export const NIGHTLY_DEFAULT_VIEWPORTS = ['390x844', '1440x900'] as const;
/** The viewport a pairwise row runs at, by id. */
export const NIGHTLY_PAIRWISE_VIEWPORT = '1440x900';

for (const id of [...NIGHTLY_DEFAULT_VIEWPORTS, NIGHTLY_PAIRWISE_VIEWPORT]) {
  if (!VIEWPORTS.some((viewport) => viewport.id === id))
    throw new Error(`The nightly scope's viewport ${id} is not one of VIEWPORTS.`);
}

/** Whether `cell` is a composition's appearance cell at its first route: an array row or a pair. */
const appearance = (cell: Cell) =>
  cell.kind === 'composition' && cell.state === APPEARANCE_STATE.id && cell.path === '/';

/** Whether `cell` is a public composition's default-pack pair: its language and typography the platform's. */
export const isDefaultPair = (cell: Cell) =>
  appearance(cell) &&
  cell.tuple.designLanguage === PLATFORM_DEFAULTS.designLanguage &&
  cell.tuple.typography === PLATFORM_DEFAULTS.typography;

/**
 * `plan` (a reachable plan) cut to the nightly's scope: the tests above, the cells they test, and
 * the perf and visual cells, which run every night whatever tests they have; the targets stay, so
 * each still needs its perf result. It throws on a plan that isn't the reachable scope's.
 */
export function nightlyScope(plan: Plan): Plan {
  if (plan.scope !== 'reachable')
    throw new Error("The nightly scope is cut from the reachable plan, and this plan isn't one.");
  const rows = new Set(plan.coverage.rows.map(tupleKey));
  const keep = (test: PlannedTest) =>
    test.row === DEFAULT_ROW &&
    ((isDefaultPair(test.cell) &&
      (NIGHTLY_DEFAULT_VIEWPORTS as readonly string[]).includes(test.viewport.id)) ||
      (appearance(test.cell) &&
        rows.has(tupleKey(test.cell.tuple)) &&
        test.viewport.id === NIGHTLY_PAIRWISE_VIEWPORT));
  const tests = plan.tests.filter(keep);
  const ids = new Set([
    ...tests.map((test) => test.cell.id),
    ...perfCells(plan).map((cell) => cell.id),
    ...visualCells(plan).map((cell) => cell.id),
  ]);
  return {
    ...plan,
    cells: plan.cells.filter((cell) => ids.has(cell.id)),
    tests,
    scope: 'nightly',
  };
}
