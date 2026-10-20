import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { reproCommandFor } from './run.mjs';

const RUNNER = path.join(path.dirname(fileURLToPath(import.meta.url)), 'run.mjs');
const REPORTS = path.join(path.dirname(fileURLToPath(import.meta.url)), 'lib', 'reports.mjs');

function runner(args, env = {}, seed = []) {
  const reports = mkdtempSync(path.join(tmpdir(), 'ci-run-'));
  seed.forEach((record, i) => {
    mkdirSync(path.join(reports, 'failures'), { recursive: true });
    writeFileSync(path.join(reports, 'failures', `seed-${i}.json`), JSON.stringify(record));
  });
  const result = spawnSync(process.execPath, [RUNNER, ...args], {
    encoding: 'utf8',
    env: {
      ...process.env,
      CI_REPORTS_DIR: reports,
      GITHUB_ACTIONS: '',
      npm_lifecycle_event: '',
      ...env,
    },
  });
  const dir = path.join(reports, 'failures');
  let records = [];
  try {
    records = readdirSync(dir).map((f) => JSON.parse(readFileSync(path.join(dir, f), 'utf8')));
  } catch {
    // no failures directory
  }
  rmSync(reports, { recursive: true, force: true });
  return { ...result, records };
}

test('a passing check writes no record and exits 0', () => {
  const result = runner(['demo', '--', process.execPath, '-e', 'process.exit(0)']);
  assert.equal(result.status, 0);
  assert.deepEqual(result.records, []);
  assert.match(result.stdout, /\[ci\] demo passed/);
});

test('a failing check exits with its status, prints the local command, and records it', () => {
  const result = runner(['demo', '--', process.execPath, '-e', 'process.exit(3)'], {
    npm_lifecycle_event: 'ci:demo',
  });
  assert.equal(result.status, 3);
  assert.match(result.stderr, /Reproduce locally with: pnpm ci:demo/);
  assert.equal(result.records.length, 1);
  assert.equal(result.records[0].gate, 'demo');
  assert.equal(result.records[0].reproCommand, 'pnpm ci:demo');
  assert.match(result.records[0].test, /exited with status 3/);
});

test('a check that writes its own record gets no generic one', () => {
  const script = `
    const { currentGate, writeFailureRecord } = await import(${JSON.stringify(REPORTS)});
    writeFailureRecord({ ...currentGate(), test: 'specific failure', route: '/x' });
    process.exit(1);
  `;
  const result = runner(['demo', '--', process.execPath, '--input-type=module', '-e', script]);
  assert.equal(result.status, 1);
  assert.equal(result.records.length, 1);
  assert.equal(result.records[0].test, 'specific failure');
  assert.equal(result.records[0].reproCommand, 'pnpm ci:demo');
});

test('a command that cannot start is recorded as a failure', () => {
  const result = runner(['demo', '--', 'definitely-not-a-command-kgn']);
  assert.notEqual(result.status, 0);
  assert.match(result.records[0]?.test ?? '', /could not start/);
});

test("a rerun clears that gate's old records and keeps other gates'", () => {
  const stale = { schemaVersion: '1.0', gate: 'demo', reproCommand: 'pnpm ci:demo' };
  const other = { schemaVersion: '1.0', gate: 'other', reproCommand: 'pnpm ci:other' };
  const result = runner(['demo', '--', process.execPath, '-e', 'process.exit(0)'], {}, [
    stale,
    other,
  ]);
  assert.equal(result.status, 0);
  assert.deepEqual(result.records, [other]);
});

test('bad usage exits 2', () => {
  assert.equal(runner(['demo']).status, 2);
});

test('the local command comes from the pnpm script name', () => {
  assert.equal(reproCommandFor('lint', { npm_lifecycle_event: 'ci:lint' }), 'pnpm ci:lint');
  assert.equal(reproCommandFor('lint', { npm_lifecycle_event: 'check:pins' }), 'pnpm ci:lint');
  assert.equal(reproCommandFor('lint', {}), 'pnpm ci:lint');
});
