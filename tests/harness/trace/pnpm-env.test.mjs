import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { resolvePnpm, shimScript, withoutPnpmSettings } from './pnpm-env.mjs';

test("another checkout's install gets none of the settings pnpm run passed down", () => {
  const env = {
    PATH: '/usr/bin',
    HOME: '/Users/someone',
    npm_config_strict_dep_builds: 'true',
    npm_config_frozen_lockfile: '',
    NPM_CONFIG_REGISTRY: 'http://127.0.0.1:9/',
    pnpm_config_verify_deps_before_run: 'false',
    npm_execpath: '/pnpm/bin/pnpm.cjs',
    PNPM_HOME: '/Users/someone/Library/pnpm',
  };
  assert.deepEqual(withoutPnpmSettings(env), {
    PATH: '/usr/bin',
    HOME: '/Users/someone',
    npm_execpath: '/pnpm/bin/pnpm.cjs',
    PNPM_HOME: '/Users/someone/Library/pnpm',
  });
  assert.equal(env.npm_config_strict_dep_builds, 'true', 'it leaves its argument alone');
});

/** A temporary directory, removed after the test, with `files` as name to script, each runnable. */
function binDir(t, name, files = {}) {
  const root = mkdtempSync(path.join(tmpdir(), 'pnpm-env-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const dir = path.join(root, name);
  mkdirSync(dir);
  for (const [file, script] of Object.entries(files)) {
    writeFileSync(path.join(dir, file), script);
    chmodSync(path.join(dir, file), 0o755);
  }
  return dir;
}

/** A script that prints `label` and each argument it got, bracketed. */
const ECHO = (label) => `#!/bin/sh\nprintf '%s:' '${label}'\nprintf ' [%s]' "$@"\necho\n`;

test('under pnpm run, the baseline runs the pnpm that started it', () => {
  assert.deepEqual(resolvePnpm({ npm_execpath: '/x/pnpm/10/bin/pnpm.cjs' }, { node: '/n/node' }), [
    '/n/node',
    '/x/pnpm/10/bin/pnpm.cjs',
  ]);
  assert.deepEqual(resolvePnpm({ npm_execpath: '/usr/local/bin/pnpm' }), ['/usr/local/bin/pnpm']);
});

test('run directly, it takes the first pnpm on PATH outside the shim directory, else corepack pnpm', (t) => {
  const shim = binDir(t, 'shim', { pnpm: ECHO('shim') });
  const notRunnable = binDir(t, 'plain');
  writeFileSync(path.join(notRunnable, 'pnpm'), ECHO('plain'));
  const folder = binDir(t, 'folder');
  mkdirSync(path.join(folder, 'pnpm'));
  const real = binDir(t, 'real', { pnpm: ECHO('real') });
  const corepack = binDir(t, 'corepack', { corepack: ECHO('corepack') });
  const PATH = [shim, 'relative/bin', notRunnable, folder, corepack, real].join(path.delimiter);
  // npm run sets npm_execpath to npm, which is no pnpm.
  const env = { PATH, npm_execpath: '/x/npm/bin/npm-cli.js' };
  assert.deepEqual(resolvePnpm(env, { exclude: [shim] }), [path.join(real, 'pnpm')]);
  assert.deepEqual(
    resolvePnpm({ PATH: [shim, corepack].join(path.delimiter) }, { exclude: [shim] }),
    [path.join(corepack, 'corepack'), 'pnpm'],
  );
  assert.throws(
    () => resolvePnpm({ PATH: shim }, { exclude: [shim] }),
    /No pnpm: run this as pnpm test:trace:baseline/,
  );
});

test('run directly, the shim runs the pnpm it resolved, not itself', (t) => {
  // The baseline puts its shim first on PATH. A shim that ran plain `pnpm`
  // would find itself and run itself forever.
  const shim = binDir(t, 'shim');
  const real = binDir(t, "it's real", { pnpm: ECHO('real pnpm') });
  const PATH = [shim, real, '/usr/bin', '/bin'].join(path.delimiter);
  const command = resolvePnpm({ PATH }, { exclude: [shim] });
  assert.ok(path.isAbsolute(command[0]), command[0]);
  writeFileSync(path.join(shim, 'pnpm'), shimScript(command));
  chmodSync(path.join(shim, 'pnpm'), 0o755);
  const run = spawnSync('pnpm', ['install', '--filter', 'a b'], {
    env: { PATH },
    encoding: 'utf8',
    timeout: 10_000,
  });
  assert.equal(run.error, undefined, 'the shim finished');
  assert.equal(run.status, 0, run.stderr);
  assert.equal(run.stdout, 'real pnpm: [install] [--filter] [a b]\n');
});
