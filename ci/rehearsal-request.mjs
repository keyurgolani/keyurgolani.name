#!/usr/bin/env node
// Whether catalog-rehearsal.yml runs (#20 PR 3): on a pull request's
// checkout, the merge commit with its parents and the head's parent
// (fetch-depth 3), the rehearsal runs only when the pull request's head
// commit itself changed tests/catalog/rehearsal.json and the file is there
// and parses. A later push that leaves the file alone, or the commit that
// removes it, runs nothing, so one request is one run, and nothing reruns
// one. There's no manual trigger.
//
//   node ci/rehearsal-request.mjs --github   Write run=true or run=false to GITHUB_OUTPUT.
//   node ci/rehearsal-request.mjs            Print the decision.
import { execFileSync } from 'node:child_process';
import { appendFileSync, existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const REQUEST = 'tests/catalog/rehearsal.json';

/**
 * The decision, from what the head commit changed and what the merge holds.
 *
 * @param {{ changed: readonly string[], text: string | null }} evidence
 *   the head commit's changed paths, and the request file's text in the merge, or null
 * @returns {{ run: boolean, reason: string }}
 */
export function decide({ changed, text }) {
  if (!changed.includes(REQUEST)) {
    return { run: false, reason: `the head commit doesn't change ${REQUEST}` };
  }
  if (text === null) return { run: false, reason: `the head commit removes ${REQUEST}` };
  try {
    const parsed = JSON.parse(text);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('not an object');
  } catch (error) {
    return { run: false, reason: `${REQUEST} doesn't parse as a JSON object: ${error.message}` };
  }
  return { run: true, reason: `the head commit changes ${REQUEST}` };
}

/** What the checkout says: the head commit (the merge's second parent) against its own parent. */
function evidence(root) {
  const changed = execFileSync('git', ['diff', '--name-only', 'HEAD^2^', 'HEAD^2'], {
    cwd: root,
    encoding: 'utf8',
  })
    .split('\n')
    .filter(Boolean);
  const file = path.join(root, REQUEST);
  return { changed, text: existsSync(file) ? readFileSync(file, 'utf8') : null };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const { run, reason } = decide(evidence(root));
  console.log(`[rehearsal] ${run ? 'Runs' : 'Skips'}: ${reason}.`);
  if (process.argv.includes('--github')) {
    appendFileSync(process.env.GITHUB_OUTPUT ?? '/dev/null', `run=${run}\n`);
  }
}
