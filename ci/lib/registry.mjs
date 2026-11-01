// The variant registry apps/web/scripts/build-registry.ts writes into the
// gitignored apps/web/src/lib/generated/. The route table imports it (#5,
// Slice 4), and `pnpm build`, `pnpm test`, and `pnpm typecheck` write it
// before they read it. A script that loads the route table without building
// the app, itself or through the harness, as `pnpm ci:security-proxy` and
// `pnpm smoke:profiles` do, writes it with buildRegistry() first, so it runs
// on a fresh clone. fresh-clone.test.mjs holds each one to it. They read the
// modules only, so it passes --modules-only and leaves public/ alone: the
// compiled files there are the last build's, which a harness copies.
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { REPO_ROOT } from './reports.mjs';

const SCRIPT = path.join(REPO_ROOT, 'apps', 'web', 'scripts', 'build-registry.ts');

/** Writes the generated registry and returns the line it printed; throws when it doesn't build. */
export function buildRegistry() {
  const result = spawnSync(process.execPath, ['--import', 'tsx', SCRIPT, '--modules-only'], {
    cwd: REPO_ROOT,
    encoding: 'utf8',
  });
  if (result.status !== 0) {
    const output = `${result.stdout ?? ''}${result.stderr ?? ''}${result.error?.message ?? ''}`;
    throw new Error(`the registry doesn't build: ${output}`.trim());
  }
  return result.stdout.trim();
}
