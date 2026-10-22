import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse as parseYaml } from 'yaml';
import { checkSourceMaps, sourceMapFiles } from './check-source-maps.mjs';

// Browser source maps ship only from a build that asks for them (#6, Slice
// 1): next.config.ts turns productionBrowserSourceMaps on for
// PORTFOLIO_ANALYZE=1 (apps/web/src/next-config.test.ts), for pnpm
// test:trace. Nothing that builds or runs the image, no workflow, no build
// script, and no committed env file may set or pass the variable, and CI's
// build job checks that its default build left no .map file behind. A CI
// job that traces an analyze build (#6, Slice 3) changes this test on
// purpose, for that job alone.

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const NAME = /PORTFOLIO_ANALYZE/;

/** Committed files, by the patterns git matches, relative to the root. */
function tracked(...patterns) {
  const run = spawnSync('git', ['ls-files', '-z', '--', ...patterns], {
    cwd: ROOT,
    encoding: 'utf8',
  });
  assert.equal(run.status, 0, run.stderr);
  return run.stdout.split('\0').filter(Boolean);
}

/**
 * The files that build, run, or configure the image, and everything CI
 * runs: every workflow, and every script under ci/ but its tests and this
 * check's own script, which names the variable to refuse it.
 */
function imageAndCiFiles() {
  const workflows = readdirSync(path.join(ROOT, '.github', 'workflows'))
    .filter((name) => /\.ya?ml$/.test(name))
    .map((name) => path.join('.github', 'workflows', name));
  const compose = readdirSync(path.join(ROOT, 'deploy'))
    .filter((name) => /\.ya?ml$/.test(name))
    .map((name) => path.join('deploy', name));
  const scripts = readdirSync(path.join(ROOT, 'ci'), { recursive: true })
    .map(String)
    .filter((name) => /\.m?js$/.test(name) && !/\.test\.m?js$/.test(name))
    .filter((name) => name !== 'check-source-maps.mjs')
    .map((name) => path.join('ci', name));
  return [
    'Dockerfile',
    '.dockerignore',
    'docker-compose.yml',
    ...compose,
    ...workflows,
    ...scripts,
  ];
}

test('nothing that builds the image or runs in CI sets or passes PORTFOLIO_ANALYZE', () => {
  const files = imageAndCiFiles();
  for (const expected of ['ci.yml', 'image-smoke.mjs', 'container.mjs']) {
    assert.ok(
      files.some((file) => path.basename(file) === expected),
      `${expected} is checked`,
    );
  }
  for (const file of files) {
    const text = readFileSync(path.join(ROOT, file), 'utf8');
    assert.doesNotMatch(text, NAME, file);
  }
});

test('no build script and no committed env file sets PORTFOLIO_ANALYZE', () => {
  for (const file of ['package.json', 'apps/web/package.json']) {
    const { scripts } = JSON.parse(readFileSync(path.join(ROOT, file), 'utf8'));
    for (const [name, command] of Object.entries(scripts)) {
      assert.doesNotMatch(command, NAME, `${file} scripts.${name}`);
    }
  }
  const envFiles = tracked(':(glob)**/.env', ':(glob)**/.env.*');
  for (const file of envFiles) {
    assert.doesNotMatch(readFileSync(path.join(ROOT, file), 'utf8'), NAME, file);
  }
});

test("CI's build job checks for source maps right after its default build", () => {
  const workflow = parseYaml(
    readFileSync(path.join(ROOT, '.github', 'workflows', 'ci.yml'), 'utf8'),
  );
  const runs = workflow.jobs.build.steps.map((step) => step.run).filter(Boolean);
  const build = runs.indexOf('pnpm ci:build');
  assert.notEqual(build, -1, 'the build job runs pnpm ci:build');
  assert.equal(runs[build + 1], 'pnpm ci:source-maps');
  const { scripts } = JSON.parse(readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
  assert.equal(scripts['ci:source-maps'], 'node ci/run.mjs source-maps -- pnpm check:source-maps');
  assert.equal(scripts['check:source-maps'], 'node ci/check-source-maps.mjs');
});

/** A temporary static tree holding `files`, removed after the test. */
function staticTree(t, files) {
  const dir = mkdtempSync(path.join(tmpdir(), 'source-maps-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  for (const file of files) {
    mkdirSync(path.dirname(path.join(dir, file)), { recursive: true });
    writeFileSync(path.join(dir, file), '');
  }
  return dir;
}

test('a build with no .map file passes', (t) => {
  const dir = staticTree(t, ['chunks/a.js', 'chunks/b.css', 'media/font.woff2', 'map/index.js']);
  assert.deepEqual(sourceMapFiles(dir), []);
  assert.equal(checkSourceMaps(dir, {}), null);
});

test('a .map file anywhere under the static tree fails, by name', (t) => {
  const dir = staticTree(t, ['chunks/a.js', 'chunks/a.js.map', 'css/b.css.map', 'chunks/x/y.map']);
  assert.deepEqual(sourceMapFiles(dir), ['chunks/a.js.map', 'chunks/x/y.map', 'css/b.css.map']);
  assert.match(
    checkSourceMaps(dir, {}),
    /shipped 3 source map file\(s\) under .*: chunks\/a\.js\.map, chunks\/x\/y\.map, css\/b\.css\.map\. Only a PORTFOLIO_ANALYZE=1 build may\./,
  );
});

test('a long list is cut at ten names', (t) => {
  const dir = staticTree(
    t,
    Array.from({ length: 12 }, (_, i) => `chunks/${String(i).padStart(2, '0')}.js.map`),
  );
  assert.match(checkSourceMaps(dir, {}), /chunks\/09\.js\.map, and 2 more\./);
});

test('the check refuses an analyze build and a missing one', (t) => {
  const dir = staticTree(t, ['chunks/a.js']);
  assert.match(checkSourceMaps(dir, { PORTFOLIO_ANALYZE: '1' }), /for the default build/);
  assert.match(checkSourceMaps(path.join(dir, 'none'), {}), /No build at .*Run pnpm build first\./);
});
