#!/usr/bin/env node
/**
 * new-variant.mjs — friendly wrapper around the monorepo's root scaffold
 * script (scripts/new-variant.mjs at repo root). Adds:
 *   - a clear error message if run from outside the monorepo
 *   - a follow-up reminder to fill out DESIGN.md before any code
 */
import { readFileSync, existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

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
  return null;
}

const root = findRepoRoot(fileURLToPath(import.meta.url));
if (!root) {
  console.error('error: must be run inside the keyurgolani/portfolio monorepo');
  process.exit(2);
}

const slug = process.argv[2];
if (!slug) {
  console.error('usage: node new-variant.mjs <slug>');
  process.exit(2);
}

const rootScaffold = path.join(root, 'scripts/new-variant.mjs');
if (!existsSync(rootScaffold)) {
  console.error('error: monorepo scaffold script not found at ' + rootScaffold);
  process.exit(2);
}

const r = spawnSync('node', [rootScaffold, slug], { stdio: 'inherit' });
if (r.status !== 0) process.exit(r.status ?? 1);

console.log(`
Next step: copy docs/skills/variant-developer/assets/DESIGN.template.md
  to packages/variant-${slug}/DESIGN.md and fill it out.
  Get user approval on DESIGN.md before writing any code.`);
