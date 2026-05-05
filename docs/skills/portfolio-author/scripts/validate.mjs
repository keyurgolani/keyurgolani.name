#!/usr/bin/env node
/**
 * validate.mjs — validate a portfolio.yml file against @portfolio/schema.
 *
 * Usage:   node validate.mjs <path/to/portfolio.yml>
 * Output:  on error, prints "<file>:<line>:<col>  <zod-path>  <message>"
 *          for each issue. Exit 1 on any error, 0 on success.
 *
 * Resolves @portfolio/schema relative to repo root. Uses yaml package
 * (workspace dep, available via @portfolio/schema's node_modules) for
 * AST-based source positions.
 *
 * Loads the schema's TypeScript source via the `tsx` loader because
 * @portfolio/schema has no build step (it exports src/index.ts directly).
 */
import { readFileSync, existsSync } from 'node:fs';
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
const schemaModule = await import(pathToFileURL(schemaIndex).href);
const PortfolioSchema = schemaModule.PortfolioSchema;
if (!PortfolioSchema) {
  console.error('error: @portfolio/schema does not export PortfolioSchema');
  process.exit(2);
}

// Resolve `yaml` package: try repo root, then schema package's node_modules,
// then bare specifier (in case it's hoisted).
async function loadYaml() {
  const candidates = [
    path.join(REPO_ROOT, 'node_modules/yaml/dist/index.js'),
    path.join(REPO_ROOT, 'packages/schema/node_modules/yaml/dist/index.js'),
    path.join(REPO_ROOT, 'apps/web/node_modules/yaml/dist/index.js'),
  ];
  for (const candidate of candidates) {
    if (existsSync(candidate)) {
      return import(pathToFileURL(candidate).href);
    }
  }
  return import('yaml');
}

const yamlModule = await loadYaml();
const { parseDocument } = yamlModule;

const file = process.argv[2];
if (!file) {
  console.error('usage: node validate.mjs <portfolio.yml>');
  process.exit(2);
}

const text = readFileSync(file, 'utf8');
const doc = parseDocument(text, { keepSourceTokens: true });

if (doc.errors.length) {
  for (const err of doc.errors) {
    const pos = err.linePos?.[0];
    const where = pos ? `${file}:${pos.line}:${pos.col}` : file;
    console.log(`${where}  yaml  ${err.message}`);
  }
  process.exit(1);
}

const data = doc.toJS();
const result = PortfolioSchema.safeParse(data);
if (result.success) {
  process.exit(0);
}

function offsetToLineCol(textArg, offset) {
  const before = textArg.slice(0, offset);
  const line = (before.match(/\n/g)?.length ?? 0) + 1;
  const lastNl = before.lastIndexOf('\n');
  const col = offset - (lastNl < 0 ? -1 : lastNl);
  return { line, col };
}

function resolveLine(astDoc, zodPath, sourceText) {
  let node = astDoc.contents;
  for (const segment of zodPath) {
    if (!node) return null;
    if (typeof segment === 'number' && node.items) {
      const item = node.items[segment];
      node = item?.value ?? item ?? null;
    } else if (typeof node.get === 'function') {
      node = node.get(segment, true);
    } else {
      return null;
    }
  }
  if (!node || !node.range) return null;
  return offsetToLineCol(sourceText, node.range[0]);
}

for (const issue of result.error.issues) {
  const pos = resolveLine(doc, issue.path, text);
  const where = pos ? `${file}:${pos.line}:${pos.col}` : file;
  const zodPath = issue.path.join('.') || '<root>';
  console.log(`${where}  ${zodPath}  ${issue.message}`);
}
process.exit(1);
