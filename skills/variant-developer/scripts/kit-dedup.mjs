#!/usr/bin/env node
/**
 * kit-dedup.mjs — heuristic dedup scanner for a variant.
 *
 * Greps the variant src/ for function declarations and arrow consts whose
 * names match exports from @portfolio/kit. Reports candidates; never blocks
 * (exit 0 always).
 *
 * Usage:
 *   node kit-dedup.mjs <variant-dir>
 *
 * The scanner is a NUDGE, not a gate. Authors resolve each flagged
 * candidate by either hoisting the helper to @portfolio/kit, or by adding
 * a `// LOCAL: <reason>` comment near the declaration to justify keeping
 * a local copy.
 */
import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

function findRepoRoot(start) {
  let dir = path.dirname(start);
  for (let i = 0; i < 10; i++) {
    try {
      const pkg = JSON.parse(readFileSync(path.join(dir, 'package.json'), 'utf8'));
      if (pkg.name === 'portfolio-monorepo') return dir;
    } catch {
      // continue walking up
    }
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}

function collectExportsFromFile(filePath, names, visited) {
  if (visited.has(filePath)) return;
  visited.add(filePath);
  if (!existsSync(filePath)) return;
  const text = readFileSync(filePath, 'utf8');

  // export { foo, bar } [from '...']
  for (const m of text.matchAll(
    /export\s*\{([^}]+)\}\s*(?:from\s*['"]([^'"]+)['"])?\s*;?/g
  )) {
    for (const part of m[1].split(',')) {
      const trimmed = part.trim();
      if (!trimmed) continue;
      // Skip type-only specifiers: `type Foo` or `type Foo as Bar`
      if (/^type\s+/.test(trimmed)) continue;
      const asMatch = trimmed.match(/^(\w+)\s+as\s+(\w+)$/);
      const name = asMatch ? asMatch[2] : trimmed;
      if (/^[A-Za-z_]\w*$/.test(name) && name !== 'default') {
        names.add(name);
      }
    }
  }

  // export function/const/let/var/class <name>
  for (const m of text.matchAll(
    /export\s+(?:async\s+)?(?:function\s*\*?|const|let|var|class)\s+([A-Za-z_]\w*)/g
  )) {
    names.add(m[1]);
  }

  // export * from './x' — recurse to resolve names
  for (const m of text.matchAll(/export\s*\*\s*from\s*['"]([^'"]+)['"]/g)) {
    const spec = m[1];
    if (!spec.startsWith('.')) continue; // bare module — skip
    const resolved = resolveLocalImport(filePath, spec);
    if (resolved) collectExportsFromFile(resolved, names, visited);
  }
}

function resolveLocalImport(fromFile, spec) {
  const base = path.resolve(path.dirname(fromFile), spec);
  const candidates = [
    base,
    `${base}.ts`,
    `${base}.tsx`,
    `${base}.mjs`,
    `${base}.cjs`,
    `${base}.js`,
    `${base}.jsx`,
    path.join(base, 'index.ts'),
    path.join(base, 'index.tsx'),
    path.join(base, 'index.mjs'),
    path.join(base, 'index.cjs'),
    path.join(base, 'index.js'),
    path.join(base, 'index.jsx'),
  ];
  for (const c of candidates) {
    try {
      const st = statSync(c);
      if (st.isFile()) return c;
    } catch {
      // not found, try next
    }
  }
  return null;
}

function listKitExports(repoRoot) {
  if (!repoRoot) return [];
  const indexFile = path.join(repoRoot, 'packages/kit/src/index.ts');
  if (!existsSync(indexFile)) return [];
  const names = new Set();
  collectExportsFromFile(indexFile, names, new Set());
  return [...names];
}

function walkSourceFiles(dir) {
  if (!existsSync(dir)) return [];
  const out = [];
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules' || entry.startsWith('.')) continue;
    const p = path.join(dir, entry);
    let st;
    try {
      st = statSync(p);
    } catch {
      continue;
    }
    if (st.isDirectory()) out.push(...walkSourceFiles(p));
    else if (/\.(tsx?|mjs|cjs|jsx?)$/.test(entry)) out.push(p);
  }
  return out;
}

const variantDir = process.argv[2];
if (!variantDir) {
  console.error('usage: node kit-dedup.mjs <variant-dir>');
  process.exit(2);
}

const repoRoot = findRepoRoot(fileURLToPath(import.meta.url));
const kitExports = listKitExports(repoRoot);
if (kitExports.length === 0) {
  console.log('warning: could not enumerate @portfolio/kit exports; skipping dedup scan.');
  process.exit(0);
}

const candidates = [];
const files = walkSourceFiles(path.join(variantDir, 'src'));

for (const file of files) {
  const text = readFileSync(file, 'utf8');
  const lines = text.split('\n');
  for (const name of kitExports) {
    const declRe = new RegExp(
      `\\bfunction\\s+${name}\\s*[<\\(]|\\b(?:const|let|var)\\s+${name}\\s*[:=]`
    );
    if (!declRe.test(text)) continue;

    // Find the first declaration line, then check for // LOCAL: marker
    // within ~2 lines before/after.
    let flagged = true;
    for (let i = 0; i < lines.length; i++) {
      if (!declRe.test(lines[i])) continue;
      let localMarker = false;
      const lo = Math.max(0, i - 2);
      const hi = Math.min(lines.length - 1, i + 2);
      for (let j = lo; j <= hi; j++) {
        if (/\/\/\s*LOCAL\s*:/.test(lines[j])) {
          localMarker = true;
          break;
        }
      }
      if (localMarker) {
        flagged = false;
      }
      break;
    }

    if (flagged) candidates.push({ file, name });
  }
}

if (candidates.length === 0) {
  console.log('No dedup candidates.');
  process.exit(0);
}

console.log(`Found ${candidates.length} possible dedup candidate(s):`);
for (const c of candidates) {
  console.log(`  ${path.relative(process.cwd(), c.file)}: '${c.name}' shadows kit export`);
}
console.log('\nResolve each by either:');
console.log('  - hoisting the helper to @portfolio/kit (and updating kit-catalog.md), or');
console.log("  - adding `// LOCAL: <reason>` comment justifying why the local copy stays.");
process.exit(0);
