import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { MERGED_VERDICT, mergeRun, parseMergeArgs } from './merge';
import { readShards } from './lib/shards';
import { SHARD_CASES } from './meta/shard-cases';

// pnpm quality:merge (#11, 11-4): a sharded quality:full run judged whole.
// The rules themselves are quality:meta's merged-verdict cases.

test('quality:merge takes one directory and an optional shard count', () => {
  assert.deepEqual(parseMergeArgs(['--', 'shards']), { dir: path.resolve('shards') });
  assert.deepEqual(parseMergeArgs(['shards', '--shards', '4']), {
    dir: path.resolve('shards'),
    expected: 4,
  });
  for (const bad of [[], ['a', 'b'], ['--shards', '4'], ['a', '--shards', '0'], ['--grep']]) {
    assert.throws(() => parseMergeArgs(bad), /usage: pnpm quality:merge/, bad.join(' '));
  }
});

test('every shard directory download-artifact leaves is read, however deep, and nothing else', () => {
  const root = mkdtempSync(path.join(tmpdir(), 'quality-merge-'));
  try {
    for (const dir of ['reports-quality-full-1/quality', 'nested/reports-quality-full-2/quality']) {
      mkdirSync(path.join(root, dir), { recursive: true });
      writeFileSync(path.join(root, dir, 'verdict.json'), '{"shard":"1/2"}');
    }
    mkdirSync(path.join(root, 'reports-links', 'failures'), { recursive: true });
    assert.deepEqual(
      readShards(root).map((shard) => shard.dir),
      ['nested/reports-quality-full-2', 'reports-quality-full-1'],
    );
    assert.deepEqual(readShards(path.join(root, 'none')), []);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('the merged verdict is written to the reports, and fails a run with no shard', (t) => {
  const reports = mkdtempSync(path.join(tmpdir(), 'quality-merge-reports-'));
  const empty = mkdtempSync(path.join(tmpdir(), 'quality-merge-empty-'));
  const previous = process.env.CI_REPORTS_DIR;
  process.env.CI_REPORTS_DIR = reports;
  t.mock.method(console, 'log', () => {});
  t.mock.method(console, 'error', () => {});
  try {
    const verdict = mergeRun(empty, 2);
    assert.equal(verdict.ok, false);
    const written = JSON.parse(
      readFileSync(path.join(reports, 'quality', MERGED_VERDICT), 'utf8'),
    ) as { ok: boolean; failures: { rule: string }[] };
    assert.deepEqual(
      written.failures.map(({ rule }) => rule),
      ['no-shards'],
    );
  } finally {
    if (previous === undefined) delete process.env.CI_REPORTS_DIR;
    else process.env.CI_REPORTS_DIR = previous;
    rmSync(reports, { recursive: true, force: true });
    rmSync(empty, { recursive: true, force: true });
  }
});

test('each merged-verdict case goes the way it should', async () => {
  const { judge } = await import('./meta/cases');
  for (const metaCase of SHARD_CASES) {
    assert.equal(judge(metaCase, await metaCase.run()), null, metaCase.id);
  }
});
