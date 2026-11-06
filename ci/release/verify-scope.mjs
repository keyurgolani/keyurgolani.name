#!/usr/bin/env node
// The release candidate's quality scope check: refuse a tag whose quality scope file
// (quality/release/scope.json, tests/quality/lib/release-scope.ts) is another release's, so each
// candidate is judged against its own scope and records list, and a stale file never stands in.
//
//   TAG=v1.2.0-rc.1 node ci/release/verify-scope.mjs
//
// Pure Node with no dependencies, so rc-verify's sparse checkout runs it with no install.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseReleaseTag } from './tags.mjs';

export const SCOPE_FILE = 'quality/release/scope.json';

/** Why `scope` (the parsed file) isn't `tag`'s, or null when it is. */
export function scopeMismatch(tag, scope) {
  const release = parseReleaseTag(tag);
  if (!release || release.kind !== 'rc') return `${tag} is not a release candidate tag`;
  const own = tag.replace(/^v/, '');
  if (!scope || typeof scope.release !== 'string')
    return `${SCOPE_FILE} names no release, so nothing says it is ${own}'s`;
  if (scope.release !== own)
    return `${SCOPE_FILE} is for ${scope.release}, and this tag is ${own}: commit ${own}'s scope and records list first`;
  return null;
}

/**
 * Why a final release can't promote the candidate whose commit holds `scope` and `records` (the
 * parsed files), or null when it can: a final keeps the full matrix's rule, every cell in scope
 * and none listed as failing.
 */
export function finalScopeRefusal(scope, records) {
  if (!scope || typeof scope !== 'object' || !Array.isArray(records))
    return `${SCOPE_FILE} or its records list wasn't read`;
  const problems = [];
  if (scope.scope !== 'full')
    problems.push(`its scope is ${JSON.stringify(scope.scope)}, not full`);
  if (records.length > 0)
    problems.push(
      `its records list names ${records.length} failing cell test${records.length === 1 ? '' : 's'}`,
    );
  return problems.length === 0
    ? null
    : `${SCOPE_FILE} keeps the candidate from a final release: ${problems.join(', and ')}. A final needs the full matrix clean: scope full and an empty list, then a new candidate`;
}

/** The scope file and its records list at `root`, parsed; throws when either can't be read. */
export function readScope(root) {
  const scope = JSON.parse(readFileSync(path.join(root, SCOPE_FILE), 'utf8'));
  const records = JSON.parse(
    readFileSync(path.join(root, path.dirname(SCOPE_FILE), String(scope.records)), 'utf8'),
  );
  return { scope, records };
}

function main() {
  const tag = process.env.TAG ?? '';
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
  let scope;
  try {
    scope = JSON.parse(readFileSync(path.join(root, SCOPE_FILE), 'utf8'));
  } catch (error) {
    console.error(`::error::${SCOPE_FILE} can't be read: ${error.message}`);
    return 1;
  }
  const problem = scopeMismatch(tag, scope);
  if (problem) {
    console.error(`::error::${problem}`);
    return 1;
  }
  console.log(
    `${SCOPE_FILE} is ${scope.release}'s: scope ${scope.scope}, records ${scope.records}`,
  );
  return 0;
}

if (path.resolve(process.argv[1] ?? '') === fileURLToPath(import.meta.url)) {
  process.exitCode = main();
}
