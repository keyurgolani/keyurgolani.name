// Row 60's reruns, out of the HTML report (R60-2): each test that carries a
// motion-stall-rerun annotation (tests/harness/motion.ts) gets one workflow
// warning, whatever its outcome, so a rerun that passed shows on the run's
// summary too, and the job summary gets a "Stall reruns" count. Only the
// push runs' browser shards run the motion contract, so they're where a
// row 60 stall shows; preflight runs tests/quality alone.
import { appendFileSync } from 'node:fs';
import path from 'node:path';
import { escapeData, REPO_ROOT } from '../../ci/lib/reports.mjs';

/** The annotation's type, which motion.ts writes and this reads. */
export const MOTION_STALL_RERUN = 'motion-stall-rerun';

/**
 * Each test that took a rerun, by its record name (`<file> > <title path>`, as
 * failure-reporter.ts names a failure) and its annotation's description.
 */
export function stallReruns(tests) {
  return tests.flatMap((test) =>
    test.annotations
      .filter(({ type }) => type === MOTION_STALL_RERUN)
      .map(({ description }) => ({
        test: `${path.relative(REPO_ROOT, test.location.file)} > ${test.titlePath().slice(3).join(' > ') || test.title}`,
        description: description ?? '',
      })),
  );
}

/** The job summary's lines for `reruns`: the count, then one line each. */
export function stallSummary(reruns) {
  const lines = [`### Stall reruns`, '', `Stall reruns: ${reruns.length}`];
  if (reruns.length > 0)
    lines.push('', ...reruns.map(({ test, description }) => `- ${test}: ${description}`));
  return `${lines.join('\n')}\n`;
}

/**
 * Reports every rerun in `tests`: a `::warning title=motion-stall-rerun::` line each in GitHub
 * Actions (a plain warning line elsewhere), and, where the job has a summary, the count appended to
 * it. Returns the reruns.
 */
export function reportStallReruns(
  tests,
  { env = process.env, log = console.log, append = appendFileSync } = {},
) {
  const reruns = stallReruns(tests);
  for (const { test, description } of reruns) {
    const message = `${test} ${description}`;
    if (env.GITHUB_ACTIONS === 'true')
      log(`::warning title=${MOTION_STALL_RERUN}::${escapeData(message)}`);
    else log(`warning: ${MOTION_STALL_RERUN}: ${message}`);
  }
  if (env.GITHUB_STEP_SUMMARY) append(env.GITHUB_STEP_SUMMARY, stallSummary(reruns));
  return reruns;
}
