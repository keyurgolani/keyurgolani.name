import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse as parseYaml } from 'yaml';
import { checkStandalone, documentFiles } from './check-standalone.mjs';
import { SCAN_SNIPPET } from './lib/container.mjs';

// The build's standalone output ships no portfolio or site document but the
// bundled examples (#5, #7), since the image copies the tree whole and its
// scan refuses any other. CI's build job runs the check after its build and
// the source map check, with no container.

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
  'packages/variant-contract/src/index.ts',
  'packages/variant-contract/package.json',
  'portfolio.example.yml',
  'site.example.yml',
  'snapshots/github.json',
  'node_modules/next/package.json',
];

test('a standalone build with no document but the bundled examples passes', (t) => {
  const dir = standaloneTree(t, SHIPPED);
  assert.deepEqual(documentFiles(dir), []);
  assert.equal(checkStandalone(dir), null);
});

test("a contract fixture's documents in the standalone build fail, by name (#5, #7)", (t) => {
  const dir = standaloneTree(t, [
    ...SHIPPED,
    'packages/variant-contract/fixtures/complete/portfolio.yml',
    'packages/variant-contract/fixtures/complete/site.yml',
    'packages/variant-contract/fixtures/hidden-canary/site.yml',
  ]);
  assert.deepEqual(documentFiles(dir), [
    'packages/variant-contract/fixtures/complete/portfolio.yml',
    'packages/variant-contract/fixtures/complete/site.yml',
    'packages/variant-contract/fixtures/hidden-canary/site.yml',
  ]);
  assert.match(
    checkStandalone(dir),
    /holds 3 document\(s\) the image must not ship: packages\/variant-contract\/fixtures\/complete\/portfolio\.yml, .*hidden-canary\/site\.yml\. The image copies this tree whole, and its scan refuses any portfolio or site document but the bundled examples\. next\.config\.ts's outputFileTracingExcludes keeps packages\/variant-contract\/fixtures out of the trace\.$/,
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

test('the check refuses the documents the image scan refuses, and no other', (t) => {
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
    'packages/variant-contract/fixtures/rtl/portfolio.yml',
    'packages/variant-contract/fixtures/rtl/site.yml',
    'packages/variant-contract/fixtures/hidden-canary/snapshots/github.json',
    'node_modules/pkg/portfolio.yml',
    'node_modules/pkg/site.yml',
  ]);
  const scan = JSON.parse(
    execFileSync(process.execPath, ['-e', SCAN_SNIPPET, dir], { encoding: 'utf8' }),
  );
  assert.equal(scan.example, true);
  assert.deepEqual(documentFiles(dir), [...scan.problems].sort());
  assert.deepEqual(documentFiles(dir), [
    'apps/web/portfolio.d',
    'apps/web/portfolio.json',
    'apps/web/site.json',
    'apps/web/site.yaml',
    'packages/variant-contract/fixtures/rtl/portfolio.yml',
    'packages/variant-contract/fixtures/rtl/site.yml',
    'portfolio.yml',
    'site.yml',
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
