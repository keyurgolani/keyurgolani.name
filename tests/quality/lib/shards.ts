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
  }[];
  /** The perf cells (lib/perf/plan.ts), which perf-coverage holds the run to. */
  readonly perf: readonly PlannedPerf[];
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
    })),
    perf: plannedPerf(plan),
  };
}

/** The planned tests a plan record holds, as the verdict reads them. */
export function plannedTests(record: Pick<PlanRecord, 'planned'>): VerdictTest[] {
  return record.planned.map((each) => ({
    cell: { id: each.cell },
    viewport: { id: each.viewport },
    row: { id: each.row },
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
}

function readJson<T>(file: string): T | null {
  if (!existsSync(file)) return null;
  try {
    return JSON.parse(readFileSync(file, 'utf8')) as T;
  } catch {
    return null;
  }
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
      shards.push({
        dir: path.relative(root, dir) || '.',
        plan: readJson<PlanRecord>(files[0]!),
        summary: readJson<Summary>(files[1]!),
        verdict: readJson<RunVerdict>(files[2]!),
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
]);

export interface MergedVerdict extends Verdict {
  readonly shards: readonly { readonly shard: string | null; readonly dir: string }[];
}

const parseShard = (shard: string | null | undefined) => {
  const match = /^(\d+)\/(\d+)$/.exec(shard ?? '');
  return match ? { index: Number(match[1]), total: Number(match[2]) } : null;
};

/**
 * The whole run's verdict from its shards' reports. `expected` is the
 * shard count the workflow ran, when the caller knows it.
 */
export function mergeShards(
  shards: readonly ShardReport[],
  options: { readonly expected?: number } = {},
): MergedVerdict {
  const failures: Failure[] = [];
  const fail = (rule: string, message: string) => failures.push({ rule, message });
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

  const summaries = shards.flatMap((shard) => (shard.summary ? [shard.summary] : []));
  const first = summaries[0];
  const joined: Summary | null = first
    ? {
        ...first,
        shard: null,
        status: summaries.every((each) => each.status === 'passed') ? 'passed' : 'failed',
        tests: summaries.flatMap((each) => each.tests),
        errors: summaries.flatMap((each) => each.errors),
      }
    : null;
  const engines = shards.find((shard) => shard.verdict)?.verdict?.engines ?? [];
  const judged = judge({
    plan: { targets: plan?.targets ?? [], tests: plan ? plannedTests(plan) : [] },
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
