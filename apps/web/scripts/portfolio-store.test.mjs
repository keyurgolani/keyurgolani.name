import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { bundleStore } from './bundle-store.mjs';

// portfolio-store's entry (#3, item 26), run the ways it ships: through tsx
// as `pnpm run store` runs it, and as the image's one-file bundle, from a
// directory outside the repo. Both bind this build's registry, where no
// composition but the fallback is registered until #13, so the bundled
// example can't be imported. The store's own tests, under packages/core,
// cover each command.

const ENTRY = fileURLToPath(new URL('./portfolio-store.ts', import.meta.url));
const TSX = fileURLToPath(import.meta.resolve('tsx/cli'));
const ROOT = fileURLToPath(new URL('../../../', import.meta.url));

function scratch(t, prefix) {
  const dir = mkdtempSync(path.join(tmpdir(), prefix));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}

/** A source directory holding the bundled example pair. */
function examplePair(t) {
  const dir = scratch(t, 'store-example-');
  copyFileSync(path.join(ROOT, 'portfolio.example.yml'), path.join(dir, 'portfolio.yml'));
  copyFileSync(path.join(ROOT, 'site.example.yml'), path.join(dir, 'site.yml'));
  return dir;
}

const run = (command, env, cwd) => {
  const result = spawnSync(process.execPath, command, {
    cwd,
    env: { PATH: process.env.PATH, ...env },
    encoding: 'utf8',
    timeout: 120_000,
  });
  return { code: result.status, out: result.stdout, err: result.stderr };
};

test("the entry runs the store's CLI with this build's publish checks: the example is variant.unavailable until #13, and nothing goes live", (t) => {
  const data = scratch(t, 'store-entry-');
  const source = examplePair(t);
  const tsx = (...args) =>
    run([TSX, '--conditions=react-server', ENTRY, ...args], { PORTFOLIO_DATA_DIR: data });

  const empty = tsx('status');
  assert.equal(empty.code, 1, empty.err);
  assert.match(empty.out, /^state: empty$/m);

  const imported = tsx('import', '--from', source);
  assert.equal(imported.code, 1, imported.out);
  assert.match(imported.err, /^validation_failed: 1 record blocks it\. Nothing was imported\.$/m);
  assert.match(
    imported.err,
    /: variant\.unavailable \(blocks-publish\) at \/appearance\/variant$/m,
  );

  const after = tsx('status');
  assert.match(after.out, /^state: empty$/m, 'a refused import makes nothing live');
});

test('the bundle needs Node and nothing else: it runs from a directory outside the repo', async (t) => {
  const built = await bundleStore(path.join(scratch(t, 'store-bundle-'), 'portfolio-store.mjs'));
  const text = readFileSync(built, 'utf8');
  // Every module is inside it; it imports nothing but Node's own.
  const imports = [...text.matchAll(/^import\s+(?:[\w$*{}\s,]+\s+from\s+)?["']([^"']+)["'];?$/gm)];
  assert.ok(imports.length > 0);
  for (const [, specifier] of imports) {
    assert.match(specifier, /^node:/, `the bundle imports ${specifier}`);
  }
  assert.doesNotMatch(text, /\bimport\(\s*["'](?!node:)/, 'nor loads anything else later');
  const app = scratch(t, 'store-app-');
  mkdirSync(path.join(app, 'bin'));
  const bin = path.join(app, 'bin', 'portfolio-store.mjs');
  copyFileSync(built, bin);

  const help = run([bin, '--help'], {}, app);
  assert.equal(help.code, 0, help.err);
  for (const command of [
    'status',
    'history',
    'verify',
    'import',
    'rollback',
    'recover',
    'unlock',
    'backup',
    'restore',
    'retention',
  ]) {
    assert.match(help.out, new RegExp(`^  ${command}\\b`, 'm'), command);
  }
  const data = scratch(t, 'store-data-');
  const status = run([bin, 'status'], { PORTFOLIO_DATA_DIR: data }, app);
  assert.equal(status.code, 1, status.err);
  assert.match(status.out, /^state: empty$/m);
  const imported = run(
    [bin, 'import', '--from', examplePair(t)],
    { PORTFOLIO_DATA_DIR: data },
    app,
  );
  assert.equal(imported.code, 1);
  assert.match(imported.err, /variant\.unavailable \(blocks-publish\)/);
  const usage = run([bin, 'rollback'], { PORTFOLIO_DATA_DIR: data }, app);
  assert.equal(usage.code, 2);
});
