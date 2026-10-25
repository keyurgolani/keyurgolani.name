import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import {
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
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
      "import { ANALYZE_ENV, failureFields, reproCommand } from './lib/budgets.mjs';",
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

/**
 * A temporary static tree holding `files`, removed after the test: a list of
 * names, each empty, or an object of names and their contents.
 */
function staticTree(t, files) {
  const dir = mkdtempSync(path.join(tmpdir(), 'source-maps-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const entries = Array.isArray(files) ? files.map((file) => [file, '']) : Object.entries(files);
  for (const [file, text] of entries) {
    mkdirSync(path.dirname(path.join(dir, file)), { recursive: true });
    writeFileSync(path.join(dir, file), text);
  }
  return dir;
}

/** The map Turbopack in Next 16.4.1 writes beside a new URL module worker's bundle, as it writes it. */
const WORKER_MAP = '{\n  "version": 3,\n  "sources": [],\n  "sections": []\n}';

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
    maps: ['chunks/a.js.map', 'css/b.css.map'],
    empty: [],
    linked: [],
    symlinks: [],
  });
  const clean = staticTree(t, ['chunks/a.js']);
  assert.deepEqual(mapsInside(clean), {
    exists: true,
    maps: [],
    empty: [],
    linked: [],
    symlinks: [],
  });
  assert.deepEqual(mapsInside(path.join(clean, 'none')), {
    exists: false,
    maps: [],
    empty: [],
    linked: [],
    symlinks: [],
  });
});

test('an empty map, as Turbopack writes for a new URL module worker, passes, in both checks, and only under the static tree', (t) => {
  for (const text of [WORKER_MAP, '{"version":3,"sources":[],"sections":[]}', '{"version":3}']) {
    const dir = staticTree(t, { 'chunks/a.js': 'a()', 'chunks/2z3sh82dl8glu.js.map': text });
    assert.equal(checkSourceMaps(dir, {}), null, text);
    assert.deepEqual(mapsInside(dir), {
      exists: true,
      maps: [],
      empty: ['chunks/2z3sh82dl8glu.js.map'],
      linked: [],
      symlinks: [],
    });
  }
  // public/ stays strict: no .map of any kind, an empty one included.
  const built = staticTree(t, ['chunks/a.js']);
  const served = staticTree(t, { 'vendor/x.js.map': WORKER_MAP });
  assert.match(
    checkSourceMaps(built, {}, served),
    /holds 1 source map file\(s\): vendor\/x\.js\.map/,
  );
  assert.deepEqual(mapsInside(served).empty, ['vendor/x.js.map'], 'which the image smoke fails');
});

test('a map that holds anything of a source fails, in both checks, as does one that is not a map', (t) => {
  const nested = (map) =>
    JSON.stringify({ version: 3, sections: [{ offset: { line: 0, column: 0 }, map }] });
  for (const [what, text] of [
    ['one source', '{"version":3,"sources":["a.ts"],"mappings":""}'],
    ['sourcesContent', '{"version":3,"sources":[],"sourcesContent":[]}'],
    ['mappings', '{"version":3,"sources":[],"mappings":"AAAA"}'],
    ['names', '{"version":3,"sources":[],"names":["x"]}'],
    ['a nested section with a source', nested({ version: 3, sources: ['a.ts'] })],
    ['a nested section with mappings', nested({ version: 3, mappings: ';;AAAA' })],
    ['a section with no map', JSON.stringify({ version: 3, sections: [{ offset: {} }] })],
    ['sections that are not a list', '{"version":3,"sections":{}}'],
    ['version 2', '{"version":2,"sources":[]}'],
    ['a list', '[]'],
    ['null', 'null'],
    ['no JSON at all', '{'],
  ]) {
    const dir = staticTree(t, { 'chunks/a.js': 'a()', 'chunks/a.js.map': text });
    assert.match(
      checkSourceMaps(dir, {}) ?? '',
      /shipped 1 source map file\(s\) under .*: chunks\/a\.js\.map\./,
      what,
    );
    assert.deepEqual(mapsInside(dir).maps, ['chunks/a.js.map'], what);
  }
  // An empty map beside it doesn't hide it.
  const both = staticTree(t, {
    'chunks/a.js.map': '{"version":3,"sources":["a.ts"]}',
    'chunks/b.js.map': WORKER_MAP,
  });
  assert.match(
    checkSourceMaps(both, {}),
    /shipped 1 source map file\(s\) under .*: chunks\/a\.js\.map\./,
  );
});

test("a shipped script or stylesheet that points at a map fails, in both checks, and a string that only mentions one, as postcss's does, doesn't", (t) => {
  const dir = staticTree(t, {
    'chunks/a.js': 'a();\n//# sourceMappingURL=a.js.map',
    'css/b.css': 'b{}\n/*# sourceMappingURL=b.css.map */',
    'chunks/c.mjs': 'c();\n  //@ sourceMappingURL=c.mjs.map',
    'chunks/2irfnzd7tc7gz.js':
      'let e,t="/*# sourceMappingURL=",r="";this.css+=t+"/*# sourceMappingURL="+e+" */";',
    'chunks/2z3sh82dl8glu.js.map': WORKER_MAP,
  });
  assert.match(
    checkSourceMaps(dir, {}),
    /chunks\/a\.js, chunks\/c\.mjs, css\/b\.css point at a source map with a sourceMappingURL comment\. No default build may\./,
  );
  assert.deepEqual(mapsInside(dir).linked, ['chunks/a.js', 'chunks/c.mjs', 'css/b.css']);
  const mentions = staticTree(t, {
    'chunks/2irfnzd7tc7gz.js':
      'let e,t="/*# sourceMappingURL=",r="";this.css+=t+"/*# sourceMappingURL="+e+" */";',
    'chunks/2z3sh82dl8glu.js.map': WORKER_MAP,
  });
  assert.equal(checkSourceMaps(mentions, {}), null);
  assert.deepEqual(mapsInside(mentions).linked, []);
});

test("a comment that names a map on a file's last line, after a statement's end, a block's, or a space, fails, in both checks, and the post-pass chunk's mid-line strings still pass", (t) => {
  const trailing = {
    'chunks/a.js': 'a();//# sourceMappingURL=a.js.map',
    'chunks/b.js': 'b()\n}//@ sourceMappingURL=b.js.map\n',
    'chunks/c.js': 'c(); /*# sourceMappingURL=c.js.map */\n\n',
    'css/d.css': 'd{color:red}/*# sourceMappingURL=d.css.map */',
  };
  const dir = staticTree(t, trailing);
  assert.match(
    checkSourceMaps(dir, {}) ?? '',
    /chunks\/a\.js, chunks\/b\.js, chunks\/c\.js, css\/d\.css point at a source map/,
  );
  assert.deepEqual(mapsInside(dir).linked, Object.keys(trailing));
  // The post-pass chunk is one line, so its last: each mention follows a quote, so neither is one.
  const chunk = 'let e,t="/*# sourceMappingURL=",r="";this.css+=t+"/*# sourceMappingURL="+e+" */";';
  // Above the last line, a mention after a space is only a mention: the rule reads the last alone.
  const above = 'x(e+" /*# sourceMappingURL="+t);\ny();';
  for (const text of [chunk, `${chunk}\n`, `x();\n${chunk}`, above]) {
    const mentions = staticTree(t, { 'chunks/2irfnzd7tc7gz.js': text });
    assert.equal(checkSourceMaps(mentions, {}), null, text);
    assert.deepEqual(mapsInside(mentions).linked, [], text);
  }
});

test('a symlink anywhere under the static tree fails, in both checks, whatever it points at', (t) => {
  const outside = staticTree(t, { 'a.js.map': '{"version":3,"sources":["a.ts"]}', 'b.js': 'b()' });
  const dir = staticTree(t, { 'chunks/a.js': 'a()' });
  mkdirSync(path.join(dir, 'media'));
  // A map, a script, a directory, and a link to nothing.
  symlinkSync(path.join(outside, 'a.js.map'), path.join(dir, 'chunks', 'a.js.map'));
  symlinkSync(path.join(outside, 'b.js'), path.join(dir, 'chunks', 'b.js'));
  symlinkSync(outside, path.join(dir, 'media', 'all'));
  symlinkSync(path.join(outside, 'none'), path.join(dir, 'gone'));
  assert.match(
    checkSourceMaps(dir, {}) ?? '',
    /chunks\/a\.js\.map, chunks\/b\.js, gone, media\/all are symlinks, which the check doesn't follow\. No default build may hold one\./,
  );
  assert.deepEqual(mapsInside(dir), {
    exists: true,
    maps: [],
    empty: [],
    linked: [],
    symlinks: ['chunks/a.js.map', 'chunks/b.js', 'gone', 'media/all'],
  });
  const one = staticTree(t, { 'chunks/a.js': 'a()' });
  symlinkSync(path.join(one, 'chunks', 'a.js'), path.join(one, 'chunks', 'b.js'));
  assert.match(checkSourceMaps(one, {}) ?? '', /chunks\/b\.js is a symlink/);
  assert.deepEqual(mapsInside(one).symlinks, ['chunks/b.js']);
});

test('the image smoke fails an image with a source map in its static tree or public/, or no static tree (CI only: it needs Docker)', () => {
  const smoke = readFileSync(path.join(ROOT, 'ci', 'image-smoke.mjs'), 'utf8');
  assert.match(smoke, /const IMAGE_STATIC = '\/app\/apps\/web\/\.next\/static';/);
  assert.match(smoke, /const IMAGE_PUBLIC = '\/app\/apps\/web\/public';/);
  assert.match(smoke, /for \(const root of \[IMAGE_STATIC, IMAGE_PUBLIC\]\) \{/);
  assert.match(smoke, /container\(\['exec', name, 'node', '-e', MAPS_SNIPPET, root\]\)/);
  // An empty map passes under the static tree alone; public/ holds none, and nothing points at one.
  assert.match(
    smoke,
    /const shipped = \[\.\.\.\(maps\.maps \?\? \[\]\), \.\.\.\(root === IMAGE_PUBLIC \? \(maps\.empty \?\? \[\]\) : \[\]\)\];/,
  );
  assert.match(smoke, /const linked = maps\.linked \?\? \[\];/);
  // A symlink fails under the static tree, as check:source-maps fails one.
  assert.match(
    smoke,
    /const symlinks = root === IMAGE_STATIC \? \(maps\.symlinks \?\? \[\]\) : \[\];/,
  );
  assert.match(smoke, /const found = \[\.\.\.shipped, \.\.\.linked, \.\.\.symlinks\];/);
  assert.match(
    smoke,
    /if \(\(root === IMAGE_STATIC && maps\.exists !== true\) \|\| found\.length > 0\) \{\n\s+throw new SmokeFailure\(/,
  );
});
