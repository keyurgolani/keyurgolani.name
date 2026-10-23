#!/usr/bin/env node
// Runs `pnpm quality:meta` only when it has something to check (#11, Slice
// 1, item 13): on a pull request that changes tests/quality/**, quality/**,
// or .github/workflows/**. Any other event (a push, a schedule, a local run)
// runs it always. The job is required, so with nothing to run it says so
// and succeeds.
//
//   node tests/quality/meta/when-changed.mjs -- <command> [args...]
//
// A pull request's checkout is its merge commit, fetched two deep, so the
// first parent is the base it merges into: what changed is HEAD^1..HEAD. When
// that can't be read, it runs the command rather than guess.
import { execFileSync, spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/** The paths that make quality:meta run on a pull request. */
export const WATCHED = [/^tests\/quality\//, /^quality\//, /^\.github\/workflows\//];

/** Whether any of `files` is one quality:meta checks. */
export function touchesWatched(files) {
  return files.some((file) => WATCHED.some((pattern) => pattern.test(file)));
}

/**
 * The files a pull request changes, or null when this isn't one or they
 * can't be read.
 *
 * @param {NodeJS.ProcessEnv} env
 * @param {(args: string[]) => string} git
 */
export function changedFiles(
  env = process.env,
  git = (args) => execFileSync('git', args, { encoding: 'utf8' }),
) {
  if (env.GITHUB_EVENT_NAME !== 'pull_request') return null;
  try {
    return git(['diff', '--name-only', 'HEAD^1', 'HEAD']).split('\n').filter(Boolean);
  } catch {
    return null;
  }
}

function main(argv) {
  const separator = argv.indexOf('--');
  const command = separator < 0 ? [] : argv.slice(separator + 1);
  if (command.length === 0) {
    console.error('usage: node tests/quality/meta/when-changed.mjs -- <command> [args...]');
    return 2;
  }
  const files = changedFiles();
  if (files !== null && !touchesWatched(files)) {
    console.log(
      `[quality-meta] nothing to run: this pull request changes none of tests/quality/**, quality/**, or .github/workflows/** (${files.length} files changed).`,
    );
    return 0;
  }
  const result = spawnSync(command[0], command.slice(1), { stdio: 'inherit' });
  return result.error ? 127 : (result.status ?? 1);
}

if (path.resolve(process.argv[1] ?? '') === fileURLToPath(import.meta.url)) {
  process.exit(main(process.argv.slice(2)));
}
