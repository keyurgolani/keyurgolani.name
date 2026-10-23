// Which cells the performance tests run on (#11, 11-3): one representative
// route per registered target, a composition's first route on the
// `complete` fixture under its published default appearance, and a
// surface's first route in its first state. Each carries its target's
// performanceTier from the registry or its registration, and the tier picks
// its ceilings. The verdict's perf-coverage rule (verdict.ts) holds the run
// to them, from plannedPerf(), fail-closed, the way it holds the cell tests
// to the plan.

import { defaultTuple, FALLBACK_ID, type Cell, type Plan } from '../../cells';
import { tupleKey } from '../../coverage';
import { PERF_KIND } from '../checks';
import type { PlannedPerf } from '../verdict';
import { APPEARANCE_STATE } from '../state-fixtures';

export { PERF_KIND };

/** The representative cell of each target in `plan`, in the plan's order, once each. */
export function perfCells(plan: Pick<Plan, 'cells' | 'targets'>): Cell[] {
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
        : own.find(
            (cell) =>
              cell.path === cell.route &&
              tupleKey(cell.tuple) === tupleKey(defaultTuple(FALLBACK_ID, 'system')),
          );
    if (pick && !pick.pending) chosen.push(pick);
  }
  return chosen;
}

/** The perf cells as the verdict and plan.json name them: each one's cell id, target, and tier. */
export function plannedPerf(plan: Pick<Plan, 'cells' | 'targets'>): PlannedPerf[] {
  return perfCells(plan).map((cell) => ({
    cell: cell.id,
    target: `${cell.kind}:${cell.target}`,
    tier: cell.performanceTier,
  }));
}
