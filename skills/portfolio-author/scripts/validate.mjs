#!/usr/bin/env node
/**
 * validate.mjs: validate a portfolio's two documents against @portfolio/schema.
 *
 * Usage:   node validate.mjs <dir>
 *
 * <dir> holds the pair: portfolio.yml and site.yml, or their .yaml or .json
 * forms. It prints each record the way `pnpm config:validate` does (where it
 * is, its code and severity, what's wrong, and how to fix it), then one line
 * on the pair. Exit 1 when a record blocks the pair or the directory can't be
 * read, 0 otherwise (warnings may remain), and 2 on a usage error.
 *
 * It reads the pair the way the server does, through @portfolio/schema/node's
 * loadPair, against the variants, appearance ids, and content extensions
 * this build registers. Links aren't checked against the site's origin: run `pnpm
 * config:validate <dir> --origin <url>` for that.
 *
 * Loads the TypeScript sources through the `tsx` loader, since the packages
 * have no build step.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';

// Both loaders: the web app's modules are CommonJS-scoped TypeScript, and the
// schema package's are ES modules.
try {
  await import('tsx/cjs/api').then((m) => m.register());
  await import('tsx/esm/api').then((m) => m.register());
} catch (e) {
  console.error('error: validate.mjs requires `tsx` to load @portfolio/schema.');
  console.error('Install with: pnpm add -Dw tsx');
  console.error(e?.message ?? e);
  process.exit(2);
}

function findRepoRoot(start) {
  let dir = path.dirname(start);
  for (let i = 0; i < 10; i++) {
    try {
      const pkg = JSON.parse(readFileSync(path.join(dir, 'package.json'), 'utf8'));
      if (pkg.name === 'portfolio-monorepo') return dir;
    } catch {}
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  throw new Error('could not find repo root from ' + start);
}

const REPO_ROOT = findRepoRoot(fileURLToPath(import.meta.url));
// The variant registry is server-only (#6): resolve server-only as Next's server does.
await import(pathToFileURL(path.join(REPO_ROOT, 'apps/web/scripts/server-only.cjs')).href);
/**
 * A module's exports by name. A CommonJS one arrives as `module.exports`
 * from Node 23 on, and as its default export on Node 22.
 */
const load = (file) =>
  import(pathToFileURL(path.join(REPO_ROOT, file)).href).then(
    (module) => module['module.exports'] ?? { ...module.default, ...module },
  );

const dir = process.argv[2];
if (!dir || process.argv.length > 3) {
  console.error(
    'usage: node validate.mjs <dir>, the directory that holds portfolio.yml and site.yml',
  );
  process.exit(2);
}

// What this build registers, as `pnpm config:validate` reads it: the
// registry `pnpm --filter @portfolio/web build:registry` generates.
let ctx;
try {
  const { liveContext } = await load('apps/web/src/lib/variants.ts');
  ctx = liveContext();
} catch (e) {
  console.error(
    "error: can't load this build's variant registry. Run pnpm --filter @portfolio/web build:registry first.",
  );
  console.error(e?.message ?? e);
  process.exit(2);
}

const { formatRecords, loadPair, pairFileNames } = await load('packages/schema/src/node.ts');
const result = loadPair(dir, ctx);
if (!result.ok && result.directory) {
  const why = {
    missing: "doesn't exist",
    'not-directory': 'is a file',
    unreadable: "can't be read",
  };
  console.log(`${dir} ${why[result.directory]}. Give the directory that holds the pair.`);
  process.exit(1);
}
process.stdout.write(formatRecords(result));
if (result.ok) {
  const { portfolio, site } = pairFileNames(result);
  const warnings = result.diagnostics.length;
  console.log(
    `${portfolio} and ${site} are valid${warnings ? `, with ${warnings} warning${warnings === 1 ? '' : 's'}` : ''}.`,
  );
  process.exit(0);
}
const blocking = result.diagnostics.filter(({ severity }) => severity !== 'warning').length;
console.log(
  `${dir} can't go live: ${blocking} record${blocking === 1 ? ' blocks' : 's block'} it.`,
);
process.exit(1);
