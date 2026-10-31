import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SCRIPT = path.join(__dirname, 'kit-dedup.mjs');
const FIXTURES = path.join(__dirname, '__fixtures__');

function run(slug) {
  return spawnSync('node', [SCRIPT, path.join(FIXTURES, slug)], { encoding: 'utf8' });
}

test('kit-dedup never blocks (always exit 0)', () => {
  assert.equal(run('dedup-clean').status, 0);
  assert.equal(run('dedup-dirty').status, 0);
});

test('clean fixture reports no candidates', () => {
  const r = run('dedup-clean');
  assert.match(r.stdout, /no dedup candidates/i);
});

test('dirty fixture flags formatDate as a candidate', () => {
  const r = run('dedup-dirty');
  assert.match(r.stdout, /formatDate/);
});

test('dirty fixture flags formatCompactNumber as a candidate', () => {
  const r = run('dedup-dirty');
  assert.match(r.stdout, /formatCompactNumber/);
});

test('dirty fixture report mentions resolution options (hoist or LOCAL comment)', () => {
  const r = run('dedup-dirty');
  assert.match(r.stdout, /hoist|LOCAL/i);
});
