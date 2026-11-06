import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import type { TestCase } from '@playwright/test/reporter';
import { REPO_ROOT } from '../../ci/lib/reports.mjs';
import { judgeListed, uncovered } from '../../ci/release/release-records.mjs';
import { serverEgressMessage } from '../harness/fixtures';
import {
  KIND_ANNOTATION,
  OWED_ANNOTATION,
  CHECKS_ANNOTATION,
  SOFT_FAILURES_ANNOTATION,
} from './lib/checks';
import type { CellFailure } from './lib/failure-records';
import { VIEWPORTS } from './lib/matrix';
import { attachEgressRecord, egressRecord, failEgress, RECORDS_ATTACHMENT } from './lib/records';
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

/** The annotations cells.spec.ts gives HC's 1440x900 default cell test. */
const CELL_ANNOTATIONS = [
  { type: KIND_ANNOTATION, description: 'cell' },
  { type: 'route', description: '/' },
  { type: 'profile', description: 'default' },
  { type: 'cell', description: 'composition:horizontal-cinema complete' },
  { type: 'target', description: 'composition:horizontal-cinema' },
  { type: 'viewport', description: '1440x900' },
  { type: 'row', description: 'default' },
];

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
    annotations: CELL_ANNOTATIONS,
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

test("a failed cell test's summary entry: failures from every records attachment, its soft count and owed checks as runCell annotated them, not its errors or ran", () => {
  const egress = { ...record(), check: 'runner', rule: 'server-egress', element: undefined };
  const entry = summaryTest(
    finished({
      // runCell's attachment, then an egress fixture's own.
      attached: [[record(), record({ rule: 'perimeter' })], [egress]],
      errors: ['axe, WCAG 2.2 AA', "Slice 2's suites", 'The server tried to reach 1 host(s)'],
      resultAnnotations: [
        { type: CHECKS_ANNOTATION, description: 'status axe focus' },
        { type: OWED_ANNOTATION, description: 'status axe keyboard focus' },
        { type: SOFT_FAILURES_ANNOTATION, description: '2' },
      ],
    }),
  );
  assert.deepEqual(entry.failures, [
    { check: 'focus', rule: 'contrast', target: NAV },
    { check: 'focus', rule: 'perimeter', target: NAV },
    { check: 'runner', rule: 'server-egress', target: null },
  ]);
  assert.equal(entry.records, 3);
  assert.equal(entry.errors.length, 3);
  assert.equal(entry.softFailures, 2);
  assert.deepEqual(entry.checks, ['status', 'axe', 'focus']);
  assert.deepEqual(entry.owed, ['status', 'axe', 'keyboard', 'focus']);
  // So the matcher holds it uncovered: it hit egress, past its soft count, short an owed check.
  assert.equal(uncovered(entry), 'it hit server-egress, which no records list may name');
  const quiet = summaryTest(
    finished({
      attached: [[record()]],
      errors: ['axe, WCAG 2.2 AA', 'Test timeout of 600000ms exceeded while tearing down "app".'],
      resultAnnotations: [
        { type: CHECKS_ANNOTATION, description: 'status focus' },
        { type: OWED_ANNOTATION, description: 'status focus' },
        { type: SOFT_FAILURES_ANNOTATION, description: '1' },
      ],
    }),
  );
  assert.equal(
    uncovered(quiet),
    'it ended with 2 error(s), not the 1 soft expectation(s) behind its records',
  );
  // With no annotations, nothing is counted or owed, and the matcher refuses it.
  const bare = summaryTest(finished());
  assert.equal(bare.softFailures, undefined);
  assert.equal(bare.owed, undefined);
  assert.match(uncovered(bare)!, /no count of runCell's soft expectations/);
});

test("an egress fixture's record names the cell test's own fields, and a listed test with one is unrecorded, naming egress", async () => {
  const attached: { name: string; body: string }[] = [];
  const testInfo = {
    annotations: CELL_ANNOTATIONS,
    attach: async (name: string, options: { body: string }) => {
      attached.push({ name, body: options.body });
    },
  };
  const message = serverEgressMessage(['x.test:443']);
  const made = await attachEgressRecord(
    testInfo,
    VIEWPORTS,
    'server-egress',
    message.split('\n')[0]!,
  );
  assert.deepEqual(made, {
    check: 'runner',
    rule: 'server-egress',
    surface: 'horizontal-cinema',
    composition: true,
    route: '/',
    viewport: '1440x900',
    inputMode: VIEWPORTS.find((each) => each.id === '1440x900')!.inputMode,
    preferenceMode: 'default',
    profile: 'default',
    actual: 'The server tried to reach 1 host(s) outside the app: x.test:443',
  });
  assert.deepEqual(
    attached.map((each) => [each.name, JSON.parse(each.body)]),
    [[RECORDS_ATTACHMENT, [made]]],
  );
  // A test that isn't a cell test gets none.
  assert.equal(
    egressRecord(
      CELL_ANNOTATIONS.filter((each) => each.type !== KIND_ANNOTATION),
      VIEWPORTS,
      'browser-egress',
      'x',
    ),
    null,
  );
  // Through the reporter and the matcher: the listed records are named, and still it's refused.
  for (const rule of ['browser-egress', 'server-egress']) {
    const entry = summaryTest(
      finished({
        attached: [[record()], [{ ...made!, rule }]],
        errors: ["Slice 2's suites", message],
        resultAnnotations: [
          { type: CHECKS_ANNOTATION, description: 'status focus' },
          { type: OWED_ANNOTATION, description: 'status focus' },
          { type: SOFT_FAILURES_ANNOTATION, description: '1' },
        ],
      }),
    );
    const listed = [
      {
        cell: 'composition:horizontal-cinema complete',
        viewport: '1440x900',
        row: 'default',
        engine: 'chromium',
        check: 'focus',
        rule: 'contrast',
        target: NAV,
        owner: 'lane C',
        routed: 'row 5',
      },
    ];
    const judged = judgeListed([entry], listed);
    assert.deepEqual(
      judged.unrecorded.map(({ why }) => why),
      [`it hit ${rule}, which no records list may name`],
    );
    // Its listed record still failed: its entry didn't pass.
    assert.deepEqual(judged.passed, []);
  }
});

test('a record that repeats one kept already, the same rule on the same element in the same cell, is one failure; an aria-only or elementless repeat stays repeated', () => {
  // Reflow's re-probe with a disclosure toggled: one element overflows both times.
  const reflow = (actual: string, element: CellFailure['element']) =>
    record({ check: 'reflow', rule: 'overflow', viewport: '320x568', actual, element });
  const entry = summaryTest(
    finished({
      attached: [
        [
          reflow('12px past the edge', { selector: NAV }),
          reflow('14px past the edge, with the disclosure open', { selector: NAV }),
          reflow('a', { semanticRole: 'link', accessibleName: 'Writing' }),
          reflow('b', { semanticRole: 'link', accessibleName: 'Writing' }),
          { ...reflow('c', undefined), check: 'runner', rule: 'status' },
          { ...reflow('d', undefined), check: 'runner', rule: 'status' },
        ],
      ],
    }),
  );
  assert.deepEqual(entry.failures, [
    { check: 'reflow', rule: 'overflow', target: `@320x568 ${NAV}` },
    { check: 'reflow', rule: 'overflow', target: '@320x568 aria:link|Writing|' },
    { check: 'reflow', rule: 'overflow', target: '@320x568 aria:link|Writing|' },
    { check: 'runner', rule: 'status', target: null },
    { check: 'runner', rule: 'status', target: null },
  ]);
  // Records counts every record the test attached, as before.
  assert.equal(entry.records, 6);
});

test("an egress fixture's teardown attaches its attempts, then its record, then throws, and both fixtures end through it", async () => {
  const calls: string[] = [];
  const testInfo = {
    annotations: CELL_ANNOTATIONS,
    attach: async (name: string, options: { body: string }) => {
      calls.push(`${name}: ${options.body.trim()}`);
    },
  };
  await assert.rejects(
    failEgress(testInfo, VIEWPORTS, {
      file: 'server-egress.txt',
      attempts: ['x.test:443'],
      rule: 'server-egress',
      actual: 'The server tried to reach 1 host(s) outside the app: x.test:443',
      message: serverEgressMessage(['x.test:443']),
    }),
    (error: Error) => error.message === serverEgressMessage(['x.test:443']),
  );
  assert.equal(calls.length, 2);
  assert.equal(calls[0], 'server-egress.txt: x.test:443');
  assert.ok(
    calls[1]!.startsWith(`${RECORDS_ATTACHMENT}: [{"check":"runner","rule":"server-egress"`),
  );
  // Each egress fixture ends through failEgress, with its own rule.
  const fixtures = readFileSync(new URL('./fixtures.ts', import.meta.url), 'utf8');
  for (const [fixture, rule] of [
    ['blockedRequests', 'browser-egress'],
    ['serverEgress', 'server-egress'],
  ]) {
    const start = fixtures.indexOf(`\n  ${fixture}: async`);
    assert.ok(start >= 0, fixture);
    const body = fixtures.slice(start, fixtures.indexOf('\n  },', start));
    assert.match(
      body,
      new RegExp(`await failEgress\\(testInfo, VIEWPORTS, \\{[^}]*rule: '${rule}'`),
      fixture,
    );
    // It throws only through failEgress, after both attaches.
    assert.doesNotMatch(body, /\bthrow\b/, fixture);
  }
});
