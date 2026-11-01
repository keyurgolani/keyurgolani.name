#!/usr/bin/env node
// A default build ships no browser source maps (#6, Slice 1). Only
// PORTFOLIO_ANALYZE=1 turns on next.config.ts's productionBrowserSourceMaps,
// for pnpm test:trace's package attribution, and nothing that builds the
// image or runs in CI sets it (ci/source-maps.test.mjs). This fails when a
// build left a .map file that holds anything of a source under
// apps/web/.next/static, the tree a server serves at /_next/static, or a
// script or stylesheet there that points at a map with a sourceMappingURL
// comment, or a symlink of any kind there, which the scan can't see through,
// or when apps/web/public, which the server serves at the site root
// and the image ships, holds any .map file at all. An empty map passes in
// the static tree alone: Turbopack in Next 16.4.1 writes one beside a
// `new URL` module worker's bundle whatever productionBrowserSourceMaps says
// (ci/lib/source-maps.mjs has the rule, which the image smoke shares). CI's
// build job runs it after pnpm ci:build.
//
//   node ci/check-source-maps.mjs [static dir] [public dir]
import { existsSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { currentGate, REPO_ROOT, reportError, writeFailureRecord } from './lib/reports.mjs';
import { scanSourceMaps } from './lib/source-maps.mjs';

export const STATIC_DIR = path.join(REPO_ROOT, 'apps', 'web', '.next', 'static');
export const PUBLIC_DIR = path.join(REPO_ROOT, 'apps', 'web', 'public');

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

/** Up to ten names, and how many more there are. */
function listed(names) {
  const shown = names.slice(0, 10).join(', ');
  return names.length > 10 ? `${shown}, and ${names.length - 10} more` : shown;
}

/**
 * What the check finds: null when it passes, else the message. The static
 * tree has to be there; public/ may not be, and then holds nothing.
 *
 * @param {string} dir the build's static tree
 * @param {Record<string, string | undefined>} [env]
 * @param {string} [publicDir]
 */
export function checkSourceMaps(dir, env = process.env, publicDir = PUBLIC_DIR) {
  if (env.PORTFOLIO_ANALYZE === '1') {
    return 'PORTFOLIO_ANALYZE=1 is set, and this check is for the default build. Unset it and rebuild.';
  }
  if (!existsSync(dir)) {
    return `No build at ${path.relative(REPO_ROOT, dir)}. Run pnpm build first.`;
  }
  const problems = [];
  const { maps, linked, symlinks } = scanSourceMaps(dir);
  if (maps.length > 0) {
    problems.push(
      `The default build shipped ${maps.length} source map file(s) under ${path.relative(REPO_ROOT, dir)}: ${listed(maps)}. Only a PORTFOLIO_ANALYZE=1 build may. (An empty map, which Turbopack writes for a new URL module worker, passes.)`,
    );
  }
  if (linked.length > 0) {
    problems.push(
      `Under ${path.relative(REPO_ROOT, dir)}, ${listed(linked)} point at a source map with a sourceMappingURL comment. No default build may.`,
    );
  }
  if (symlinks.length > 0) {
    problems.push(
      `Under ${path.relative(REPO_ROOT, dir)}, ${listed(symlinks)} ${symlinks.length === 1 ? 'is a symlink' : 'are symlinks'}, which the check doesn't follow. No default build may hold one.`,
    );
  }
  const served = existsSync(publicDir) ? sourceMapFiles(publicDir) : [];
  if (served.length > 0) {
    problems.push(
      `${path.relative(REPO_ROOT, publicDir)}, which the server serves at the site root and the image ships, holds ${served.length} source map file(s): ${listed(served)}. No build may put one there.`,
    );
  }
  return problems.length > 0 ? problems.join(' ') : null;
}

function main(argv) {
  const dir = path.resolve(argv[0] ?? STATIC_DIR);
  const publicDir = path.resolve(argv[1] ?? PUBLIC_DIR);
  const problem = checkSourceMaps(dir, process.env, publicDir);
  if (!problem) {
    const { empty } = scanSourceMaps(dir);
    const allowed =
      empty.length > 0
        ? ` (${empty.length} empty map${empty.length === 1 ? '' : 's'}, from a module worker: ${listed(empty)})`
        : '';
    console.log(
      `[source-maps] no source map under ${path.relative(REPO_ROOT, dir)} or ${path.relative(REPO_ROOT, publicDir)}${allowed}`,
    );
    return 0;
  }
  reportError(problem, { title: 'source maps' });
  const gate = currentGate();
  if (gate) {
    const scan = existsSync(dir) ? scanSourceMaps(dir) : { maps: [], linked: [], symlinks: [] };
    const maps = [
      ...[...scan.maps, ...scan.linked, ...scan.symlinks].map((file) => path.join(dir, file)),
      ...(existsSync(publicDir) ? sourceMapFiles(publicDir) : []).map((file) =>
        path.join(publicDir, file),
      ),
    ];
    writeFailureRecord({
      ...gate,
      test: 'a default build ships no browser source maps',
      asset: maps[0] ? path.relative(REPO_ROOT, maps[0]) : undefined,
      expected:
        'no source map but an empty one under apps/web/.next/static, none pointed at, no symlink there, and no .map file under apps/web/public',
      actual: problem,
    });
  }
  return 1;
}

if (path.resolve(process.argv[1] ?? '') === fileURLToPath(import.meta.url)) {
  process.exit(main(process.argv.slice(2)));
}
