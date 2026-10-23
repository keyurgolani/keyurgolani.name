// Builds the preview fixture specs' host once, before any of them starts a
// server, and removes it after the last one (#7, Slice 4): a copy of the
// workspace built with PREVIEW_FIXTURES=1, which registers
// fixture-environment. The build runs alone, so nothing it loads the
// machine with lands on a test's timing. First it writes this checkout's
// own registry, with no fixture flag, which the shared harness reads as it
// loads (tests/harness/registry.ts) and which a checkout that hasn't been
// built has none of.
import { spawnSync } from 'node:child_process';
import { appendFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { FullConfig } from '@playwright/test';
import { FIXTURE_FLAG } from '../../ci/lib/fixture-flags.mjs';
import { buildFixtureHost, FIXTURE_HOST_ENV } from '../harness/fixture-host.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

/** Writes the checkout's registry with no fixture flag set, its output appended to `log`. */
function checkoutRegistry(log: string): void {
  const env: NodeJS.ProcessEnv = {};
  for (const [name, value] of Object.entries(process.env)) {
    if (!FIXTURE_FLAG.test(name)) env[name] = value;
  }
  const [command, ...prefix] = process.env.npm_execpath
    ? [process.execPath, process.env.npm_execpath]
    : ['pnpm'];
  const result = spawnSync(command!, [...prefix, '--filter', '@portfolio/web', 'build:registry'], {
    cwd: ROOT,
    env,
    encoding: 'utf8',
  });
  appendFileSync(log, `${result.stdout ?? ''}${result.stderr ?? ''}`);
  if (result.status !== 0) {
    throw new Error(`The checkout's registry didn't generate (log: ${log}).`);
  }
}

export default function setup(config: FullConfig): () => void {
  const log = path.join(path.dirname(config.projects[0]!.outputDir), 'fixture-host.log');
  mkdirSync(path.dirname(log), { recursive: true });
  checkoutRegistry(log);
  const started = Date.now();
  const host = buildFixtureHost({
    variants: [],
    buildEnv: { PREVIEW_FIXTURES: '1' },
    log,
  });
  console.log(
    `[preview-fixtures] fixture host with PREVIEW_FIXTURES=1 built in ${Math.round((Date.now() - started) / 1000)}s`,
  );
  // Workers start after this returns, with this environment.
  process.env[FIXTURE_HOST_ENV] = host.web;
  return () => host.remove();
}
