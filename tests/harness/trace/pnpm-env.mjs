// pnpm for another checkout (#6, Slice 1): pnpm test:trace:baseline
// installs and builds 62a0f06 in a worktree of its own, with a pnpm shim on
// its PATH for that checkout's own scripts.
import { accessSync, constants, statSync } from 'node:fs';
import path from 'node:path';

/**
 * `env` without the settings pnpm passes down to a script it runs. pnpm run
 * exports this checkout's pnpm-workspace.yaml and .npmrc settings as
 * npm_config_* variables (strictDepBuilds as npm_config_strict_dep_builds,
 * for one), and a pnpm command in another checkout reads them as its own, so
 * an install there would follow this checkout's rules rather than its own.
 *
 * @param {Record<string, string | undefined>} env
 */
export function withoutPnpmSettings(env) {
  return Object.fromEntries(
    Object.entries(env).filter(([name]) => !/^(npm|pnpm)_config_/i.test(name)),
  );
}

/** Whether `file` is a file this process may run. */
function runnable(file) {
  try {
    accessSync(file, constants.X_OK);
    return statSync(file).isFile();
  } catch {
    return false;
  }
}

/**
 * The pnpm to run, as an absolute command, so a shim named pnpm that runs it
 * can never run itself: the pnpm that started this script (npm_execpath,
 * under pnpm run), else the first pnpm on PATH outside `exclude`, which
 * holds the shim's own directory, else corepack pnpm.
 *
 * @param {Record<string, string | undefined>} env
 * @param {{ exclude?: string[], node?: string }} [options] node runs a pnpm that is a JS file
 * @returns {string[]}
 */
export function resolvePnpm(env, { exclude = [], node = process.execPath } = {}) {
  const execpath = env.npm_execpath;
  if (execpath && /^pnpm(?:\.[cm]?js)?$/.test(path.basename(execpath))) {
    return /\.[cm]?js$/.test(execpath) ? [node, path.resolve(execpath)] : [path.resolve(execpath)];
  }
  const skip = new Set(exclude.map((dir) => path.resolve(dir)));
  const dirs = (env.PATH ?? '')
    .split(path.delimiter)
    .filter((dir) => path.isAbsolute(dir) && !skip.has(path.resolve(dir)));
  const find = (name) => dirs.map((dir) => path.join(dir, name)).find(runnable);
  const pnpm = find('pnpm');
  if (pnpm) return [pnpm];
  const corepack = find('corepack');
  if (corepack) return [corepack, 'pnpm'];
  throw new Error(
    'No pnpm: run this as pnpm test:trace:baseline, or put pnpm or corepack on PATH.',
  );
}

/**
 * A POSIX shell script that runs `command` with the arguments it gets.
 *
 * @param {string[]} command absolute, as resolvePnpm gives it
 */
export function shimScript(command) {
  const quoted = command.map((part) => `'${part.replaceAll("'", `'\\''`)}'`).join(' ');
  return `#!/bin/sh\nexec ${quoted} "$@"\n`;
}
