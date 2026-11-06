#!/usr/bin/env node
// The release candidate's first check: refuse a tag whose commit isn't on
// main, or has no green complete ci run (docs/releasing.md), unless its one
// red is quality-pr's on exactly the candidate's named records.
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
// A red push run counts only when every job gate needs but quality-pr's
// shards and verdict succeeded (every shard of a matrix job), and the
// quality-pr verdict's own summary (its reports-quality-pr-verdict artifact,
// quality/summary.json) shows its every failure to be a failure record of a
// cell test that the candidate's records list (quality/release/records.json)
// names, by the same matcher rc-quality's verdict uses
// (ci/release/release-records.mjs): no other failing test, no other verdict
// rule, no listed record that ran and no longer fails. ci.yml's own gate is
// untouched and stays strict. The artifact is read with the job's actions:
// read and parsed as untrusted: anything missing, malformed, or too big
// refuses the tag. A list that's empty, as a final release's must be, leaves
// only the green run.
//
// Pure Node with no dependencies, so the job that runs it needs no install.
import { appendFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { githubGet, githubGetBytes, repository } from './github.mjs';
import { judgeListed, recordsProblems } from './release-records.mjs';
import { parseReleaseTag } from './tags.mjs';
import { readScope } from './verify-scope.mjs';
import { zipEntry } from './zip.mjs';

export const CI_WORKFLOW = '.github/workflows/ci.yml';
const SHA = /^[0-9a-f]{40}$/;

/**
 * Whether `compare` (GET compare/{sha}...heads/main) puts the commit on main: main
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

/** The artifact quality-pr-verdict uploads, and the summary in it rc-verify reads. */
export const QPR_ARTIFACT = 'reports-quality-pr-verdict';
export const QPR_SUMMARY = 'quality/summary.json';

/**
 * The jobs ci.yml's gate needs, by the name each runs under: a matrix job's shards are
 * `<name> (<k>/<n>)`. ci/release/verify-rc.test.mjs holds the list to ci.yml's gate.
 */
export const GATE_NEEDS = [
  'changes',
  'static',
  'unit',
  'build',
  'browser',
  'routes',
  'appearance-browser',
  'preview-fixtures-browser',
  'check-variants',
  'variants',
  'external-variant',
  'quality-pr-plan',
  'quality-pr',
  'quality-pr-verdict',
  'quality-meta',
  'trace',
  'image',
  'profiles',
  'rehearsal',
  'fresh-clone',
  'docs',
];
/** The gate's quality-pr jobs, whose red a records list can explain. */
export const QPR_JOBS = new Set(['quality-pr', 'quality-pr-verdict']);

/**
 * Why `jobs` (GET runs/{id}/jobs) don't show every job gate needs but quality-pr's green, one
 * reason a job; none when they do. A matrix job needs each of its n shards, each succeeded.
 */
export function otherJobsRed(jobs) {
  const reasons = [];
  for (const need of GATE_NEEDS.filter((each) => !QPR_JOBS.has(each))) {
    const own = (jobs ?? []).filter(
      (job) =>
        typeof job?.name === 'string' && (job.name === need || job.name.startsWith(`${need} (`)),
    );
    if (own.length === 0) {
      reasons.push(`${need} didn't run`);
      continue;
    }
    for (const job of own.filter((each) => each.conclusion !== 'success'))
      reasons.push(`${job.name} ended ${job.conclusion ?? job.status ?? 'unknown'}`);
    const shards = own.map((job) => /\((\d+)\/(\d+)\)$/.exec(job.name));
    if (shards.some((match) => match !== null)) {
      const totals = new Set(shards.map((match) => match?.[2]));
      const seen = new Set(shards.map((match) => match?.[1]));
      const total = Number([...totals][0]);
      if (totals.size !== 1 || shards.some((match) => match === null) || !(total > 0))
        reasons.push(`${need}'s shards don't agree on their count`);
      else if (seen.size !== total || own.length !== total)
        reasons.push(`${need} ran ${own.length} of its ${total} shards`);
    }
  }
  return reasons;
}

/**
 * Why the quality-pr summary `summary` (its verdict's quality/summary.json, parsed, untrusted)
 * doesn't show quality-pr's red as the records list `listed` names it, one reason a line; none
 * when it does: its verdict failed on tests-failed alone, every failing test a cell test, every
 * failure record of each listed, and no listed record whose test ran gone from it.
 */
export function qualityPrUnlisted(summary, listed) {
  if (!summary || typeof summary !== 'object' || !Array.isArray(summary.tests))
    return ["quality-pr's summary has no tests"];
  const failures = summary.verdict?.failures;
  if (!Array.isArray(failures)) return ["quality-pr's summary has no verdict"];
  const reasons = [];
  for (const failure of failures) {
    if (failure?.rule !== 'tests-failed')
      reasons.push(`quality-pr failed ${String(failure?.rule)}, which no records list can name`);
  }
  const tests = summary.tests;
  for (const test of tests.filter((each) => each?.outcome === 'unexpected' && each.kind !== 'cell'))
    reasons.push(`${String(test.title)} failed, and it isn't a cell test`);
  const judged = judgeListed(tests, listed);
  for (const { test, failure, entry } of judged.unlisted)
    reasons.push(
      `${String(test.title)}: ${failure.check} ${failure.rule} failed, and the records list doesn't name it. To list it: ${entry}`,
    );
  for (const test of judged.unrecorded)
    reasons.push(`${String(test.title)} failed with no failure record, which no entry can name`);
  for (const entry of judged.passed)
    reasons.push(
      `${entry.cell} at ${entry.viewport}, ${entry.row}: ${entry.check} ${entry.rule} on ${String(entry.target)} no longer fails: take its entry out`,
    );
  const failing = tests.filter((each) => each?.outcome === 'unexpected');
  if (reasons.length === 0 && (failures.length === 0 || failing.length === 0))
    reasons.push("quality-pr's verdict shows no listed failure, so nothing names the run's red");
  return reasons;
}

/** Whether a run's jobs (GET runs/{id}/jobs) show gate succeeded. */
export function gatePassed(jobs) {
  return (jobs ?? []).some((job) => job?.name === 'gate' && job.conclusion === 'success');
}

/**
 * The ci runs whose red a records list might explain: ci.yml, a push to main, on that exact
 * commit, finished and concluded failure.
 */
export function redRuns(sha, runs) {
  return (runs ?? []).filter(
    (run) =>
      run?.path === CI_WORKFLOW &&
      run.event === 'push' &&
      run.head_branch === 'main' &&
      run.head_sha === sha &&
      run.status === 'completed' &&
      run.conclusion === 'failure',
  );
}

/**
 * The verdict for one tag: { ok, reasons, run, listed }. `quality`, when given, holds the
 * candidate's records list (`listed`, already validated) and each red run's quality-pr summary by
 * run id (`summaries`; an Error for one that couldn't be read): a red run counts when every other
 * job gate needs succeeded and its summary's every failure is listed (`listed: true` then).
 *
 * @param {{ tag: string, sha: string, compare: object, runs: object[], jobsByRun: Record<string, object[]>, quality?: { listed: object[], summaries: Record<string, unknown> } }} input
 */
export function evaluateRc({ tag, sha, compare, runs, jobsByRun, quality }) {
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
  if (run) return { ok: reasons.length === 0, reasons, run, listed: false };
  // No green run: a red one counts only when quality-pr's is its one red, all of it listed.
  const why = [];
  for (const red of redRuns(sha, runs)) {
    const others = otherJobsRed(jobsByRun?.[String(red.id)]);
    const summary = quality?.summaries?.[String(red.id)];
    const qpr =
      quality === undefined
        ? ['no records list was read']
        : summary instanceof Error || summary === undefined
          ? [`quality-pr's summary couldn't be read: ${summary?.message ?? 'not fetched'}`]
          : qualityPrUnlisted(summary, quality.listed);
    if (others.length === 0 && qpr.length === 0) {
      return { ok: reasons.length === 0, reasons, run: red, listed: true };
    }
    why.push(`run ${red.id}: ${[...others, ...qpr].join('; ')}`);
  }
  reasons.push(
    `${sha} has no green complete ci run: no ci.yml push run on main for this commit concluded success with gate passing${why.length > 0 ? `, and no red one is red on listed records alone (${why.join(' | ')})` : ''}`,
  );
  return { ok: false, reasons, run: null, listed: false };
}

/** The quality-pr summary of `run`, read from its verdict's artifact; an Error when it can't be. */
async function qualityPrSummary(base, run) {
  try {
    const listed = await githubGet(
      `${base}/actions/runs/${run.id}/artifacts?name=${QPR_ARTIFACT}&per_page=100`,
    );
    const artifacts = (listed?.artifacts ?? []).filter(
      (each) => each?.name === QPR_ARTIFACT && each.expired === false,
    );
    if (artifacts.length !== 1)
      throw new Error(
        `run ${run.id} has ${artifacts.length} live ${QPR_ARTIFACT} artifacts, not one`,
      );
    const zip = await githubGetBytes(`${base}/actions/artifacts/${artifacts[0].id}/zip`, {
      maxBytes: 512 * 1024 * 1024,
    });
    const bytes = zipEntry(zip, QPR_SUMMARY);
    if (bytes === null) throw new Error(`${QPR_ARTIFACT} holds no ${QPR_SUMMARY}`);
    return JSON.parse(bytes.toString('utf8'));
  } catch (error) {
    return error instanceof Error ? error : new Error(String(error));
  }
}

async function main() {
  const tag = process.env.TAG ?? '';
  const sha = process.env.SHA ?? '';
  if (!SHA.test(sha)) throw new Error(`SHA ${sha} is not a full commit SHA`);
  const [owner, repo] = repository();
  const base = `/repos/${owner}/${repo}`;
  const compare = await githubGet(`${base}/compare/${sha}...heads/main`);
  const listed = await githubGet(
    `${base}/actions/workflows/ci.yml/runs?branch=main&event=push&head_sha=${sha}&status=completed&per_page=100`,
  );
  const runs = listed.workflow_runs ?? [];
  const jobsByRun = {};
  for (const run of [...candidateRuns(sha, runs), ...redRuns(sha, runs)]) {
    const jobs = await githubGet(`${base}/actions/runs/${run.id}/jobs?filter=latest&per_page=100`);
    jobsByRun[String(run.id)] = jobs.jobs ?? [];
  }
  // The candidate's records list, from the checkout (the tag's commit), validated as rc-quality's
  // is; then each red run's quality-pr summary, only if no run is green.
  let quality;
  const green = candidateRuns(sha, runs).some((run) => gatePassed(jobsByRun[String(run.id)]));
  if (!green && redRuns(sha, runs).length > 0) {
    const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
    const { scope, records } = readScope(root);
    const problems = recordsProblems(records, scope);
    if (problems.length > 0) throw new Error(`the records list is invalid: ${problems.join('; ')}`);
    const summaries = {};
    for (const run of redRuns(sha, runs))
      summaries[String(run.id)] = await qualityPrSummary(base, run);
    quality = { listed: records, summaries };
  }
  const verdict = evaluateRc({ tag, sha, compare, runs, jobsByRun, quality });
  const summary = verdict.ok
    ? verdict.listed
      ? `### ${tag}: eligible on its records list\n\n${sha} is on main, and ci run [${verdict.run.id}](${verdict.run.html_url}) failed only quality-pr, on records quality/release/records.json names.\n`
      : `### ${tag}: eligible\n\n${sha} is on main, and ci run [${verdict.run.id}](${verdict.run.html_url}) passed gate on it.\n`
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
