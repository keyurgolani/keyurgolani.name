// The merged verdict's cases for `pnpm quality:meta` (#11, 11-4): a sharded
// quality:full run judged whole (lib/shards.ts). Each case writes its
// shards' reports to a new temporary directory as download-artifact leaves
// them, one directory per shard, and runs readShards and mergeShards over
// it, so the reading is proven with the judging. A known-bad case breaks
// one rule: each shard's own verdict passes or fails for what a shard can
// see, and the whole run fails for what only the shards together show.

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { Summary, SummaryTest } from '../reporter';
import { mergeShards, readShards, type PlanRecord, type RunVerdict } from '../lib/shards';
import type { VerdictTest } from '../lib/verdict';
import type { MetaCase, MetaOutcome } from './cases';
import { ALSO_RUNS, CELLS, cellTest, HARNESS, HELD, PROBE, RUNS, summary } from './runner-cases';

const GATE = 'merged-verdict';

function planOf(
  tests: readonly VerdictTest[],
  targets = [{ kind: 'composition' as const, id: 'fallback' }],
): PlanRecord {
  return {
    mode: 'full',
    cells: new Set(tests.map((test) => test.cell.id)).size,
    tests: tests.length,
    targets,
    reasons: [],
    changes: [],
    changed: [],
    coverage: { rows: [], tuples: 0, accepted: 0, uncoverable: [] },
    planned: tests.map((test) => ({
      cell: test.cell.id,
      viewport: test.viewport.id,
      row: test.row.id,
      skip: test.skip ?? null,
      engineSkips: test.engineSkips,
      conditions: test.conditions ?? true,
    })),
    perf: [],
  };
}

const PLAN = planOf([RUNS, ALSO_RUNS]);

/** A passing harness test that isn't the canary probe. */
const HARNESS_CHECK: SummaryTest = {
  ...PROBE,
  title: 'the harness refuses a request outside the app',
  file: 'tests/quality/harness.spec.ts',
  canaryProbe: false,
};

interface ShardInput {
  readonly shard: string;
  readonly tests: readonly SummaryTest[];
  readonly plan?: PlanRecord | null;
  /** null for a shard cut off before it judged. */
  readonly verdict?: Partial<RunVerdict> | null;
}

/** One shard's reports, as run.ts writes them. */
function shardFiles(input: ShardInput) {
  const shardSummary: Summary = summary(input.tests, { mode: 'full', shard: input.shard });
  const verdict: RunVerdict | null =
    input.verdict === null
      ? null
      : {
          ok: true,
          failures: [],
          flaky: [],
          counts: { collected: input.tests.length },
          mode: 'full',
          shard: input.shard,
          engines: ['chromium'],
          canary: { before: [], after: [] },
          ...input.verdict,
        };
  return { plan: input.plan === undefined ? PLAN : input.plan, summary: shardSummary, verdict };
}

/** The shards written to a new directory, read back, and judged whole. */
function mergedOutcome(shards: readonly ShardInput[], expected?: number): MetaOutcome {
  const root = mkdtempSync(path.join(tmpdir(), 'quality-meta-shards-'));
  try {
    for (const input of shards) {
      const dir = path.join(root, `reports-quality-full-${input.shard.split('/')[0]}`, 'quality');
      mkdirSync(dir, { recursive: true });
      const files = shardFiles(input);
      if (files.plan) writeFileSync(path.join(dir, 'plan.json'), JSON.stringify(files.plan));
      writeFileSync(path.join(dir, 'summary.json'), JSON.stringify(files.summary));
      if (files.verdict)
        writeFileSync(path.join(dir, 'verdict.json'), JSON.stringify(files.verdict));
    }
    const verdict = mergeShards(readShards(root), { expected });
    return {
      passed: verdict.ok,
      findings: verdict.failures.map(({ rule, message }) => `${rule}: ${message}`),
    };
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

/** Two shards that are fine: each planned test once, the probe in the first, its trace holding the canary. */
const SHARD_1: ShardInput = {
  shard: '1/2',
  tests: [cellTest(RUNS), PROBE],
  verdict: { canary: { before: [HELD], after: [] } },
};
const SHARD_2: ShardInput = { shard: '2/2', tests: [cellTest(ALSO_RUNS), HARNESS_CHECK] };

function mergedCase(
  rule: string,
  slug: string,
  input: string,
  expect: MetaCase['expect'],
  shards: readonly ShardInput[],
  options: { expected?: number; reason?: RegExp } = {},
): MetaCase {
  return {
    id: `${GATE}/${rule}${slug ? `-${slug}` : ''}`,
    gate: GATE,
    input,
    expect,
    reason: expect === 'fail' ? (options.reason ?? new RegExp(`^${rule}: `)) : undefined,
    run: () => mergedOutcome(shards, options.expected),
  };
}

export const SHARD_CASES: readonly MetaCase[] = [
  mergedCase(
    'whole',
    'run',
    'two shards, every planned test once between them',
    'pass',
    [SHARD_1, SHARD_2],
    { expected: 2 },
  ),
  // Each shard collected nothing, which no shard's count answers for the run.
  mergedCase('zero-tests', 'every-shard', 'two shards that each collected no test', 'fail', [
    {
      shard: '1/2',
      tests: [],
      plan: planOf([], []),
      verdict: {
        ok: false,
        failures: [{ rule: 'zero-tests', message: 'The run collected no test.' }],
      },
    },
    {
      shard: '2/2',
      tests: [],
      plan: planOf([], []),
      verdict: {
        ok: false,
        failures: [{ rule: 'zero-tests', message: 'The run collected no test.' }],
      },
    },
  ]),
  // A planned test no shard ran: each shard passes, since a shard holds only some tests.
  mergedCase(
    'plan-coverage',
    'in-no-shard',
    'two passing shards, one planned test in neither',
    'fail',
    [SHARD_1, { ...SHARD_2, tests: [HARNESS_CHECK] }],
  ),
  mergedCase(
    'canary-probe-missing',
    'in-no-shard',
    'two passing shards, the canary probe in neither',
    'fail',
    [{ ...SHARD_1, tests: [cellTest(RUNS), HARNESS_CHECK] }, SHARD_2],
  ),
  mergedCase(
    'empty-project',
    'in-every-shard',
    'two passing shards, the harness project empty in both',
    'fail',
    [
      { ...SHARD_1, tests: [cellTest(RUNS), { ...PROBE, project: CELLS }] },
      { ...SHARD_2, tests: [cellTest(ALSO_RUNS)] },
    ],
    { reason: new RegExp(`^empty-project: The project ${HARNESS} collected no test\\.$`) },
  ),
  mergedCase(
    'missing-shard',
    '',
    'shard 1 of 2, holding every test, and no shard 2',
    'fail',
    [{ ...SHARD_1, tests: [cellTest(RUNS), cellTest(ALSO_RUNS), PROBE, HARNESS_CHECK] }],
    { expected: 2 },
  ),
  mergedCase(
    'missing-shard',
    'expected-more',
    'two shards of a run the workflow sharded three ways',
    'fail',
    [SHARD_1, SHARD_2],
    { expected: 3, reason: /^(missing-shard|shard-mismatch): / },
  ),
  mergedCase('shard-unjudged', '', 'shard 2 cut off before its verdict', 'fail', [
    SHARD_1,
    { ...SHARD_2, verdict: null },
  ]),
  mergedCase('shard-mismatch', 'plan', "shard 2's plan isn't shard 1's", 'fail', [
    SHARD_1,
    { ...SHARD_2, plan: { ...PLAN, reasons: ['Another run planned this.'] } },
  ]),
  mergedCase('no-shards', '', 'an empty directory', 'fail', []),
  // A shard's own failure the joined summary can't show again carries over, naming its shard.
  mergedCase(
    'artifact-unreadable',
    'carried',
    'shard 2 deleted an artifact its scrub could not read',
    'fail',
    [
      SHARD_1,
      {
        ...SHARD_2,
        verdict: {
          ok: false,
          failures: [{ rule: 'artifact-unreadable', message: 'results/x.zip was deleted.' }],
        },
      },
    ],
    { reason: /^artifact-unreadable: shard 2\/2: results\/x\.zip was deleted\.$/ },
  ),
];
