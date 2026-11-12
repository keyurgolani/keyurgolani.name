#!/usr/bin/env node
// The nightly's pause (row 151, the coordinator's ruling, 2026-11-11): scheduled.yml's big-run job
// asks whether a big run is in flight on the repository, and quality-full and quality-verdict skip
// the night when one is, so the nightly's 16 shards never stand beside a big run's 16 past the
// account's 20 job slots. A big run is either:
//
// - a release-tag run: release.yml on a tag push (a candidate's or a final's), never its PR dry run;
// - an inventory evidence run over the release scope (c′): any run of INVENTORY_WORKFLOW, the file
//   an inventory run must be (.github/workflows/inventory.yml), on any branch or event.
//
// It reads the repository's queued, waiting and in-progress runs with the job's actions: read,
// writes `busy=true|false` to GITHUB_OUTPUT, and says which run it found, or that it found none,
// in the job summary. Pure Node with no dependencies, so it runs on a sparse checkout.
//
//   GITHUB_TOKEN=... GITHUB_REPOSITORY=owner/repo node ci/big-run.mjs
import { appendFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { githubList, repository } from './release/github.mjs';

/** The release workflow, by its path in the repository. */
export const RELEASE_WORKFLOW = '.github/workflows/release.yml';
/** The workflow an inventory evidence run over (c′) runs as, by its path: a run of it pauses the nightly. */
export const INVENTORY_WORKFLOW = '.github/workflows/inventory.yml';
/** The run statuses that hold or will hold job slots. */
export const IN_FLIGHT = ['queued', 'waiting', 'pending', 'requested', 'in_progress'];

const TAG = /^v\d+\.\d+\.\d+(?:-rc\.[1-9]\d*)?$/;

/** Whether `run` (a workflow run, as the Actions API lists it) is a big run in flight. */
export function isBigRun(run) {
  if (!run || !IN_FLIGHT.includes(run.status)) return false;
  if (run.path === INVENTORY_WORKFLOW) return true;
  return run.path === RELEASE_WORKFLOW && run.event === 'push' && TAG.test(run.head_branch ?? '');
}

/** What a run is, in words, for the summary. */
const described = (run) =>
  run.path === INVENTORY_WORKFLOW
    ? `the inventory run ${run.id} (${run.head_branch ?? 'no branch'}, ${run.status})`
    : `the release run ${run.id} for ${run.head_branch} (${run.status})`;

/**
 * The night's decision from `runs`: busy when any is a big run in flight, with the line the job
 * summary gets either way. Runs are deduplicated by id, since the API lists one per status.
 */
export function bigRunDecision(runs) {
  const seen = new Map();
  for (const run of runs ?? []) if (run && !seen.has(run.id)) seen.set(run.id, run);
  const big = [...seen.values()].filter(isBigRun).sort((a, b) => a.id - b.id);
  if (big.length === 0)
    return {
      busy: false,
      summary: 'No release or inventory run is in flight, so the nightly quality matrix runs.',
      runs: [],
    };
  return {
    busy: true,
    summary: `The nightly quality matrix is skipped tonight: ${big.map(described).join(', and ')} ${big.length === 1 ? 'is' : 'are'} in flight, and a night beside a big run would hold more than the account's 20 job slots. quality-full and quality-verdict skip; the rest of the night runs.`,
    runs: big.map((run) => run.id),
  };
}

async function main() {
  const [owner, repo] = repository();
  const base = `/repos/${owner}/${repo}`;
  const runs = [];
  for (const status of IN_FLIGHT) {
    runs.push(...(await githubList(`${base}/actions/runs?status=${status}`, 'workflow_runs')));
  }
  const decision = bigRunDecision(runs);
  console.log(`[big-run] ${decision.summary}`);
  if (process.env.GITHUB_OUTPUT)
    appendFileSync(process.env.GITHUB_OUTPUT, `busy=${decision.busy}\n`);
  if (process.env.GITHUB_STEP_SUMMARY)
    appendFileSync(process.env.GITHUB_STEP_SUMMARY, `### Big runs\n\n${decision.summary}\n`);
  return 0;
}

if (path.resolve(process.argv[1] ?? '') === fileURLToPath(import.meta.url)) {
  process.exitCode = await main();
}
