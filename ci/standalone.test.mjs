import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse as parseYaml } from 'yaml';
import { checkStandalone, scanStandalone } from './check-standalone.mjs';
import { SCAN_SNIPPET } from './lib/container.mjs';

// The build's standalone output holds the bundled sample and nothing the
// image must not ship (#5, #7), since the image copies the tree whole and
// its scan refuses the rest. The check runs the scan's rule on the build's
// tree: CI's build job runs it after its build and the source map check,
// with no container.

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/** A temporary standalone tree holding `files`, removed after the test. */
function standaloneTree(t, files) {
  const dir = mkdtempSync(path.join(tmpdir(), 'standalone-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  for (const file of files) {
    mkdirSync(path.dirname(path.join(dir, file)), { recursive: true });
    writeFileSync(path.join(dir, file), '');
  }
  return dir;
}

/** What a standalone build holds that the image may ship. */
const SHIPPED = [
  'apps/web/server.js',
  'apps/web/.next/server/app/page.js',
  'apps/web/node_modules/@portfolio/schema/src/snapshots.ts',
  'packages/variant-contract/src/index.ts',
  'packages/variant-contract/package.json',
  'portfolio.example.yml',
  'site.example.yml',
  'snapshots/github.json',
  'example-media/work/small-traces.png',
  'node_modules/next/package.json',
];

test('a standalone build with the bundled sample and nothing the image scan refuses passes', (t) => {
  const dir = standaloneTree(t, SHIPPED);
  assert.deepEqual(scanStandalone(dir), { problems: [], example: true });
  assert.equal(checkStandalone(dir), null);
});

test("a contract fixture's documents in the standalone build fail, by name (#5, #7)", (t) => {
  const dir = standaloneTree(t, [
    ...SHIPPED,
    'packages/variant-contract/fixtures/complete/portfolio.yml',
    'packages/variant-contract/fixtures/complete/site.yml',
    'packages/variant-contract/fixtures/hidden-canary/site.yml',
  ]);
  assert.deepEqual(scanStandalone(dir).problems, [
    'packages/variant-contract/fixtures/complete/portfolio.yml',
    'packages/variant-contract/fixtures/complete/site.yml',
    'packages/variant-contract/fixtures/hidden-canary/site.yml',
  ]);
  assert.match(
    checkStandalone(dir),
    /holds 3 path\(s\) the image must not ship: packages\/variant-contract\/fixtures\/complete\/portfolio\.yml, .*hidden-canary\/site\.yml\. The image copies this tree whole, and its scan refuses any portfolio or site document but the bundled examples at the root, env files, git metadata, secrets, test trees, and any snapshot but the sample's in snapshots\/\. next\.config\.ts's outputFileTracingIncludes and outputFileTracingExcludes decide what the trace ships beside the code\.$/,
  );
});

test("a snapshot anywhere but the root's snapshots/ fails, by name, its node_modules copies too (#7)", (t) => {
  const dir = standaloneTree(t, [
    ...SHIPPED,
    'snapshots/urls.json',
    'packages/variant-contract/fixtures/hidden-canary/snapshots/github.json',
    'packages/schema/src/__fixtures__/invalid/snapshot.syntax/snapshots/github.json',
    'packages/schema/src/__fixtures__/invalid/snapshot.ignored/snapshots/github-notes.txt',
    'apps/web/snapshots/github.json',
    'apps/web/node_modules/@portfolio/variant-contract/fixtures/hidden-canary/snapshots/github.json',
    'node_modules/.pnpm/node_modules/@portfolio/schema/src/__fixtures__/invalid/snapshot.invalid/snapshots/github.json',
    'packages/kit/src/snapshots.json',
    'snapshots/archive/github.json',
  ]);
  // The copies under node_modules come last, after the files they copy.
  assert.deepEqual(scanStandalone(dir), {
    problems: [
      'apps/web/snapshots/github.json',
      'packages/schema/src/__fixtures__/invalid/snapshot.syntax/snapshots/github.json',
      'packages/variant-contract/fixtures/hidden-canary/snapshots/github.json',
      'apps/web/node_modules/@portfolio/variant-contract/fixtures/hidden-canary/snapshots/github.json',
      'node_modules/.pnpm/node_modules/@portfolio/schema/src/__fixtures__/invalid/snapshot.invalid/snapshots/github.json',
    ],
    example: true,
  });
  assert.match(
    checkStandalone(dir),
    /holds 5 path\(s\) the image must not ship: apps\/web\/snapshots\/github\.json, packages\/schema\/src\/__fixtures__\/invalid\/snapshot\.syntax\/snapshots\/github\.json, packages\/variant-contract\/fixtures\/hidden-canary\/snapshots\/github\.json, apps\/web\/node_modules\//,
  );
});

test("a build that lacks any of the bundled sample's files, its snapshot and media among them, fails (#7, #10)", (t) => {
  for (const missing of [
    'snapshots/github.json',
    'example-media/work/small-traces.png',
    'portfolio.example.yml',
    'site.example.yml',
  ]) {
    const dir = standaloneTree(
      t,
      SHIPPED.filter((file) => file !== missing),
    );
    assert.deepEqual(scanStandalone(dir), { problems: [], example: false }, missing);
    assert.match(
      checkStandalone(dir),
      /lacks the bundled sample the demo profile renders: portfolio\.example\.yml, site\.example\.yml, snapshots\/github\.json, and example-media\/work\/small-traces\.png\. next\.config\.ts's outputFileTracingIncludes ships them\.$/,
      missing,
    );
  }
});

test('an example document anywhere but the root fails, by name, its node_modules copies too (#7)', (t) => {
  const dir = standaloneTree(t, [
    ...SHIPPED,
    'packages/schema/src/__fixtures__/zzprobe/portfolio.example.yml',
    'packages/schema/src/__fixtures__/zzprobe/site.example.yml',
    'apps/web/site.example.yml',
    'apps/web/node_modules/@portfolio/schema/src/__fixtures__/zzprobe/portfolio.example.yml',
    'node_modules/.pnpm/node_modules/@portfolio/schema/src/__fixtures__/zzprobe/site.example.yml',
  ]);
  assert.deepEqual(scanStandalone(dir), {
    problems: [
      'apps/web/site.example.yml',
      'packages/schema/src/__fixtures__/zzprobe/portfolio.example.yml',
      'packages/schema/src/__fixtures__/zzprobe/site.example.yml',
      'apps/web/node_modules/@portfolio/schema/src/__fixtures__/zzprobe/portfolio.example.yml',
      'node_modules/.pnpm/node_modules/@portfolio/schema/src/__fixtures__/zzprobe/site.example.yml',
    ],
    example: true,
  });
  assert.match(
    checkStandalone(dir),
    /holds 5 path\(s\) the image must not ship: apps\/web\/site\.example\.yml, packages\/schema\/src\/__fixtures__\/zzprobe\/portfolio\.example\.yml, /,
  );
});

test('a long list is cut at ten names, and a missing build says so', (t) => {
  const dir = standaloneTree(
    t,
    Array.from({ length: 12 }, (_, i) => `packages/variant-contract/fixtures/f${i}/site.yml`),
  );
  assert.match(checkStandalone(dir), /, and 2 more\./);
  assert.match(
    checkStandalone(path.join(standaloneTree(t, []), 'none')),
    /No standalone build at .*Run pnpm build first\./,
  );
});

test('the check refuses what the image scan refuses in the image, and no other', (t) => {
  const dir = standaloneTree(t, [
    ...SHIPPED,
    'portfolio.yml',
    'apps/web/portfolio.json',
    'apps/web/portfolio.d/notes.txt',
    'site.yml',
    'apps/web/site.yaml',
    'apps/web/site.json',
    'apps/web/site.webmanifest',
    'apps/web/site.md',
    'apps/web/.env',
    'apps/web/.env.production',
    '.git/HEAD',
    'deploy/secrets/owner_password_hash',
    'tests/fixtures/hidden/snapshots/github.json',
    'ci/run.mjs',
    'reports/unit.json',
    'packages/variant-contract/fixtures/rtl/portfolio.yml',
    'packages/variant-contract/fixtures/rtl/site.yml',
    'packages/variant-contract/fixtures/hidden-canary/snapshots/github.json',
    'packages/kit/node_modules/@portfolio/variant-contract/fixtures/hidden-canary/snapshots/github.json',
    'node_modules/pkg/portfolio.yml',
    'node_modules/pkg/site.yml',
    'node_modules/pkg/.env',
    'node_modules/pkg/tests/index.js',
  ]);
  const scan = JSON.parse(
    execFileSync(process.execPath, ['-e', SCAN_SNIPPET, dir], { encoding: 'utf8' }),
  );
  const { problems, example } = scanStandalone(dir);
  assert.equal(scan.example, true);
  assert.equal(example, true);
  assert.deepEqual([...problems].sort(), [...scan.problems].sort());
  assert.deepEqual(problems, [
    '.git',
    'apps/web/.env',
    'apps/web/.env.production',
    'apps/web/portfolio.d',
    'apps/web/portfolio.json',
    'apps/web/site.json',
    'apps/web/site.yaml',
    'ci',
    'deploy/secrets',
    'packages/variant-contract/fixtures/hidden-canary/snapshots/github.json',
    'packages/variant-contract/fixtures/rtl/portfolio.yml',
    'packages/variant-contract/fixtures/rtl/site.yml',
    'portfolio.yml',
    'reports',
    'site.yml',
    'tests',
    'packages/kit/node_modules/@portfolio/variant-contract/fixtures/hidden-canary/snapshots/github.json',
  ]);
});

test("CI's build job checks the standalone output after its build and the source map check, and next.config.ts keeps the fixtures out", () => {
  const workflow = parseYaml(
    readFileSync(path.join(ROOT, '.github', 'workflows', 'ci.yml'), 'utf8'),
  );
  const runs = workflow.jobs.build.steps.map((step) => step.run).filter(Boolean);
  const maps = runs.indexOf('pnpm ci:source-maps');
  assert.ok(maps !== -1 && runs.indexOf('pnpm ci:build') < maps);
  assert.equal(runs[maps + 1], 'pnpm ci:standalone');
  const { scripts } = JSON.parse(readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
  assert.equal(scripts['ci:standalone'], 'node ci/run.mjs standalone -- pnpm check:standalone');
  assert.equal(scripts['check:standalone'], 'node ci/check-standalone.mjs');
  const config = readFileSync(path.join(ROOT, 'apps', 'web', 'next.config.ts'), 'utf8');
  assert.match(
    config,
    /outputFileTracingExcludes: \{\n\s+'\/\*\*': \['\.\.\/\.\.\/packages\/variant-contract\/fixtures\/\*\*'\],\n\s+\}/,
  );
});
