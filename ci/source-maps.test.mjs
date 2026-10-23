import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse as parseYaml } from 'yaml';
import { checkSourceMaps, sourceMapFiles } from './check-source-maps.mjs';
import { MAPS_SNIPPET } from './lib/container.mjs';

// Browser source maps ship only from a build that asks for them (#6, Slice
// 1): next.config.ts turns productionBrowserSourceMaps on for
// PORTFOLIO_ANALYZE=1 (apps/web/src/next-config.test.ts), for pnpm
// test:trace. Nothing that builds or runs the image, no workflow, no build
// script, and no committed env file may set or pass the variable, and CI's
// build job checks that its default build left no .map file behind. The
// one exception is CI's trace job (#6, items 3 and 4), whose trace needs
// the maps: ci/lib/budgets.mjs names the variable once, in ANALYZE_ENV, and
// only ci/budgets.mjs passes that, to its own two builds, in a job no image,
// other job, or upload takes a build from.

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const NAME = /PORTFOLIO_ANALYZE/;
/** The scripts that name it on purpose: this check's, to refuse it, and the trace job's, once. */
const EXEMPT = [path.join('ci', 'check-source-maps.mjs'), path.join('ci', 'lib', 'budgets.mjs')];

/** Committed files, by the patterns git matches, relative to the root. */
function tracked(...patterns) {
  const run = spawnSync('git', ['ls-files', '-z', '--', ...patterns], {
    cwd: ROOT,
    encoding: 'utf8',
  });
  assert.equal(run.status, 0, run.stderr);
  return run.stdout.split('\0').filter(Boolean);
}

/** Every file under `dir`, at any depth, relative to the root. */
function everyFile(dir) {
  return readdirSync(path.join(ROOT, dir), { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => path.relative(ROOT, path.join(entry.parentPath, entry.name)));
}

/**
 * The files that build, run, or configure the image, and everything CI
 * runs: every committed file in .github/ and deploy/, at any depth (a local
 * deploy/secrets/ is never committed, so never read), and every script
 * under ci/ but its tests and this check's own script, which names the
 * variable to refuse it.
 */
function imageAndCiFiles() {
  const scripts = everyFile('ci')
    .filter((name) => /\.m?js$/.test(name) && !/\.test\.m?js$/.test(name))
    .filter((name) => !EXEMPT.includes(name));
  return [
    'Dockerfile',
    '.dockerignore',
    'docker-compose.yml',
    ...tracked('.github', 'deploy'),
    ...scripts,
  ];
}

test('nothing that builds the image or runs in CI sets or passes PORTFOLIO_ANALYZE', () => {
  const files = imageAndCiFiles();
  for (const expected of [
    path.join('.github', 'workflows', 'ci.yml'),
    path.join('deploy', 'compose.owner.yml'),
    path.join('ci', 'image-smoke.mjs'),
    path.join('ci', 'lib', 'container.mjs'),
  ]) {
    assert.ok(files.includes(expected), `${expected} is checked`);
  }
  assert.ok(
    files.some((file) => file.startsWith(`.github${path.sep}`) && !file.includes('workflows')),
    'all of .github is checked, not only its workflows',
  );
  for (const file of files) {
    const text = readFileSync(path.join(ROOT, file), 'utf8');
    assert.doesNotMatch(text, NAME, file);
  }
});

test("only CI's trace job builds with PORTFOLIO_ANALYZE, and nothing it builds leaves its runner", () => {
  const lib = readFileSync(path.join(ROOT, 'ci', 'lib', 'budgets.mjs'), 'utf8');
  assert.deepEqual(
    lib.split('\n').filter((line) => NAME.test(line)),
    ["export const ANALYZE_ENV = Object.freeze({ PORTFOLIO_ANALYZE: '1' });"],
  );
  // ANALYZE_ENV goes into one environment in all of ci/: the trace job's builds.
  const users = everyFile('ci')
    .filter((name) => /\.m?js$/.test(name) && !/\.test\.m?js$/.test(name))
    .filter((name) => /\bANALYZE_ENV\b/.test(readFileSync(path.join(ROOT, name), 'utf8')));
  assert.deepEqual(users.sort(), [
    path.join('ci', 'budgets.mjs'),
    path.join('ci', 'lib', 'budgets.mjs'),
  ]);
  const job = readFileSync(path.join(ROOT, 'ci', 'budgets.mjs'), 'utf8');
  assert.deepEqual(
    job
      .match(/.*\bANALYZE_ENV\b.*/g)
      .map((line) => line.trim())
      .filter((line) => !line.startsWith('//')),
    [
      "import { ANALYZE_ENV } from './lib/budgets.mjs';",
      'envWith({ BUDGET_FIXTURES: fixtures, ...ANALYZE_ENV }),',
    ],
  );
  assert.match(
    job,
    /'pnpm',\n\s+\['build'\],\n\s+envWith\(\{ BUDGET_FIXTURES: fixtures, \.\.\.ANALYZE_ENV \}\),/,
  );
  assert.match(job, /sourceMapFiles\(PUBLIC_DIR\)/, 'it checks public/ after each build');

  const { scripts } = JSON.parse(readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
  assert.equal(scripts['ci:budgets'], 'node ci/run.mjs budgets -- node ci/budgets.mjs');
  const workflow = parseYaml(
    readFileSync(path.join(ROOT, '.github', 'workflows', 'ci.yml'), 'utf8'),
  );
  const runners = Object.entries(workflow.jobs).filter(([, job]) =>
    (job.steps ?? []).some((step) => /\bci:budgets\b/.test(step.run ?? '')),
  );
  assert.deepEqual(
    runners.map(([name]) => name),
    ['trace'],
  );
  // Nothing takes a build from it: only gate and selected wait on it, for its verdict.
  for (const [name, job] of Object.entries(workflow.jobs)) {
    const needs = [job.needs ?? []].flat();
    if (!['gate', 'selected'].includes(name)) {
      assert.ok(!needs.includes('trace'), `${name} needs nothing of trace`);
    }
  }
  const budgets = workflow.jobs.trace;
  assert.equal(budgets.outputs, undefined, 'it hands no job an output');
  const uploads = budgets.steps.filter((step) => /upload-artifact/.test(step.uses ?? ''));
  assert.equal(uploads.length, 2);
  for (const step of budgets.steps) {
    assert.doesNotMatch(step.uses ?? '', /docker|cache/, 'it builds no image and caches nothing');
    assert.doesNotMatch(step.run ?? '', /docker|ci:image|ci:build/);
  }
  for (const step of uploads) {
    const paths = step.with.path
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean);
    assert.ok(paths.includes('!reports/**/*.map'), `${step.name} leaves source maps out`);
    for (const entry of paths.filter((line) => !line.startsWith('!'))) {
      assert.match(entry, /^reports\//, `${step.name} uploads only reports: ${entry}`);
      assert.doesNotMatch(entry, /\.next|\.map|apps\//, `${step.name}: ${entry}`);
    }
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

test('a .map file in public/, which the server serves at the site root, fails too', (t) => {
  const built = staticTree(t, ['chunks/a.js']);
  const served = staticTree(t, ['.gitkeep', 'img/logo.png', 'vendor/x.js', 'vendor/x.js.map']);
  assert.match(
    checkSourceMaps(built, {}, served),
    /^.*, which the server serves at the site root and the image ships, holds 1 source map file\(s\): vendor\/x\.js\.map\. No build may put one there\.$/,
  );
  const both = staticTree(t, ['chunks/a.js.map']);
  assert.match(
    checkSourceMaps(both, {}, served),
    /shipped 1 source map file\(s\) under .*: chunks\/a\.js\.map\. Only a PORTFOLIO_ANALYZE=1 build may\. .*holds 1 source map file\(s\): vendor\/x\.js\.map\./,
  );
  const clean = staticTree(t, ['.gitkeep', 'img/logo.png']);
  assert.equal(checkSourceMaps(built, {}, clean), null);
  assert.equal(checkSourceMaps(built, {}, path.join(clean, 'none')), null, 'no public/ holds none');
});

/** MAPS_SNIPPET's answer for `dir`, run as the image smoke runs it inside the container. */
function mapsInside(dir) {
  const run = spawnSync(process.execPath, ['-e', MAPS_SNIPPET, dir], { encoding: 'utf8' });
  assert.equal(run.status, 0, run.stderr);
  return JSON.parse(run.stdout);
}

test("the image smoke's scan finds every .map under the image's static tree", (t) => {
  const dir = staticTree(t, ['chunks/a.js', 'chunks/a.js.map', 'css/b.css.map', 'media/f.woff2']);
  assert.deepEqual(mapsInside(dir), {
    exists: true,
    count: 2,
    maps: ['chunks/a.js.map', 'css/b.css.map'],
  });
  const clean = staticTree(t, ['chunks/a.js']);
  assert.deepEqual(mapsInside(clean), { exists: true, count: 0, maps: [] });
  assert.deepEqual(mapsInside(path.join(clean, 'none')), { exists: false, count: 0, maps: [] });
});

test('the image smoke fails an image with a source map in its static tree or public/, or no static tree (CI only: it needs Docker)', () => {
  const smoke = readFileSync(path.join(ROOT, 'ci', 'image-smoke.mjs'), 'utf8');
  assert.match(smoke, /const IMAGE_STATIC = '\/app\/apps\/web\/\.next\/static';/);
  assert.match(smoke, /const IMAGE_PUBLIC = '\/app\/apps\/web\/public';/);
  assert.match(smoke, /for \(const root of \[IMAGE_STATIC, IMAGE_PUBLIC\]\) \{/);
  assert.match(smoke, /container\(\['exec', name, 'node', '-e', MAPS_SNIPPET, root\]\)/);
  assert.match(
    smoke,
    /if \(\(root === IMAGE_STATIC && maps\.exists !== true\) \|\| maps\.count !== 0\) \{\n\s+throw new SmokeFailure\(/,
  );
});
