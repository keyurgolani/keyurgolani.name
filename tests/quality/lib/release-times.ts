// A CI run's measured times, as release-fit.ts's times file (lib/release-fit.ts) takes them. There
// are two inputs, both read as they are and never rewritten:
//
// - The run's jobs, as GitHub's jobs API gives them (`/actions/runs/{id}/jobs`, each job's steps[]
//   with their started_at and completed_at). A job's fixed part is the sum of its install, build,
//   and list steps, plus its checkout and upload steps if it has them. overheadSeconds is the p90
//   of those sums over the jobs read (nearest rank). A job without one of the three named steps, or
//   one whose steps lack either time, fails the read.
// - Each job's log as text: Playwright's line reporter, one result line a test,
//   `✓ 12 [chromium 490d6d4f3e] › cells.spec.ts:43:7 › <cell> › <viewport> <row> › <title> (12.3s)`.
//   A cells.spec.ts test's key is testKey(cell, viewport, row, engine), and the engine is the first
//   word of its project. Any other line is skipped, but a line that starts like a result and doesn't
//   parse fails the read, as does a test that appears twice.
//
// Only jobs that finished with conclusion success are read. A capped or cancelled job holds a part
// of its tests (E's reader: NOT READ), so it fails the read unless it's named to leave out, and the
// source says which were left out.

import { CELL_SPEC, testKey } from './pr-shards';
import type { ReleaseTimes, TimedTest } from './release-fit';

/** The steps a job's fixed part always holds, by their names in ci.yml's rc1-evidence job. */
export const FIXED_STEPS: readonly string[] = ['Install', 'pnpm ci:build', "List the job's tests"];
/** The steps it holds when the job has them: its checkout, and the reports' upload. */
export const OPTIONAL_STEP = /^(Run actions\/checkout@|Upload )/;

export interface ApiStep {
  readonly name: string;
  readonly started_at?: string | null;
  readonly completed_at?: string | null;
}

export interface ApiJob {
  readonly id?: number;
  readonly name: string;
  readonly conclusion?: string | null;
  readonly steps?: readonly ApiStep[];
}

const seconds = (step: ApiStep, job: string): number => {
  const start = Date.parse(step.started_at ?? '');
  const end = Date.parse(step.completed_at ?? '');
  if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) {
    throw new Error(`${job}: step "${step.name}" has no readable started_at and completed_at.`);
  }
  return (end - start) / 1000;
};

/** A job's fixed part, in seconds, and the steps it summed. */
export function jobOverhead(job: ApiJob): {
  readonly seconds: number;
  readonly steps: readonly { readonly name: string; readonly seconds: number }[];
} {
  const steps = job.steps ?? [];
  for (const name of FIXED_STEPS) {
    const found = steps.filter((step) => step.name === name).length;
    if (found !== 1) throw new Error(`${job.name}: ${found} steps named "${name}", not 1.`);
  }
  const summed = steps
    .filter((step) => FIXED_STEPS.includes(step.name) || OPTIONAL_STEP.test(step.name))
    .map((step) => ({ name: step.name, seconds: seconds(step, job.name) }));
  return { seconds: summed.reduce((sum, step) => sum + step.seconds, 0), steps: summed };
}

/** The p90 of `values`, nearest rank. */
export function p90(values: readonly number[]): number {
  if (values.length === 0) throw new Error('No job to take a p90 of.');
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.ceil(0.9 * sorted.length) - 1]!;
}

/** Playwright's duration, `250ms`, `12.3s`, or `1.2m`, in seconds; null when it's none of them. */
export function durationSeconds(text: string): number | null {
  const match = /^(\d+(?:\.\d+)?)(ms|s|m)$/.exec(text);
  if (!match) return null;
  const value = Number(match[1]);
  return match[2] === 'ms' ? value / 1000 : match[2] === 'm' ? value * 60 : value;
}

// GitHub prefixes each log line with its time; a line may also carry the reporter's colours.
const STAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z /;
const COLOUR = /\u001b\[[0-9;]*m/g;
/** A line that starts like a result: a mark, its number, and a project in brackets. */
const RESULT_START = /^\s*[✓✘]\s+\d+\s+\[/;
const RESULT =
  /^\s*[✓✘]\s+\d+\s+\[([^\]]+)\] › ([^\s:]+\.spec\.ts)(?::\d+:\d+)? › (.+) \((\d+(?:\.\d+)?(?:ms|s|m))\)\s*$/;

/** One log line as a timed test: null for a line that isn't a result, and it throws for one that starts like a result and doesn't parse. */
export function resultLine(raw: string, where: string): TimedTest | null {
  const line = raw.replace(STAMP, '').replace(COLOUR, '');
  if (!RESULT_START.test(line)) return null;
  const match = RESULT.exec(line);
  const secs = match ? durationSeconds(match[4]!) : null;
  if (!match || secs === null)
    throw new Error(`${where}: a result line that doesn't parse: ${line.trim()}`);
  const [, project, file, title] = match as unknown as [string, string, string, string];
  if (file !== CELL_SPEC) return { project, file, seconds: secs };
  const parts = title.split(' › ');
  const at = parts[1]?.split(' ') ?? [];
  if (parts.length !== 3 || at.length !== 2) {
    throw new Error(
      `${where}: a cell test whose title isn't "<cell> › <viewport> <row> › <title>": ${line.trim()}`,
    );
  }
  const engine = project.split(' ')[0]!;
  return { project, file, key: testKey(parts[0]!, at[0]!, at[1]!, engine), seconds: secs };
}

/** A job's log as its timed tests, each once. */
export function logTests(text: string, where: string): TimedTest[] {
  const tests: TimedTest[] = [];
  text.split(/\r?\n/).forEach((raw, at) => {
    const test = resultLine(raw, `${where}:${at + 1}`);
    if (test) tests.push(test);
  });
  return tests;
}

export interface RunInput {
  /** Each run's jobs API JSON, by where it came from. */
  readonly runs: readonly { readonly from: string; readonly jobs: readonly ApiJob[] }[];
  /** Each job's log text, by the job's name. */
  readonly logs: ReadonlyMap<string, string>;
  /** Only jobs whose name starts with this are read. */
  readonly prefix: string;
  /** Jobs to leave out by name, each with a reason the source keeps. */
  readonly exclude?: ReadonlyMap<string, string>;
}

/** The times file for `input`, with each job's fixed part, or it throws, naming what it couldn't read. */
export function runTimes(input: RunInput): {
  readonly times: ReleaseTimes;
  readonly jobs: readonly {
    readonly name: string;
    readonly overhead: number;
    readonly tests: number;
  }[];
} {
  const exclude = input.exclude ?? new Map<string, string>();
  const jobs = input.runs.flatMap((run) =>
    run.jobs.filter((job) => job.name.startsWith(input.prefix)),
  );
  if (jobs.length === 0) throw new Error(`No job named "${input.prefix}…" in the runs.`);
  const names = jobs.map((job) => job.name);
  const twice = names.filter((name, at) => names.indexOf(name) !== at);
  if (twice.length > 0)
    throw new Error(`Jobs named more than once: ${[...new Set(twice)].join(', ')}.`);
  for (const name of exclude.keys()) {
    if (!names.includes(name)) throw new Error(`Left out but not in the runs: ${name}.`);
  }
  for (const name of input.logs.keys()) {
    if (!names.includes(name)) throw new Error(`A log for a job not in the runs: ${name}.`);
  }
  const read = jobs.filter((job) => !exclude.has(job.name));
  const unread = read.filter((job) => job.conclusion !== 'success');
  if (unread.length > 0) {
    throw new Error(
      `Jobs that didn't succeed, so hold a part of their tests: ${unread.map((job) => `${job.name} (${job.conclusion ?? 'no conclusion'})`).join(', ')}. Leave each out by name, or re-run it.`,
    );
  }
  const seen = new Map<string, string>();
  const tests: TimedTest[] = [];
  const perJob = read.map((job) => {
    const text = input.logs.get(job.name);
    if (text === undefined) throw new Error(`No log for ${job.name}.`);
    const own = logTests(text, job.name);
    if (own.length === 0) throw new Error(`${job.name}: its log has no result line.`);
    for (const test of own) {
      const id = `${test.project} ${test.file} ${test.key ?? ''}`;
      if (test.key !== undefined && seen.has(id)) {
        throw new Error(`${test.key} on ${test.project} is in ${seen.get(id)} and ${job.name}.`);
      }
      seen.set(id, job.name);
    }
    tests.push(...own);
    return { name: job.name, overhead: jobOverhead(job).seconds, tests: own.length };
  });
  const overheadSeconds = Math.round(p90(perJob.map((job) => job.overhead)));
  const left = [...exclude].map(([name, why]) => `${name} (${why})`);
  return {
    times: {
      source: `${input.runs.map((run) => run.from).join(', ')}: ${read.length} "${input.prefix}" jobs read${left.length ? `, left out ${left.join('; ')}` : ''}; overheadSeconds is the p90 of each job's ${[...FIXED_STEPS, 'checkout', 'upload'].join(', ')} steps; tests from each job's Playwright lines (release-times.ts)`,
      overheadSeconds,
      tests,
    },
    jobs: perJob,
  };
}
