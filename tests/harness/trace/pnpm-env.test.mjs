import assert from 'node:assert/strict';
import { test } from 'node:test';
import { withoutPnpmSettings } from './pnpm-env.mjs';

test("another checkout's install gets none of the settings pnpm run passed down", () => {
  const env = {
    PATH: '/usr/bin',
    HOME: '/Users/someone',
    npm_config_strict_dep_builds: 'true',
    npm_config_frozen_lockfile: '',
    NPM_CONFIG_REGISTRY: 'http://127.0.0.1:9/',
    pnpm_config_verify_deps_before_run: 'false',
    npm_execpath: '/pnpm/bin/pnpm.cjs',
    PNPM_HOME: '/Users/someone/Library/pnpm',
  };
  assert.deepEqual(withoutPnpmSettings(env), {
    PATH: '/usr/bin',
    HOME: '/Users/someone',
    npm_execpath: '/pnpm/bin/pnpm.cjs',
    PNPM_HOME: '/Users/someone/Library/pnpm',
  });
  assert.equal(env.npm_config_strict_dep_builds, 'true', 'it leaves its argument alone');
});
