import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { runInNewContext } from 'node:vm';
import { build } from 'esbuild';
import { toPublicView, validatePublicationUnit } from '@portfolio/schema';
import { buildRenderInput } from './render-input';
import { validateManifest } from './validate-manifest';

// The root entry runs in a browser (#5, Slice 1 and the orchestrator's note
// on the render input): #7's preview frame and #9's in-browser render import
// it. A real browser bundle proves no Node built-in is anywhere in its graph,
// and running that bundle where only browser globals exist proves it reads
// no environment and builds the same input as Node does.

const SRC = fileURLToPath(new URL('.', import.meta.url));
const SOURCES = readdirSync(SRC).filter(
  (file) => file.endsWith('.ts') && !file.endsWith('.test.ts'),
);

async function bundle() {
  return build({
    entryPoints: [fileURLToPath(new URL('./index.ts', import.meta.url))],
    bundle: true,
    platform: 'browser',
    format: 'iife',
    globalName: 'Contract',
    write: false,
    metafile: true,
    logLevel: 'silent',
  });
}

test('the root entry bundles for a browser, with no React, Next, or Node module', async () => {
  const result = await bundle();
  assert.deepEqual(result.errors, []);
  const inputs = Object.keys(result.metafile.inputs);
  assert.ok(
    inputs.some((file) => /(?:^|variant-contract\/)src\/index\.ts$/.test(file)),
    inputs.join(', '),
  );
  for (const banned of [
    /node_modules\/(?:\.pnpm\/)?react/,
    /node_modules\/(?:\.pnpm\/)?next/,
    /^node:/,
  ]) {
    assert.deepEqual(
      inputs.filter((file) => banned.test(file)),
      [],
      String(banned),
    );
  }
});

test("the package's own modules import only zod, @portfolio/schema, and each other", () => {
  for (const file of SOURCES) {
    const text = readFileSync(new URL(file, import.meta.url), 'utf8');
    const specifiers = [
      ...text.matchAll(/(?:^|\n)\s*(?:import|export)\b[^'"]*?from\s+'([^']+)'/g),
    ].map((match) => match[1]!);
    for (const specifier of specifiers) {
      assert.ok(
        specifier === 'zod' || specifier === '@portfolio/schema' || specifier.startsWith('./'),
        `${file} imports ${specifier}`,
      );
    }
    for (const banned of [
      /process\./,
      /\brequire\(/,
      /\bDate\.now\(/,
      /\bMath\.random\(/,
      /\bfetch\(/,
    ]) {
      assert.ok(!banned.test(text), `${file} uses ${banned}`);
    }
  }
});

test('bundled and run with browser globals alone, it builds the same input as in Node', async () => {
  const code = (await bundle()).outputFiles[0]!.text;
  const PAIR = new URL('../../schema/src/__fixtures__/pairs/engineering/yaml/', import.meta.url);
  const unit = validatePublicationUnit({
    portfolio: {
      text: readFileSync(new URL('portfolio.yml', PAIR), 'utf8'),
      format: 'yaml',
      name: 'portfolio.yml',
    },
    site: {
      text: readFileSync(new URL('site.yml', PAIR), 'utf8'),
      format: 'yaml',
      name: 'site.yml',
    },
  }).pair!;
  const raw = JSON.parse(
    readFileSync(new URL('./__fixtures__/manifest.json', import.meta.url), 'utf8'),
  );
  const checked = validateManifest(raw, { packageName: '@acme/ocean' });
  assert.ok(checked.ok);
  const args = {
    pair: unit,
    view: toPublicView(unit),
    manifest: checked.manifest,
    route: { route: 'home' } as const,
    basePath: '/sample',
    origin: 'https://rowan.test',
    requestTime: '2026-10-20T15:42:07.123Z',
    idPrefix: 'pv-',
  };
  const expected = await buildRenderInput(args);

  // No process, require, Buffer, or module: only what a browser page has.
  const context: Record<string, unknown> = {
    crypto: globalThis.crypto,
    TextEncoder,
    TextDecoder,
    URL,
    URLSearchParams,
    console,
  };
  context.globalThis = context;
  context.window = context;
  runInNewContext(code, context);
  // The data is parsed inside the page, as a frame's postMessage or #9's own state would be.
  context.argsJson = JSON.stringify(args);
  context.manifestJson = JSON.stringify(raw);
  const fromBrowser = await runInNewContext(
    'Contract.buildRenderInput(JSON.parse(argsJson)).then((input) => JSON.stringify(input))',
    context,
  );
  assert.deepEqual(JSON.parse(fromBrowser), JSON.parse(JSON.stringify(expected)));
  // The validator runs there too.
  assert.equal(
    runInNewContext(
      "Contract.validateManifest(JSON.parse(manifestJson), { packageName: '@acme/ocean' }).ok",
      context,
    ),
    true,
  );
});
