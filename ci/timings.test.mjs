import test from 'node:test';
import assert from 'node:assert/strict';
import { percentile, renderMarkdown, stats, summarize } from './timings.mjs';

const at = (s) => new Date(Date.UTC(2026, 9, 22, 0, 0, s)).toISOString();
const job = (name, created, started, completed, steps = [], conclusion = 'success') => ({
  name,
  conclusion,
  created_at: at(created),
  started_at: at(started),
  completed_at: at(completed),
  steps,
});
const step = (name, started, completed, conclusion = 'success') => ({
  name,
  conclusion,
  started_at: at(started),
  completed_at: at(completed),
});

test('percentile takes the nearest rank and ignores non-numbers', () => {
  assert.equal(percentile([5, 1, 3], 50), 3);
  assert.equal(percentile([1, 2, 3, 4], 50), 2);
  assert.equal(percentile([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 90), 9);
  assert.equal(percentile([NaN, 4], 100), 4);
  assert.equal(percentile([], 50), null);
  assert.deepEqual(stats([]), { median: null, p90: null, max: null });
});

test('a run is timed from its creation to its last job, and its queue to its first start', () => {
  const summary = summarize([
    {
      id: 1,
      created_at: at(0),
      jobs: [
        job('unit', 0, 4, 100, [step('pnpm ci:unit', 10, 95), step('Install', 5, 10)]),
        job('static', 0, 2, 40),
        // A skipped job neither ends the run nor counts as a job run.
        job('publish', 200, 200, 200, [], 'skipped'),
      ],
    },
  ]);
  assert.equal(summary.runs, 1);
  assert.deepEqual(summary.wallSeconds, { median: 100, p90: 100, max: 100 });
  assert.deepEqual(summary.queueSeconds, { median: 2, p90: 2, max: 2 });
  assert.deepEqual(
    summary.jobs.map((j) => j.name),
    ['unit', 'static'],
  );
  assert.equal(summary.jobs[0].durationSeconds.median, 96);
  assert.equal(summary.jobs[0].queueSeconds.median, 4);
  assert.deepEqual(summary.jobs[0].slowestSteps[0], { name: 'pnpm ci:unit', medianSeconds: 85 });
});

test('the cache hit rate counts "<name> cache hit" steps that ran', () => {
  const hit = (conclusion) =>
    job('unit', 0, 1, 10, [step('pnpm store cache hit', 2, 2, conclusion)]);
  const summary = summarize([
    { id: 1, created_at: at(0), jobs: [hit('success')] },
    { id: 2, created_at: at(0), jobs: [hit('skipped')] },
    { id: 3, created_at: at(0), jobs: [hit('success')] },
    { id: 4, created_at: at(0), jobs: [hit('success')] },
  ]);
  assert.deepEqual(summary.cache, { 'pnpm store': { hits: 3, lookups: 4, rate: 0.75 } });
  assert.match(renderMarkdown(summary), /\| pnpm store \| 3 \| 4 \| 0.75 \|/);
});

test('a run with no job that ran is left out', () => {
  const summary = summarize([
    { id: 1, created_at: at(0), jobs: [job('gate', 0, 0, 0, [], 'skipped')] },
  ]);
  assert.equal(summary.runs, 0);
  assert.deepEqual(summary.jobs, []);
});
