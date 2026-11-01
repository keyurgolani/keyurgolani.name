#!/usr/bin/env node
// CI timings from finished runs: node ci/timings.mjs [--limit 30] [--out <file>]
//
// Reads finished `ci` workflow runs on pull requests with `gh api` (read
// only; it never starts, reruns, or cancels anything), and summarizes wall
// time, queue time, per-job and per-step durations, and the cache hit rate.
// ci/baseline.json is its output from before path selection and caches, and
// ci/shards.mjs reads the per-job numbers from it.
//
// Only successful runs count, since a failed run stops early and a cancelled
// one never finishes. A job's queue time is created to started, and a run's
// wall time is its creation to its last job's finish.
//
// A cache hit shows as a step named "<name> cache hit" that ran: the workflow
// runs that step only when the restore step reports `cache-hit`, so the
// steps list alone gives the hit rate without reading logs.
import { spawnSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const seconds = (from, to) => (Date.parse(to) - Date.parse(from)) / 1000;

/** The nearest-rank percentile of a list of numbers, or null when empty. */
export function percentile(values, p) {
  const sorted = values.filter((v) => Number.isFinite(v)).sort((a, b) => a - b);
  if (sorted.length === 0) return null;
  const rank = Math.max(1, Math.ceil((p / 100) * sorted.length));
  return sorted[Math.min(rank, sorted.length) - 1];
}

/** Median, p90, and max of a list, rounded to whole seconds. */
export function stats(values) {
  const round = (v) => (v === null ? null : Math.round(v));
  return {
    median: round(percentile(values, 50)),
    p90: round(percentile(values, 90)),
    max: round(percentile(values, 100)),
  };
}

const ran = (job) => job.conclusion !== 'skipped' && job.started_at && job.completed_at;

/**
 * Summarizes runs shaped like the GitHub API's: { id, created_at, jobs: [{
 * name, conclusion, created_at, started_at, completed_at, steps: [{ name,
 * conclusion, started_at, completed_at }] }] }.
 */
export function summarize(runs) {
  const wall = [];
  const queue = [];
  const byJob = new Map();
  const cache = new Map();

  for (const run of runs) {
    const jobs = (run.jobs ?? []).filter(ran);
    if (jobs.length === 0) continue;
    const lastFinish = jobs
      .map((j) => j.completed_at)
      .sort()
      .at(-1);
    const firstStart = jobs.map((j) => j.started_at).sort()[0];
    wall.push(seconds(run.created_at, lastFinish));
    queue.push(seconds(run.created_at, firstStart));
    for (const job of jobs) {
      const entry = byJob.get(job.name) ?? { durations: [], queues: [], steps: new Map() };
      entry.durations.push(seconds(job.started_at, job.completed_at));
      entry.queues.push(seconds(job.created_at ?? job.started_at, job.started_at));
      for (const step of job.steps ?? []) {
        const hit = /^(.+) cache hit$/.exec(step.name);
        if (hit) {
          const c = cache.get(hit[1]) ?? { hits: 0, lookups: 0 };
          c.lookups += 1;
          if (step.conclusion === 'success') c.hits += 1;
          cache.set(hit[1], c);
        }
        if (step.conclusion === 'skipped' || !step.started_at || !step.completed_at) continue;
        const list = entry.steps.get(step.name) ?? [];
        list.push(seconds(step.started_at, step.completed_at));
        entry.steps.set(step.name, list);
      }
      byJob.set(job.name, entry);
    }
  }

  const jobs = [...byJob.entries()]
    .map(([name, { durations, queues, steps }]) => ({
      name,
      runs: durations.length,
      durationSeconds: stats(durations),
      queueSeconds: stats(queues),
      slowestSteps: [...steps.entries()]
        .map(([step, list]) => ({ name: step, medianSeconds: stats(list).median }))
        .sort((a, b) => b.medianSeconds - a.medianSeconds || a.name.localeCompare(b.name))
        .slice(0, 3),
    }))
    .sort(
      (a, b) => b.durationSeconds.median - a.durationSeconds.median || a.name.localeCompare(b.name),
    );

  return {
    runs: wall.length,
    wallSeconds: stats(wall),
    queueSeconds: stats(queue),
    jobs,
    cache: Object.fromEntries(
      [...cache.entries()]
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([name, { hits, lookups }]) => [
          name,
          { hits, lookups, rate: lookups ? Math.round((hits / lookups) * 100) / 100 : null },
        ]),
    ),
  };
}

export function renderMarkdown(summary) {
  const s = (v) => (v === null ? '' : `${v}s`);
  const lines = [
    `${summary.runs} runs. Wall median ${s(summary.wallSeconds.median)}, p90 ${s(summary.wallSeconds.p90)}, max ${s(summary.wallSeconds.max)}. Queue median ${s(summary.queueSeconds.median)}, p90 ${s(summary.queueSeconds.p90)}.`,
    '',
    '| Job | Runs | Median | p90 | Max | Queue median | Slowest step |',
    '| --- | --- | --- | --- | --- | --- | --- |',
    ...summary.jobs.map((j) =>
      [
        '',
        j.name,
        j.runs,
        s(j.durationSeconds.median),
        s(j.durationSeconds.p90),
        s(j.durationSeconds.max),
        s(j.queueSeconds.median),
        j.slowestSteps[0]
          ? `${j.slowestSteps[0].name} (${s(j.slowestSteps[0].medianSeconds)})`
          : '',
        '',
      ]
        .join(' | ')
        .trim(),
    ),
  ];
  const caches = Object.entries(summary.cache);
  if (caches.length > 0) {
    lines.push('', '| Cache | Hits | Lookups | Rate |', '| --- | --- | --- | --- |');
    for (const [name, c] of caches)
      lines.push(`| ${name} | ${c.hits} | ${c.lookups} | ${c.rate} |`);
  }
  return `${lines.join('\n')}\n`;
}

function gh(args) {
  const result = spawnSync('gh', ['api', ...args], { encoding: 'utf8', maxBuffer: 64 << 20 });
  if (result.status !== 0) throw new Error(`gh api ${args.join(' ')}: ${result.stderr.trim()}`);
  return JSON.parse(result.stdout);
}

function option(argv, name, fallback) {
  const at = argv.indexOf(name);
  return at === -1 ? fallback : argv[at + 1];
}

function main(argv) {
  const limit = Number(option(argv, '--limit', '30'));
  const out = option(argv, '--out', null);
  const repo = option(argv, '--repo', 'keyurgolani/keyurgolani.name');
  const list = gh([
    `repos/${repo}/actions/workflows/ci.yml/runs?event=pull_request&status=success&per_page=100`,
  ]);
  const picked = list.workflow_runs.filter((r) => r.head_branch !== 'main').slice(0, limit);
  const runs = picked.map((r) => ({
    id: r.id,
    created_at: r.created_at,
    head_sha: r.head_sha,
    jobs: gh([`repos/${repo}/actions/runs/${r.id}/jobs?per_page=100`]).jobs,
  }));
  const summary = summarize(runs);
  const result = {
    source: {
      workflow: 'ci.yml',
      event: 'pull_request',
      conclusion: 'success',
      runIds: runs.map((r) => r.id),
      from: runs.at(-1)?.created_at ?? null,
      to: runs[0]?.created_at ?? null,
    },
    ...summary,
  };
  if (out) writeFileSync(path.resolve(out), `${JSON.stringify(result, null, 2)}\n`);
  console.log(renderMarkdown(summary));
  return 0;
}

if (path.resolve(process.argv[1] ?? '') === fileURLToPath(import.meta.url)) {
  process.exit(main(process.argv.slice(2)));
}
