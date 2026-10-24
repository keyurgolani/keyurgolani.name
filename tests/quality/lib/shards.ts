// A sharded quality:full run's merged verdict (#11, 11-4). Each shard's
// run.ts judges only what a shard can: the checks that need every test (the
// plan's coverage, empty projects, the canary probe, and targets with no
// test) skip there. Once every shard has uploaded its reports, this reads
// them back, checks they're one run's shards, and judges the run whole:
// the shards' summaries joined into one, against the plan they share, with
// every shard's canary scan. A shard's own failures the joined summary can't
// show again (a browser that didn't launch, a setup or scrub failure, a
// canary that proved nothing) carry over, each naming its shard.
//
// It fails closed on its own rules too:
//
// - no-shards: nothing under the directory is a shard's report.
// - missing-shard: a shard of 1..m left no report, or the run expected m
//   shards and the reports say otherwise.
// - shard-unjudged: a shard's report holds no verdict, so its run was cut
//   off before it judged and scrubbed.
// - shard-mismatch: the reports aren't one run's: two say different shard
//   counts, modes, or engines, two hold different plans, or one shard
//   reported twice.
// - shard-job: the caller says the shard jobs didn't all succeed
//   (quality-pr-verdict passes `needs`' result).
//
// quality:pr's shards (lib/pr-shards.ts) merge the same way: each lists
// every project and plans the whole PR set, and runs only its own groups.

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import type { Plan, RunMode } from '../cells';
import type { Summary } from '../reporter';
import { plannedPerf } from './perf/plan';
import {
  judge,
  type ArtifactHit,
  type Failure,
  type PlannedPerf,
  type Verdict,
  type VerdictTest,
} from './verdict';

/** What run.ts keeps of a plan in reports/quality/plan.json. */
export interface PlanRecord {
  readonly mode: RunMode;
  readonly cells: number;
  readonly tests: number;
  readonly targets: Plan['targets'];
  readonly reasons: readonly string[];
  readonly changes: Plan['changes'];
  readonly changed: readonly { readonly cell: string; readonly by: unknown }[];
  readonly coverage: Pick<Plan['coverage'], 'rows' | 'tuples' | 'accepted' | 'uncoverable'>;
  readonly planned: readonly {
    readonly cell: string;
    readonly viewport: string;
    readonly row: string;
    readonly skip: string | null;
    readonly engineSkips: Readonly<Record<string, string>>;
    /** Whether it runs the default row's reload conditions (cells.ts). */
    readonly conditions: boolean;
    /** A swept cell's test (lib/sweep.ts), which owes the sweep's checks. Absent otherwise. */
    readonly sweep?: true;
  }[];
  /** The perf cells (lib/perf/plan.ts), which perf-coverage holds the run to. run.ts always writes them. */
  readonly perf?: readonly PlannedPerf[];
}

/** What plan.json keeps of a plan: no file contents. */
export function planRecord(plan: Plan): PlanRecord {
  return {
    mode: plan.mode,
    cells: plan.cells.length,
    tests: plan.tests.length,
    targets: plan.targets,
    reasons: plan.reasons,
    changes: plan.changes,
    changed: plan.cells
      .filter((cell) => cell.changed)
      .map((cell) => ({ cell: cell.id, by: cell.changed })),
    coverage: {
      rows: plan.coverage.rows,
      tuples: plan.coverage.tuples,
      accepted: plan.coverage.accepted,
      uncoverable: plan.coverage.uncoverable,
    },
    planned: plan.tests.map((test) => ({
      cell: test.cell.id,
      viewport: test.viewport.id,
      row: test.row.id,
      skip: test.skip ?? null,
      engineSkips: test.engineSkips,
      conditions: test.conditions,
      ...(test.cell.sweep ? { sweep: true as const } : {}),
    })),
    perf: plannedPerf(plan),
  };
}

/** The planned tests a plan record holds, as the verdict reads them. */
export function plannedTests(record: Pick<PlanRecord, 'planned'>): VerdictTest[] {
  return record.planned.map((each) => ({
    cell: { id: each.cell, ...(each.sweep ? { sweep: true } : {}) },
    viewport: { id: each.viewport },
    // The plan wrote it from a row's id.
    row: { id: each.row as VerdictTest['row']['id'] },
    ...(each.skip === null ? {} : { skip: each.skip }),
    engineSkips: each.engineSkips,
    conditions: each.conditions,
  }));
}

/** What run.ts writes to reports/quality/verdict.json: the verdict, and what a merge needs of the run. */
export interface RunVerdict extends Verdict {
  readonly mode: RunMode;
  readonly shard: string | null;
  readonly engines: readonly string[];
  /** The canary scan before and after the scrub, by label, never by value. */
  readonly canary: {
    readonly before: readonly ArtifactHit[];
    readonly after: readonly ArtifactHit[];
  };
}

/** One shard's reports, as the merge reads them. */
export interface ShardReport {
  /** The directory its quality/ reports are in, relative to the merge's. */
  readonly dir: string;
  readonly plan: PlanRecord | null;
  readonly summary: Summary | null;
  readonly verdict: RunVerdict | null;
  /** Why a file that's there can't be read as what run.ts writes, one line each: such a file reads as none. */
  readonly problems?: readonly string[];
}

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);
const isArray = (value: unknown) => Array.isArray(value);
const isShardField = (value: unknown) => value === null || typeof value === 'string';

/** What each file must hold to be read as run.ts wrote it, as checks on its parsed value. */
const SHAPES: Readonly<Record<string, (value: Record<string, unknown>) => boolean>> = {
  'plan.json': (value) => isArray(value.targets) && isArray(value.planned),
  'summary.json': (value) =>
    isArray(value.tests) &&
    isArray(value.errors) &&
    isArray(value.projects) &&
    isShardField(value.shard),
  'verdict.json': (value) =>
    typeof value.ok === 'boolean' &&
    isArray(value.failures) &&
    (value.failures as unknown[]).every(
      (each) => isObject(each) && typeof each.rule === 'string' && typeof each.message === 'string',
    ) &&
    typeof value.mode === 'string' &&
    isShardField(value.shard) &&
    isArray(value.engines) &&
    isObject(value.canary) &&
    isArray(value.canary.before) &&
    isArray(value.canary.after),
};

/** A shard's file, or null when it's missing, or when it's there and isn't what run.ts writes, which `problems` says. */
function readShardFile<T>(file: string, problems: string[]): T | null {
  if (!existsSync(file)) return null;
  let value: unknown;
  try {
    value = JSON.parse(readFileSync(file, 'utf8'));
  } catch (error) {
    problems.push(`${path.basename(file)} isn't JSON: ${(error as Error).message.split('\n')[0]}`);
    return null;
  }
  if (!isObject(value) || !SHAPES[path.basename(file)]!(value)) {
    problems.push(`${path.basename(file)} isn't what run.ts writes, so it can't be read.`);
    return null;
  }
  return value as T;
}

/**
 * Every shard's reports under `root`: each directory with a quality/ that
 * holds a plan, a summary, or a verdict, as download-artifact leaves each
 * shard's reports artifact in a directory of its own.
 */
export function readShards(root: string): ShardReport[] {
  const shards: ShardReport[] = [];
  const walk = (dir: string) => {
    const quality = path.join(dir, 'quality');
    const files = ['plan.json', 'summary.json', 'verdict.json'].map((name) =>
      path.join(quality, name),
    );
    if (files.some((file) => existsSync(file))) {
      const problems: string[] = [];
      shards.push({
        dir: path.relative(root, dir) || '.',
        plan: readShardFile<PlanRecord>(files[0]!, problems),
        summary: readShardFile<Summary>(files[1]!, problems),
        verdict: readShardFile<RunVerdict>(files[2]!, problems),
        ...(problems.length > 0 ? { problems } : {}),
      });
      return;
    }
    for (const entry of readdirSync(dir, { withFileTypes: true }).sort((a, b) =>
      a.name < b.name ? -1 : 1,
    )) {
      if (entry.isDirectory()) walk(path.join(dir, entry.name));
    }
  };
  if (existsSync(root)) walk(root);
  return shards;
}

/** The checks run.ts's verdict makes again from the joined summary; a shard's other failures carry over. */
const REJUDGED = new Set([
  'zero-tests',
  'plan-coverage',
  'empty-project',
  'canary-probe-missing',
  'expected-failure',
  'undeclared-skip',
  'target-without-results',
  'unchecked-cell',
  'tests-failed',
  'run-errors',
  'canary-leaked',
  'perf-coverage',
]);

/**
 * The shards' summaries as one run's: every shard's tests and errors, no
 * shard, and none of what run.ts adds to a shard's summary after judging
 * it (its verdict, timing trend, and budget results). quality:merge writes
 * it as the run's summary.json, which the release's timing gate reads.
 */
export function joinSummaries(shards: readonly ShardReport[]): Summary | null {
  const summaries = shards.flatMap((shard) => (shard.summary ? [shard.summary] : []));
  const first = summaries[0];
  if (!first) return null;
  const {
    verdict: _verdict,
    timing: _timing,
    budgets: _budgets,
    ...rest
  } = first as Summary & Record<'verdict' | 'timing' | 'budgets', unknown>;
  void _verdict;
  void _timing;
  void _budgets;
  return {
    ...rest,
    shard: null,
    status: summaries.every((each) => each.status === 'passed') ? 'passed' : 'failed',
    tests: summaries.flatMap((each) => each.tests),
    errors: summaries.flatMap((each) => each.errors),
  };
}

export interface MergedVerdict extends Verdict {
  readonly shards: readonly { readonly shard: string | null; readonly dir: string }[];
}

const parseShard = (shard: string | null | undefined) => {
  const match = /^(\d+)\/(\d+)$/.exec(shard ?? '');
  return match ? { index: Number(match[1]), total: Number(match[2]) } : null;
};

/**
 * The whole run's verdict from its shards' reports. `expected` is the
 * shard count the workflow ran, and `mode` the mode it ran them in (`full`
 * for the nightly and release runs), when the caller knows them.
 */
export function mergeShards(
  shards: readonly ShardReport[],
  options: { readonly expected?: number; readonly mode?: RunMode; readonly jobs?: string } = {},
): MergedVerdict {
  const failures: Failure[] = [];
  const fail = (rule: string, message: string) => failures.push({ rule, message });
  // The shard jobs' own result, as `needs` gives it: a shard whose job
  // failed, was cancelled, or was skipped fails the run, whatever its
  // reports say, since a job can end badly after its verdict.
  if (options.jobs !== undefined && options.jobs !== 'success') {
    fail(
      'shard-job',
      `The shard jobs ended ${options.jobs || 'with no result'}, not success, so a shard failed, was cancelled, or was skipped.`,
    );
  }
  const listed = shards.map((each) => ({
    shard: each.verdict?.shard ?? each.summary?.shard ?? null,
    dir: each.dir,
  }));
  const done = (): MergedVerdict => ({
    ok: failures.length === 0,
    failures,
    flaky: [],
    counts: {},
    shards: listed,
  });

  if (shards.length === 0) {
    fail('no-shards', "No shard's quality reports are here, so nothing says what ran.");
    return done();
  }
  const name = (shard: ShardReport) => shard.verdict?.shard ?? shard.summary?.shard ?? shard.dir;
  for (const shard of shards) {
    for (const problem of shard.problems ?? [])
      fail('shard-unreadable', `${shard.dir}: ${problem}`);
    if (!shard.verdict) {
      fail(
        'shard-unjudged',
        `${shard.dir} holds no verdict.json, so its run stopped before it judged and scrubbed.`,
      );
    }
  }

  const totals = new Set<number>();
  const seen = new Map<number, string>();
  for (const shard of shards) {
    const parsed = parseShard(shard.verdict?.shard ?? shard.summary?.shard);
    if (!parsed) {
      if (shard.verdict || shard.summary) {
        fail('shard-mismatch', `${shard.dir} isn't a shard: its run names no <n>/<m> shard.`);
      }
      continue;
    }
    totals.add(parsed.total);
    if (parsed.index < 1 || parsed.index > parsed.total) {
      fail(
        'shard-mismatch',
        `${shard.dir} names shard ${parsed.index}/${parsed.total}, outside 1..${parsed.total}.`,
      );
      continue;
    }
    const other = seen.get(parsed.index);
    if (other !== undefined) {
      fail('shard-mismatch', `Shard ${parsed.index} reported twice: in ${other} and ${shard.dir}.`);
    }
    seen.set(parsed.index, shard.dir);
  }
  if (options.expected !== undefined) totals.add(options.expected);
  if (totals.size > 1) {
    fail(
      'shard-mismatch',
      `The shards disagree on how many there are: ${[...totals].sort().join(', ')}.`,
    );
  }
  const total = Math.max(0, ...totals);
  for (let index = 1; index <= total; index += 1) {
    if (!seen.has(index)) {
      fail(
        'missing-shard',
        `Shard ${index}/${total} left no report, so its tests are unaccounted for.`,
      );
    }
  }

  const modes = new Set(shards.flatMap((shard) => (shard.verdict ? [shard.verdict.mode] : [])));
  if (modes.size > 1)
    fail('shard-mismatch', `The shards ran different modes: ${[...modes].join(', ')}.`);
  if (options.mode !== undefined) {
    for (const shard of shards) {
      if (shard.verdict && shard.verdict.mode !== options.mode) {
        fail(
          'shard-mismatch',
          `${shard.dir} ran quality:${shard.verdict.mode}, and this run is quality:${options.mode}.`,
        );
      }
    }
  }
  const engineSets = new Set(
    shards.flatMap((shard) => (shard.verdict ? [JSON.stringify(shard.verdict.engines)] : [])),
  );
  if (engineSets.size > 1) fail('shard-mismatch', 'The shards planned different engines.');

  const plans = shards.filter((shard) => shard.plan);
  const plan = plans[0]?.plan ?? null;
  for (const shard of plans.slice(1)) {
    if (JSON.stringify(shard.plan) !== JSON.stringify(plan)) {
      fail(
        'shard-mismatch',
        `${shard.dir}'s plan isn't ${plans[0]!.dir}'s, so they aren't one run's shards.`,
      );
    }
  }
  if (!plan)
    fail('shard-mismatch', 'No shard kept its plan.json, so nothing says what was planned.');

  // A shard's failures the joined summary can't show again, naming the shard.
  for (const shard of shards) {
    for (const each of shard.verdict?.failures ?? []) {
      if (!REJUDGED.has(each.rule)) fail(each.rule, `shard ${name(shard)}: ${each.message}`);
    }
  }

  const joined = joinSummaries(shards);
  const engines = shards.find((shard) => shard.verdict)?.verdict?.engines ?? [];
  const judged = judge({
    // perf-coverage, too, is judged once, here, on every shard's perf tests.
    plan: {
      targets: plan?.targets ?? [],
      tests: plan ? plannedTests(plan) : [],
      ...(plan?.perf !== undefined ? { perf: plan.perf } : {}),
    },
    engines,
    summary: joined,
    missingBrowsers: [],
    canary: {
      before: shards.flatMap((shard) => shard.verdict?.canary.before ?? []),
      after: shards.flatMap((shard) => shard.verdict?.canary.after ?? []),
    },
  });
  failures.push(...judged.failures);
  const unique = failures.filter(
    (each, index) =>
      failures.findIndex((other) => other.rule === each.rule && other.message === each.message) ===
      index,
  );
  return {
    ok: unique.length === 0,
    failures: unique,
    flaky: judged.flaky,
    counts: { ...judged.counts, shards: shards.length },
    shards: listed,
  };
}
