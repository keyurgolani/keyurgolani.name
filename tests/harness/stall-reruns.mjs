// Row 60's reruns, out of the HTML report (R60-2): each test that carries a
// motion-stall-rerun annotation (tests/harness/motion.ts) gets one workflow
// warning, whatever its outcome, so a rerun that passed shows on the run's
// summary too, and the browser job's summary gets a "Stall reruns" count.
// The ci workflow's browser shards run the motion contract on pull requests
// and pushes alike; the ruling counts the push runs' reruns; preflight runs
// tests/quality alone. The harness's own pins (tests/e2e/motion-harness.spec.ts)
// stall a stub on purpose, so their reruns are no warning and no count: the
// summary lists them apart, as "harness self-tests", a control that the
// rerun path ran.
import { appendFileSync } from 'node:fs';
import path from 'node:path';
import { escapeData, REPO_ROOT } from '../../ci/lib/reports.mjs';

/** The annotation's type, which motion.ts writes and this reads. */
export const MOTION_STALL_RERUN = 'motion-stall-rerun';
/** The harness's own pins, whose stalls are stubbed: their reruns are self-tests, never counted. */
export const HARNESS_SPEC = 'tests/e2e/motion-harness.spec.ts';

/**
 * Each test that took a rerun, by its record name (`<file> > <title path>`, as
 * failure-reporter.ts names a failure) and its annotation's description.
 */
export function stallReruns(tests) {
  return tests.flatMap((test) => {
    const file = path.relative(REPO_ROOT, test.location.file);
    return test.annotations
      .filter(({ type }) => type === MOTION_STALL_RERUN)
      .map(({ description }) => ({
        test: `${file} > ${test.titlePath().slice(3).join(' > ') || test.title}`,
        description: description ?? '',
        selfTest: file === HARNESS_SPEC,
      }));
  });
}

/**
 * The job summary's lines for `reruns`, the counted ones: the count, then one line each, then the
 * harness's own `selfTests` count apart.
 */
export function stallSummary(reruns, selfTests = 0) {
  const lines = [`### Stall reruns`, '', `Stall reruns: ${reruns.length}`];
  if (reruns.length > 0)
    lines.push('', ...reruns.map(({ test, description }) => `- ${test}: ${description}`));
  lines.push('', `harness self-tests: ${selfTests}`);
  return `${lines.join('\n')}\n`;
}

/**
 * Reports every counted rerun in `tests`, one outside the harness's own pins: a
 * `::warning title=motion-stall-rerun::` line each in GitHub Actions (a plain warning line
 * elsewhere), and, in the browser gate's job (CI_GATE `browser`) with a summary, the count appended
 * to it, 0 included, with the harness's self-tests apart. Returns the counted reruns.
 */
export function reportStallReruns(
  tests,
  { env = process.env, log = console.log, append = appendFileSync } = {},
) {
  const all = stallReruns(tests);
  const reruns = all.filter(({ selfTest }) => !selfTest);
  const selfTests = all.length - reruns.length;
  for (const { test, description } of reruns) {
    const message = `${test} ${description}`;
    if (env.GITHUB_ACTIONS === 'true')
      log(`::warning title=${MOTION_STALL_RERUN}::${escapeData(message)}`);
    else log(`warning: ${MOTION_STALL_RERUN}: ${message}`);
  }
  if (env.CI_GATE === 'browser' && env.GITHUB_STEP_SUMMARY)
    append(env.GITHUB_STEP_SUMMARY, stallSummary(reruns, selfTests));
  return reruns;
}
