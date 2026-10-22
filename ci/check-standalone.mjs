#!/usr/bin/env node
// The build's standalone output ships no portfolio or site document but the
// bundled examples (#5, #7). The image copies the tree whole, and its file
// scan refuses any other, so a document a route's trace drags in, such as a
// contract fixture's, fails the image job. This fails the build job first,
// with no container: CI runs it after pnpm ci:source-maps. It walks the tree
// as the scan does, leaving out node_modules and following no link, and
// uses the scan's rule for a document (ci/lib/container.mjs scanFromInside),
// which ci/standalone.test.mjs holds it to.
//
//   node ci/check-standalone.mjs [standalone dir]
import { existsSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { currentGate, REPO_ROOT, reportError, writeFailureRecord } from './lib/reports.mjs';

export const STANDALONE_DIR = path.join(REPO_ROOT, 'apps', 'web', '.next', 'standalone');

/** Whether the image scan refuses an entry by this name as a document. */
export function refusedDocument(name) {
  return (
    (name.startsWith('portfolio.') && name !== 'portfolio.example.yml') ||
    /^site\.(?:yml|yaml|json)$/.test(name)
  );
}

/**
 * Every document under `dir` the image scan refuses, relative to it,
 * sorted. An entry it refuses isn't walked into.
 */
export function documentFiles(dir) {
  const found = [];
  const walk = (at) => {
    for (const entry of readdirSync(at, { withFileTypes: true })) {
      if (entry.name === 'node_modules') continue;
      const full = path.join(at, entry.name);
      if (refusedDocument(entry.name)) found.push(path.relative(dir, full));
      else if (entry.isDirectory()) walk(full);
    }
  };
  walk(dir);
  return found.sort();
}

/** Up to ten names, and how many more there are. */
function listed(names) {
  const shown = names.slice(0, 10).join(', ');
  return names.length > 10 ? `${shown}, and ${names.length - 10} more` : shown;
}

/**
 * What the check finds: null when it passes, else the message. The
 * standalone tree has to be there.
 *
 * @param {string} dir the build's .next/standalone
 */
export function checkStandalone(dir) {
  const shown = path.relative(REPO_ROOT, dir) || dir;
  if (!existsSync(dir)) return `No standalone build at ${shown}. Run pnpm build first.`;
  const documents = documentFiles(dir);
  if (documents.length === 0) return null;
  return `${shown} holds ${documents.length} document(s) the image must not ship: ${listed(documents)}. The image copies this tree whole, and its scan refuses any portfolio or site document but the bundled examples. next.config.ts's outputFileTracingExcludes keeps packages/variant-contract/fixtures out of the trace.`;
}

function main(argv) {
  const dir = path.resolve(argv[0] ?? STANDALONE_DIR);
  const problem = checkStandalone(dir);
  if (!problem) {
    console.log(
      `[standalone] no portfolio or site document but the examples under ${path.relative(REPO_ROOT, dir)}`,
    );
    return 0;
  }
  reportError(problem, { title: 'standalone output' });
  const gate = currentGate();
  if (gate) {
    const [first] = existsSync(dir) ? documentFiles(dir) : [];
    writeFailureRecord({
      ...gate,
      test: 'the standalone output ships no portfolio or site document but the bundled examples',
      asset: first ? path.join(path.relative(REPO_ROOT, dir), first) : undefined,
      expected: 'no portfolio or site document but portfolio.example.yml and site.example.yml',
      actual: problem,
    });
  }
  return 1;
}

if (path.resolve(process.argv[1] ?? '') === fileURLToPath(import.meta.url)) {
  process.exit(main(process.argv.slice(2)));
}
