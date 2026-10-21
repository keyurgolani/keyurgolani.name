import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

// Every module in @portfolio/core is owner code (#1, item 14), so each one
// records its own name in the owner load trace as it loads, the way
// apps/web/src/server/owner/ modules do. load-trace.ts is the helper.

const SRC = fileURLToPath(new URL('.', import.meta.url));
const TRACE = Symbol.for('keyurgolani.portfolio.owner-modules');

function modules(dir = SRC): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const file = path.join(dir, entry.name);
    if (entry.isDirectory()) return modules(file);
    if (!/\.(ts|mjs)$/.test(entry.name) || /\.test\.ts$/.test(entry.name)) return [];
    return entry.name === 'load-trace.ts' && dir === SRC ? [] : [file];
  });
}

/** The trace name for `file`, such as `core/auth/phc`. */
const traceName = (file: string) =>
  `core/${path
    .relative(SRC, file)
    .replace(/\.(ts|mjs)$/, '')
    .split(path.sep)
    .join('/')}`;

const loaded = () =>
  (globalThis as typeof globalThis & { [TRACE]?: Set<string> })[TRACE] ?? new Set<string>();

test('every core module records its own name in the owner load trace as it loads', async () => {
  const files = modules();
  assert.ok(files.length > 0);
  for (const file of files) {
    const name = traceName(file);
    assert.ok(readFileSync(file, 'utf8').includes(`'${name}'`), `${name} names itself`);
    await import(pathToFileURL(file).href);
    assert.ok(loaded().has(name), `${name} is in the trace once it loads`);
  }
});
