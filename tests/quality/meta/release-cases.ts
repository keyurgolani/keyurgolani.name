// The release run's cases for `pnpm quality:meta` (#11, 11-4): what
// `pnpm quality:release` decides from the full matrix's verdict and the
// release gates (release.ts's judgeRelease). A release passes only when
// the matrix and every gate do; a run that left no verdict fails, and so
// does a gate that throws. The stand-in gate here is the seam 11-3's timing
// gate takes.

import type { Verdict } from '../lib/verdict';
import { judgeRelease, MATRIX_GATE, RELEASE_GATES, type ReleaseGate } from '../release';
import type { MetaCase, MetaOutcome } from './cases';

const GATE = 'release';

const PASSED: Verdict = {
  ok: true,
  failures: [],
  flaky: [],
  counts: { collected: 3, expected: 3 },
};
const FAILED: Verdict = {
  ok: false,
  failures: [{ rule: 'tests-failed', message: '1 test(s) failed: fallback complete / at 390x844' }],
  flaky: [],
  counts: { collected: 3, expected: 2, unexpected: 1 },
};

/** A release-only gate, as 11-3's timing gate will be: over its ceiling or not. */
const timing = (over: boolean): ReleaseGate => ({
  id: 'timing',
  description: 'the stand-in for 11-3: the lab vitals medians against their ceilings',
  run: () =>
    over ? [{ rule: 'timing', message: 'LCP median 3100 ms is over its 2500 ms ceiling.' }] : [],
});

async function releaseOutcome(
  matrix: Verdict | null,
  gates: readonly ReleaseGate[],
): Promise<MetaOutcome> {
  const verdict = await judgeRelease(matrix, gates, '/nonexistent-reports');
  return {
    passed: verdict.ok,
    findings: verdict.gates.flatMap((gate) =>
      gate.failures.map(({ rule, message }) => `${gate.id} ${rule}: ${message}`),
    ),
  };
}

function releaseCase(
  slug: string,
  input: string,
  expect: MetaCase['expect'],
  matrix: Verdict | null,
  gates: readonly ReleaseGate[],
  reason?: RegExp,
): MetaCase {
  return {
    id: `${GATE}/${slug}`,
    gate: GATE,
    input,
    expect,
    reason,
    run: () => releaseOutcome(matrix, gates),
  };
}

export const RELEASE_CASES: readonly MetaCase[] = [
  releaseCase('passes', 'a passing matrix and the repository gates', 'pass', PASSED, RELEASE_GATES),
  releaseCase(
    'release-gate-passes',
    'a passing matrix and a release-only gate under its ceiling',
    'pass',
    PASSED,
    [MATRIX_GATE, timing(false)],
  ),
  releaseCase(
    'matrix-failed',
    'a matrix verdict with a failed test',
    'fail',
    FAILED,
    RELEASE_GATES,
    /^matrix tests-failed: /,
  ),
  releaseCase(
    'no-verdict',
    'a run that left no verdict.json',
    'fail',
    null,
    RELEASE_GATES,
    /^matrix no-verdict: /,
  ),
  releaseCase(
    'release-gate-failed',
    'a passing matrix and a release-only gate over its ceiling',
    'fail',
    PASSED,
    [MATRIX_GATE, timing(true)],
    /^timing timing: /,
  ),
  releaseCase(
    'gate-threw',
    'a release-only gate that throws',
    'fail',
    PASSED,
    [
      MATRIX_GATE,
      {
        id: 'timing',
        description: 'a gate that throws',
        run: () => {
          throw new Error('no vitals.json');
        },
      },
    ],
    /^timing gate-error: timing threw: no vitals\.json$/,
  ),
  releaseCase(
    'no-matrix-gate',
    'release gates that leave the matrix out',
    'fail',
    PASSED,
    [timing(false)],
    /^matrix no-matrix-gate: /,
  ),
];
