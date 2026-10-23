#!/usr/bin/env node
// The build's standalone output holds nothing the image must not ship (#5,
// #7). The image copies the tree whole, and its file scan refuses a
// portfolio or site document but the bundled examples at the root, env
// files, git metadata, secrets, test trees, and any snapshot but the
// sample's, and needs the bundled sample. So a file a route's trace or next.config.ts's
// includes drag in, such as a contract fixture's document or snapshot,
// fails the image job. This runs the same scan (ci/lib/container.mjs
// scanTree) on the build's own tree, with no container, so the build job
// fails first: CI runs it after pnpm ci:source-maps. A native tree holds at
// least what the image's does, since .dockerignore keeps tests/ and the
// rest out of the image's build.
//
//   node ci/check-standalone.mjs [standalone dir]
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { scanTree } from './lib/container.mjs';
import { currentGate, REPO_ROOT, reportError, writeFailureRecord } from './lib/reports.mjs';

export const STANDALONE_DIR = path.join(REPO_ROOT, 'apps', 'web', '.next', 'standalone');

/** The bundled sample the demo profile renders, which the scan needs. */
const SAMPLE =
  'portfolio.example.yml, site.example.yml, snapshots/github.json, and example-media/work/small-traces.png';

/** Whether a path the scan refuses is a copy the tracer made under node_modules. */
const inModules = (file) => file.split(path.sep).includes('node_modules');

/**
 * What the image scan finds under `dir`: what it refuses, relative to `dir`,
 * sorted with the copies under node_modules last, so the files they copy
 * come first; and whether the bundled sample is there.
 */
export function scanStandalone(dir) {
  const { problems, example } = scanTree(dir);
  const sorted = [...problems].sort(
    (a, b) => Number(inModules(a)) - Number(inModules(b)) || (a < b ? -1 : a > b ? 1 : 0),
  );
  return { problems: sorted, example };
}

/**
 * What only #6's catalog fixture ships (scripts/fixture-routes.ts): its
 * route, and its plates' attribute in any chunk. A build without
 * BUDGET_FIXTURES has neither, since generation writes no route file there.
 */
const CATALOG_ROUTE = /(?:^|[\\/])(?:_|%5F)catalog-fixture(?:[\\/.]|$)/i;
const CATALOG_MARKER = 'data-plate-live';

/** Every file under `dir`, relative to it. */
function filesUnder(dir) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => path.relative(dir, path.join(entry.parentPath ?? entry.path, entry.name)));
}

/**
 * The catalog fixture's paths and chunks in a build's output: the
 * standalone tree and the static assets beside it, .next/static. A build
 * made with BUDGET_FIXTURES ships them, and every other build none.
 *
 * @param {string} dir the build's .next/standalone
 */
export function catalogFixtureFiles(dir) {
  const found = [];
  for (const root of [dir, path.join(dir, '..', 'static')]) {
    for (const file of filesUnder(root)) {
      if (file.split(path.sep).includes('node_modules')) continue;
      const shown = path.join(path.relative(dir, root), file);
      if (CATALOG_ROUTE.test(file)) {
        found.push(shown);
        continue;
      }
      if (/\.(?:js|mjs|cjs|html|rsc|json)$/.test(file)) {
        if (readFileSync(path.join(root, file), 'utf8').includes(CATALOG_MARKER)) found.push(shown);
      }
    }
  }
  return found;
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
export function checkStandalone(dir, env = process.env) {
  // A tree outside the repository goes by its own path.
  const relative = path.relative(REPO_ROOT, dir);
  const outside = relative === '..' || relative.startsWith(`..${path.sep}`);
  const shown = relative === '' || outside ? dir : relative;
  if (!existsSync(dir)) return `No standalone build at ${shown}. Run pnpm build first.`;
  const { problems, example } = scanStandalone(dir);
  const found = [];
  if (problems.length > 0) {
    found.push(
      `${shown} holds ${problems.length} path(s) the image must not ship: ${listed(problems)}. The image copies this tree whole, and its scan refuses any portfolio or site document but the bundled examples at the root, env files, git metadata, secrets, test trees, and any snapshot but the sample's in snapshots/. next.config.ts's outputFileTracingIncludes and outputFileTracingExcludes decide what the trace ships beside the code.`,
    );
  }
  if (!example) {
    found.push(
      `${shown} lacks the bundled sample the demo profile renders: ${SAMPLE}. next.config.ts's outputFileTracingIncludes ships them.`,
    );
  }
  if (!env.BUDGET_FIXTURES) {
    const catalog = catalogFixtureFiles(dir);
    if (catalog.length > 0) {
      found.push(
        `${shown} ships #6's catalog fixture, which only a BUDGET_FIXTURES build may: ${listed(catalog)}. Registry generation writes its route only with the flag; remove the file at apps/web/src/app/(studio)/studio/%5Fcatalog-fixture and generate again.`,
      );
    }
  }
  return found.length === 0 ? null : found.join(' ');
}

function main(argv) {
  const dir = path.resolve(argv[0] ?? STANDALONE_DIR);
  const problem = checkStandalone(dir);
  if (!problem) {
    console.log(
      `[standalone] the bundled sample and nothing the image must not ship under ${path.relative(REPO_ROOT, dir)}`,
    );
    return 0;
  }
  reportError(problem, { title: 'standalone output' });
  const gate = currentGate();
  if (gate) {
    const [first] = existsSync(dir) ? scanStandalone(dir).problems : [];
    writeFailureRecord({
      ...gate,
      test: 'the standalone output holds the bundled sample and nothing the image must not ship',
      asset: first ? path.join(path.relative(REPO_ROOT, dir), first) : undefined,
      expected: `${SAMPLE}, and nothing the image scan refuses`,
      actual: problem,
    });
  }
  return 1;
}

if (path.resolve(process.argv[1] ?? '') === fileURLToPath(import.meta.url)) {
  process.exit(main(process.argv.slice(2)));
}
