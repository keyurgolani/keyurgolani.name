#!/usr/bin/env node
// The base quality-pr's [37] rule diffs against (tests/quality/lib/changes.ts), chosen once in
// quality-pr-plan and read by every quality-pr shard, so the plan and its shards plan one set.
//
// - A pull request: HEAD^1, the merge commit's first parent, the base branch's tip, diffed from the
//   merge base as before.
// - A push: github.event.before, the branch's tip before the push, so every commit the push brings
//   directs its cells, not only the last one (a two-commit push whose last commit is docs alone
//   would otherwise direct nothing). The checkout is two commits deep, so `before` is fetched alone
//   (git fetch --no-tags --depth=1, once more if that fails) and diffed tree to tree
//   (QUALITY_CHANGED_DIFF=tree): with the history cut at HEAD^1 there's no merge base to find.
//   On a push that only adds commits, before is the merge base, so the tree diff and the
//   merge-base diff agree. On a forced push the tree diff names what differs from the old tip,
//   which can be fewer paths than from the fork point; the old tip's own push run stands for the
//   rest, since push runs are never cancelled (ci.yml's concurrency: a group per sha, cancelling in
//   progress only on a pull request). github.event.forced (EVENT_FORCED) says so in the reason; it
//   doesn't change the base.
// - It falls back to HEAD^1 when before is all zeros (a new branch) or can't be fetched, and says
//   which base it used and why: in the log, in the step summary, and on a fallback in a warning
//   annotation.
// - The event comes in through the environment alone (EVENT_NAME, EVENT_BEFORE, EVENT_FORCED), never
//   through the run: line. An empty EVENT_NAME and a before that isn't 40 hex digits fail the step.
//   Every git call is an argument vector, no shell.
//
//   node ci/quality-base.mjs                 quality-pr-plan: choose, and write base and diff to
//                                            GITHUB_OUTPUT, which the count step and the shards read
//   node ci/quality-base.mjs --from-plan     a quality-pr shard: check PLAN_BASE and PLAN_DIFF, fetch the
//                                            base if it's a commit, and fail if it can't be read
import { execFileSync } from 'node:child_process';
import { appendFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { escapeData, reportError } from './lib/reports.mjs';

/** HEAD^1, the fallback and the pull request's base. */
export const FIRST_PARENT = 'HEAD^1';
const SHA = /^[0-9a-f]{40}$/;
const ZERO = /^0{40}$/;

/** The diff each base takes: from the merge base (git's three dots), or tree to tree. */
export const DIFFS = { mergeBase: 'merge-base', tree: 'tree' };

/** git in `cwd`, an argument vector, its output, or a throw with its stderr's first line. */
export function gitIn(cwd) {
  return (...args) =>
    execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
}

/** The first line of a failed git call's stderr, or its message. */
const firstLine = (error) =>
  String(error?.stderr || error?.message || error)
    .trim()
    .split('\n')[0];

/** Fetches `sha` alone, and confirms it's a commit here. */
function fetchCommit(git, sha) {
  git('fetch', '--no-tags', '--depth=1', 'origin', sha);
  git('cat-file', '-e', `${sha}^{commit}`);
}

/** How many times a push's before is fetched before the base falls back to HEAD^1. */
export const FETCH_TRIES = 2;

/**
 * The base for `event` (github.event_name), `before` (github.event.before, push only) and `forced`
 * (github.event.forced, push only, the reason alone), with the diff it takes and why:
 * { base, diff, reason, fallback }. Throws on an empty event, and on a push's `before` that isn't
 * 40 hex digits.
 */
export function chooseBase({ event, before, forced = false }, git) {
  if (!event) {
    throw new Error('EVENT_NAME is empty, so the event is unknown: refusing to choose a base');
  }
  if (event !== 'push') {
    return {
      base: FIRST_PARENT,
      diff: DIFFS.mergeBase,
      reason: `${event}: HEAD^1, the merge commit's first parent, the base branch's tip`,
      fallback: false,
    };
  }
  const label = forced ? 'push (forced)' : 'push';
  const value = String(before ?? '');
  if (!SHA.test(value)) {
    throw new Error(
      `github.event.before is ${JSON.stringify(value.slice(0, 80))}, not a commit's 40 hex digits: refusing it`,
    );
  }
  if (ZERO.test(value)) {
    return {
      base: FIRST_PARENT,
      diff: DIFFS.mergeBase,
      reason: `${label}: github.event.before is all zeros (a new branch), so HEAD^1, the last commit alone`,
      fallback: true,
    };
  }
  let failure = null;
  for (let tries = 0; tries < FETCH_TRIES; tries += 1) {
    try {
      fetchCommit(git, value);
      failure = null;
      break;
    } catch (error) {
      failure = error;
    }
  }
  if (failure) {
    return {
      base: FIRST_PARENT,
      diff: DIFFS.mergeBase,
      reason: `${label}: github.event.before ${value} couldn't be fetched in ${FETCH_TRIES} tries (${firstLine(failure)}), so HEAD^1, the last commit alone`,
      fallback: true,
    };
  }
  return {
    base: value,
    diff: DIFFS.tree,
    reason: forced
      ? `${label}: github.event.before ${value}, the old tip, diffed tree to tree from it`
      : `${label}: github.event.before ${value}, the branch's tip before the push, diffed tree to tree`,
    fallback: false,
  };
}

/**
 * A shard's base, as quality-pr-plan chose it: HEAD^1 with its merge-base diff, or a commit with
 * its tree diff, fetched here too. Anything else, or a commit that can't be fetched, throws: the
 * shard can't plan the plan's set without it.
 */
export function planBase({ base, diff }, git) {
  if (base === FIRST_PARENT && diff === DIFFS.mergeBase) {
    return { base, diff, reason: "quality-pr-plan's base: HEAD^1" };
  }
  if (SHA.test(String(base ?? '')) && !ZERO.test(base) && diff === DIFFS.tree) {
    try {
      fetchCommit(git, base);
    } catch (error) {
      throw new Error(
        `quality-pr-plan's base ${base} couldn't be fetched here (${firstLine(error)}), so this shard can't plan its set`,
      );
    }
    return { base, diff, reason: `quality-pr-plan's base: ${base}, diffed tree to tree` };
  }
  throw new Error(
    `quality-pr-plan's base is ${JSON.stringify(String(base ?? '').slice(0, 80))} with diff ${JSON.stringify(String(diff ?? '').slice(0, 20))}: refusing it`,
  );
}

/** What the step writes: the outputs the count step and the shards read, and a summary line. */
export function stepFiles({ base, diff, reason }) {
  return {
    output: `base=${base}\ndiff=${diff}\n`,
    summary: `**quality-pr base:** \`${base}\` (${diff} diff). ${reason}.\n`,
  };
}

function main() {
  const git = gitIn(process.cwd());
  const fromPlan = process.argv.includes('--from-plan');
  const chosen = fromPlan
    ? planBase({ base: process.env.PLAN_BASE, diff: process.env.PLAN_DIFF }, git)
    : chooseBase(
        {
          event: process.env.EVENT_NAME,
          before: process.env.EVENT_BEFORE,
          forced: process.env.EVENT_FORCED === 'true',
        },
        git,
      );
  const files = stepFiles(chosen);
  console.log(`[quality-base] ${chosen.base} (${chosen.diff} diff): ${chosen.reason}`);
  if (chosen.fallback) {
    console.log(`::warning title=quality-pr base::${escapeData(chosen.reason)}`);
  }
  if (!fromPlan && process.env.GITHUB_OUTPUT)
    appendFileSync(process.env.GITHUB_OUTPUT, files.output);
  if (process.env.GITHUB_STEP_SUMMARY)
    appendFileSync(process.env.GITHUB_STEP_SUMMARY, files.summary);
}

if (path.resolve(process.argv[1] ?? '') === fileURLToPath(import.meta.url)) {
  try {
    main();
  } catch (error) {
    reportError(`[quality-base] ${error instanceof Error ? error.message : error}`, {
      title: 'quality-pr base',
    });
    process.exit(1);
  }
}
