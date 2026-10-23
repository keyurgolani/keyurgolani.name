import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { ROOT_DIRS, ROOT_FILES } from './fixture-host.mjs';

// The fixture host copies the root files, apps/, packages/, and ROOT_DIRS,
// and builds the copy. A build source that imports a root directory the copy
// leaves out fails the copy's `next build` (#11: quality/thresholds), so every
// such import must name a directory the copy has. The build's sources are
// what it bundles and every file its type check reads. Since Next 16.4 that
// check is tsc over the whole project of the tsconfig next.config.ts names,
// test files included.

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const WEB = path.join(REPO_ROOT, 'apps', 'web');
const SKIPPED = new Set(['node_modules', '.next', '.turbo', 'dist', 'coverage', 'generated']);
const SOURCE = /\.(?:[cm]?[jt]sx?)$/;
const TEST_FILE = /\.(?:test|spec)\.[cm]?[jt]sx?$/;
const SPECIFIER = /(?:\bfrom\s*|\bimport\s*\(\s*|\brequire\s*\(\s*)['"](\.{1,2}\/[^'"]+)['"]/g;

/** Every non-test source file under `dir`, which the build may bundle. */
function sources(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const file = path.join(dir, entry.name);
    if (entry.isDirectory()) return SKIPPED.has(entry.name) ? [] : sources(file);
    return SOURCE.test(entry.name) && !TEST_FILE.test(entry.name) ? [file] : [];
  });
}

/** The tsconfig next build type-checks: next.config.ts's tsconfigPath, else tsconfig.json. */
function buildTsconfig() {
  const config = readFileSync(path.join(WEB, 'next.config.ts'), 'utf8');
  return /\btsconfigPath:\s*'([^']+)'/.exec(config)?.[1] ?? 'tsconfig.json';
}

/** Every file outside node_modules that tsc reads for `tsconfig`, in apps/web. */
function typeChecked(tsconfig) {
  const file = path.join(WEB, tsconfig);
  const { config, error } = ts.readConfigFile(file, ts.sys.readFile);
  assert.equal(error, undefined, tsconfig);
  const { fileNames, options } = ts.parseJsonConfigFileContent(
    config,
    ts.sys,
    WEB,
    undefined,
    file,
  );
  return ts
    .createProgram(fileNames, { ...options, noEmit: true, incremental: false })
    .getSourceFiles()
    .map((source) => source.fileName)
    .filter((name) => !name.split(/[\\/]/).includes('node_modules'));
}

/**
 * Each root directory or file outside apps/ and packages/ that a build
 * source imports, or the type check reads, with the files that reach it.
 */
function rootImports(tsconfig) {
  const found = new Map();
  const add = (target, file) => {
    const [top] = target.split(path.sep);
    if (top === 'apps' || top === 'packages' || top.startsWith('..')) return;
    const key = target.includes(path.sep) ? top : target;
    found.set(key, [...new Set([...(found.get(key) ?? []), path.relative(REPO_ROOT, file)])]);
  };
  const checked = typeChecked(tsconfig).map((file) => path.resolve(file));
  const files = new Set([
    ...['apps', 'packages'].flatMap((dir) => sources(path.join(REPO_ROOT, dir))),
    ...checked.filter((file) =>
      /^(?:apps|packages)$/.test(path.relative(REPO_ROOT, file).split(path.sep)[0]),
    ),
  ]);
  for (const file of files) {
    for (const [, specifier] of readFileSync(file, 'utf8').matchAll(SPECIFIER)) {
      add(path.relative(REPO_ROOT, path.resolve(path.dirname(file), specifier)), file);
    }
  }
  // A file the check reads by any other route, such as a path alias.
  for (const file of checked) add(path.relative(REPO_ROOT, file), file);
  return found;
}

/** The roots in `found` the fixture host doesn't copy, as an assertion message. */
function uncopied(found) {
  const copied = new Set([...ROOT_DIRS, ...ROOT_FILES]);
  return [...found]
    .filter(([key]) => !copied.has(key))
    .map(([key, files]) => `${key} (reached from ${files.join(', ')})`);
}

test('every root directory a build source imports, or its type check reads, is one the fixture host copies', () => {
  const found = rootImports(buildTsconfig());
  // The scan sees the import that broke the copy's build.
  assert.ok(
    found.get('quality')?.includes(path.join('apps', 'web', 'scripts', 'appearance-targets.ts')),
    JSON.stringify(Object.fromEntries(found)),
  );
  assert.deepEqual(uncopied(found), [], "The fixture host doesn't copy these, so its build fails");
});

test("the build's type check reads no test file, and tsconfig.json, which pnpm typecheck uses, still does", () => {
  assert.notEqual(buildTsconfig(), 'tsconfig.json');
  assert.deepEqual(
    typeChecked(buildTsconfig()).filter((file) => TEST_FILE.test(file)),
    [],
  );
  const tests = typeChecked('tsconfig.json').filter((file) => TEST_FILE.test(file));
  assert.ok(tests.includes(path.join(WEB, 'scripts', 'fixture-gate.test.ts')), tests.join('\n'));
  // Under tsconfig.json the scan finds what failed the image's and the copy's
  // build when Next 16.4 began checking test files: ci/, from those tests.
  assert.ok(
    uncopied(rootImports('tsconfig.json')).some((line) => line.startsWith('ci ')),
    'the scan sees a test file that reaches ci/',
  );
});
