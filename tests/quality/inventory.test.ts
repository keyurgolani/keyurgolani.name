import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { recordKey } from '../../ci/release/release-records.mjs';
import * as inventoryModule from './inventory';
import { readShards } from './lib/shards';
import { SHARD_WORKERS } from './lib/pr-shards';
import { readFileSync } from 'node:fs';
import { ALSO_RUNS, cellTest, RUNS } from './meta/runner-cases';
import { SHARD_1, SHARD_2, writeShards, type ShardInput } from './meta/shard-cases';

// The inventory run's summary (tests/quality/inventory.ts, .github/workflows/inventory.yml): every
// shard merged, failures counted by composition, rule, check and viewport with their record keys,
// never gated on a records list; it fails only when the shards aren't the whole run.

const failing = (
  planned: typeof RUNS,
  failures: { check: string; rule: string; target: string | null }[],
) =>
  cellTest(planned, {
    outcome: 'unexpected',
    status: 'failed',
    records: failures.length,
    failures,
  });

function inventoried(shards: readonly ShardInput[], expected?: number) {
  const root = mkdtempSync(path.join(tmpdir(), 'quality-inventory-'));
  try {
    writeShards(root, shards);
    return inventoryModule.inventory(readShards(root), expected);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

test('whole shards with failing tests: every record counted and keyed, and the inventory passes, gating on no records list', () => {
  const contrast = { check: 'axe', rule: 'color-contrast', target: '#main > p' };
  const focus = { check: 'focus', rule: 'contrast', target: 'nav > a' };
  const summary = inventoried(
    [
      {
        ...SHARD_1,
        tests: [failing(RUNS, [contrast, focus]), ...SHARD_1.tests.slice(1)],
        verdict: {
          ...SHARD_1.verdict,
          ok: false,
          failures: [{ rule: 'tests-failed', message: 'x' }],
        },
      },
      { ...SHARD_2, tests: [failing(ALSO_RUNS, [contrast]), ...SHARD_2.tests.slice(1)] },
    ],
    2,
  );
  assert.equal(summary.ok, true, JSON.stringify(summary.incomplete));
  assert.deepEqual(summary.incomplete, []);
  assert.equal(summary.shards, 2);
  assert.equal(summary.failedTests, 2);
  assert.equal(summary.records, 3);
  assert.deepEqual(summary.byTarget, { 'composition:fallback': 3 });
  assert.deepEqual(summary.byRule, { 'axe color-contrast': 2, 'focus contrast': 1 });
  assert.deepEqual(summary.byCheck, { axe: 2, focus: 1 });
  assert.deepEqual(summary.byViewport, { '1024x768': 1, '1440x900': 2 });
  // Each key as a records list names it: the test's cell, viewport, row and engine, the record's own.
  assert.equal(summary.keys.length, 3);
  assert.ok(
    summary.keys.includes(
      recordKey({
        cell: RUNS.cell.id,
        viewport: RUNS.viewport.id,
        row: RUNS.row.id,
        engine: 'chromium',
        ...contrast,
      }),
    ),
  );
  assert.deepEqual(summary.unrecorded, []);
  const lines = inventoryModule.inventoryLines(summary);
  assert.ok(lines.includes('| axe color-contrast | 2 |'));
  assert.match(
    lines.join('\n'),
    /2 test\(s\) failed, holding 3 failure record\(s\) \(3 distinct keys\); 0 failed with no record\. It reports, and gates on no records list\./,
  );
});

test('a failed test with no record is named, not counted as one', () => {
  const summary = inventoried(
    [
      {
        ...SHARD_1,
        tests: [
          cellTest(RUNS, { outcome: 'unexpected', status: 'timedOut' }),
          ...SHARD_1.tests.slice(1),
        ],
      },
      SHARD_2,
    ],
    2,
  );
  assert.equal(summary.ok, true);
  assert.equal(summary.records, 0);
  assert.equal(summary.unrecorded.length, 1);
  assert.match(summary.unrecorded[0]!, /fallback complete \/ at 1440x900, default$/);
});

test('a missing shard, or a report that holds none of its tests, fails the inventory', () => {
  const missing = inventoried([SHARD_1], 2);
  assert.equal(missing.ok, false);
  assert.ok(missing.incomplete.some((each) => each.rule === 'missing-shard'));
  // The second shard's report is there, but holds none of the tests it ran.
  const empty = inventoried([SHARD_1, { ...SHARD_2, tests: SHARD_2.tests.slice(1) }], 2);
  assert.equal(empty.ok, false);
  assert.ok(
    empty.incomplete.some((each) => each.rule === 'plan-coverage'),
    JSON.stringify(empty.incomplete),
  );
  // A shard cut off before it judged.
  const cut = inventoried([SHARD_1, { ...SHARD_2, verdict: null }], 2);
  assert.ok(cut.incomplete.some((each) => each.rule === 'shard-unjudged'));
  assert.deepEqual(
    [...inventoryModule.INVENTORY_GATES],
    [
      'no-shards',
      'missing-shard',
      'shard-mismatch',
      'shard-unreadable',
      'shard-unjudged',
      'not-whole',
      'plan-coverage',
      'zero-tests',
    ],
  );
});

test("the inventory's worker count is the planner's, the release run's: one setting the worker probe settles", () => {
  const file = JSON.parse(
    readFileSync(new URL('../../quality/inventory/workers.json', import.meta.url), 'utf8'),
  ) as { workers: number; source: string };
  assert.equal(file.workers, SHARD_WORKERS);
  assert.match(file.source, /worker probe/);
  // Its scope is (c′), whole, with an empty records list: it reports and gates on none.
  const scope = JSON.parse(
    readFileSync(new URL('../../quality/inventory/scope.json', import.meta.url), 'utf8'),
  ) as { scope: string };
  assert.equal(scope.scope, 'reachable');
  assert.deepEqual(
    JSON.parse(
      readFileSync(new URL('../../quality/inventory/records.json', import.meta.url), 'utf8'),
    ),
    [],
  );
});
