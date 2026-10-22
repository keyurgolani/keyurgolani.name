import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import {
  chmodSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { REPO_ROOT } from './lib/reports.mjs';

// The scripts that load the route table without building the app write the
// generated registry it imports first (ci/lib/registry.mjs), so each runs on
// a fresh clone, as CI's image job runs `pnpm ci:security-proxy` on one, and
// a registry that doesn't build is the script's own reported failure.
// Each runs here in a scratch copy of the checkout as a clone of it has it:
// no build output and no apps/web/src/lib/generated/, with each workspace
// package's node_modules linked to the checkout's, so nothing installs.
// Nothing reaches a container: `docker` and `finch` on PATH are stubs that
// exit 1, and so is CONTAINER_CLI.

const GENERATED = path.join('apps', 'web', 'src', 'lib', 'generated');

/** The checkout's files as a clone would have them, with what isn't committed yet. */
function cloneFiles() {
  const out = execFileSync(
    'git',
    ['ls-files', '--cached', '--others', '--exclude-standard', '-z'],
    { cwd: REPO_ROOT, encoding: 'utf8' },
  );
  return [...new Set(out.split('\0'))].filter(
    (file) => file && existsSync(path.join(REPO_ROOT, file)),
  );
}

/** A scratch clone of the checkout, removed after the test, and a directory of container CLI stubs. */
function freshClone(t) {
  const scratch = mkdtempSync(path.join(tmpdir(), 'portfolio-fresh-clone-'));
  t.after(() => rmSync(scratch, { recursive: true, force: true }));
  const root = path.join(scratch, 'clone');
  for (const file of cloneFiles()) {
    mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
    copyFileSync(path.join(REPO_ROOT, file), path.join(root, file));
  }
  const workspaces = [
    '.',
    ...['apps', 'packages'].flatMap((dir) =>
      readdirSync(path.join(REPO_ROOT, dir)).map((name) => path.join(dir, name)),
    ),
  ];
  for (const dir of workspaces) {
    const modules = path.join(REPO_ROOT, dir, 'node_modules');
    if (existsSync(modules) && existsSync(path.join(root, dir))) {
      symlinkSync(modules, path.join(root, dir, 'node_modules'), 'dir');
    }
  }
  const bin = path.join(scratch, 'bin');
  mkdirSync(bin);
  for (const name of ['docker', 'finch']) {
    writeFileSync(path.join(bin, name), '#!/bin/sh\necho "stub $(basename "$0") $*" >&2\nexit 1\n');
    chmodSync(path.join(bin, name), 0o755);
  }
  return { root, bin };
}

/**
 * Runs node in the clone with PATH and `env` alone, so no report directory or
 * gate of this run reaches it. Returns its exit status and everything it printed.
 */
function inClone({ root, bin }, args, env = {}) {
  const result = spawnSync(process.execPath, args, {
    cwd: root,
    encoding: 'utf8',
    env: { PATH: [bin, '/usr/bin', '/bin'].join(path.delimiter), ...env },
    timeout: 120_000,
  });
  return { status: result.status, output: `${result.stdout ?? ''}${result.stderr ?? ''}` };
}

test('pnpm ci:security-proxy writes the registry, so the proxy specs load the route table on a fresh clone', (t) => {
  const clone = freshClone(t);
  assert.equal(
    existsSync(path.join(clone.root, GENERATED)),
    false,
    'a fresh clone has no registry',
  );
  // --list loads every spec, as the image job's run does, and runs none.
  const { status, output } = inClone(clone, [path.join('ci', 'test-security-proxy.mjs'), '--list']);
  assert.equal(status, 0, output);
  assert.doesNotMatch(output, /Cannot find module/);
  assert.ok(existsSync(path.join(clone.root, GENERATED, 'registry.meta.ts')), output);
  const listed = /Total: (\d+) tests? in \d+ files?/.exec(output);
  assert.ok(listed && Number(listed[1]) > 0, output);
  for (const spec of ['security-suite.ts', 'security.spec.ts', 'hop-count.spec.ts']) {
    assert.ok(output.includes(spec), `${spec} lists no test:\n${output}`);
  }
  assert.doesNotMatch(output, /^stub /m, 'listing reached a container CLI');
});

test('pnpm smoke:profiles writes the registry, so it loads the route table on a fresh clone', (t) => {
  const clone = freshClone(t);
  assert.equal(
    existsSync(path.join(clone.root, GENERATED)),
    false,
    'a fresh clone has no registry',
  );
  const { status, output } = inClone(
    clone,
    ['--import', 'tsx', path.join('ci', 'smoke-profiles.mjs')],
    { CONTAINER_CLI: path.join(clone.bin, 'docker') },
  );
  assert.doesNotMatch(output, /Cannot find module/);
  // Past the route table, it stops at its first container step, whichever
  // that is: the stub refuses every one.
  assert.match(output, /^stub docker \S/m);
  assert.equal(status, 1, output);
  assert.ok(existsSync(path.join(clone.root, GENERATED, 'registry.meta.ts')), output);
});

test("each script reports a registry that doesn't build as its own failure, before any container or spec runs", (t) => {
  const clone = freshClone(t);
  rmSync(path.join(clone.root, 'apps', 'web', 'scripts', 'build-registry.ts'));
  const env = { CONTAINER_CLI: path.join(clone.bin, 'docker') };
  const smoke = inClone(clone, ['--import', 'tsx', path.join('ci', 'smoke-profiles.mjs')], env);
  assert.equal(smoke.status, 1, smoke.output);
  // Its own failure line, as the end of a run prints one, and no stack of its own.
  assert.match(smoke.output, /^\[profiles\] FAIL smoke:profiles: the registry doesn't build/m);
  assert.doesNotMatch(smoke.output, /registry\.mjs:\d+/);
  assert.doesNotMatch(smoke.output, /^stub /m, 'smoke:profiles reached a container CLI');
  const proxy = inClone(clone, [path.join('ci', 'test-security-proxy.mjs'), '--list'], env);
  assert.equal(proxy.status, 1, proxy.output);
  assert.match(proxy.output, /^\[test:security:proxy\] the registry doesn't build/m);
  assert.doesNotMatch(proxy.output, /registry\.mjs:\d+/);
  assert.doesNotMatch(proxy.output, /Listing tests|Running \d+ tests?/, 'Playwright ran');
});
