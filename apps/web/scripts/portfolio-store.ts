#!/usr/bin/env node
/**
 * portfolio-store.ts: the revision store's command line (#3, item 26), for
 * the owner profile's data directory. It binds what this build registers,
 * from #5's generated metadata module, as #4's config.mjs does, through the
 * composition root's own buildUnitChecks(), so a revision the CLI writes
 * records the rendering the server's would, and #4's pair loader, then runs
 * runCli() from @portfolio/core.
 *
 *   pnpm run store <command> [options]          in a clone, through tsx
 *   node bin/portfolio-store.mjs <command>      in the image, as /app/bin/portfolio-store.mjs
 *
 * `pnpm store` alone is pnpm's own command, so a clone says `pnpm run store`.
 * The image's copy is this file bundled by esbuild with every module it
 * imports (scripts/bundle-store.mjs), so it needs Node and nothing else.
 * `--help` and packages/core/src/cli.ts say what each command does.
 */
import { realpathSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { UnitChecks } from '@portfolio/core';
import { readPairBytes } from '@portfolio/schema/node';
import { runCli } from '../../../packages/core/src/cli';
import { CONTENT_EXTENSIONS } from '../src/lib/generated/registry.extensions';
import { VARIANTS } from '../src/lib/generated/registry.meta';
import { createAppearanceCatalog } from '../src/server/appearance-catalog';
import { buildUnitChecks } from '../src/server/unit-checks';
import webPackage from '../package.json' with { type: 'json' };

/**
 * apps/web, which a relative PORTFOLIO_DATA_DIR or PORTFOLIO_SOURCE_DIR
 * resolves against, as the server's do: this file's parent in the repo, and
 * /app/apps/web for the bundle at /app/bin in the image.
 */
function webDir(): string {
  const here = path.dirname(fileURLToPath(import.meta.url));
  return path.basename(here) === 'scripts'
    ? path.resolve(here, '..')
    : path.resolve(here, '..', 'apps', 'web');
}

/** PORTFOLIO_ORIGIN when it's a bare http or https origin, as startup takes it, else nothing. */
function origin(value: string | undefined): string | undefined {
  if (!value) return undefined;
  try {
    const url = new URL(value);
    return /^https?:$/.test(url.protocol) && url.origin === value ? url.origin : undefined;
  } catch {
    return undefined;
  }
}

/** The checks the CLI runs a unit through, on PORTFOLIO_ORIGIN as `env` has it. */
export function storeChecks(env: Readonly<Record<string, string | undefined>>): UnitChecks {
  const canonical = origin(env.PORTFOLIO_ORIGIN);
  return buildUnitChecks({
    registry: VARIANTS,
    extensions: CONTENT_EXTENSIONS,
    ...(canonical ? { origin: canonical } : {}),
    appVersion: webPackage.version,
  });
}

/** Whether this file is the process's own script: importing it, as a test does, runs nothing. */
function isMain(): boolean {
  const script = process.argv[1];
  if (!script) return false;
  try {
    return realpathSync(script) === realpathSync(fileURLToPath(import.meta.url));
  } catch {
    return false;
  }
}

const context = { catalog: createAppearanceCatalog(), extensions: CONTENT_EXTENSIONS };

// No top-level await: tsx runs this file as CommonJS, since apps/web isn't a module package.
if (isMain()) {
  void runCli({
    argv: process.argv.slice(2),
    env: process.env,
    checks: storeChecks(process.env),
    readSource: (dir) => readPairBytes(dir, context),
    envBase: webDir(),
    // A path on the command line is from where pnpm ran, or the shell is.
    cwd: process.env.INIT_CWD || process.cwd(),
  }).then((code) => {
    process.exitCode = code;
  });
}
