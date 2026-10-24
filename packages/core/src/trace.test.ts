import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import ts from 'typescript';
import { closure } from './store/test-support/imports';

// Owner code in @portfolio/core records its own name in the owner load trace
// as it loads (#1, item 14), the way apps/web/src/server/owner/ modules do;
// load-trace.ts is the helper. The public entry, src/index.ts, and every
// module it reaches are what every profile loads (#3, item 19): read-only's
// SourceCatalogReader and the unit it shares with the store. None of them
// records itself, and none reaches an owner module.

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

// Types count: a type the entry names is no more owner code than a value.
const PUBLIC = closure(path.join(SRC, 'index.ts'), { types: true });

test("every core module but the public entry's records its own name in the owner load trace as it loads", async () => {
  const files = modules();
  assert.ok(files.length > 0);
  for (const file of files) {
    if (PUBLIC.has(file)) continue;
    const name = traceName(file);
    assert.ok(readFileSync(file, 'utf8').includes(`'${name}'`), `${name} names itself`);
    await import(pathToFileURL(file).href);
    assert.ok(loaded().has(name), `${name} is in the trace once it loads`);
  }
});

test('the public entry reaches no owner module, and loading it records nothing in the trace', () => {
  const reached = [...PUBLIC].map((file) => path.relative(SRC, file)).sort();
  assert.deepEqual(reached, [
    // #9's store-free bundle reader, for demo's read-only reference.
    'catalog/bundle.ts',
    // #10's media pipeline, which read-only and demo run at startup.
    'catalog/media/address.ts',
    'catalog/media/derive.ts',
    'catalog/media/ingest.ts',
    'catalog/media/limits.ts',
    'catalog/media/local.ts',
    'catalog/media/remote.ts',
    'catalog/media/resolve.ts',
    'catalog/media/sniff.ts',
    'catalog/media/startup.ts',
    'catalog/port.ts',
    // 10h's scheme generator port, types alone.
    'catalog/schemes.ts',
    'catalog/source.ts',
    'catalog/unit.ts',
    'catalog/view.ts',
    'index.ts',
  ]);
  for (const file of PUBLIC) {
    assert.ok(
      !readFileSync(file, 'utf8').includes('recordOwnerModule'),
      `${path.relative(SRC, file)} records nothing`,
    );
  }
  // In a process of its own, so no other test's imports count.
  const child = spawnSync(
    process.execPath,
    [
      '--conditions=react-server',
      '--import',
      'tsx',
      '--input-type=module',
      '--eval',
      `await import(${JSON.stringify(pathToFileURL(path.join(SRC, 'index.ts')).href)});
       const trace = globalThis[Symbol.for('keyurgolani.portfolio.owner-modules')];
       console.log(JSON.stringify([...(trace ?? [])]));`,
    ],
    { cwd: path.resolve(SRC, '..'), encoding: 'utf8' },
  );
  assert.equal(child.status, 0, child.stderr);
  assert.deepEqual(JSON.parse(child.stdout.trim().split('\n').pop()!), []);
});

/** Every file package.json's exports map names, under any condition. */
function entries(): string[] {
  const manifest = JSON.parse(readFileSync(path.resolve(SRC, '..', 'package.json'), 'utf8')) as {
    exports: unknown;
  };
  const files = (value: unknown): string[] =>
    typeof value === 'string'
      ? [value]
      : value && typeof value === 'object'
        ? Object.values(value).flatMap(files)
        : [];
  return [...new Set(files(manifest.exports))].map((file) => path.resolve(SRC, '..', file));
}

// Every entry is server code (#3, item 19). Each imports server-only, which
// throws outside the react-server condition Next's server runs under, so a
// client bundle that reached one fails to build. The preview specs open a
// store through the owner entry in a child under that condition
// (tests/harness/preview-store.ts), not in the browser suite's own process.
test('every entry in the exports map imports server-only', () => {
  const found = entries();
  for (const known of ['index.ts', 'owner.ts']) {
    assert.ok(found.includes(path.join(SRC, known)), `the exports map names ${known}`);
  }
  for (const file of found) {
    const entry = path.relative(SRC, file);
    const source = ts.createSourceFile(file, readFileSync(file, 'utf8'), ts.ScriptTarget.Latest);
    const imports = source.statements.filter(ts.isImportDeclaration);
    assert.ok(
      imports.some(
        (declaration) =>
          declaration.importClause === undefined &&
          ts.isStringLiteral(declaration.moduleSpecifier) &&
          declaration.moduleSpecifier.text === 'server-only',
      ),
      `${entry} imports server-only`,
    );
  }
});
