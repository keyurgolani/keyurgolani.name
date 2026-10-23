import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { FIXED_TIME } from './lib/clock';
import { scrubRun, parseRunArgs } from './run';
import { plantCanary } from './lib/artifacts.mjs';
import { UNKNOWN_FORM } from './lib/canary-forms.mjs';

test("quality:full's shard goes to Playwright; quality:pr's stays the runner's (pr-shards.test.ts), and the rest goes to Playwright", () => {
  assert.deepEqual(parseRunArgs(['pr']), {
    mode: 'pr',
    shard: null,
    externalVariant: false,
    playwright: [],
  });
  assert.deepEqual(parseRunArgs(['full', '--', '--shard=2/3']), {
    mode: 'full',
    shard: '2/3',
    externalVariant: false,
    playwright: ['--shard=2/3'],
  });
  assert.deepEqual(parseRunArgs(['full', '--shard=1/1', '--grep', 'login']), {
    mode: 'full',
    shard: '1/1',
    externalVariant: false,
    playwright: ['--shard=1/1', '--grep', 'login'],
  });
  assert.deepEqual(parseRunArgs(['pr', '--shard=1/2']), {
    mode: 'pr',
    shard: '1/2',
    externalVariant: false,
    playwright: [],
  });
  assert.throws(() => parseRunArgs(['full', '--shard=3/2']), /1 <= n <= m/);
  assert.throws(() => parseRunArgs(['full', '--shard=0/2']), /1 <= n <= m/);
  assert.throws(() => parseRunArgs(['full', '--shard=x']), /<n>\/<m>/);
  assert.throws(() => parseRunArgs(['nightly']), /usage/);
  assert.deepEqual(parseRunArgs(['full', '--', '--external-variant', '--shard=1/2']), {
    mode: 'full',
    shard: '1/2',
    externalVariant: true,
    playwright: ['--shard=1/2'],
  });
  assert.throws(() => parseRunArgs(['pr', '--external-variant']), /close and scheduled runs/);
  assert.throws(() => parseRunArgs([]), /usage/);
});

test("the page's fixed time is the server preload's, which can't be imported here without setting it", () => {
  const preload = readFileSync(
    fileURLToPath(new URL('../harness/fixed-clock.mjs', import.meta.url)),
    'utf8',
  );
  assert.ok(preload.includes(`export const FIXED_TIME = '${FIXED_TIME}';`));
});

test("run.ts never scrubs by the canary's value: a form no rule knows keeps it for the scan to fail", async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'quality-run-scrub-'));
  try {
    const canary = plantCanary();
    const secrets = path.join(dir, 'secrets');
    writeFileSync(secrets, `${JSON.stringify('session-cookie-value')}\n`);
    const reports = path.join(dir, 'reports');
    mkdirSync(reports);
    writeFileSync(
      path.join(reports, 'server.log'),
      `${UNKNOWN_FORM(canary)}session-cookie-value\n`,
    );
    const { before, after, removed } = await scrubRun(reports, canary, secrets);
    assert.equal(before.length, 1);
    assert.deepEqual(
      after.map(({ file }) => path.basename(file)),
      ['server.log'],
    );
    assert.deepEqual(removed, []);
    assert.ok(
      !readFileSync(path.join(reports, 'server.log'), 'utf8').includes('session-cookie-value'),
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
