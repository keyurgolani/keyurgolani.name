// Which cells the performance tests run on (#11, 11-3): one representative
// route per registered target, a composition's first route on the
// `complete` fixture under its published default appearance, and a
// surface's first route in its first state. Each carries its target's
// performanceTier from the registry or its registration, and the tier picks
// its ceilings. perfCoverage() holds the run to them, fail-closed, the way
// the verdict holds the cell tests to the plan.

import { defaultTuple, FALLBACK_ID, type Cell, type Plan } from '../../cells';
import { tupleKey } from '../../coverage';
import type { Failure } from '../verdict';
import type { Summary } from '../../reporter';
import { APPEARANCE_STATE } from '../state-fixtures';

/** The test kind perf.spec.ts's tests carry. */
export const PERF_KIND = 'perf';

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

/**
 * perf-coverage: each perf cell's test ran exactly once on each engine,
 * and every target that has cells has a perf cell. A sharded run holds only
 * some of them, so only the repeats count there.
 */
export function perfCoverage(
  plan: Pick<Plan, 'cells' | 'targets'>,
  engines: readonly string[],
  summary: Pick<Summary, 'tests' | 'shard'> | null,
): Failure[] {
  if (!summary) return [];
  const failures: Failure[] = [];
  const cells = perfCells(plan);
  for (const target of plan.targets) {
    const hasCells = plan.cells.some(
      (cell) => cell.kind === target.kind && cell.target === target.id,
    );
    if (hasCells && !cells.some((cell) => cell.kind === target.kind && cell.target === target.id)) {
      failures.push({
        rule: 'perf-coverage',
        message: `${target.kind}:${target.id} has no representative cell, so nothing measures its performance.`,
      });
    }
  }
  const sharded = summary.shard !== null;
  const ran = summary.tests.filter((test) => test.kind === PERF_KIND);
  for (const test of ran) {
    if (!cells.some((cell) => cell.id === test.cell)) {
      failures.push({
        rule: 'perf-coverage',
        message: `${test.title} ran, and no perf cell is ${test.cell}.`,
      });
    }
  }
  for (const cell of cells) {
    for (const engine of engines) {
      const count = ran.filter((test) => test.cell === cell.id && test.engine === engine).length;
      if (count > 1) {
        failures.push({
          rule: 'perf-coverage',
          message: `The perf test of ${cell.id} ran ${count} times on ${engine}, not once.`,
        });
      } else if (count === 0 && !sharded) {
        failures.push({
          rule: 'perf-coverage',
          message: `The perf test of ${cell.id} is planned on ${engine}, and didn't run.`,
        });
      }
    }
  }
  return failures;
}
