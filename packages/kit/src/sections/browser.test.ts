import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import ts from 'typescript';

// @portfolio/kit/sections renders on the server, in #7's preview frame, and in
// #9's browser render, so it bundles for a browser, holds no client module,
// and reads nothing that differs between those places (#5, Slice 2). Slice
// 3's source audit holds variants to the same rules.

const KIT = fileURLToPath(new URL('../../', import.meta.url));

/** The kit's own modules the sections entry pulls in, as absolute paths. */
async function kitModules(): Promise<string[]> {
  const result = await build({
    entryPoints: ['src/sections/index.ts'],
    absWorkingDir: KIT,
    bundle: true,
    platform: 'browser',
    format: 'esm',
    jsx: 'automatic',
    write: false,
    metafile: true,
    logLevel: 'silent',
  });
  assert.deepEqual(result.errors, []);
  const inputs = Object.keys(result.metafile.inputs);
  assert.deepEqual(
    inputs.filter((file) => /^node:|node_modules\/(?:\.pnpm\/)?next[@/]/.test(file)),
    [],
    'no Node or Next module',
  );
  return inputs.filter((file) => file.startsWith('src/')).map((file) => path.join(KIT, file));
}

/** What reads the clock, randomness, the environment, or the network. */
const BANNED = [
  /\bprocess\b/,
  /\brequire\s*\(/,
  /\bDate\.now\b/,
  /\bDate\s*\(\s*\)/,
  /\bperformance\b/,
  /\bMath\.random\b/,
  /\brandomUUID\b/,
  /\bgetRandomValues\b/,
  /\bfetch\s*\(/,
  /\bXMLHttpRequest\b/,
  /\bWebSocket\b/,
  /\bnavigator\b/,
  /\b(?:local|session)Storage\b/,
  /\bindexedDB\b/,
  /\bdocument\.cookie\b/,
];

/** A module's code without its comments, so prose can't trip the scan or hide from it. */
function code(file: string): string {
  return ts.transpileModule(readFileSync(file, 'utf8'), {
    fileName: file,
    compilerOptions: {
      module: ts.ModuleKind.ESNext,
      target: ts.ScriptTarget.ES2022,
      jsx: ts.JsxEmit.Preserve,
      removeComments: true,
    },
  }).outputText;
}

test('the sections entry bundles for a browser, with no Node, Next, or client module', async () => {
  const files = await kitModules();
  assert.ok(
    files.some((file) => file.endsWith('sections/index.ts')),
    files.join(', '),
  );
  assert.ok(
    files.some((file) => file.endsWith('format.ts')),
    'it uses the kit formatters',
  );
  for (const file of files) {
    assert.doesNotMatch(
      readFileSync(file, 'utf8'),
      /^\s*['"]use client['"]/,
      `${file} is a client module`,
    );
  }
});

test('the kit modules it renders with read no clock, randomness, environment, or network', async () => {
  for (const file of await kitModules()) {
    const text = code(file);
    for (const banned of BANNED) assert.doesNotMatch(text, banned, `${file} uses ${banned}`);
  }
});
