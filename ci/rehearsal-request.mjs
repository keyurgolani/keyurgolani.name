#!/usr/bin/env node
// Whether catalog-rehearsal.yml runs (#20 PR 3): on a pull request's
// checkout, the merge commit with its parents and the head's parent
// (fetch-depth 3), the rehearsal runs only when the pull request's head
// commit itself changed tests/catalog/rehearsal.json, the file parses, and
// its `for`, the request's id, is the head's own parent: the commit the
// request rehearses. So one request is one run:
//
// - a later push that leaves the file alone, or the commit that removes
//   it, runs nothing;
// - a restack rewrites the head's parent, so the request it carries is for
//   a commit that's gone, and runs nothing until the owner asks again;
// - a request the base already holds, by the same id, runs nothing.
//
// The workflow doesn't run on a reopen, and there's no manual trigger.
//
//   node ci/rehearsal-request.mjs --github   Write run=true or run=false to GITHUB_OUTPUT.
//   node ci/rehearsal-request.mjs            Print the decision.
import { execFileSync } from 'node:child_process';
import { appendFileSync, existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const REQUEST = 'tests/catalog/rehearsal.json';

/** A request's id, its `for`: a full commit id, or null when the text has none. */
function requestId(text) {
  try {
    const id = JSON.parse(text)?.for;
    return typeof id === 'string' && /^[0-9a-f]{40}$/.test(id) ? id : null;
  } catch {
    return null;
  }
}

/**
 * The decision, from what the head commit changed and what the merge holds.
 *
 * @param {{ changed: readonly string[], text: string | null, parent: string, base: string | null }} evidence
 *   the head commit's changed paths, the request file's text in the merge or
 *   null, the head's parent's commit id, and the request file's text on the
 *   base or null
 * @returns {{ run: boolean, reason: string }}
 */
export function decide({ changed, text, parent, base }) {
  if (!changed.includes(REQUEST)) {
    return { run: false, reason: `the head commit doesn't change ${REQUEST}` };
  }
  if (text === null) return { run: false, reason: `the head commit removes ${REQUEST}` };
  try {
    const parsed = JSON.parse(text);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed))
      throw new Error('not an object');
  } catch (error) {
    return { run: false, reason: `${REQUEST} doesn't parse as a JSON object: ${error.message}` };
  }
  const id = requestId(text);
  if (id === null) {
    return {
      run: false,
      reason: `${REQUEST} has no \`for\`, the full id of the commit it rehearses`,
    };
  }
  if (id !== parent) {
    return {
      run: false,
      reason: `the request is for ${id}, and the head's parent is ${parent}: a restack left it behind, so ask again`,
    };
  }
  if (base !== null && requestId(base) === id) {
    return { run: false, reason: `the base already holds the request for ${id}` };
  }
  return { run: true, reason: `the head commit asks to rehearse ${id}` };
}

/** What the checkout says: the head commit (the merge's second parent) against its own parent, and the base (its first). */
export function evidence(root) {
  const git = (...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8' });
  const changed = git('diff', '--name-only', 'HEAD^2^', 'HEAD^2').split('\n').filter(Boolean);
  const parent = git('rev-parse', 'HEAD^2^').trim();
  let base = null;
  try {
    base = execFileSync('git', ['show', `HEAD^1:${REQUEST}`], {
      cwd: root,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    });
  } catch {
    base = null;
  }
  const file = path.join(root, REQUEST);
  return { changed, text: existsSync(file) ? readFileSync(file, 'utf8') : null, parent, base };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const { run, reason } = decide(evidence(root));
  console.log(`[rehearsal] ${run ? 'Runs' : 'Skips'}: ${reason}.`);
  if (process.argv.includes('--github')) {
    appendFileSync(process.env.GITHUB_OUTPUT ?? '/dev/null', `run=${run}\n`);
  }
}
