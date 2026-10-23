#!/usr/bin/env node
// The scheduled workflow's reporter:
//   NEEDS_JSON='${{ toJSON(needs) }}' GITHUB_TOKEN=... node ci/report-issue.mjs --records <dir>
//
// Keeps one rolling issue for the scheduled checks. When a scheduled job
// didn't succeed, it opens the issue, or comments on the open one, with each
// failed job, its result, its local command, and the failure records the
// jobs uploaded. A job that timed out, was cancelled, or was skipped counts
// as failed, so nothing ages silently. When every job passed, it comments
// and closes the open issue, if any. The issue is found by a marker in its
// body, among open issues github-actions opened.
//
// Only this job holds `issues: write`. Pure Node with no dependencies.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { CONTEXT_FIELDS } from './summarize.mjs';

export const MARKER = '<!-- scheduled-checks-report -->';
export const TITLE = 'Scheduled checks are failing';
const BOT = 'github-actions[bot]';

/** Local commands for the scheduled jobs; any other job is `pnpm ci:<job>`. */
const COMMANDS = { links: 'pnpm check:docs && pnpm check:links' };
const commandFor = (job) => COMMANDS[job] ?? `pnpm ci:${job}`;

const RESULT_TEXT = {
  failure: 'failed',
  cancelled: 'was cancelled or timed out',
  skipped: 'was skipped, so it never ran',
};

/** The jobs that didn't succeed: [{ job, result }], by name. */
export function failedJobs(needs) {
  const rows = Object.entries(needs ?? {}).map(([job, v]) => ({
    job,
    result: v?.result ?? 'unknown',
  }));
  return rows.filter((r) => r.result !== 'success').sort((a, b) => a.job.localeCompare(b.job));
}

/** Failure records under a directory of downloaded report artifacts. */
export function readRecords(dir) {
  const records = [];
  const walk = (d) => {
    let entries = [];
    try {
      entries = readdirSync(d, { withFileTypes: true });
    } catch (error) {
      if (error.code === 'ENOENT') return;
      throw error;
    }
    for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
      const full = path.join(d, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (path.basename(d) === 'failures' && entry.name.endsWith('.json')) {
        try {
          const record = JSON.parse(readFileSync(full, 'utf8'));
          if (record && typeof record === 'object' && typeof record.gate === 'string')
            records.push(record);
        } catch {
          // An unreadable record is the producing job's failure to report; skip it here.
        }
      }
    }
  };
  if (dir && statSync(dir, { throwIfNoEntry: false })?.isDirectory()) walk(dir);
  return records;
}

/**
 * One table cell of free text for the issue body, as a code span. A
 * record's text comes from what a check saw, a page's title or a link's URL
 * among it, and GitHub decodes entities before it finds mentions, issue
 * references, commit SHAs, and bare URLs, so escaping can't keep them out.
 * Inside a code span GitHub renders none of them, and no HTML or link
 * either. Every line break becomes a space and `|` becomes `\|`, so the
 * table holds, and the fence is one backtick longer than the longest run in
 * the text, padded with spaces.
 */
export function issueCell(value) {
  if (value === undefined || value === null || value === '') return '';
  const text = String(value)
    .replace(/\r\n|\r|\n/g, ' ')
    .replace(/\|/g, '\\|');
  const longest = Math.max(0, ...[...text.matchAll(/`+/g)].map((m) => m[0].length));
  const fence = '`'.repeat(longest + 1);
  return `${fence} ${text} ${fence}`;
}

/** The failure records as a table for the issue, every cell a code span. */
export function renderRecords(records) {
  const lines = [
    `### Failures (${records.length})`,
    '',
    '| Gate | Test | Context | Expected | Actual | Threshold | Artifacts | Reproduce |',
    '| --- | --- | --- | --- | --- | --- | --- | --- |',
  ];
  for (const r of records) {
    const context = CONTEXT_FIELDS.filter((f) => r[f] !== undefined)
      .map((f) => `${f}=${r[f]}`)
      .join(', ');
    const cells = [
      r.gate,
      r.test,
      context,
      r.expected,
      r.actual,
      r.threshold,
      Array.isArray(r.artifacts) ? r.artifacts.join(', ') : r.artifacts,
      r.reproCommand,
    ].map(issueCell);
    lines.push(`| ${cells.join(' | ')} |`);
  }
  return lines.join('\n');
}

export function renderReport({ failed, records, runUrl, date }) {
  const lines = [
    `The scheduled checks failed on ${date}, in [this run](${runUrl}).`,
    '',
    '| Job | Result | Run locally |',
    '| --- | --- | --- |',
    ...failed.map(
      ({ job, result }) =>
        `| ${issueCell(job)} | ${RESULT_TEXT[result] ?? issueCell(result)} | ${issueCell(commandFor(job))} |`,
    ),
  ];
  const shown = records.slice(0, 50);
  if (shown.length > 0) lines.push('', renderRecords(shown));
  if (records.length > shown.length) {
    lines.push(
      '',
      `And ${records.length - shown.length} more records in the run's reports artifacts.`,
    );
  }
  return `${lines.join('\n')}\n`;
}

/**
 * What to do, given the jobs' results and the open issues: a list of
 * { kind: 'create' | 'comment' | 'close', issue?, title?, body? }.
 */
export function decide({ needs, openIssues, records = [], runUrl, date }) {
  const failed = failedJobs(needs);
  const rolling = (openIssues ?? [])
    .filter((i) => !i.pull_request && i.user?.login === BOT && (i.body ?? '').includes(MARKER))
    .sort((a, b) => a.number - b.number)[0];
  if (Object.keys(needs ?? {}).length === 0) {
    // No jobs at all means the workflow lost its edges: report that too.
    failed.push({ job: 'report', result: 'needs no jobs' });
  }
  if (failed.length > 0) {
    const report = renderReport({ failed, records, runUrl, date });
    if (rolling) return [{ kind: 'comment', issue: rolling.number, body: report }];
    return [
      {
        kind: 'create',
        title: TITLE,
        body: `${MARKER}\nThis issue rolls: each failing scheduled run comments here, and the first passing run closes it.\n\n${report}`,
      },
    ];
  }
  if (!rolling) return [];
  return [
    {
      kind: 'comment',
      issue: rolling.number,
      body: `Every scheduled check passed on ${date}, in [this run](${runUrl}).\n`,
    },
    { kind: 'close', issue: rolling.number },
  ];
}

/** A minimal GitHub REST client. fetchImpl is injectable for tests. */
export function github({ token, repo, fetchImpl = fetch, api = 'https://api.github.com' }) {
  const call = async (method, route, body) => {
    const response = await fetchImpl(`${api}/repos/${repo}${route}`, {
      method,
      headers: {
        accept: 'application/vnd.github+json',
        authorization: `Bearer ${token}`,
        'x-github-api-version': '2022-11-28',
        ...(body ? { 'content-type': 'application/json' } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(30_000),
    });
    if (!response.ok) throw new Error(`${method} ${route} answered ${response.status}`);
    return response.status === 204 ? null : response.json();
  };
  return {
    openIssues: () =>
      call('GET', `/issues?state=open&creator=${encodeURIComponent(BOT)}&per_page=100`),
    apply: async (action) => {
      if (action.kind === 'create')
        return call('POST', '/issues', { title: action.title, body: action.body });
      if (action.kind === 'comment')
        return call('POST', `/issues/${action.issue}/comments`, { body: action.body });
      if (action.kind === 'close')
        return call('PATCH', `/issues/${action.issue}`, {
          state: 'closed',
          state_reason: 'completed',
        });
      throw new Error(`unknown action ${action.kind}`);
    },
  };
}

export async function report({ env, argv, fetchImpl = fetch, now = new Date() }) {
  const needs = JSON.parse(env.NEEDS_JSON ?? '');
  const at = argv.indexOf('--records');
  const records = readRecords(at === -1 ? null : argv[at + 1]);
  const repo = env.GITHUB_REPOSITORY;
  if (!repo || !env.GITHUB_TOKEN)
    throw new Error('GITHUB_REPOSITORY and GITHUB_TOKEN are required');
  const runUrl = `${env.GITHUB_SERVER_URL ?? 'https://github.com'}/${repo}/actions/runs/${env.GITHUB_RUN_ID}`;
  const client = github({ token: env.GITHUB_TOKEN, repo, fetchImpl });
  const actions = decide({
    needs,
    openIssues: await client.openIssues(),
    records,
    runUrl,
    date: now.toISOString().slice(0, 10),
  });
  for (const action of actions) {
    await client.apply(action);
    console.log(`[report] ${action.kind}${action.issue ? ` #${action.issue}` : ''}`);
  }
  if (actions.length === 0) console.log('[report] every scheduled check passed; no open report');
  return actions;
}

if (path.resolve(process.argv[1] ?? '') === fileURLToPath(import.meta.url)) {
  try {
    await report({ env: process.env, argv: process.argv.slice(2) });
  } catch (error) {
    console.log(`::error title=report::${error.message}`);
    process.exit(1);
  }
}
