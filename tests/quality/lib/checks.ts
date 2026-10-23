// The checks every quality cell test runs (run-cell.ts), which it lists in
// an annotation, and which the run's verdict holds every passing cell test
// to (verdict.ts): a cell that passed without one of them fails the run.

export const CELL_CHECKS = ['status', 'markers', 'emulation', 'clock', 'axe'] as const;
export type CellCheck = (typeof CELL_CHECKS)[number];

/** The annotation a cell test lists the checks it ran in. */
export const CHECKS_ANNOTATION = 'quality-checks';
