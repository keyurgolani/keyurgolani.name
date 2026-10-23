#!/usr/bin/env node
// The `gate` and `selected` jobs' decisions:
//   NEEDS_JSON='${{ toJSON(needs) }}' node ci/gate.mjs             # gate
//   NEEDS_JSON='${{ toJSON(needs) }}' node ci/gate.mjs --selected  # selected
//
// gate is the one required check. It passes only on a complete run, which
// `changes` (ci/select-jobs.mjs) reports for every PR that's ready for
// review, every PR into main, and every push, and only when every job it
// needs succeeded. A job that failed, was cancelled, timed out (GitHub
// reports that as a failure), or was skipped fails it, since a complete run
// skips nothing. A draft PR's selected run always fails gate, so no
// selection can merge: GitHub refuses to merge a draft, and marking it ready
// starts the complete run on the same head.
//
// selected is the draft's feedback: it passes when every selected job
// succeeded and the rest were skipped, and it's never required.
//
// Pure Node with no dependencies, so neither job needs an install.
import { appendFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const rowsOf = (needs) =>
  Object.entries(needs ?? {})
    .map(([job, value]) => ({ job, result: value?.result ?? 'unknown' }))
    .sort((a, b) => a.job.localeCompare(b.job));

/** @param {Record<string, { result?: string }>} needs */
export function evaluateNeeds(needs) {
  const rows = rowsOf(needs);
  const failed = rows.filter((row) => row.result !== 'success');
  // An empty needs list means the workflow lost its edges; never pass that.
  return { ok: rows.length > 0 && failed.length === 0, rows, failed };
}

/** What `changes` reported: { complete, jobs }, or null when it didn't finish. */
export function selectionOf(needs) {
  const changes = needs?.changes;
  if (changes?.result !== 'success') return null;
  let jobs;
  try {
    jobs = JSON.parse(changes.outputs?.jobs ?? '');
  } catch {
    return null;
  }
  if (!Array.isArray(jobs)) return null;
  return { complete: changes.outputs?.complete === 'true', jobs };
}

/** gate: a complete run where every needed job succeeded. */
export function evaluateGate(needs) {
  const verdict = evaluateNeeds(needs);
  const selection = selectionOf(needs);
  if (!selection) {
    return { ...verdict, ok: false, complete: false, reason: 'changes did not report a selection' };
  }
  if (!selection.complete) {
    return {
      ...verdict,
      ok: false,
      complete: false,
      reason:
        'this run checked only the jobs a draft selects. gate passes only on the complete run, which starts when the PR is marked ready for review',
    };
  }
  // A complete run selects every check job, so a needed job outside the
  // selection means changes and the workflow disagree.
  const missing = verdict.rows
    .map(({ job }) => job)
    .filter((job) => job !== 'changes' && !selection.jobs.includes(job));
  if (missing.length > 0) {
    return {
      ...verdict,
      ok: false,
      complete: true,
      reason: `the complete run left out ${missing.join(', ')}`,
    };
  }
  return { ...verdict, complete: true, reason: verdict.ok ? '' : 'a needed job did not succeed' };
}

/** selected: every selected job succeeded, and every other one was skipped or succeeded. */
export function evaluateSelected(needs) {
  const rows = rowsOf(needs);
  const selection = selectionOf(needs);
  if (!selection) {
    return { ok: false, rows, failed: rows, reason: 'changes did not report a selection' };
  }
  const failed = rows.filter(({ job, result }) => {
    if (job === 'changes') return false;
    if (selection.jobs.includes(job)) return result !== 'success';
    return result !== 'skipped' && result !== 'success';
  });
  return { ok: failed.length === 0, rows, failed, reason: failed.length ? 'a job failed' : '' };
}

export function renderGateSummary({ ok, rows, reason }, title = 'gate') {
  const lines = [
    `### ${title}: ${ok ? 'passed' : 'failed'}`,
    '',
    ...(reason ? [`${reason[0].toUpperCase()}${reason.slice(1)}.`, ''] : []),
    '| Job | Result |',
    '| --- | --- |',
    ...rows.map(({ job, result }) => `| ${job} | ${result} |`),
  ];
  if (!ok && rows.some((r) => r.result === 'failure' || r.result === 'cancelled')) {
    lines.push('', "Each failed job's summary lists its failure records and local commands.");
  }
  return `${lines.join('\n')}\n`;
}

function main(argv) {
  const title = argv.includes('--selected') ? 'selected' : 'gate';
  let needs;
  try {
    needs = JSON.parse(process.env.NEEDS_JSON ?? '');
  } catch {
    console.log(`::error title=${title}::NEEDS_JSON is missing or not JSON`);
    return 1;
  }
  const verdict = title === 'selected' ? evaluateSelected(needs) : evaluateGate(needs);
  const summary = renderGateSummary(verdict, title);
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, summary);
  console.log(summary);
  for (const { job, result } of verdict.failed) {
    console.log(`::error title=${title}::${job} finished as ${result}`);
  }
  if (verdict.rows.length === 0) console.log(`::error title=${title}::${title} needs no jobs`);
  if (verdict.reason && !verdict.ok) console.log(`::error title=${title}::${verdict.reason}`);
  return verdict.ok ? 0 : 1;
}

if (path.resolve(process.argv[1] ?? '') === fileURLToPath(import.meta.url)) {
  process.exit(main(process.argv.slice(2)));
}
