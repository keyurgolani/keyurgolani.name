import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { childEnv, reproCommandFor } from './run.mjs';

const RUNNER = path.join(path.dirname(fileURLToPath(import.meta.url)), 'run.mjs');
const REPORTS = path.join(path.dirname(fileURLToPath(import.meta.url)), 'lib', 'reports.mjs');

function runner(args, env = {}, seed = []) {
  const reports = mkdtempSync(path.join(tmpdir(), 'ci-run-'));
  seed.forEach((record, i) => {
    mkdirSync(path.join(reports, 'failures'), { recursive: true });
    writeFileSync(path.join(reports, 'failures', `seed-${i}.json`), JSON.stringify(record));
  });
  // The outer runner's CI_* variables, such as CI_REPRO_COMMAND when this
  // file runs inside a CI shard, never reach the runner under test.
  const inherited = Object.fromEntries(
    Object.entries(process.env).filter(([key]) => !key.startsWith('CI_')),
  );
  const result = spawnSync(process.execPath, [RUNNER, ...args], {
    encoding: 'utf8',
    env: {
      ...inherited,
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
  assert.equal(
    reproCommandFor('unit', {
      npm_lifecycle_event: 'ci:unit',
      CI_REPRO_COMMAND: 'pnpm test:shard unit 2/3',
    }),
    'pnpm test:shard unit 2/3',
  );
});

test("a shard's CI_REPRO_COMMAND names only that run, and never reaches the command it runs", () => {
  const probe =
    'console.log(JSON.stringify({ outer: process.env.CI_REPRO_COMMAND ?? null, repro: process.env.CI_REPRO }))';
  const result = runner(['unit', '--', process.execPath, '-e', probe], {
    CI_REPRO_COMMAND: 'pnpm test:shard unit 2/3',
  });
  assert.equal(result.status, 0);
  const seen = JSON.parse(result.stdout.split('\n').find((line) => line.startsWith('{')));
  assert.deepEqual(seen, { outer: null, repro: 'pnpm test:shard unit 2/3' });
  assert.equal(childEnv({ CI_REPRO_COMMAND: 'x', A: '1' }, 'g', 'r').CI_REPRO_COMMAND, undefined);
});

test('a gate nested under a shard reports its own command', () => {
  const nested = [
    process.execPath,
    RUNNER,
    'demo',
    '--',
    process.execPath,
    '-e',
    'process.exit(4)',
  ];
  const outer = `process.exit(require('node:child_process').spawnSync(${JSON.stringify(nested[0])}, ${JSON.stringify(nested.slice(1))}, { stdio: 'inherit' }).status)`;
  const result = runner(['unit', '--', process.execPath, '-e', outer], {
    CI_REPRO_COMMAND: 'pnpm test:shard unit 2/3',
  });
  assert.equal(result.status, 4);
  assert.equal(result.records.find((r) => r.gate === 'demo')?.reproCommand, 'pnpm ci:demo');
  assert.equal(
    result.records.find((r) => r.gate === 'unit')?.reproCommand,
    'pnpm test:shard unit 2/3',
  );
});
