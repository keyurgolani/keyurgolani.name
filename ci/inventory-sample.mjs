#!/usr/bin/env node
// The tests an inventory sample runs (quality/inventory/sample.json), as GitHub step outputs: its
// matrix, one entry a job (its label, and the --grep that selects its tests by their @test tags),
// and the three whole-run shard lists emptied, so inventory-sample runs and inventory-1 to -3 and
// inventory-summary skip. With no sample file it writes nothing, and the whole run goes ahead.
//   node ci/inventory-sample.mjs <sample.json> >> "$GITHUB_OUTPUT"
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const TAGS = /^\(@test-[0-9a-f]{12}(?:\|@test-[0-9a-f]{12})*\)$/;

/** What's wrong with `sample`: one line a problem; none when its jobs can run. */
export function sampleProblems(sample) {
  const jobs = Array.isArray(sample?.jobs) ? sample.jobs : [];
  if (jobs.length === 0) return ['the sample names no jobs'];
  const problems = [];
  if (jobs.length > 12)
    problems.push(`the sample names ${jobs.length} jobs, more than the 12 at a time`);
  const labels = new Set();
  for (const job of jobs) {
    if (!/^sample-[a-z0-9-]+$/.test(job?.label ?? '') || labels.has(job.label))
      problems.push(`a job's label, ${job?.label}, isn't sample-<name> or repeats`);
    labels.add(job?.label);
    if (!TAGS.test(job?.grep ?? ''))
      problems.push(`${job?.label}: its grep isn't a list of @test tags`);
    else if (job.tests !== job.grep.split('|').length)
      problems.push(
        `${job.label}: it says ${job.tests} tests, and its grep names ${job.grep.split('|').length}`,
      );
  }
  return problems;
}

/** The step outputs for `sample`: the matrix, and the whole run's lists emptied. */
export function sampleOutputs(sample) {
  const include = sample.jobs.map(({ label, grep }) => ({ label, grep }));
  return [
    `matrix=${JSON.stringify({ include })}`,
    'shards1=[]',
    'shards2=[]',
    'shards3=[]',
    '',
  ].join('\n');
}

if (path.resolve(process.argv[1] ?? '') === fileURLToPath(import.meta.url)) {
  const file = process.argv[2];
  if (file && existsSync(file)) {
    const sample = JSON.parse(readFileSync(file, 'utf8'));
    const problems = sampleProblems(sample);
    for (const problem of problems) console.error(`inventory sample: ${problem}`);
    if (problems.length > 0) process.exitCode = 1;
    else process.stdout.write(sampleOutputs(sample));
  }
}
