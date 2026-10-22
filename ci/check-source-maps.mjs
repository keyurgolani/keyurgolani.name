#!/usr/bin/env node
// A default build ships no browser source maps (#6, Slice 1). Only
// PORTFOLIO_ANALYZE=1 turns on next.config.ts's productionBrowserSourceMaps,
// for pnpm test:trace's package attribution, and nothing that builds the
// image or runs in CI sets it (ci/source-maps.test.mjs). This fails when a
// build left any .map file under apps/web/.next/static, the tree a server
// serves at /_next/static. CI's build job runs it after pnpm ci:build.
//
//   node ci/check-source-maps.mjs [static dir]
import { existsSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { currentGate, REPO_ROOT, reportError, writeFailureRecord } from './lib/reports.mjs';

export const STATIC_DIR = path.join(REPO_ROOT, 'apps', 'web', '.next', 'static');

/** Every .map file under `dir`, relative to it, sorted. */
export function sourceMapFiles(dir) {
  const found = [];
  const walk = (current) => {
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const file = path.join(current, entry.name);
      if (entry.isDirectory()) walk(file);
      else if (entry.name.endsWith('.map')) found.push(path.relative(dir, file));
    }
  };
  walk(dir);
  return found.sort();
}

/**
 * What the check finds in `dir`: null when it passes, else the message.
 *
 * @param {string} dir
 * @param {Record<string, string | undefined>} [env]
 */
export function checkSourceMaps(dir, env = process.env) {
  if (env.PORTFOLIO_ANALYZE === '1') {
    return 'PORTFOLIO_ANALYZE=1 is set, and this check is for the default build. Unset it and rebuild.';
  }
  if (!existsSync(dir)) {
    return `No build at ${path.relative(REPO_ROOT, dir)}. Run pnpm build first.`;
  }
  const maps = sourceMapFiles(dir);
  if (maps.length === 0) return null;
  const shown = maps.slice(0, 10).join(', ');
  const more = maps.length > 10 ? `, and ${maps.length - 10} more` : '';
  return `The default build shipped ${maps.length} source map file(s) under ${path.relative(REPO_ROOT, dir)}: ${shown}${more}. Only a PORTFOLIO_ANALYZE=1 build may.`;
}

function main(argv) {
  const dir = path.resolve(argv[0] ?? STATIC_DIR);
  const problem = checkSourceMaps(dir);
  if (!problem) {
    console.log(`[source-maps] no .map file under ${path.relative(REPO_ROOT, dir)}`);
    return 0;
  }
  reportError(problem, { title: 'source maps' });
  const gate = currentGate();
  if (gate) {
    const maps = existsSync(dir) ? sourceMapFiles(dir) : [];
    writeFailureRecord({
      ...gate,
      test: 'a default build ships no browser source maps',
      asset: maps[0] ? path.relative(REPO_ROOT, path.join(dir, maps[0])) : undefined,
      expected: 'no .map file under apps/web/.next/static',
      actual: problem,
    });
  }
  return 1;
}

if (path.resolve(process.argv[1] ?? '') === fileURLToPath(import.meta.url)) {
  process.exit(main(process.argv.slice(2)));
}
