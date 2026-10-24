import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { bundleStore } from './bundle-store.mjs';

// portfolio-store's entry (#3, item 26), run the ways it ships: through tsx
// as `pnpm run store` runs it, and as the image's one-file bundle, from a
// directory outside the repo. Both bind this build's registry, which
// registers the example's variant, Editorial Evidence (#13), so the bundled
// example imports, and a variant no package takes is refused. The store's
// own tests, under packages/core, cover each command.

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

/** The example pair with a variant no package may take. */
function unknownVariantPair(t) {
  const dir = examplePair(t);
  const site = path.join(dir, 'site.yml');
  const text = readFileSync(site, 'utf8');
  assert.ok(text.includes('variant: editorial-evidence'));
  writeFileSync(site, text.replace('variant: editorial-evidence', 'variant: missing-variant'));
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

test("the entry runs the store's CLI with this build's publish checks: a variant it doesn't register is refused, and the example goes live (#13)", (t) => {
  const data = scratch(t, 'store-entry-');
  const tsx = (...args) =>
    run([TSX, '--conditions=react-server', ENTRY, ...args], { PORTFOLIO_DATA_DIR: data });

  const empty = tsx('status');
  assert.equal(empty.code, 1, empty.err);
  assert.match(empty.out, /^state: empty$/m);

  const refused = tsx('import', '--from', unknownVariantPair(t));
  assert.equal(refused.code, 1, refused.out);
  assert.match(refused.err, /^validation_failed: 1 record blocks it\. Nothing was imported\.$/m);
  assert.match(refused.err, /: variant\.unavailable \(blocks-publish\) at \/appearance\/variant$/m);
  assert.match(tsx('status').out, /^state: empty$/m, 'a refused import makes nothing live');

  const imported = tsx('import', '--from', examplePair(t));
  assert.equal(imported.code, 0, imported.err);
  assert.match(imported.out, /^Imported portfolio\.yml and site\.yml as a new revision\.$/m);
  assert.doesNotMatch(imported.err, /variant\.unavailable/);
  assert.match(tsx('status').out, /^live revision: rev_[0-9a-f]+ \(seq 1\)$/m);
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
  // Later, it loads only sharp, a native module, for an import's media
  // (#10): from the server's build in the image, and never from the bundle.
  const later = [...text.matchAll(/\bimport\(\s*["']([^"']+)["']/g)]
    .map(([, specifier]) => specifier)
    .filter((specifier) => !specifier.startsWith('node:'));
  assert.deepEqual([...new Set(later)], ['sharp'], 'nor loads anything else later');
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
  const refused = run(
    [bin, 'import', '--from', unknownVariantPair(t)],
    { PORTFOLIO_DATA_DIR: data },
    app,
  );
  assert.equal(refused.code, 1);
  assert.match(refused.err, /variant\.unavailable \(blocks-publish\)/);
  const imported = run(
    [bin, 'import', '--from', examplePair(t)],
    { PORTFOLIO_DATA_DIR: data },
    app,
  );
  assert.equal(imported.code, 0, imported.err);
  assert.match(imported.out, /^Imported portfolio\.yml and site\.yml as a new revision\.$/m);
  const usage = run([bin, 'rollback'], { PORTFOLIO_DATA_DIR: data }, app);
  assert.equal(usage.code, 2);
});
