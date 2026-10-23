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
import { readFileSync, realpathSync, statSync } from 'node:fs';
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

/** Why the CLI won't run on the origin it was given. */
export class OriginError extends Error {}

type Env = Readonly<Record<string, string | undefined>>;

/**
 * PORTFOLIO_ORIGIN, or the file PORTFOLIO_ORIGIN_FILE names, read as
 * config.ts reads them: one or the other, the file a regular one, with one
 * trailing newline trimmed, and empty counting as unset. The origin's
 * warning rules, such as origin.sample, go by it, so a value that isn't a
 * bare http or https origin is refused, as startup refuses it.
 */
export function storeOrigin(
  env: Env,
  files: {
    readonly readFile?: (file: string) => string;
    readonly isFile?: (file: string) => boolean;
  } = {},
): string | undefined {
  const readFile = files.readFile ?? ((file) => readFileSync(file, 'utf8'));
  const isFile = files.isFile ?? ((file) => statSync(file).isFile());
  const direct = env.PORTFOLIO_ORIGIN || undefined;
  const file = env.PORTFOLIO_ORIGIN_FILE || undefined;
  if (direct !== undefined && file !== undefined) {
    throw new OriginError('Set PORTFOLIO_ORIGIN or PORTFOLIO_ORIGIN_FILE, not both.');
  }
  let value = direct;
  if (file !== undefined) {
    try {
      if (!isFile(file)) throw new Error('not a regular file');
      const text = readFile(file);
      value = text.replace(/\r?\n$/, '') || undefined;
    } catch {
      throw new OriginError('PORTFOLIO_ORIGIN_FILE must name a regular file this user can read.');
    }
  }
  if (value === undefined) return undefined;
  try {
    const url = new URL(value);
    if (/^https?:$/.test(url.protocol) && url.origin === value) return url.origin;
  } catch {
    // Not a URL at all.
  }
  throw new OriginError(
    'PORTFOLIO_ORIGIN must be a bare origin: http or https, a host, and an optional port, ' +
      'with no path or trailing slash, such as https://jane.name.',
  );
}

/** The checks the CLI runs a unit through, on the origin `env` gives. Throws OriginError. */
export function storeChecks(env: Env): UnitChecks {
  const canonical = storeOrigin(env);
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
/** The checks, or null once it said why it can't run, as a usage error. */
function mainChecks(): UnitChecks | null {
  try {
    return storeChecks(process.env);
  } catch (error) {
    if (!(error instanceof OriginError)) throw error;
    process.stderr.write(`origin_invalid: ${error.message} Nothing was read or changed.\n`);
    process.exitCode = 2;
    return null;
  }
}

const checks = isMain() ? mainChecks() : null;
if (checks) {
  void runCli({
    argv: process.argv.slice(2),
    env: process.env,
    checks,
    readSource: (dir) => readPairBytes(dir, context),
    envBase: webDir(),
    // A path on the command line is from where pnpm ran, or the shell is.
    cwd: process.env.INIT_CWD || process.cwd(),
  }).then((code) => {
    process.exitCode = code;
  });
}
