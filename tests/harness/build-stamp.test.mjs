import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  BUILD_INPUTS,
  BUILD_STAMP,
  buildInputFiles,
  writeBuildInputs,
  writeBuildStamp,
} from '../../apps/web/scripts/build-stamp.mjs';
import { buildProblem, runAppToExit } from './app-server.mjs';

// The build's stamp (the distinct guard's hang, 2026-10-26; the lows review's
// A-H1 and A-M1): the harness refuses a standalone build that's stale against
// what the tests read, at the first start and in about a second, instead of
// serving it for minutes. The stamp is of the inputs' content, never of git.

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

/** Writes `text` at `file` under `root`, making its directories. */
function put(root, file, text) {
  mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
  writeFileSync(path.join(root, file), text);
}

/**
 * A checkout, outside git unless `git` is set: a root with its inputs and an apps/web with a
 * standalone build and a registry, and `stamp()`, which lists its inputs as prebuild does and
 * stamps it as postbuild does, with no edit between.
 */
function builtWeb(t, { git = false } = {}) {
  const root = mkdtempSync(path.join(tmpdir(), 'portfolio-stamp-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  put(root, 'package.json', '{"name":"portfolio-monorepo"}\n');
  put(root, 'pnpm-lock.yaml', "lockfileVersion: '9.0'\n");
  put(root, 'tsconfig.base.json', '{}\n');
  put(root, 'snapshots/s.json', '{}\n');
  put(root, 'README.md', '# Portfolio\n');
  put(root, 'packages/kit/package.json', '{"name":"@portfolio/kit"}\n');
  put(root, 'packages/kit/src/index.ts', 'export const kit = 1;\n');
  put(root, 'apps/web/package.json', '{"name":"@portfolio/web"}\n');
  put(root, 'apps/web/src/lib/generated/registry.meta.ts', 'export const A = 1;\n');
  if (git) {
    const run = (...args) => {
      const result = spawnSync('git', ['-C', root, ...args], { encoding: 'utf8' });
      assert.equal(result.status, 0, result.stderr);
    };
    put(root, '.gitignore', '.next/\nnode_modules/\n');
    run('init', '-q');
    run('add', '-A');
    run('-c', 'user.name=t', '-c', 'user.email=t@example.test', 'commit', '-qm', 'base');
  }
  const web = path.join(root, 'apps', 'web');
  put(web, '.next/standalone/apps/web/server.js', 'process.exit(0);\n');
  const warnings = [];
  const postbuild = () =>
    writeBuildStamp(web, new Date('2026-10-26T12:00:00Z'), {
      warn: (message) => warnings.push(message),
    });
  const stamp = () => {
    writeBuildInputs(web);
    return postbuild();
  };
  return { web, root, stamp, postbuild, warnings };
}

/** A built and stamped checkout. */
function stamped(t, options) {
  const built = builtWeb(t, options);
  built.stamp();
  return built;
}

const stampOf = (web) => JSON.parse(readFileSync(path.join(web, BUILD_STAMP), 'utf8'));
const env = {};
const hasGit = spawnSync('git', ['--version']).status === 0;

test("a matching stamp passes: it holds each input's hash, the registry's, and when it was built", (t) => {
  const { web } = stamped(t);
  const stamp = stampOf(web);
  assert.match(stamp.inputs, /^[0-9a-f]{64}$/);
  assert.match(stamp.registry, /^[0-9a-f]{64}$/);
  assert.equal(stamp.builtAt, '2026-10-26T12:00:00.000Z');
  assert.deepEqual(Object.keys(stamp.files), [
    'apps/web/package.json',
    'apps/web/src/lib/generated/registry.meta.ts',
    'package.json',
    'packages/kit/package.json',
    'packages/kit/src/index.ts',
    'pnpm-lock.yaml',
    'snapshots/s.json',
    'tsconfig.base.json',
  ]);
  assert.equal(buildProblem(web, { env }), null);
});

test('a stamp whose registry is not the one the tests read fails fast', async (t) => {
  const { web } = stamped(t);
  put(web, 'src/lib/generated/registry.meta.ts', 'export const A = 2;\n');
  assert.match(
    buildProblem(web, { env }) ?? '',
    /is stale: it served another registry.*run pnpm build/,
  );
  // At a start, before any server runs.
  const started = Date.now();
  await assert.rejects(runAppToExit({ env: {}, web }), /is stale/);
  assert.ok(Date.now() - started < 5000, `${Date.now() - started} ms`);
});

test('a changed input fails fast, naming it, under apps/web, packages, or the root files and directories (A-M1)', async (t) => {
  for (const [file, text, named] of [
    ['apps/web/package.json', '{"name":"@portfolio/web","x":1}\n', 'apps/web/package.json'],
    ['packages/kit/src/index.ts', 'export const kit = 2;\n', 'packages/kit/src/index.ts'],
    ['packages/kit/src/new.ts', 'export {};\n', 'packages/kit/src/new.ts (new)'],
    ['snapshots/s.json', '{"a":1}\n', 'snapshots/s.json'],
    ['tsconfig.base.json', '{"compilerOptions":{}}\n', 'tsconfig.base.json'],
    ['pnpm-lock.yaml', "lockfileVersion: '9.1'\n", 'pnpm-lock.yaml'],
  ]) {
    const { web, root } = stamped(t);
    put(root, file, text);
    const problem = buildProblem(web, { env }) ?? '';
    assert.match(
      problem,
      /is stale: its inputs changed since it was built \(.*\); run pnpm build/,
      file,
    );
    assert.ok(problem.includes(named), `${file}: ${problem}`);
  }
  const { web, root } = stamped(t);
  rmSync(path.join(root, 'packages/kit/src/index.ts'));
  assert.match(buildProblem(web, { env }) ?? '', /packages\/kit\/src\/index\.ts \(gone\)/);
  // A start says so before any server runs.
  put(root, 'packages/kit/src/index.ts', 'export const kit = 3;\n');
  const started = Date.now();
  await assert.rejects(runAppToExit({ env: {}, web }), /its inputs changed/);
  assert.ok(Date.now() - started < 5000, `${Date.now() - started} ms`);
});

test('a change outside the inputs passes: docs, tests, build output, installs, caches, and type-check state', (t) => {
  const { web, root } = stamped(t);
  for (const file of [
    'README.md',
    'docs/notes.md',
    'tests/e2e/a.spec.ts',
    'packages/kit/src/index.test.ts',
    'packages/kit/test/fixture.css',
    'packages/kit/node_modules/x/index.js',
    'packages/kit/tsconfig.tsbuildinfo',
    'apps/web/next-env.d.ts',
    'apps/web/.cache/images/a',
    'apps/web/.next/cache/b',
    'apps/web/test-results/c.txt',
  ]) {
    put(root, file, `${file}\n`);
  }
  assert.equal(buildProblem(web, { env }), null);
});

test(
  'a fresh build of a dirty tree passes, and a later edit to an untracked input fails (A-H1, real git)',
  { skip: !hasGit },
  (t) => {
    const { web, root, stamp } = builtWeb(t, { git: true });
    // What the external-variant host does before it builds: an uncommitted dependency, and a
    // new file git doesn't track yet.
    put(root, 'apps/web/package.json', '{"name":"@portfolio/web","dependencies":{"acme":"1"}}\n');
    put(root, 'pnpm-lock.yaml', "lockfileVersion: '9.0'\n# acme\n");
    put(root, 'packages/kit/src/untracked.ts', 'export const u = 1;\n');
    stamp();
    assert.equal(buildProblem(web, { env }), null);
    // git's view of the tree doesn't matter: a commit of the same content passes too.
    spawnSync('git', ['-C', root, 'add', '-A']);
    spawnSync('git', [
      '-C',
      root,
      '-c',
      'user.name=t',
      '-c',
      'user.email=t@example.test',
      'commit',
      '-qm',
      'x',
    ]);
    assert.equal(buildProblem(web, { env }), null);
    put(root, 'packages/kit/src/later.ts', 'export const l = 1;\n');
    assert.match(buildProblem(web, { env }) ?? '', /packages\/kit\/src\/later\.ts \(new\)/);
  },
);

test('an input saved while the build ran: postbuild refuses to stamp, naming it, and the build stays unstamped (B-L1)', (t) => {
  for (const [edit, named] of [
    [
      (root) => put(root, 'packages/kit/src/index.ts', 'export const kit = 2;\n'),
      'packages/kit/src/index.ts',
    ],
    [
      (root) => put(root, 'packages/kit/src/saved.ts', 'export {};\n'),
      'packages/kit/src/saved.ts (new)',
    ],
    [(root) => rmSync(path.join(root, 'snapshots/s.json')), 'snapshots/s.json (gone)'],
  ]) {
    const { web, root, postbuild } = builtWeb(t);
    // prebuild lists the inputs, `next build` reads them, and the developer saves an edit.
    writeBuildInputs(web);
    edit(root);
    assert.throws(postbuild, (error) => {
      assert.match(error.message, /refusing to stamp: inputs changed while the build ran \(.*\)/);
      assert.ok(error.message.includes(named), error.message);
      return true;
    });
    assert.equal(existsSync(path.join(web, BUILD_STAMP)), false);
    assert.match(buildProblem(web, { env }) ?? '', /it has no .*portfolio-build\.json/);
  }
  // The registry build:registry wrote before the listing is an input like any other.
  const { web, postbuild } = builtWeb(t);
  writeBuildInputs(web);
  put(web, 'src/lib/generated/registry.meta.ts', 'export const A = 2;\n');
  assert.throws(postbuild, /apps\/web\/src\/lib\/generated\/registry\.meta\.ts/);
  // With no listing from prebuild, postbuild can't tell, so it refuses too.
  const bare = builtWeb(t);
  assert.ok(!existsSync(path.join(bare.web, BUILD_INPUTS)));
  assert.throws(bare.postbuild, /refusing to stamp: there's no .*portfolio-build-inputs\.json/);
  assert.equal(existsSync(path.join(bare.web, BUILD_STAMP)), false);
});

test("the walk follows a link the build reads through, and names one it can't follow (B-L2)", (t) => {
  const { web, root, stamp, warnings } = builtWeb(t);
  put(root, 'packages/shared/src/s.ts', 'export const s = 1;\n');
  put(root, 'packages/kit/src/a.ts', 'export const a = 1;\n');
  // A linked file and a linked directory inside the checkout, as a bundler reads them.
  symlinkSync('a.ts', path.join(root, 'packages/kit/src/linked.ts'));
  symlinkSync('../../shared/src', path.join(root, 'packages/kit/src/shared'));
  // A link that dangles, one out of the checkout, and one back to a directory it sits in.
  symlinkSync('missing.ts', path.join(root, 'packages/kit/src/dangling.ts'));
  const outside = mkdtempSync(path.join(tmpdir(), 'portfolio-outside-'));
  t.after(() => rmSync(outside, { recursive: true, force: true }));
  put(outside, 'o.ts', 'export {};\n');
  symlinkSync(outside, path.join(root, 'packages/kit/src/outside'));
  symlinkSync('..', path.join(root, 'packages/kit/src/loop'));
  stamp();
  const files = stampOf(web).files;
  assert.equal(files['packages/kit/src/linked.ts'], files['packages/kit/src/a.ts']);
  assert.ok('packages/kit/src/shared/s.ts' in files, Object.keys(files).join('\n'));
  for (const [link, why] of [
    ['packages/kit/src/dangling.ts', 'it dangles'],
    ['packages/kit/src/outside', 'it leads out of the checkout'],
    ['packages/kit/src/loop', 'it loops back to a directory it sits in'],
  ]) {
    assert.ok(link in files, link);
    assert.ok(
      warnings.some((warning) => warning.startsWith(`${link} -> `) && warning.includes(why)),
      `${link}: ${warnings.join('\n')}`,
    );
  }
  assert.ok(!Object.keys(files).some((file) => file.startsWith('packages/kit/src/outside/')));
  assert.equal(warnings.length, 3, warnings.join('\n'));
  assert.equal(buildProblem(web, { env }), null);
  // An edit through a linked file or directory is an edit to an input, and so is a re-pointed link.
  put(root, 'packages/shared/src/s.ts', 'export const s = 2;\n');
  assert.match(buildProblem(web, { env }) ?? '', /packages\/kit\/src\/shared\/s\.ts/);
  stamp();
  rmSync(path.join(root, 'packages/kit/src/dangling.ts'));
  symlinkSync('other.ts', path.join(root, 'packages/kit/src/dangling.ts'));
  assert.match(buildProblem(web, { env }) ?? '', /packages\/kit\/src\/dangling\.ts/);
});

test("a test or reports directory is skipped beside a package's package.json alone, and counts deeper (B-L2)", (t) => {
  const { web, root, stamp } = builtWeb(t);
  put(root, 'packages/kit/test/fixture.css', 'a {}\n');
  put(root, 'packages/kit/src/components/test/module.ts', 'export {};\n');
  put(web, 'src/app/(studio)/studio/reports/page.tsx', 'export default 1;\n');
  put(web, 'reports/r.json', '{}\n');
  stamp();
  const files = Object.keys(stampOf(web).files);
  assert.ok(files.includes('packages/kit/src/components/test/module.ts'), files.join('\n'));
  assert.ok(files.includes('apps/web/src/app/(studio)/studio/reports/page.tsx'), files.join('\n'));
  assert.ok(!files.some((file) => file.startsWith('packages/kit/test/')));
  assert.ok(!files.some((file) => file.startsWith('apps/web/reports/')));
});

test('a build with no stamp, or a stamp from before the content stamp, fails fast; the override passes', async (t) => {
  const { web } = builtWeb(t);
  assert.match(buildProblem(web, { env }) ?? '', /is stale: it has no .*portfolio-build\.json/);
  const started = Date.now();
  await assert.rejects(runAppToExit({ env: {}, web }), /no .*portfolio-build\.json/);
  assert.ok(Date.now() - started < 5000, `${Date.now() - started} ms`);
  // The git stamp, a commit and a registry, is no content stamp.
  put(web, BUILD_STAMP, '{"head":null,"registry":"","builtAt":"2026-10-26T12:00:00.000Z"}\n');
  assert.match(buildProblem(web, { env }) ?? '', /is stale: it has no .*portfolio-build\.json/);
  // PORTFOLIO_ALLOW_STALE_BUILD=1 is the escape hatch.
  assert.equal(buildProblem(web, { env: { PORTFOLIO_ALLOW_STALE_BUILD: '1' } }), null);
});

test('no build at all is still that message first', (t) => {
  const web = mkdtempSync(path.join(tmpdir(), 'portfolio-stamp-'));
  t.after(() => rmSync(web, { recursive: true, force: true }));
  assert.match(buildProblem(web, { env }) ?? '', /no standalone build at .*run pnpm build first/);
});

test("this checkout's inputs read in well under the harness's second, and leave out installs, build output, and tests", () => {
  const started = Date.now();
  const files = Object.keys(buildInputFiles(path.join(REPO_ROOT, 'apps', 'web')));
  const elapsed = Date.now() - started;
  assert.ok(elapsed < 3000, `${elapsed} ms`);
  assert.ok(files.includes('apps/web/package.json'));
  assert.ok(files.includes('pnpm-lock.yaml'));
  assert.ok(files.some((file) => file.startsWith('packages/kit/src/')));
  assert.ok(files.some((file) => file.startsWith('quality/')));
  assert.ok(
    !files.some((file) => /(?:^|\/)(?:node_modules|\.next|test|__tests__)\//.test(file)),
    'skipped dirs',
  );
  assert.ok(!files.some((file) => /\.(?:test|spec)\.[cm]?[jt]sx?$/.test(file)), 'test files');
});

test(
  "every tracked file under this checkout's inputs is stamped but its known tests, so a new skipped directory fails, named (B-L2)",
  { skip: !hasGit },
  () => {
    const listed = spawnSync(
      'git',
      [
        '-C',
        REPO_ROOT,
        'ls-files',
        '-z',
        '--',
        'apps/web',
        'packages',
        'snapshots',
        'example-media',
        'quality',
      ],
      { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 },
    );
    if (listed.status !== 0) return;
    const files = new Set(Object.keys(buildInputFiles(path.join(REPO_ROOT, 'apps', 'web'))));
    const known = [
      /^packages\/appearance\/test\//,
      /(?:^|\/)src\/__tests__\//,
      /\.(?:test|spec)\.[cm]?[jt]sx?$/,
    ];
    const left = listed.stdout
      .split('\0')
      .filter(Boolean)
      // A file the checkout deleted but hasn't committed yet is no input.
      .filter((file) => existsSync(path.join(REPO_ROOT, file)))
      .filter((file) => !files.has(file) && !known.some((pattern) => pattern.test(file)));
    assert.deepEqual(left, []);
  },
);
