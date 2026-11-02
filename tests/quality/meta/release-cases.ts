// The release run's cases for `pnpm quality:meta` (#11, 11-4): what
// `pnpm quality:release` decides from the full matrix's verdict and the
// release gates (release.ts's judgeRelease), each case over a reports
// directory of its own holding the run's summary.json. A release passes
// only when the matrix and every gate do: a run that left no verdict fails,
// a timing median past its ceiling's release tolerance fails (11-3's
// TIMING_GATE), and so does any gate that fails or throws. The stand-in
// gates prove the seam holds any gate, not only the two it has.

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { Summary } from '../reporter';
import type { Verdict } from '../lib/verdict';
import { judgeRelease, MATRIX_GATE, RELEASE_GATES, type ReleaseGate } from '../release';
import type { MetaCase, MetaOutcome } from './cases';
import { five, lcp, perfTest } from './perf-cases';

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

/** A release summary whose perf test's five loads sit within their light ceilings. */
export const WITHIN: Pick<Summary, 'tests'> = { tests: [perfTest(five())] };
/** A release summary with an LCP median of 2,800 ms, 12% over its 2,500 ms ceiling. */
export const OVER: Pick<Summary, 'tests'> = {
  tests: [perfTest([lcp(2790), lcp(2800), lcp(2810), lcp(2700), lcp(2900)])],
};

/** A release-only gate besides the two RELEASE_GATES has: over its limit or not. */
const standIn = (over: boolean): ReleaseGate => ({
  id: 'stand-in',
  description: 'a release-only gate besides the matrix and the timing',
  run: () => (over ? [{ rule: 'stand-in', message: 'It is over its limit.' }] : []),
});

/**
 * The release's verdict on `matrix`, with `summary` as the run's
 * reports/quality/summary.json (none when null), on a workflow's first
 * attempt, every failure a finding.
 */
export async function releaseOutcome(
  matrix: Verdict | null,
  gates: readonly ReleaseGate[],
  summary: Pick<Summary, 'tests'> | null,
): Promise<MetaOutcome> {
  const reports = mkdtempSync(path.join(tmpdir(), 'quality-meta-release-'));
  const attempt = process.env.GITHUB_RUN_ATTEMPT;
  process.env.GITHUB_RUN_ATTEMPT = '1';
  try {
    if (summary) {
      mkdirSync(path.join(reports, 'quality'));
      writeFileSync(path.join(reports, 'quality', 'summary.json'), JSON.stringify(summary));
    }
    const verdict = await judgeRelease(matrix, gates, reports);
    return {
      passed: verdict.ok,
      findings: verdict.gates.flatMap((gate) =>
        gate.failures.map(({ rule, message }) => `${gate.id} ${rule}: ${message}`),
      ),
    };
  } finally {
    if (attempt === undefined) delete process.env.GITHUB_RUN_ATTEMPT;
    else process.env.GITHUB_RUN_ATTEMPT = attempt;
    rmSync(reports, { recursive: true, force: true });
  }
}

function releaseCase(
  slug: string,
  input: string,
  expect: MetaCase['expect'],
  [matrix, gates, summary]: [Verdict | null, readonly ReleaseGate[], Pick<Summary, 'tests'> | null],
  reason?: RegExp,
): MetaCase {
  return {
    id: `${GATE}/${slug}`,
    gate: GATE,
    input,
    expect,
    reason,
    run: () => releaseOutcome(matrix, gates, summary),
  };
}

export const RELEASE_CASES: readonly MetaCase[] = [
  releaseCase(
    'passes',
    "a passing matrix, and timing medians within their ceilings, through the repository's gates",
    'pass',
    [PASSED, RELEASE_GATES, WITHIN],
  ),
  releaseCase(
    'matrix-failed',
    'a matrix verdict with a failed test',
    'fail',
    [FAILED, RELEASE_GATES, WITHIN],
    /^matrix tests-failed: /,
  ),
  releaseCase(
    'no-verdict',
    'a run that left no verdict.json',
    'fail',
    [null, RELEASE_GATES, WITHIN],
    /^matrix no-verdict: /,
  ),
  releaseCase(
    'timing-breach',
    'a passing matrix, and an LCP median 12% over its ceiling',
    'fail',
    [PASSED, RELEASE_GATES, OVER],
    /^timing timing-over: composition:fallback: lcpMs's median 2800 is over 2750/,
  ),
  releaseCase(
    'timing-no-summary',
    'a passing matrix, and a run that left no summary.json for the timing gate',
    'fail',
    [PASSED, RELEASE_GATES, null],
    /^timing timing-no-summary: /,
  ),
  releaseCase(
    'release-gate-passes',
    'a passing matrix and a release-only gate under its limit',
    'pass',
    [PASSED, [MATRIX_GATE, standIn(false)], null],
  ),
  releaseCase(
    'release-gate-failed',
    'a passing matrix and a release-only gate over its limit',
    'fail',
    [PASSED, [MATRIX_GATE, standIn(true)], null],
    /^stand-in stand-in: /,
  ),
  releaseCase(
    'gate-threw',
    'a release-only gate that throws',
    'fail',
    [
      PASSED,
      [
        MATRIX_GATE,
        {
          id: 'stand-in',
          description: 'a gate that throws',
          run: () => {
            throw new Error('no vitals.json');
          },
        },
      ],
      null,
    ],
    /^stand-in gate-error: stand-in threw: no vitals\.json$/,
  ),
  releaseCase(
    'no-matrix-gate',
    'release gates that leave the matrix out',
    'fail',
    [PASSED, [standIn(false)], null],
    /^matrix no-matrix-gate: /,
  ),
];
