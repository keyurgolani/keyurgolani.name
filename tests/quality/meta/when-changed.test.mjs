import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { changedFiles, touchesWatched } from './when-changed.mjs';

const SCRIPT = fileURLToPath(new URL('./when-changed.mjs', import.meta.url));

test('quality:meta runs on a pull request that changes tests/quality, quality, or the workflows, and on no other', () => {
  assert.ok(touchesWatched(['README.md', 'tests/quality/run.ts']));
  assert.ok(touchesWatched(['quality/surfaces/login.ts']));
  assert.ok(touchesWatched(['.github/workflows/ci.yml']));
  assert.ok(!touchesWatched(['apps/web/src/proxy.ts', 'tests/e2e/smoke.spec.ts', 'quality.md']));
  assert.ok(!touchesWatched(['tests/qualityx/a.ts', 'packages/quality/a.ts']));
  assert.ok(!touchesWatched([]));
});

test("a pull request's changes are its merge commit's against the base, its first parent", () => {
  const calls = [];
  const git = (args) => {
    calls.push(args);
    return 'tests/quality/run.ts\nREADME.md\n';
  };
  assert.deepEqual(changedFiles({ GITHUB_EVENT_NAME: 'pull_request' }, git), [
    'tests/quality/run.ts',
    'README.md',
  ]);
  assert.deepEqual(calls, [['diff', '--name-only', 'HEAD^1', 'HEAD']]);
  assert.equal(changedFiles({ GITHUB_EVENT_NAME: 'push' }, git), null, 'a push always runs it');
  assert.equal(changedFiles({}, git), null, 'a local run always runs it');
  const broken = () => {
    throw new Error('no parent');
  };
  assert.equal(
    changedFiles({ GITHUB_EVENT_NAME: 'pull_request' }, broken),
    null,
    'unreadable runs it',
  );
});

/** A git repository whose last commit changes `file`, as a pull request's merge commit would. */
function repository(file) {
  const dir = mkdtempSync(path.join(tmpdir(), 'quality-meta-changed-'));
  const git = (...args) =>
    execFileSync('git', ['-c', 'user.name=test', '-c', 'user.email=test@example.test', ...args], {
      cwd: dir,
      encoding: 'utf8',
    });
  git('init', '-q');
  writeFileSync(path.join(dir, 'README.md'), 'base\n');
  git('add', '-A');
  git('commit', '-q', '-m', 'base');
  mkdirSync(path.dirname(path.join(dir, file)), { recursive: true });
  writeFileSync(path.join(dir, file), 'change\n');
  git('add', '-A');
  git('commit', '-q', '-m', 'change');
  return dir;
}

test('with nothing to run it succeeds and says so; otherwise it runs the command and keeps its status', () => {
  const run = (cwd, env, command) =>
    spawnSync(process.execPath, [SCRIPT, '--', process.execPath, '-e', command], {
      cwd,
      env: { ...process.env, ...env },
      encoding: 'utf8',
    });
  const other = repository('apps/web/src/a.ts');
  const watched = repository('quality/surfaces/a.ts');
  try {
    const skipped = run(other, { GITHUB_EVENT_NAME: 'pull_request' }, 'process.exit(3)');
    assert.equal(skipped.status, 0);
    assert.match(skipped.stdout, /nothing to run/);
    assert.equal(run(watched, { GITHUB_EVENT_NAME: 'pull_request' }, 'process.exit(3)').status, 3);
    // Outside a pull request the command always runs.
    assert.equal(run(other, { GITHUB_EVENT_NAME: 'push' }, 'process.exit(4)').status, 4);
  } finally {
    rmSync(other, { recursive: true, force: true });
    rmSync(watched, { recursive: true, force: true });
  }
  assert.equal(spawnSync(process.execPath, [SCRIPT], { encoding: 'utf8' }).status, 2);
});
