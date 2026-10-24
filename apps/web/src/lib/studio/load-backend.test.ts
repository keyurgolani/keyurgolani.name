import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadOwnerBackend } from './load-backend';

// Each Studio backend loads from one module (#9): Owner Studio's adapter only
// from load-backend.ts, which the owner shell calls, and Demo Studio's
// browser backend only from the demo shell, so neither profile's code names
// the other's backend. Elsewhere a module may import either one's types, and
// a test may import either.

const SRC = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

/** A value import, static or dynamic, of `module`: not `import type`. */
const valueImport = (module: string) =>
  new RegExp(
    `\\bimport\\s*\\(\\s*['"][^'"]*${module}['"]|\\bimport\\s+(?!type\\b)[^;]*?\\bfrom\\s+['"][^'"]*${module}['"]`,
  );
const OWNER = valueImport('owner-backend');
const DEMO = valueImport('browser-backend');

function sources(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const file = path.join(dir, entry.name);
    if (entry.isDirectory()) return sources(file);
    return /\.tsx?$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name) ? [file] : [];
  });
}

const loading = (pattern: RegExp) =>
  sources(SRC)
    .filter((file) => pattern.test(readFileSync(file, 'utf8')))
    .map((file) => path.relative(SRC, file));

test('only load-backend.ts loads the owner adapter, and only the demo shell the browser backend, outside tests', () => {
  assert.deepEqual(loading(OWNER), [path.join('lib', 'studio', 'load-backend.ts')]);
  assert.deepEqual(loading(DEMO), [
    path.join('app', '(studio)', '_components', 'demo', 'demo-shell.tsx'),
  ]);
  // The check sees each form it refuses, and lets a type import by.
  for (const [text, pattern] of [
    ["import { ownerBackend } from './owner-backend';", OWNER],
    ["const m = import('~/lib/demo/browser-backend');", DEMO],
    ["import * as backend from '../studio/owner-backend';", OWNER],
  ] as const) {
    assert.match(text, pattern, text);
  }
  assert.doesNotMatch("import type { DemoBackend } from '~/lib/demo/browser-backend';", DEMO);
});

test('the loader loads the owner adapter', async () => {
  assert.equal(typeof (await loadOwnerBackend()).ownerBackend, 'function');
});
