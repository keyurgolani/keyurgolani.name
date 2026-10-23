#!/usr/bin/env node
// The release candidate's first check: refuse a tag whose commit isn't on
// main, or has no green complete ci run (docs/releasing.md).
//
//   GITHUB_TOKEN=... GITHUB_REPOSITORY=owner/repo TAG=v1.2.0-rc.1 SHA=<commit> \
//     node ci/release/verify-rc.mjs
//
// "On main" means main's tip is the commit or descends from it, by the
// compare API. "A green complete ci run" means a ci.yml run for a push to
// main on exactly that commit, whose `gate` job succeeded and whose run
// concluded success. gate passes only on a complete run (ci/gate.mjs), so a
// draft's selected run can never count, and a PR's run never counts either,
// since its gate checked a merge commit, not this one.
//
// Pure Node with no dependencies, so the job that runs it needs no install.
import { appendFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { githubGet, repository } from './github.mjs';
import { parseReleaseTag } from './tags.mjs';

export const CI_WORKFLOW = '.github/workflows/ci.yml';
const SHA = /^[0-9a-f]{40}$/;

/**
 * Whether `compare` (GET compare/{sha}...main) puts the commit on main: main
 * is the commit, or is ahead of it with the commit as the merge base.
 */
export function onMain(sha, compare) {
  const status = compare?.status;
  const base = compare?.merge_base_commit?.sha;
  if (status === 'identical') return base === undefined || base === sha;
  return status === 'ahead' && base === sha;
}

/**
 * The ci runs that count for `sha`: ci.yml, a push to main, on that exact
 * commit, finished and concluded success.
 */
export function candidateRuns(sha, runs) {
  return (runs ?? []).filter(
    (run) =>
      run?.path === CI_WORKFLOW &&
      run.event === 'push' &&
      run.head_branch === 'main' &&
      run.head_sha === sha &&
      run.status === 'completed' &&
      run.conclusion === 'success',
  );
}

/** Whether a run's jobs (GET runs/{id}/jobs) show gate succeeded. */
export function gatePassed(jobs) {
  return (jobs ?? []).some((job) => job?.name === 'gate' && job.conclusion === 'success');
}

/**
 * The verdict for one tag: { ok, reasons, run }.
 *
 * @param {{ tag: string, sha: string, compare: object, runs: object[], jobsByRun: Record<string, object[]> }} input
 */
export function evaluateRc({ tag, sha, compare, runs, jobsByRun }) {
  const reasons = [];
  const release = parseReleaseTag(tag);
  if (!release || release.kind !== 'rc') reasons.push(`${tag} is not a vX.Y.Z-rc.N tag`);
  if (!SHA.test(String(sha ?? ''))) {
    reasons.push(`${sha} is not a full commit SHA`);
    return { ok: false, reasons, run: null };
  }
  if (!onMain(sha, compare)) {
    reasons.push(
      `${sha} is not on main (compare says ${compare?.status ?? 'nothing'}). Tag a commit that is on main`,
    );
  }
  const run = candidateRuns(sha, runs).find((candidate) =>
    gatePassed(jobsByRun?.[String(candidate.id)]),
  );
  if (!run) {
    reasons.push(
      `${sha} has no green complete ci run: no ci.yml push run on main for this commit concluded success with gate passing`,
    );
  }
  return { ok: reasons.length === 0, reasons, run: run ?? null };
}

async function main() {
  const tag = process.env.TAG ?? '';
  const sha = process.env.SHA ?? '';
  if (!SHA.test(sha)) throw new Error(`SHA ${sha} is not a full commit SHA`);
  const [owner, repo] = repository();
  const base = `/repos/${owner}/${repo}`;
  const compare = await githubGet(`${base}/compare/${sha}...main`);
  const listed = await githubGet(
    `${base}/actions/workflows/ci.yml/runs?branch=main&event=push&head_sha=${sha}&status=completed&per_page=100`,
  );
  const runs = listed.workflow_runs ?? [];
  const jobsByRun = {};
  for (const run of candidateRuns(sha, runs)) {
    const jobs = await githubGet(`${base}/actions/runs/${run.id}/jobs?filter=latest&per_page=100`);
    jobsByRun[String(run.id)] = jobs.jobs ?? [];
  }
  const verdict = evaluateRc({ tag, sha, compare, runs, jobsByRun });
  const summary = verdict.ok
    ? `### ${tag}: eligible\n\n${sha} is on main, and ci run [${verdict.run.id}](${verdict.run.html_url}) passed gate on it.\n`
    : `### ${tag}: refused\n\n${verdict.reasons.map((reason) => `- ${reason}.`).join('\n')}\n`;
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, summary);
  console.log(summary);
  for (const reason of verdict.reasons) console.log(`::error title=release candidate::${reason}`);
  return verdict.ok ? 0 : 1;
}

if (path.resolve(process.argv[1] ?? '') === fileURLToPath(import.meta.url)) {
  main().then(
    (code) => process.exit(code),
    (error) => {
      console.log(`::error title=release candidate::${error.message}`);
      process.exit(1);
    },
  );
}
