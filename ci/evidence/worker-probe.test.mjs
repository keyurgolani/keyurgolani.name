// The worker probe's report (ci/evidence/worker-probe.mjs): each run's figures from Playwright's
// JSON report, and the two runs compared, every test that ended differently named.
import test from 'node:test';
import assert from 'node:assert/strict';
import { compare, summarize, testsOf } from './worker-probe.mjs';

const report = (outcome) => ({
  suites: [
    {
      title: 'cells.spec.ts',
      specs: [
        {
          title: 'a',
          tests: [
            { projectName: 'chromium s1', status: 'expected', results: [{ duration: 3000 }] },
          ],
        },
        { title: 'b', tests: [{ projectName: 'chromium s1', status: 'skipped', results: [] }] },
      ],
      suites: [
        {
          title: 'nested',
          specs: [
            {
              title: 'c',
              tests: [
                { projectName: 'chromium s2', status: outcome, results: [{ duration: 1000 }] },
              ],
            },
          ],
        },
      ],
    },
  ],
});

test('a run: its tests, their time and per-test pace, and its outcomes', () => {
  assert.deepEqual(
    testsOf(report('expected')).map((each) => each.key),
    [
      'chromium s1 › cells.spec.ts › a',
      'chromium s1 › cells.spec.ts › b',
      'chromium s2 › cells.spec.ts › nested › c',
    ],
  );
  const run = summarize(report('expected'), 2, 80);
  assert.equal(run.ran, 2);
  assert.equal(run.testSeconds, 4);
  assert.equal(run.perTestSeconds, 2);
  assert.equal(run.wallPerTest, 40);
  assert.deepEqual(
    [run.expected, run.unexpected, run.flaky, run.skipped, run.retried],
    [2, 0, 0, 1, 0],
  );
});

test('the two runs compared: a test that ends differently is a flake, by name', () => {
  const one = summarize(report('expected'), 1, 120);
  const two = summarize(report('unexpected'), 2, 80);
  const { differ, lines } = compare(one, two);
  assert.deepEqual(differ, ['chromium s2 › cells.spec.ts › nested › c']);
  assert.ok(lines.includes('| 1 | 120 | 2 | 4 | 2 | 60 | 0 | 0 | 0 |'));
  assert.match(
    lines.at(-1),
    /^1 test\(s\) ended differently: .* \(expected at 1, unexpected at 2\)$/,
  );
  assert.equal(compare(one, one).lines.at(-1), 'Every test ended the same in both runs.');
});
