// The checks every quality cell test runs (run-cell.ts) and every visual
// test runs (visual.spec.ts), which each lists in an annotation, and which
// the run's verdict holds every passing one to (verdict.ts): a test that
// passed without one of its kind's checks fails the run. Slice 2's suites
// run by row and viewport: requiredChecks() says which a cell test owes, and
// run-cell.ts runs what it says.

import { VIEWPORTS } from './matrix';
import type { PreferenceMode } from './vocabulary';

export const CELL_CHECKS = ['status', 'emulation', 'clock', 'axe', 'contrast'] as const;
export type CellCheck = (typeof CELL_CHECKS)[number];

export const VISUAL_CHECKS = ['fonts', 'status', 'screenshot'] as const;
export type VisualCheck = (typeof VISUAL_CHECKS)[number];

/** What every perf test (perf.spec.ts, #11's 11-3) runs: the statuses, the LCP and static-mode rules, and the timing medians. */
export const PERF_CHECKS = ['status', 'lcp', 'static', 'timing'] as const;
export type PerfCheck = (typeof PERF_CHECKS)[number];

/** The test kind perf.spec.ts's tests carry. */
export const PERF_KIND = 'perf';
/** Slice 2's suites, each a gate of part A's EXCEPTION_GATES but overlays, which are the keyboard gate's. */
export type SuiteCheck =
  | 'keyboard'
  | 'focus'
  | 'occlusion'
  | 'landscape-occlusion'
  | 'overlays'
  | 'hover'
  | 'reflow'
  | 'inventory'
  | 'enhancement'
  | 'motion'
  | 'transparency';

/** What each row adds to every cell test of it. */
const ROW_CHECKS: Readonly<Record<PreferenceMode, readonly SuiteCheck[]>> = {
  default: ['keyboard', 'focus', 'occlusion', 'overlays'],
  'reduced-motion': ['motion'],
  'forced-colors': ['keyboard', 'focus'],
  'contrast-more': ['keyboard', 'focus'],
  'high-contrast': ['keyboard', 'focus'],
  'reduced-transparency': ['transparency'],
  print: ['inventory'],
  'no-javascript': ['keyboard'],
};

/** The runner's check that a swept page rendered the pack its cookie asked for (lib/sweep.ts's packFindings). */
export const SWEEP_PACK_CHECK = 'sweep-pack';

/**
 * What a swept cell's test owes beside CELL_CHECKS and SWEEP_PACK_CHECK (lib/sweep.ts): the
 * [37] rule's five checks alone, by the row each runs in. Its axe run is
 * the contrast rules, since a pack changes how the page looks and never
 * what it is.
 */
export const SWEEP_ROW_CHECKS: Readonly<Record<string, readonly SuiteCheck[]>> = {
  default: ['keyboard', 'focus'],
  'forced-colors': ['keyboard', 'focus'],
  'reduced-motion': ['motion'],
  'reduced-transparency': ['transparency'],
};

/**
 * The checks a cell test at `viewport` in `row` owes. In the default row,
 * hover parity runs at the pointer viewports; the reflow, inventory, and
 * enhancement conditions, which reload the page several times, once a cell,
 * at the first viewport, where the plan says the cell takes them
 * (PlannedTest.conditions); and the landscape occlusion pass at the phone's.
 * A swept cell's test (`sweep`) owes SWEEP_ROW_CHECKS instead.
 */
export function requiredChecks(
  row: string,
  viewport: string,
  conditions = true,
  sweep = false,
): string[] {
  if (sweep) return [...CELL_CHECKS, SWEEP_PACK_CHECK, ...(SWEEP_ROW_CHECKS[row] ?? [])];
  const at = VIEWPORTS.find((each) => each.id === viewport);
  const checks: string[] = [...CELL_CHECKS, ...(ROW_CHECKS[row as PreferenceMode] ?? [])];
  if (row === 'default' && at) {
    if (at.inputMode === 'mouse') checks.push('hover');
    if (conditions && at === VIEWPORTS[0]) checks.push('reflow', 'inventory', 'enhancement');
    if (at === VIEWPORTS.find((each) => each.inputMode === 'touch'))
      checks.push('landscape-occlusion');
  }
  return checks;
}

/** The annotation a test lists the checks it ran in. */
export const CHECKS_ANNOTATION = 'quality-checks';

/**
 * The check a page that requires script takes in place of its content
 * without JavaScript: its notice, in the no-JavaScript row and the default
 * row's no-JavaScript and print conditions.
 */
export const NOTICE_CHECK = 'notice';

/** The annotation that says which kind of quality test a test is: cell, visual, or perf. */
export const KIND_ANNOTATION = 'quality-kind';

export type TestKind = 'cell' | 'visual' | 'perf';

/** Each kind's checks. */
export const KIND_CHECKS: Readonly<Record<TestKind, readonly string[]>> = {
  cell: CELL_CHECKS,
  visual: VISUAL_CHECKS,
  perf: PERF_CHECKS,
};

/**
 * Whether `text` is a reason a test may skip with or a registration may
 * exclude cells with: a sentence of three words or more, ending in a
 * period, with nothing around it. " " and "n/a" aren't.
 */
export function isReason(text: unknown): boolean {
  if (typeof text !== 'string' || text.trim() !== text) return false;
  return text.length >= 16 && text.split(/\s+/).length >= 3 && /[.!?]$/.test(text);
}
