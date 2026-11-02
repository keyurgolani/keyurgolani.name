// Which cells the performance tests run on (#11, 11-3): one representative
// route per registered target, a composition's first route on the
// `complete` fixture under its published default appearance, and a
// surface's first route in a state with no query, its default page, or in
// the state its registration's perfState names, the one way a query goes on
// a surface's perf cell. Each carries its target's
// performanceTier from the registry or its registration, and the tier picks
// its ceilings. The verdict's perf-coverage rule (verdict.ts) holds the run
// to them, from plannedPerf(), fail-closed, the way it holds the cell tests
// to the plan.
//
// A PR plan leaves a signed-in surface's perf cell, such as #8's Studio's,
// to the full plan, which runs nightly and before release: #11's item 8
// keeps the PR matrix small, and 11-3's timing only reports on a PR. Its
// accessibility cells still run on every PR. plannedPerf() names such a
// cell as deferred, so perf-coverage knows the target is answered for and
// that the cell doesn't run.

import { defaultTuple, FALLBACK_ID, type Cell, type Plan } from '../../cells';
import { tupleKey } from '../../coverage';
import { PERF_KIND } from '../checks';
import type { PlannedPerf } from '../verdict';
import { APPEARANCE_STATE } from '../state-fixtures';

export { PERF_KIND };

/** Why a PR plan leaves a signed-in surface's perf cell to the full plan. */
export const DEFERRED_PERF =
  "A signed-in surface's performance runs in the full plan, nightly and before release, and not on a PR (#11, item 8).";

type PerfPlan = Pick<Plan, 'cells' | 'targets' | 'mode'>;

/** The representative cell of each target in `plan`, in the plan's order, once each, the deferred ones included. */
function representatives(plan: Pick<Plan, 'cells' | 'targets'>): Cell[] {
  const chosen: Cell[] = [];
  for (const target of plan.targets) {
    const own = plan.cells.filter((cell) => cell.kind === target.kind && cell.target === target.id);
    const pick =
      target.kind === 'composition'
        ? own.find(
            (cell) =>
              cell.state === APPEARANCE_STATE.id &&
              cell.path === '/' &&
              tupleKey(cell.tuple) === tupleKey(defaultTuple(cell.target, 'system')),
          )
        : (own.find(
            (cell) =>
              cell.perfState === true &&
              tupleKey(cell.tuple) === tupleKey(defaultTuple(FALLBACK_ID, 'system')),
          ) ??
          own.find(
            (cell) =>
              cell.path === cell.route &&
              tupleKey(cell.tuple) === tupleKey(defaultTuple(FALLBACK_ID, 'system')),
          ));
    if (pick && !pick.pending) chosen.push(pick);
  }
  return chosen;
}

/** Whether `plan` leaves `cell`'s perf test to the full plan. */
const deferred = (plan: PerfPlan, cell: Cell) => plan.mode === 'pr' && cell.auth === 'session';

/** The perf cells `plan` runs, in the plan's order, once each. */
export function perfCells(plan: PerfPlan): Cell[] {
  return representatives(plan).filter((cell) => !deferred(plan, cell));
}

/**
 * The perf cells as the verdict and plan.json name them: each one's cell
 * id, target, and tier, and why it doesn't run here when the plan defers it.
 */
export function plannedPerf(plan: PerfPlan): PlannedPerf[] {
  return representatives(plan).map((cell) => ({
    cell: cell.id,
    target: `${cell.kind}:${cell.target}`,
    tier: cell.performanceTier,
    ...(deferred(plan, cell) ? { deferred: DEFERRED_PERF } : {}),
  }));
}
