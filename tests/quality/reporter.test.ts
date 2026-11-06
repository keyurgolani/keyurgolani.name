import assert from 'node:assert/strict';
import path from 'node:path';
import test from 'node:test';
import type { TestCase } from '@playwright/test/reporter';
import { REPO_ROOT } from '../../ci/lib/reports.mjs';
import { KIND_ANNOTATION } from './lib/checks';
import type { CellFailure } from './lib/failure-records';
import { RECORDS_ATTACHMENT } from './lib/records';
import { summaryTest } from './reporter';

// The reporter's summary.json entry for one test (summaryTest): what a release candidate's records
// list is matched on (ci/release/release-records.mjs) comes from here, so it's pinned on stand-in
// TestCases as Playwright hands them to the reporter.

const NAV = 'html > body:nth-child(2) > header:nth-child(2) > nav:nth-child(2) > a:nth-child(1)';

/** A failure record of HC's cell page at 1440x900, as runCell attaches it. */
const record = (extra: Partial<CellFailure> = {}): CellFailure => ({
  check: 'focus',
  rule: 'contrast',
  surface: 'horizontal-cinema',
  composition: true,
  route: '/',
  viewport: '1440x900',
  inputMode: 'keyboard',
  preferenceMode: 'default',
  element: { semanticRole: 'link', accessibleName: 'Writing', selector: NAV },
  expected: '3:1',
  actual: '0 of 486 changed pixels reach 3:1',
  ...extra,
});

/**
 * A finished cell test of HC at 1440x900, default, as the reporter sees it: its annotations, the
 * last result's annotations, errors and attachments (each a records attachment of `attached`).
 */
function finished({
  outcome = 'unexpected',
  attached = [[record()]],
  errors = ['axe, WCAG 2.2 AA'],
  resultAnnotations = [] as { type: string; description?: string }[],
}: {
  outcome?: 'expected' | 'unexpected';
  attached?: readonly (readonly CellFailure[])[];
  errors?: readonly string[];
  resultAnnotations?: { type: string; description?: string }[];
} = {}): TestCase {
  return {
    title: 'composition:horizontal-cinema complete / at 1440x900, default',
    titlePath: () => [
      '',
      'chromium',
      'cells.spec.ts',
      'composition:horizontal-cinema complete / at 1440x900, default',
    ],
    location: { file: path.join(REPO_ROOT, 'tests/quality/cells.spec.ts'), line: 1 },
    parent: { project: () => ({ name: 'chromium', use: { browserName: 'chromium' } }) },
    expectedStatus: 'passed',
    annotations: [
      { type: KIND_ANNOTATION, description: 'cell' },
      { type: 'route', description: '/' },
      { type: 'cell', description: 'composition:horizontal-cinema complete' },
      { type: 'target', description: 'composition:horizontal-cinema' },
      { type: 'viewport', description: '1440x900' },
      { type: 'row', description: 'default' },
    ],
    outcome: () => outcome,
    results: [
      {
        status: outcome === 'expected' ? 'passed' : 'failed',
        annotations: resultAnnotations,
        errors: errors.map((message) => ({ message })),
        attachments: attached.map((records) => ({
          name: RECORDS_ATTACHMENT,
          contentType: 'application/json',
          body: Buffer.from(JSON.stringify(records)),
        })),
      },
    ],
  } as unknown as TestCase;
}

test("a failed cell test's failures are its records keyed under its own surface and viewport: a primitives-page or landscape record is qualified", () => {
  const listed = summaryTest(
    finished({
      attached: [
        [
          record(),
          record({ surface: 'primitives', composition: false, route: '/_fixtures/appearance' }),
          record({ check: 'occlusion', rule: 'obscured', viewport: '900x1440' }),
          record({ element: undefined, check: 'runner', rule: 'status' }),
        ],
      ],
    }),
  );
  assert.equal(listed.kind, 'cell');
  assert.equal(listed.target, 'composition:horizontal-cinema');
  assert.equal(listed.viewport, '1440x900');
  assert.deepEqual(listed.failures, [
    { check: 'focus', rule: 'contrast', target: NAV },
    { check: 'focus', rule: 'contrast', target: `primitives >> ${NAV}` },
    { check: 'occlusion', rule: 'obscured', target: `@900x1440 ${NAV}` },
    { check: 'runner', rule: 'status', target: null },
  ]);
  // A waived record isn't a failure, and a test that passed failed nothing.
  assert.deepEqual(
    summaryTest(finished({ attached: [[record({ exceptionId: 'hc-nav-focus' })]] })).failures,
    [],
  );
  assert.deepEqual(summaryTest(finished({ outcome: 'expected', errors: [] })).failures, []);
});
