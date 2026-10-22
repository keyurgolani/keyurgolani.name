// Builds the appearance specs' fixture host once, before any of them starts
// a server, and removes it after the last one (#19, Slice 3): a copy of the
// workspace built with APPEARANCE_FIXTURES=1, which registers the fixture
// packs and serves /_fixtures/appearance. The build runs alone, so nothing
// it loads the machine with lands on a test's timing.
import path from 'node:path';
import type { FullConfig } from '@playwright/test';
import { buildFixtureHost, FIXTURE_HOST_ENV } from '../harness/fixture-host.mjs';

export default function setup(config: FullConfig): () => void {
  const log = path.join(path.dirname(config.projects[0]!.outputDir), 'fixture-host.log');
  const started = Date.now();
  const host = buildFixtureHost({
    variants: [],
    buildEnv: { APPEARANCE_FIXTURES: '1' },
    log,
  });
  console.log(
    `[appearance] fixture host with APPEARANCE_FIXTURES=1 built in ${Math.round((Date.now() - started) / 1000)}s`,
  );
  // Workers start after this returns, with this environment.
  process.env[FIXTURE_HOST_ENV] = host.web;
  return () => host.remove();
}
