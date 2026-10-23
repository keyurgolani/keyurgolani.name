import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { FIXED_TIME } from './lib/clock';
import { parseRunArgs } from './run';

test('quality:pr runs whole; quality:full takes a shard, and the rest goes to Playwright', () => {
  assert.deepEqual(parseRunArgs(['pr']), { mode: 'pr', shard: null, playwright: [] });
  assert.deepEqual(parseRunArgs(['full', '--', '--shard=2/3']), {
    mode: 'full',
    shard: '2/3',
    playwright: ['--shard=2/3'],
  });
  assert.deepEqual(parseRunArgs(['full', '--shard=1/1', '--grep', 'login']), {
    mode: 'full',
    shard: '1/1',
    playwright: ['--shard=1/1', '--grep', 'login'],
  });
  assert.throws(() => parseRunArgs(['pr', '--shard=1/2']), /quality:pr runs whole/);
  assert.throws(() => parseRunArgs(['full', '--shard=3/2']), /1 <= n <= m/);
  assert.throws(() => parseRunArgs(['full', '--shard=0/2']), /1 <= n <= m/);
  assert.throws(() => parseRunArgs(['full', '--shard=x']), /<n>\/<m>/);
  assert.throws(() => parseRunArgs(['nightly']), /usage/);
  assert.throws(() => parseRunArgs([]), /usage/);
});

test("the page's fixed time is the server preload's, which can't be imported here without setting it", () => {
  const preload = readFileSync(
    fileURLToPath(new URL('../harness/fixed-clock.mjs', import.meta.url)),
    'utf8',
  );
  assert.ok(preload.includes(`export const FIXED_TIME = '${FIXED_TIME}';`));
});
