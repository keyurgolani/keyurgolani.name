// Builds the route specs' fixture host once, before any of them starts a
// server, and removes it after the last one (#5, Slice 4). The build runs
// alone, so nothing it loads the machine with lands on a test's timing.
import path from 'node:path';
import type { FullConfig } from '@playwright/test';
import { buildFixtureHost, FIXTURE_HOST_ENV } from '../harness/fixture-host.mjs';
import { PUBLIC_FILE } from './apps';

export default function setup(config: FullConfig): () => void {
  const log = path.join(path.dirname(config.projects[0]!.outputDir), 'fixture-host.log');
  const started = Date.now();
  const host = buildFixtureHost({
    variants: ['chapters', 'notes'],
    publicFiles: { [PUBLIC_FILE.name]: PUBLIC_FILE.text },
    log,
  });
  console.log(
    `[routes] fixture host with ${host.packages.join(', ')} built in ${Math.round((Date.now() - started) / 1000)}s`,
  );
  // Workers start after this returns, with this environment.
  process.env[FIXTURE_HOST_ENV] = host.web;
  return () => host.remove();
}
