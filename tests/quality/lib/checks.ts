// The checks every quality cell test runs (run-cell.ts) and every visual
// test runs (visual.spec.ts), which each lists in an annotation, and which
// the run's verdict holds every passing one to (verdict.ts): a test that
// passed without one of its kind's checks fails the run.

export const CELL_CHECKS = ['status', 'emulation', 'clock', 'axe'] as const;
export type CellCheck = (typeof CELL_CHECKS)[number];

export const VISUAL_CHECKS = ['fonts', 'status', 'screenshot'] as const;
export type VisualCheck = (typeof VISUAL_CHECKS)[number];

/** What every perf test (perf.spec.ts, #11's 11-3) runs: the statuses, the LCP and static-mode rules, and the timing medians. */
export const PERF_CHECKS = ['status', 'lcp', 'static', 'timing'] as const;
export type PerfCheck = (typeof PERF_CHECKS)[number];

/** The test kind perf.spec.ts's tests carry. */
export const PERF_KIND = 'perf';

/** The annotation a test lists the checks it ran in. */
export const CHECKS_ANNOTATION = 'quality-checks';

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
