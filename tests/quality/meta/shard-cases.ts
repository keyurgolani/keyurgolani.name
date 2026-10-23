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
import type { RunMode } from '../cells';
import type { Summary, SummaryTest } from '../reporter';
import { mergeShards, readShards, type PlanRecord, type RunVerdict } from '../lib/shards';
import type { VerdictTest } from '../lib/verdict';
import type { MetaCase, MetaOutcome } from './cases';
import { five, perfTest } from './perf-cases';
import {
  ALSO_RUNS,
  CELL,
  CELLS,
  cellTest,
  HARNESS,
  HELD,
  PROBE,
  RUNS,
  summary,
} from './runner-cases';

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
  };
}

const PLAN = planOf([RUNS, ALSO_RUNS]);

/** The plan with the fallback composition's perf cell (11-3), which one shard's perf test answers. */
export const PERF_PLAN: PlanRecord = {
  ...PLAN,
  perf: [{ cell: CELL, target: 'composition:fallback', tier: 'light' }],
};
const PERF_TEST = perfTest(five());

/** A passing harness test that isn't the canary probe. */
const HARNESS_CHECK: SummaryTest = {
  ...PROBE,
  title: 'the harness refuses a request outside the app',
  file: 'tests/quality/harness.spec.ts',
  canaryProbe: false,
};

export interface ShardInput {
  readonly shard: string;
  readonly tests: readonly SummaryTest[];
  readonly plan?: PlanRecord | null;
  /** null for a shard cut off before it judged. */
  readonly verdict?: Partial<RunVerdict> | null;
  /** verdict.json's text as it stands, in place of the verdict run.ts would write. */
  readonly rawVerdict?: string;
  /** Its artifact's directory, when not the one its shard index names. */
  readonly dir?: string;
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

/** Each shard's reports under `root`, one directory each, as download-artifact leaves them. */
export function writeShards(root: string, shards: readonly ShardInput[]): void {
  for (const input of shards) {
    const dir = path.join(
      root,
      input.dir ?? `reports-quality-full-${input.shard.split('/')[0]}`,
      'quality',
    );
    mkdirSync(dir, { recursive: true });
    const files = shardFiles(input);
    if (files.plan) writeFileSync(path.join(dir, 'plan.json'), JSON.stringify(files.plan));
    writeFileSync(path.join(dir, 'summary.json'), JSON.stringify(files.summary));
    if (input.rawVerdict !== undefined)
      writeFileSync(path.join(dir, 'verdict.json'), input.rawVerdict);
    else if (files.verdict)
      writeFileSync(path.join(dir, 'verdict.json'), JSON.stringify(files.verdict));
  }
}

/** The shards written to a new directory, read back, and judged whole. */
function mergedOutcome(
  shards: readonly ShardInput[],
  expected?: number,
  mode?: RunMode,
): MetaOutcome {
  const root = mkdtempSync(path.join(tmpdir(), 'quality-meta-shards-'));
  try {
    writeShards(root, shards);
    const verdict = mergeShards(readShards(root), { expected, mode });
    return {
      passed: verdict.ok,
      findings: verdict.failures.map(({ rule, message }) => `${rule}: ${message}`),
    };
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

/** Two shards that are fine: each planned test once, the probe in the first, its trace holding the canary. */
export const SHARD_1: ShardInput = {
  shard: '1/2',
  tests: [cellTest(RUNS), PROBE],
  verdict: { canary: { before: [HELD], after: [] } },
};
export const SHARD_2: ShardInput = { shard: '2/2', tests: [cellTest(ALSO_RUNS), HARNESS_CHECK] };

function mergedCase(
  rule: string,
  slug: string,
  input: string,
  expect: MetaCase['expect'],
  shards: readonly ShardInput[],
  options: { expected?: number; reason?: RegExp; mode?: RunMode } = {},
): MetaCase {
  return {
    id: `${GATE}/${rule}${slug ? `-${slug}` : ''}`,
    gate: GATE,
    input,
    expect,
    reason: expect === 'fail' ? (options.reason ?? new RegExp(`^${rule}: `)) : undefined,
    run: () => mergedOutcome(shards, options.expected, options.mode),
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
  mergedCase(
    'shard-mismatch',
    'reported-twice',
    'two directories both claiming shard 1/2, and a 2/2',
    'fail',
    [SHARD_1, { ...SHARD_1, dir: 'reports-quality-full-1-again', tests: [] }, SHARD_2],
    { reason: /^shard-mismatch: Shard 1 reported twice: in \S+ and \S+\.$/ },
  ),
  mergedCase(
    'shard-mismatch',
    'outside',
    'shards 1/2 and 2/2, and a third claiming 3/2',
    'fail',
    [SHARD_1, SHARD_2, { shard: '3/2', tests: [] }],
    { reason: /^shard-mismatch: reports-quality-full-3 names shard 3\/2, outside 1\.\.2\.$/ },
  ),
  mergedCase(
    'whole',
    'full-mode',
    'two full shards, merged as the full run',
    'pass',
    [SHARD_1, SHARD_2],
    {
      expected: 2,
      mode: 'full',
    },
  ),
  mergedCase(
    'shard-mismatch',
    'mode',
    "two full shards, merged as a PR run's",
    'fail',
    [SHARD_1, SHARD_2],
    { mode: 'pr', reason: /^shard-mismatch: \S+ ran quality:full, and this run is quality:pr\.$/ },
  ),
  // A verdict.json that's JSON, and not what run.ts writes, fails the merge, not the merge's own code.
  mergedCase(
    'shard-unreadable',
    'verdict',
    "shard 2's verdict.json holding only its shard",
    'fail',
    [SHARD_1, { ...SHARD_2, rawVerdict: '{"shard":"2/2"}' }],
    {
      reason:
        /^(shard-unreadable: reports-quality-full-2: verdict\.json isn't what run\.ts writes|shard-unjudged: reports-quality-full-2 holds no verdict\.json)/,
    },
  ),
  // 11-3's perf-coverage, judged once, on every shard's perf tests together.
  mergedCase('perf-coverage', 'whole', "the perf cell's test in shard 2 alone", 'pass', [
    { ...SHARD_1, plan: PERF_PLAN },
    { ...SHARD_2, plan: PERF_PLAN, tests: [...SHARD_2.tests, PERF_TEST] },
  ]),
  mergedCase(
    'perf-coverage',
    'in-no-shard',
    "two passing shards, the perf cell's test in neither",
    'fail',
    [
      { ...SHARD_1, plan: PERF_PLAN },
      { ...SHARD_2, plan: PERF_PLAN },
    ],
    { reason: /^perf-coverage: The perf test of .* is planned on chromium, and didn't run\.$/ },
  ),
  mergedCase(
    'perf-coverage',
    'in-two-shards',
    "two passing shards, the perf cell's test in both",
    'fail',
    [
      { ...SHARD_1, plan: PERF_PLAN, tests: [...SHARD_1.tests, PERF_TEST] },
      { ...SHARD_2, plan: PERF_PLAN, tests: [...SHARD_2.tests, PERF_TEST] },
    ],
    { reason: /^perf-coverage: The perf test of .* ran 2 times on chromium, not once\.$/ },
  ),
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
