import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ROOT_DIRS, ROOT_FILES } from './fixture-host.mjs';

// The fixture host copies the root files, apps/, packages/, and ROOT_DIRS,
// and builds the copy. A build source that imports a root directory the copy
// leaves out fails the copy's `next build` (#11: quality/thresholds), so every
// such import must name a directory the copy has.

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const SKIPPED = new Set(['node_modules', '.next', '.turbo', 'dist', 'coverage', 'generated']);
const SOURCE = /\.(?:[cm]?[jt]sx?)$/;
// The build leaves test files out of its type check, as apps/web's tsconfig does.
const TEST_FILE = /\.(?:test|spec)\.[cm]?[jt]sx?$/;
const SPECIFIER = /(?:\bfrom\s*|\bimport\s*\(\s*|\brequire\s*\(\s*)['"](\.{1,2}\/[^'"]+)['"]/g;

/** Every non-test source file under `dir`. */
function sources(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const file = path.join(dir, entry.name);
    if (entry.isDirectory()) return SKIPPED.has(entry.name) ? [] : sources(file);
    return SOURCE.test(entry.name) && !TEST_FILE.test(entry.name) ? [file] : [];
  });
}

/** Each root directory or file outside apps/ and packages/ that a build source imports, with its importers. */
function rootImports() {
  const found = new Map();
  for (const file of ['apps', 'packages'].flatMap((dir) => sources(path.join(REPO_ROOT, dir)))) {
    for (const [, specifier] of readFileSync(file, 'utf8').matchAll(SPECIFIER)) {
      const target = path.relative(REPO_ROOT, path.resolve(path.dirname(file), specifier));
      const [top] = target.split(path.sep);
      if (top === 'apps' || top === 'packages' || top.startsWith('..')) continue;
      const key = target.includes(path.sep) ? top : target;
      found.set(key, [...(found.get(key) ?? []), path.relative(REPO_ROOT, file)]);
    }
  }
  return found;
}

test('every root directory a build source imports is one the fixture host copies', () => {
  const found = rootImports();
  // The scan sees the import that broke the copy's build.
  assert.ok(
    found.get('quality')?.includes(path.join('apps', 'web', 'scripts', 'appearance-targets.ts')),
    JSON.stringify(Object.fromEntries(found)),
  );
  const copied = new Set([...ROOT_DIRS, ...ROOT_FILES]);
  const missing = [...found].filter(([key]) => !copied.has(key));
  assert.deepEqual(
    missing,
    [],
    `The fixture host doesn't copy these, so its build can't resolve them: ${missing
      .map(([key, files]) => `${key} (imported by ${files.join(', ')})`)
      .join('; ')}`,
  );
});
