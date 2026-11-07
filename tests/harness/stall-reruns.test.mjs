import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { REPO_ROOT } from '../../ci/lib/reports.mjs';
import { MOTION_STALL_RERUN, reportStallReruns, stallSummary } from './stall-reruns.mjs';

/** A test as Playwright's reporter API gives it, with what reportStallReruns reads. */
const testCase = (title, annotations, outcome = 'expected') => ({
  title,
  annotations,
  location: { file: path.join(REPO_ROOT, 'tests/e2e/motion-contract.spec.ts'), line: 104 },
  titlePath: () => [
    '',
    'chromium',
    'motion-contract.spec.ts',
    'kinetic-cosmos, under reduce',
    title,
  ],
  outcome: () => outcome,
});
const RERUN = {
  type: MOTION_STALL_RERUN,
  description: 'kind=frame-stall scroller=0 step=3 call=next-frames',
};

/** What reportStallReruns prints and appends, as GitHub Actions has it. */
function run(tests) {
  const lines = [];
  const appended = [];
  const reruns = reportStallReruns(tests, {
    env: { GITHUB_ACTIONS: 'true', GITHUB_STEP_SUMMARY: '/summary.md' },
    log: (line) => lines.push(line),
    append: (file, text) => appended.push([file, text]),
  });
  return { lines, appended, reruns };
}

test('a passed test that took a stall rerun gives one warning, and one without gives none', () => {
  const { lines } = run([
    testCase('nothing runs once the page has settled', [
      { type: 'route', description: '/' },
      RERUN,
    ]),
    testCase('a navigation link jumps to its section', [{ type: 'route', description: '/' }]),
  ]);
  assert.deepEqual(lines, [
    '::warning title=motion-stall-rerun::tests/e2e/motion-contract.spec.ts > kinetic-cosmos, under reduce > nothing runs once the page has settled kind=frame-stall scroller=0 step=3 call=next-frames',
  ]);
});

test('every outcome warns, a failed or flaky rerun as much as a passed one', () => {
  for (const outcome of ['expected', 'unexpected', 'flaky', 'skipped']) {
    assert.equal(run([testCase('t', [RERUN], outcome)]).lines.length, 1, outcome);
  }
});

test("the job summary gets the Stall reruns count, 0 included, and each rerun's test", () => {
  const { appended } = run([testCase('t', [RERUN])]);
  assert.deepEqual(appended, [['/summary.md', stallSummary(run([testCase('t', [RERUN])]).reruns)]]);
  assert.match(
    appended[0][1],
    /^### Stall reruns\n\nStall reruns: 1\n\n- tests\/e2e\/motion-contract\.spec\.ts > kinetic-cosmos, under reduce > t: kind=frame-stall/,
  );
  assert.match(run([testCase('t', [])]).appended[0][1], /Stall reruns: 0\n$/);
});

test('the reporter reports reruns before it looks for a gate, and motion.ts writes the same type', () => {
  const reporter = readFileSync(path.join(REPO_ROOT, 'tests/harness/failure-reporter.ts'), 'utf8');
  const onEnd = reporter.slice(reporter.indexOf('onEnd()'));
  assert.ok(onEnd.indexOf('reportStallReruns(') > 0, 'onEnd reports the reruns');
  assert.ok(
    onEnd.indexOf('reportStallReruns(') < onEnd.indexOf('currentGate()'),
    'before the gate check',
  );
  const motion = readFileSync(path.join(REPO_ROOT, 'tests/harness/motion.ts'), 'utf8');
  assert.match(motion, /import \{ MOTION_STALL_RERUN \} from '\.\/stall-reruns\.mjs';/);
});
