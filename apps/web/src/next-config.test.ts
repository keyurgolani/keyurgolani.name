import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

// Browser source maps (#6, Slice 1): next.config.ts turns on
// productionBrowserSourceMaps for PORTFOLIO_ANALYZE=1 and for nothing else,
// so only a build that asks for them, the one pnpm test:trace attributes
// chunk bytes with, ships .map files. Each case loads the config in a fresh
// process, since the config reads the variable once, as it loads.

const WEB = fileURLToPath(new URL('..', import.meta.url));

/** productionBrowserSourceMaps, as next.config.ts sets it with PORTFOLIO_ANALYZE at `value`. */
function sourceMapsWith(value: string | undefined): unknown {
  const env: Record<string, string | undefined> = { ...process.env };
  delete env.PORTFOLIO_ANALYZE;
  if (value !== undefined) env.PORTFOLIO_ANALYZE = value;
  const run = spawnSync(
    process.execPath,
    [
      '--import',
      'tsx',
      '-e',
      "const { default: config } = require('./next.config.ts'); process.stdout.write(JSON.stringify(config.productionBrowserSourceMaps));",
    ],
    { cwd: WEB, env, encoding: 'utf8' },
  );
  assert.equal(run.status, 0, run.stderr);
  return JSON.parse(run.stdout);
}

test('a build without PORTFOLIO_ANALYZE ships no browser source maps', () => {
  assert.equal(sourceMapsWith(undefined), false);
});

test('PORTFOLIO_ANALYZE=1 turns browser source maps on', () => {
  assert.equal(sourceMapsWith('1'), true);
});

test('any other PORTFOLIO_ANALYZE value leaves them off', () => {
  for (const value of ['', '0', 'true', 'yes', ' 1']) {
    assert.equal(sourceMapsWith(value), false, JSON.stringify(value));
  }
});
