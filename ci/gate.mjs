#!/usr/bin/env node
// The `gate` job's decision: NEEDS_JSON='${{ toJSON(needs) }}' node ci/gate.mjs
//
// gate passes only when every job it needs succeeded. A job that failed, was
// cancelled, timed out (GitHub reports that as a failure), or was skipped
// because something upstream broke all fail the gate. Pure Node with no
// dependencies, so the gate job needs no install.
import { appendFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/** @param {Record<string, { result?: string }>} needs */
export function evaluateNeeds(needs) {
  const rows = Object.entries(needs ?? {})
    .map(([job, value]) => ({ job, result: value?.result ?? 'unknown' }))
    .sort((a, b) => a.job.localeCompare(b.job));
  const failed = rows.filter((row) => row.result !== 'success');
  // An empty needs list means the workflow lost its edges; never pass that.
  return { ok: rows.length > 0 && failed.length === 0, rows, failed };
}

export function renderGateSummary({ ok, rows }) {
  const lines = [
    `### gate: ${ok ? 'passed' : 'failed'}`,
    '',
    '| Job | Result |',
    '| --- | --- |',
    ...rows.map(({ job, result }) => `| ${job} | ${result} |`),
  ];
  if (!ok) {
    lines.push('', "Each failed job's summary lists its failure records and local commands.");
  }
  return `${lines.join('\n')}\n`;
}

function main() {
  let needs;
  try {
    needs = JSON.parse(process.env.NEEDS_JSON ?? '');
  } catch {
    console.log('::error title=gate::NEEDS_JSON is missing or not JSON');
    return 1;
  }
  const verdict = evaluateNeeds(needs);
  const summary = renderGateSummary(verdict);
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, summary);
  console.log(summary);
  for (const { job, result } of verdict.failed) {
    console.log(`::error title=gate::${job} finished as ${result}`);
  }
  if (verdict.rows.length === 0) console.log('::error title=gate::gate needs no jobs');
  return verdict.ok ? 0 : 1;
}

if (path.resolve(process.argv[1] ?? '') === fileURLToPath(import.meta.url)) {
  process.exit(main());
}
