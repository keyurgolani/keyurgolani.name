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
// A red push run counts only on its first attempt, when every job gate needs
// but quality-pr's shards and verdict succeeded (every shard of a matrix
// job), the quality-pr jobs show their red is the quality runs' own (each
// failed shard failed only its `pnpm ci:quality-pr` step, with its reports
// scrubbed and uploaded; the verdict failed only `pnpm ci:quality-pr-verdict`,
// with its reports uploaded), and the quality-pr verdict's own summary (its
// reports-quality-pr-verdict artifact, quality/summary.json) shows its every
// failure to be a failure record of a cell test that the candidate's records
// list (quality/release/records.json) names, by the same matcher rc-quality's
// verdict uses (ci/release/release-records.mjs): no other failing test, no
// verdict rule but tests-failed (and shard-job beside it), no listed record
// that ran, its check owed there, and no longer fails (one whose check its test
// didn't owe is not judged, a note). A green run with a non-empty list is held
// to the last of those too, its summary a green verdict over no failed test.
// Either way the summary must have the shape both read (summaryProblem). The
// artifact is the one live one the run's latest quality-pr-verdict job, of the
// run's own attempt, uploaded, its size checked, and its digest when the API
// gives one, read with the job's actions: read and parsed as untrusted:
// anything missing, malformed, too big, or from another attempt refuses the
// tag. ci.yml's own gate is untouched and stays strict. A list that's empty,
// as a final release's must be, leaves only the green run. Text from the
// artifact is stripped of control characters before it reaches the log or the
// job summary, and escaped in a workflow command.
//
// Pure Node with no dependencies, so the job that runs it needs no install.
import { createHash } from 'node:crypto';
import { appendFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { githubGet, githubGetBytes, githubList, repository } from './github.mjs';
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
 * `<name> (<k>/<n>)`. ci/release/verify-rc-listed.test.mjs holds the list to ci.yml's gate.
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

/** browser's shard count in ci.yml (its matrix, and `browser (k/N)` in its name). */
export const BROWSER_SHARDS = 4;
/**
 * The shard count of each matrix job gate needs but quality-pr's, as ci.yml runs them: each job's
 * matrix of shards 1..N, named `<job> (k/N)`. A unit test (verify-rc-listed.test.mjs) parses the
 * repository's ci.yml and holds these to it, so a change to a matrix changes them in the same
 * commit. Every other job gate needs runs once, by its own name.
 */
export const SHARD_COUNTS = { unit: 3, browser: BROWSER_SHARDS, variants: 4 };

/**
 * Why the shard indexes `ks` (each k of a `<job> (k/n)` name, as written) aren't exactly 1..`total`,
 * each once, or null when they are: a 0, a leading zero, a gap, or a k twice is refused, the
 * reason naming the ks.
 */
export function shardsProblem(job, ks, total) {
  const wanted = Array.from({ length: total }, (_, at) => String(at + 1));
  const sorted = [...ks].sort((a, b) => Number(a) - Number(b) || (a < b ? -1 : 1));
  if (sorted.length === total && sorted.every((k, at) => k === wanted[at])) return null;
  return `${job} ran shards ${sorted.map(clean).join(', ') || 'none'} of 1..${total}, not each once`;
}

/**
 * Why `jobs` (GET runs/{id}/jobs) don't show every job gate needs but quality-pr's green, one
 * reason a job; none when they do. A matrix job needs exactly its shards 1..N by `counts`, each
 * once and succeeded: fewer, one twice, one of another count, a k or n written otherwise than as a
 * plain count, or one cancelled or skipped is refused. Any other job runs once, by its own name,
 * succeeded.
 */
export function otherJobsRed(jobs, counts = SHARD_COUNTS) {
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
    const total = counts[need];
    if (total === undefined) {
      if (own.length !== 1 || own[0].name !== need)
        reasons.push(
          `${need} ran as ${own.map((job) => job.name).join(', ')}, not once by its name`,
        );
      continue;
    }
    const shard = new RegExp(`^${need} \\((\\d+)/(\\d+)\\)$`);
    const parsed = own.map((job) => shard.exec(job.name));
    const off = own.filter((_, at) => parsed[at] === null || parsed[at][2] !== String(total));
    if (off.length > 0)
      reasons.push(
        `${need} ran ${off.map((job) => job.name).join(', ')}, not its shards of ${total}`,
      );
    const problem = shardsProblem(
      need,
      parsed.filter((match) => match !== null).map((match) => match[1]),
      total,
    );
    if (problem) reasons.push(problem);
  }
  return reasons;
}

/** `text` from an artifact with its control characters (CR and LF among them) made spaces. */
export function clean(text) {
  return String(text).replace(/[\u0000-\u001f\u007f-\u009f]/g, ' ');
}

/** `text` as a workflow command's message: % as %25, CR as %0D, LF as %0A. */
export function commandText(text) {
  return String(text).replace(/%/g, '%25').replace(/\r/g, '%0D').replace(/\n/g, '%0A');
}

const QPR_SHARD = /^quality-pr \((\d+)\/(\d+)\)$/;
/** A shard count or index as ci.yml writes one: 1 or more, no leading zero. */
const COUNT = /^[1-9]\d*$/;
const OK_STEP = new Set(['success', 'skipped']);

/**
 * Why `jobs` (the run's latest attempt's GET runs/{id}/jobs) don't show quality-pr's red as the
 * quality runs' own, one reason a line, with the verdict job; none when they do: every
 * `quality-pr (k/n)` shard, for one n, ran and concluded success or failure; a failed shard's one
 * step not success or skipped is its `pnpm ci:quality-pr --shard=k/n`, with Scrub reports, Failure
 * summary and Upload reports successful; quality-pr-verdict's, its `pnpm ci:quality-pr-verdict`,
 * with Upload reports successful. otherJobsRed() skips these jobs, so this reads them.
 */
export function qprJobsProof(jobs) {
  const reasons = [];
  const shards = (jobs ?? []).filter((job) => QPR_SHARD.test(String(job?.name)));
  const totals = new Set(shards.map((job) => QPR_SHARD.exec(job.name)[2]));
  const [total] = totals;
  if (shards.length === 0) reasons.push('quality-pr ran no shard');
  else if (totals.size !== 1 || !COUNT.test(total))
    reasons.push("quality-pr's shards don't agree on their count");
  else {
    const problem = shardsProblem(
      'quality-pr',
      shards.map((job) => QPR_SHARD.exec(job.name)[1]),
      Number(total),
    );
    if (problem) reasons.push(problem);
  }
  const step = (job, name) => (job?.steps ?? []).find((each) => each?.name === name);
  const onlyRed = (job, own, needed) => {
    const red = (job?.steps ?? []).filter((each) => !OK_STEP.has(each?.conclusion));
    if (red.length !== 1 || red[0].name !== own)
      reasons.push(
        `${job.name} failed on ${red.map((each) => clean(each?.name)).join(', ') || 'no step'}, not on ${own} alone`,
      );
    for (const name of needed) {
      if (step(job, name)?.conclusion !== 'success')
        reasons.push(`${job.name}'s ${name} step didn't succeed`);
    }
  };
  for (const job of shards) {
    const [, k, n] = QPR_SHARD.exec(job.name);
    if (job.conclusion === 'success') continue;
    if (job.conclusion !== 'failure') {
      reasons.push(`${job.name} ended ${clean(job.conclusion ?? job.status ?? 'unknown')}`);
      continue;
    }
    onlyRed(job, `pnpm ci:quality-pr --shard=${k}/${n}`, [
      'Scrub reports',
      'Failure summary',
      'Upload reports',
    ]);
  }
  const verdicts = (jobs ?? []).filter((job) => job?.name === 'quality-pr-verdict');
  const verdict = verdicts.length === 1 ? verdicts[0] : null;
  if (!verdict) reasons.push(`quality-pr-verdict ran ${verdicts.length} times, not once`);
  else if (verdict.conclusion === 'failure')
    onlyRed(verdict, 'pnpm ci:quality-pr-verdict', ['Upload reports']);
  else if (verdict.conclusion !== 'success')
    reasons.push(`quality-pr-verdict ended ${clean(verdict.conclusion ?? 'unknown')}`);
  else if (step(verdict, 'Upload reports')?.conclusion !== 'success')
    reasons.push("quality-pr-verdict's Upload reports step didn't succeed");
  return { reasons, verdict };
}

/**
 * The one live reports-quality-pr-verdict artifact of `run` that its latest attempt's verdict job
 * (`verdict`, a job of the listing for that attempt, of the run's own attempt) uploaded, or why
 * not: exactly one live one by that name, its id a safe integer, its workflow_run this run on main
 * at `sha`, and made within that job's start and end. An artifact another job made first, or a
 * past attempt's, is refused.
 */
export function bindArtifact(artifacts, run, sha, verdict) {
  if (verdict?.run_attempt !== run.run_attempt)
    return {
      artifact: null,
      reason: `quality-pr-verdict's job is attempt ${clean(verdict?.run_attempt)}, not the run's ${clean(run.run_attempt)}`,
    };
  const live = (Array.isArray(artifacts) ? artifacts : []).filter(
    (each) => each?.name === QPR_ARTIFACT && each.expired === false,
  );
  if (live.length !== 1)
    return {
      artifact: null,
      reason: `run ${run.id} has ${live.length} live ${QPR_ARTIFACT} artifacts, not one`,
    };
  const [artifact] = live;
  if (!Number.isSafeInteger(artifact.id) || artifact.id <= 0)
    return {
      artifact: null,
      reason: `${QPR_ARTIFACT}'s id is ${clean(artifact.id)}, not an artifact id`,
    };
  const from = artifact.workflow_run ?? {};
  if (from.id !== run.id || from.head_sha !== sha || from.head_branch !== 'main')
    return { artifact: null, reason: `${QPR_ARTIFACT} is another run's, or not main's at ${sha}` };
  const made = Date.parse(artifact.created_at);
  const start = Date.parse(verdict?.started_at);
  const end = Date.parse(verdict?.completed_at);
  if (!(made >= start && made <= end))
    return {
      artifact: null,
      reason: `${QPR_ARTIFACT} wasn't made while this attempt's quality-pr-verdict ran`,
    };
  if (!Number.isSafeInteger(artifact.size_in_bytes) || artifact.size_in_bytes <= 0)
    return { artifact: null, reason: `${QPR_ARTIFACT} names no size` };
  return { artifact, reason: null };
}

/** Why `bytes` aren't `artifact`'s download: its size, and its sha256 digest when the API gives one. */
export function downloadProblem(bytes, artifact) {
  if (bytes.length !== artifact.size_in_bytes)
    return `${QPR_ARTIFACT} downloaded ${bytes.length} bytes, not its ${artifact.size_in_bytes}`;
  if (typeof artifact.digest === 'string' && artifact.digest !== '') {
    const [kind, value] = artifact.digest.split(':');
    if (kind !== 'sha256' || createHash('sha256').update(bytes).digest('hex') !== value)
      return `${QPR_ARTIFACT}'s download doesn't match its digest`;
  }
  return null;
}

/** The fields every cell test of a summary names its key by. */
const CELL_KEY = ['cell', 'viewport', 'row', 'engine'];

/**
 * Why the quality-pr summary `summary` (its verdict's quality/summary.json, parsed, untrusted)
 * isn't one a records list can be held to, or null when it is: an object of schemaVersion 1, with
 * a tests list holding at least one cell test, a verdict with a failures list, and every cell test
 * naming its cell, viewport, row and engine as non-empty text. Both paths read it through this, so
 * a summary whose shape drifts refuses: a summary whose tests lost their kind holds no cell test.
 */
export function summaryProblem(summary) {
  if (!summary || typeof summary !== 'object' || Array.isArray(summary))
    return "quality-pr's summary is no object";
  if (!Array.isArray(summary.tests)) return "quality-pr's summary has no tests";
  const verdict = summary.verdict;
  if (!verdict || typeof verdict !== 'object' || !Array.isArray(verdict.failures))
    return "quality-pr's summary has no verdict";
  if (summary.schemaVersion !== 1)
    return `quality-pr's summary is schemaVersion ${clean(JSON.stringify(summary.schemaVersion))}, not 1`;
  if (!summary.tests.some((test) => test?.kind === 'cell'))
    return "quality-pr's summary holds no cell test, so no entry can be judged by it";
  const unnamed = summary.tests.filter(
    (test) =>
      test?.kind === 'cell' &&
      !CELL_KEY.every((field) => typeof test[field] === 'string' && test[field] !== ''),
  );
  if (unnamed.length > 0)
    return `${unnamed.length} cell test(s) of quality-pr's summary don't name their ${CELL_KEY.join(', ')}`;
  return null;
}

/**
 * Why the quality-pr summary `summary` (its verdict's quality/summary.json, parsed, untrusted)
 * doesn't show quality-pr's red as the records list `listed` names it, one reason a line; none
 * when it does: its verdict failed on tests-failed alone, every failing test a cell test, every
 * failure record of each listed, and no listed record whose test ran, owing its check, gone from
 * it.
 */
export function qualityPrUnlisted(summary, listed, { jobsProven = false } = {}) {
  const shape = summaryProblem(summary);
  if (shape) return [shape];
  const failures = summary.verdict.failures;
  const reasons = [];
  const rules = failures.map((failure) => failure?.rule);
  for (const rule of rules) {
    // A shard that failed on its cell tests ends its job red, so the merge says shard-job beside
    // tests-failed: that pair alone is quality-pr's own red, once the jobs show it (qprJobsProof).
    if (rule === 'tests-failed') continue;
    if (rule === 'shard-job' && rules.includes('tests-failed') && jobsProven) continue;
    reasons.push(
      rule === 'shard-job'
        ? "quality-pr failed shard-job, and its jobs don't show that a shard failed on its cell tests alone"
        : `quality-pr failed ${clean(rule)}, which no records list can name`,
    );
  }
  const tests = summary.tests;
  for (const test of tests.filter((each) => each?.outcome === 'unexpected' && each.kind !== 'cell'))
    reasons.push(`${clean(test.title)} failed, and it isn't a cell test`);
  // rc-verify reads a push run, whose sentinels owe no conditions: an entry counts as passed
  // only where its check ran.
  const judged = judgeListed(tests, listed, { owedOnly: true });
  for (const { test, failure, entry } of judged.unlisted)
    reasons.push(
      `${clean(test.title)}: ${clean(failure.check)} ${clean(failure.rule)} failed, and the records list doesn't name it. To list it: ${clean(entry)}`,
    );
  for (const { test, why } of judged.unrecorded)
    reasons.push(
      `${clean(test.title)} failed, and not on its records alone (${clean(why)}), which no entry can name`,
    );
  for (const { test, failure } of judged.repeated)
    reasons.push(
      `${clean(test.title)}: ${clean(failure.check)} ${clean(failure.rule)} failed more than once under one key, so no one entry names one record`,
    );
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
 * The verdict for one tag: { ok, reasons, run, listed, flaky, notJudged }. `quality`, when given, holds the
 * candidate's records list (`listed`, already validated) and, by run id, each read run's
 * artifact listing (`artifacts`) and its quality-pr summary (`summaries`; an Error for one that
 * couldn't be read). A green run counts as before; with a non-empty list, only on its first
 * attempt, its summary showing no strict entry's test passing. A red run counts on its first
 * attempt when every other job gate needs succeeded, its quality-pr jobs show their red is the
 * quality runs' own, its artifact is the one its verdict job made, and its summary's every
 * failure is listed (`listed: true` then).
 *
 * `counts` are the shard counts of the ci.yml that ran the runs, SHARD_COUNTS (this commit's) by
 * default: a test on a run from before a change to a matrix passes its own.
 *
 * @param {{ tag: string, sha: string, compare: object, runs: object[], jobsByRun: Record<string, object[]>, quality?: { listed: object[], summaries: Record<string, unknown>, artifacts?: Record<string, object[]> }, counts?: Record<string, number> }} input
 */
export function evaluateRc({ tag, sha, compare, runs, jobsByRun, quality, counts = SHARD_COUNTS }) {
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
  const listed = quality?.listed ?? [];
  // A run's summary, read from the artifact its latest verdict job made, or why it can't be used.
  const summaryOf = (run, verdict) => {
    if (run.run_attempt !== 1)
      return {
        summary: null,
        why: `run ${run.id} is attempt ${clean(run.run_attempt)}, and only a first attempt counts`,
      };
    const listing = quality?.artifacts?.[String(run.id)];
    if (listing instanceof Error)
      return {
        summary: null,
        why: `run ${run.id}'s artifacts couldn't be listed: ${clean(listing.message)}`,
      };
    const bound = bindArtifact(listing, run, sha, verdict);
    if (bound.reason) return { summary: null, why: bound.reason };
    const summary = quality?.summaries?.[String(run.id)];
    if (summary instanceof Error || summary === undefined)
      return {
        summary: null,
        why: `quality-pr's summary couldn't be read: ${clean(summary?.message ?? 'not fetched')}`,
      };
    return { summary, why: null };
  };
  const run = candidateRuns(sha, runs).find((candidate) =>
    gatePassed(jobsByRun?.[String(candidate.id)]),
  );
  if (run) {
    // With entries listed, quality-pr's summary on the green run too: a strict entry whose test
    // passed there is a record that doesn't fail, whatever rc-quality sees later.
    if (listed.length === 0)
      return { ok: reasons.length === 0, reasons, run, listed: false, flaky: [] };
    const { verdict } = qprJobsProof(jobsByRun?.[String(run.id)]);
    const read = summaryOf(run, verdict);
    const why =
      read.why ??
      summaryProblem(read.summary) ??
      (read.summary?.verdict?.ok === true && read.summary.verdict.failures?.length === 0
        ? null
        : "quality-pr's summary says its verdict failed, though gate passed") ??
      (read.summary.tests.some((test) => test?.outcome === 'unexpected')
        ? "quality-pr's summary holds a failed test, though gate passed"
        : null);
    if (why) {
      reasons.push(`${sha}'s green ci run ${run.id} can't be held to the records list: ${why}`);
      return { ok: false, reasons, run: null, listed: false, flaky: [] };
    }
    const judged = judgeListed(read.summary.tests ?? [], listed, { owedOnly: true });
    for (const entry of judged.passed)
      reasons.push(
        `${entry.cell} at ${entry.viewport}, ${entry.row}: ${entry.check} ${entry.rule} on ${String(entry.target)} passed in ci run ${run.id}'s quality-pr, so it's no failing record: take its entry out`,
      );
    return {
      ok: reasons.length === 0,
      reasons,
      run: reasons.length === 0 ? run : null,
      listed: false,
      flaky: judged.flaky,
      notJudged: judged.notJudged,
    };
  }
  // No green run: a red one counts only when quality-pr's is its one red, all of it listed.
  const why = [];
  for (const red of redRuns(sha, runs)) {
    const jobs = jobsByRun?.[String(red.id)];
    const others = otherJobsRed(jobs, counts);
    const proof = qprJobsProof(jobs);
    const read =
      quality === undefined
        ? { summary: null, why: 'no records list was read' }
        : summaryOf(red, proof.verdict);
    const qpr = read.why
      ? [read.why]
      : qualityPrUnlisted(read.summary, listed, { jobsProven: proof.reasons.length === 0 });
    const all = [...others, ...proof.reasons, ...qpr];
    if (all.length === 0) {
      const judged = judgeListed(read.summary.tests, listed, { owedOnly: true });
      return {
        ok: reasons.length === 0,
        reasons,
        run: red,
        listed: true,
        flaky: judged.flaky,
        notJudged: judged.notJudged,
      };
    }
    why.push(`run ${red.id}: ${all.join('; ')}`);
  }
  reasons.push(
    `${sha} has no green complete ci run: no ci.yml push run on main for this commit concluded success with gate passing${why.length > 0 ? `, and no red one is red on listed records alone (${why.join(' | ')})` : ''}`,
  );
  return { ok: false, reasons, run: null, listed: false, flaky: [] };
}

/**
 * The summary's notes for each strict entry not judged on the run rc-verify read: its test didn't
 * owe its check there (judgeListed's notJudged), so it neither failed nor passed.
 */
export function notJudgedLines(notJudged) {
  return (notJudged ?? []).map(
    ({ entry, why }) =>
      `- not judged: ${entry.cell} at ${entry.viewport}, ${entry.row}, on ${entry.engine}: ${entry.check} ${entry.rule}${entry.target === null ? '' : ` on ${entry.target}`} (${why}; owner ${entry.owner}, ${entry.routed})`,
  );
}

/**
 * The summary's lines for each flaky entry and how it came out in the run rc-verify read: failed
 * (on its record), passed, not judged (its test unrecorded, so held, or its check not owed), or
 * not run.
 */
export function flakyLines(flaky) {
  return (flaky ?? []).map(
    ({ entry, outcome }) =>
      `- flaky, ${outcome}: ${entry.cell} at ${entry.viewport}, ${entry.row}, on ${entry.engine}: ${entry.check} ${entry.rule}${entry.target === null ? '' : ` on ${entry.target}`} (owner ${entry.owner}, ${entry.routed}; seen failing in run ${entry.seen?.failed} and passing in run ${entry.seen?.passed} on ${entry.seen?.commit})`,
  );
}

/**
 * The artifact listing of `run`, and its quality-pr summary read from the artifact its latest
 * verdict job made (bindArtifact()), its download held to its size, and to its digest when the
 * API gives one; an Error in place of the summary when it can't be read, and in place of the
 * listing too when that's what failed, so the refusal names the listing, not an empty one. `get`
 * and `getBytes` are githubGet and githubGetBytes, or a test's stand-ins.
 */
export async function qualityPrSummary(
  base,
  run,
  sha,
  jobs,
  { get = githubGet, getBytes = githubGetBytes } = {},
) {
  let artifacts = [];
  try {
    artifacts = await githubList(
      `${base}/actions/runs/${run.id}/artifacts?name=${QPR_ARTIFACT}`,
      'artifacts',
      { get },
    );
  } catch (error) {
    const failed = error instanceof Error ? error : new Error(String(error));
    return { artifacts: failed, summary: failed };
  }
  try {
    const { artifact, reason } = bindArtifact(artifacts, run, sha, qprJobsProof(jobs).verdict);
    if (reason) throw new Error(reason);
    const zip = await getBytes(`${base}/actions/artifacts/${artifact.id}/zip`, {
      maxBytes: 512 * 1024 * 1024,
    });
    const problem = downloadProblem(zip, artifact);
    if (problem) throw new Error(problem);
    const bytes = zipEntry(zip, QPR_SUMMARY);
    if (bytes === null) throw new Error(`${QPR_ARTIFACT} holds no ${QPR_SUMMARY}`);
    return { artifacts, summary: JSON.parse(bytes.toString('utf8')) };
  } catch (error) {
    return { artifacts, summary: error instanceof Error ? error : new Error(String(error)) };
  }
}

async function main() {
  const tag = process.env.TAG ?? '';
  const sha = process.env.SHA ?? '';
  if (!SHA.test(sha)) throw new Error(`SHA ${sha} is not a full commit SHA`);
  const [owner, repo] = repository();
  const base = `/repos/${owner}/${repo}`;
  const compare = await githubGet(`${base}/compare/${sha}...heads/main`);
  const runs = await githubList(
    `${base}/actions/workflows/ci.yml/runs?branch=main&event=push&head_sha=${sha}&status=completed`,
    'workflow_runs',
  );
  const jobsByRun = {};
  for (const run of [...candidateRuns(sha, runs), ...redRuns(sha, runs)]) {
    jobsByRun[String(run.id)] = await githubList(
      `${base}/actions/runs/${run.id}/jobs?filter=latest`,
      'jobs',
    );
  }
  // The candidate's records list, from the checkout (the tag's commit), validated as rc-quality's
  // is; then the quality-pr summaries it's held to.
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
  const { scope, records } = readScope(root);
  const problems = recordsProblems(records, scope);
  if (problems.length > 0) throw new Error(`the records list is invalid: ${problems.join('; ')}`);
  // Each red run's quality-pr summary when no run is green; the green run's when the list names
  // any entry.
  const quality = { listed: records, summaries: {}, artifacts: {} };
  const green = candidateRuns(sha, runs).find((run) => gatePassed(jobsByRun[String(run.id)]));
  const read = green ? (records.length > 0 ? [green] : []) : redRuns(sha, runs);
  for (const run of read) {
    const got = await qualityPrSummary(base, run, sha, jobsByRun[String(run.id)]);
    quality.summaries[String(run.id)] = got.summary;
    quality.artifacts[String(run.id)] = got.artifacts;
  }
  const verdict = evaluateRc({ tag, sha, compare, runs, jobsByRun, quality });
  let summary = verdict.ok
    ? verdict.listed
      ? `### ${tag}: eligible on its records list\n\n${sha} is on main, and ci run [${verdict.run.id}](${verdict.run.html_url}) failed only quality-pr, on records quality/release/records.json names.\n`
      : `### ${tag}: eligible\n\n${sha} is on main, and ci run [${verdict.run.id}](${verdict.run.html_url}) passed gate on it.\n`
    : `### ${tag}: refused\n\n${verdict.reasons.map((reason) => `- ${reason}.`).join('\n')}\n`;
  const notes = notJudgedLines(verdict.notJudged);
  if (notes.length > 0)
    summary += `\nNot judged on this run, their check not owed there:\n\n${notes.join('\n')}\n`;
  const flaky = flakyLines(verdict.flaky);
  if (flaky.length > 0) summary += `\nFlaky entries in the records list:\n\n${flaky.join('\n')}\n`;
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, summary);
  console.log(summary);
  for (const reason of verdict.reasons)
    console.log(`::error title=release candidate::${commandText(clean(reason))}`);
  return verdict.ok ? 0 : 1;
}

if (path.resolve(process.argv[1] ?? '') === fileURLToPath(import.meta.url)) {
  main().then(
    (code) => process.exit(code),
    (error) => {
      console.log(`::error title=release candidate::${commandText(clean(error.message))}`);
      process.exit(1);
    },
  );
}
