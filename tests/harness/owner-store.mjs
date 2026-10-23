// Owner's first start publishes the mounted pair, so it refuses a site whose
// variant the build doesn't register (#3, Slice 3): every fixture's, until
// #13 registers a composition. The harness's owner servers start on a store
// the store's own test child published the pair into, as a first start in a
// build that registers the variant would have. owner-store.spec.ts lays its
// stores out the same way.
import { spawnSync } from 'node:child_process';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
/** packages/core, where `--import tsx` resolves. */
const CORE = path.join(REPO_ROOT, 'packages', 'core');
const CHILD = path.join(CORE, 'src', 'store', 'test-support', 'child.ts');

/** The document named `name` in `dir`, as the store takes it. */
function document(dir, name) {
  const file = readdirSync(dir).find((entry) => new RegExp(`^${name}\\.(ya?ml|json)$`).test(entry));
  if (!file) throw new Error(`seedOwnerStore: no ${name} document in ${dir}`);
  return {
    format: file.endsWith('.json') ? 'json' : 'yaml',
    sourceText: readFileSync(path.join(dir, file), 'utf8'),
  };
}

/**
 * Lays out `dataDir` as startup's preflight does and publishes the pair in
 * `sourceDir` into it as revision 1, from a child process, which checks it
 * as #4's validator does and no variant registry. It throws when that
 * didn't commit.
 */
export function seedOwnerStore(dataDir, sourceDir) {
  const task = {
    kind: 'run',
    dataDir,
    steps: [
      { op: 'preflight' },
      {
        op: 'publishDocuments',
        documents: {
          portfolio: document(sourceDir, 'portfolio'),
          site: document(sourceDir, 'site'),
        },
      },
    ],
  };
  const run = spawnSync(process.execPath, ['--import', 'tsx', CHILD, JSON.stringify(task)], {
    cwd: CORE,
    encoding: 'utf8',
    timeout: 60_000,
  });
  const line = (run.stdout ?? '').trim().split('\n').pop() ?? '';
  let results = [];
  try {
    results = JSON.parse(line).results ?? [];
  } catch {
    results = [];
  }
  if (run.status !== 0 || results.length !== 2 || results[1]?.outcome?.kind !== 'committed') {
    throw new Error(
      `seedOwnerStore: the store child didn't publish the pair (exit ${run.status}): ${line || run.stderr}`.slice(
        0,
        2000,
      ),
    );
  }
}

/**
 * A script for `node -e`, run as root in the image, that copies a store
 * seedOwnerStore made, mounted at /seed, into the data volume at
 * /var/lib/portfolio, for the server's user, uid 1001, as the image makes
 * the directory: what a container run seeds a named volume with.
 */
export const COPY_SEED_INTO_VOLUME = [
  "const fs = require('node:fs');",
  "const path = require('node:path');",
  "const into = '/var/lib/portfolio';",
  "fs.cpSync('/seed', into, { recursive: true });",
  'const own = (p) => {',
  '  fs.chownSync(p, 1001, 1001);',
  '  if (fs.lstatSync(p).isDirectory()) for (const name of fs.readdirSync(p)) own(path.join(p, name));',
  '};',
  'own(into);',
].join('\n');
