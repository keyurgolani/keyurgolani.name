import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

test('run directly with no pnpm and no corepack, the baseline stops at once and leaves nothing', (t) => {
  // node tests/trace/baseline.mjs, not under pnpm run: no npm_execpath, and
  // here nothing on PATH to run pnpm with, git included, so a run that went
  // any further would fail on something else.
  const root = mkdtempSync(path.join(tmpdir(), 'baseline-run-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const empty = path.join(root, 'bin');
  const temp = path.join(root, 'tmp');
  const reports = path.join(root, 'reports');
  mkdirSync(empty);
  mkdirSync(temp);
  const run = spawnSync(
    process.execPath,
    [path.join(REPO_ROOT, 'tests', 'trace', 'baseline.mjs')],
    {
      cwd: REPO_ROOT,
      env: { PATH: empty, HOME: root, TMPDIR: temp, CI_REPORTS_DIR: reports },
      encoding: 'utf8',
      timeout: 30_000,
    },
  );
  assert.equal(run.error, undefined, 'it ended by itself');
  assert.equal(run.status, 1, run.stderr);
  assert.equal(
    run.stderr,
    '[baseline] No pnpm: run this as pnpm test:trace:baseline, or put pnpm or corepack on PATH.\n',
  );
  assert.deepEqual(readdirSync(temp), [], 'its temporary directory is gone');
  assert.deepEqual(readdirSync(root).sort(), ['bin', 'tmp'], 'it wrote no reports');
});
