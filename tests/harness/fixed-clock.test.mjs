import { spawnSync } from 'node:child_process';
import assert from 'node:assert/strict';
import test from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';

// The fixed clock (#5, Slice 6), preloaded the way the variant specs start
// the server: it starts at 2026-01-01T00:00:00Z, time passes from there, and
// a Date built from a value is unchanged.

const PRELOAD = pathToFileURL(fileURLToPath(new URL('./fixed-clock.mjs', import.meta.url))).href;

/** What `script` prints, run under the preload. */
function underClock(script) {
  const result = spawnSync(process.execPath, ['-e', script], {
    // In UTC, as the harness runs the server.
    env: { PATH: process.env.PATH ?? '', TZ: 'UTC', NODE_OPTIONS: `--import=${PRELOAD}` },
    encoding: 'utf8',
  });
  assert.equal(result.status, 0, result.stderr);
  return JSON.parse(result.stdout);
}

test('the clock starts at 2026-01-01, on the UTC day every fixture renders under', async () => {
  const { FIXED_TIME } = await import(PRELOAD);
  assert.equal(FIXED_TIME, '2026-01-01T00:00:00.000Z');
  const seen = underClock(`
    const first = Date.now();
    const start = Date.now(); while (Date.now() - start < 20) {}
    console.log(JSON.stringify({
      created: new Date().toISOString(),
      now: first,
      later: Date.now() - first,
      called: Date(),
      isDate: new Date() instanceof Date,
      name: Date.name,
    }));
  `);
  assert.equal(seen.created.slice(0, 10), '2026-01-01');
  assert.ok(seen.now >= Date.parse(FIXED_TIME) && seen.now < Date.parse(FIXED_TIME) + 60_000);
  // Time passes, from there.
  assert.ok(seen.later >= 20, String(seen.later));
  assert.match(seen.called, /^Thu Jan 01 2026 /);
  assert.equal(seen.isDate, true);
  assert.equal(seen.name, 'Date');
});

test('a Date built from a value is the one it always was', () => {
  const seen = underClock(`
    console.log(JSON.stringify({
      epoch: new Date(0).toISOString(),
      parts: new Date(2024, 1, 29, 12).getDate(),
      text: new Date('2025-06-30T08:00:00Z').toISOString(),
      parse: Date.parse('2020-01-01T00:00:00Z'),
      utc: Date.UTC(2021, 0, 1),
    }));
  `);
  assert.deepEqual(seen, {
    epoch: '1970-01-01T00:00:00.000Z',
    parts: 29,
    text: '2025-06-30T08:00:00.000Z',
    parse: Date.parse('2020-01-01T00:00:00Z'),
    utc: Date.UTC(2021, 0, 1),
  });
});
