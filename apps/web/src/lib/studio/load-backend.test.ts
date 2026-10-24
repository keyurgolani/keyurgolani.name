import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadBackend } from './load-backend';

// Each Studio backend loads only through load-backend.ts (#9): there, the
// owner adapter only under owner and the browser backend only under demo,
// so neither profile's page pulls in the other's. Elsewhere a module may
// import either one's types, and a test may import either.

const SRC = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

/** A value import, static or dynamic, of either backend module: not `import type`. */
const VALUE_IMPORT =
  /\bimport\s*\(\s*['"][^'"]*(?:owner-backend|browser-backend)['"]|\bimport\s+(?!type\b)[^;]*?\bfrom\s+['"][^'"]*(?:owner-backend|browser-backend)['"]/;

function sources(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const file = path.join(dir, entry.name);
    if (entry.isDirectory()) return sources(file);
    return /\.tsx?$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name) ? [file] : [];
  });
}

test('only load-backend.ts loads a Studio backend, outside tests', () => {
  const loading = sources(SRC)
    .filter((file) => VALUE_IMPORT.test(readFileSync(file, 'utf8')))
    .map((file) => path.relative(SRC, file));
  assert.deepEqual(loading, [path.join('lib', 'studio', 'load-backend.ts')]);
  // The check sees each form it refuses, and lets a type import by.
  for (const text of [
    "import { ownerBackend } from './owner-backend';",
    "const m = import('~/lib/demo/browser-backend');",
    "import * as backend from '../studio/owner-backend';",
  ]) {
    assert.match(text, VALUE_IMPORT, text);
  }
  assert.doesNotMatch(
    "import type { DemoBackend } from '~/lib/demo/browser-backend';",
    VALUE_IMPORT,
  );
});

test('each profile loads its own backend, and read-only none', async () => {
  assert.equal(typeof (await loadBackend('owner')).ownerBackend, 'function');
  assert.equal(typeof (await loadBackend('demo')).browserBackend, 'function');
  assert.equal(loadBackend('read-only'), null);
});
