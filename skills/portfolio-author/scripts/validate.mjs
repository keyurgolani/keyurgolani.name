#!/usr/bin/env node
/**
 * validate.mjs — validate a portfolio document against @portfolio/schema.
 *
 * Usage:   node validate.mjs <path/to/portfolio.yml | portfolio.json>
 * Output:  on error, prints "<file>:<line>:<col>  <message>" for each
 *          problem. Exit 1 on any error, 0 on success.
 *
 * It reads the document the way the server does: @portfolio/schema's
 * parsePortfolio, so the same YAML and JSON rules, schema, and unique section
 * ids apply, and every problem carries its JSON pointer and position.
 *
 * Loads the schema's TypeScript source via the `tsx` loader because
 * @portfolio/schema has no build step (it exports src/index.ts directly).
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';

// Try to register tsx so that we can `import` packages/schema/src/index.ts
try {
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

const __filename = fileURLToPath(import.meta.url);
const REPO_ROOT = findRepoRoot(__filename);

// Dynamic import after tsx is registered.
const schemaIndex = path.join(REPO_ROOT, 'packages/schema/src/index.ts');
const { detectFormat, parsePortfolio } = await import(pathToFileURL(schemaIndex).href);
if (!parsePortfolio) {
  console.error('error: @portfolio/schema does not export parsePortfolio');
  process.exit(2);
}

const file = process.argv[2];
if (!file) {
  console.error('usage: node validate.mjs <portfolio.yml | portfolio.json>');
  process.exit(2);
}

let format;
try {
  format = detectFormat(file);
} catch (error) {
  console.error(`error: ${error.message}`);
  process.exit(2);
}

const result = parsePortfolio(readFileSync(file, 'utf8'), format);
if (result.ok) process.exit(0);

for (const problem of result.problems) {
  const where = problem.line !== undefined ? `${file}:${problem.line}:${problem.column}` : file;
  console.log(`${where}  ${problem.message}`);
}
process.exit(1);
