import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

// What the demo's import and export load (#9, PR 3), read from esbuild's
// browser bundles of each entry. The worker parses and validates, so it
// carries #4's schema, and never #10's post-pass or sanitize-html: it writes
// no HTML, and the post-pass runs where the content renders (the threat
// model's script-1 row). The main-thread API carries no parser at all, so
// an import can't fall back to this thread. None of them reaches owner code.
// And no module under lib/demo logs, fetches, beacons, or reports errors.

const ROOT = fileURLToPath(new URL('../../../../../', import.meta.url));
const DEMO = fileURLToPath(new URL('./', import.meta.url));

/** The repository-relative inputs of a browser bundle of `entry`. */
async function inputsOf(entry: string): Promise<string[]> {
  const result = await build({
    entryPoints: [path.join(DEMO, entry)],
    bundle: true,
    write: false,
    platform: 'browser',
    format: 'esm',
    metafile: true,
    logLevel: 'silent',
    absWorkingDir: ROOT,
  });
  return Object.keys(result.metafile.inputs).map((input) =>
    path.relative(ROOT, path.resolve(ROOT, input)).split(path.sep).join('/'),
  );
}

const SANITIZER = [
  /(?:^|\/)sanitize-html\//,
  /packages\/kit\/src\/markdown-(?:post-pass|sanitize)\.ts$/,
];
const OWNER = [
  /^apps\/web\/src\/server\/owner\//,
  /^apps\/web\/src\/lib\/studio\/owner-backend\.ts$/,
  /^apps\/web\/src\/lib\/studio-fetch\.ts$/,
  /^packages\/core\//,
];

function matching(inputs: readonly string[], patterns: readonly RegExp[]): string[] {
  return inputs.filter((input) => patterns.some((pattern) => pattern.test(input)));
}

test("the import worker's module graph carries #4's validator and none of #10's post-pass, sanitize-html, or owner code", async () => {
  const inputs = await inputsOf('import/import.worker.ts');
  assert.ok(inputs.includes('apps/web/src/lib/demo/import/pipeline.ts'));
  assert.ok(inputs.includes('packages/schema/src/validate.ts'));
  assert.ok(inputs.some((input) => /(?:^|\/)yaml\//.test(input)));
  assert.deepEqual(matching(inputs, SANITIZER), []);
  assert.deepEqual(matching(inputs, OWNER), []);
  assert.deepEqual(
    inputs.filter((input) => input.startsWith('packages/kit/')),
    [],
  );
});

test('the main-thread import API loads no parser or validator, so nothing can parse on this thread', async () => {
  const inputs = await inputsOf('import/index.ts');
  assert.deepEqual(inputs, ['apps/web/src/lib/demo/import/index.ts']);
});

test('the export carries #4 serialize and none of the post-pass, sanitize-html, or owner code', async () => {
  const inputs = await inputsOf('export/index.ts');
  assert.ok(inputs.includes('packages/schema/src/serialize.ts'));
  assert.deepEqual(matching(inputs, SANITIZER), []);
  assert.deepEqual(matching(inputs, OWNER), []);
});

/** Every module under lib/demo but tests and their support. */
function demoModules(): string[] {
  const found: string[] = [];
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const file = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name !== 'test-support') walk(file);
      } else if (/\.tsx?$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name)) {
        found.push(file);
      }
    }
  };
  walk(DEMO);
  return found.sort();
}

test('no lib/demo module logs, fetches, beacons, reports errors, opens a socket, or posts anywhere but to its worker', () => {
  const modules = demoModules();
  assert.ok(modules.length >= 4);
  const banned: Record<string, RegExp> = {
    console: /\bconsole\s*\./,
    fetch: /\bfetch\s*\(/,
    sendBeacon: /\bsendBeacon\b/,
    reportError: /\breportError\b/,
    XMLHttpRequest: /\bXMLHttpRequest\b/,
    WebSocket: /\bWebSocket\b/,
    EventSource: /\bEventSource\b/,
    importScripts: /\bimportScripts\b/,
    BroadcastChannel: /\bBroadcastChannel\b/,
    'new Image': /\bnew\s+Image\b/,
  };
  const posting: Record<string, RegExp> = {
    'import/index.ts': /\bworker\.postMessage\(/g,
    'import/import.worker.ts': /\bscope\.postMessage\(/g,
  };
  for (const file of modules) {
    const relative = path.relative(DEMO, file).split(path.sep).join('/');
    const source = readFileSync(file, 'utf8');
    for (const [name, pattern] of Object.entries(banned)) {
      assert.equal(pattern.test(source), false, `${relative} uses ${name}`);
    }
    const posts = source.match(/\.postMessage\(/g)?.length ?? 0;
    const allowed = posting[relative] ? (source.match(posting[relative]!)?.length ?? 0) : 0;
    assert.equal(posts, allowed, `${relative} posts a message`);
    assert.ok(allowed <= 1, `${relative} posts more than once`);
  }
});
