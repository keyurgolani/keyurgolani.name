#!/usr/bin/env node
/**
 * audit.mjs — pre-merge audit for a variant package.
 *
 * Usage: node audit.mjs <path/to/variant/dir>
 *
 * Hard fails (exit 1):
 *   - Missing kind in supportedKinds (vs ALL_SECTION_KINDS)
 *   - Renderer dispatch for a declared kind has neither a bespoke renderer
 *     nor explicit FallbackSection routing
 *   - themes missing 'light' or 'dark'
 *
 * Warnings (exit 0):
 *   - colorSchemes length <= 1
 *   - typographyPresets length <= 1
 */
import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Register tsx so we can import packages/schema/src/index.ts directly.
try {
  const tsxApi = await import('tsx/esm/api');
  if (typeof tsxApi.register === 'function') {
    tsxApi.register();
  }
} catch (e) {
  console.error('error: audit.mjs requires `tsx`. Install with: pnpm add -Dw tsx');
  console.error(e?.message ?? e);
  process.exit(2);
}

function findRepoRoot(start) {
  let dir = path.dirname(start);
  for (let i = 0; i < 12; i++) {
    try {
      const pkg = JSON.parse(readFileSync(path.join(dir, 'package.json'), 'utf8'));
      if (pkg.name === 'portfolio-monorepo') return dir;
    } catch {
      // ignore
    }
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}

const REPO_ROOT = findRepoRoot(fileURLToPath(import.meta.url));
if (!REPO_ROOT) {
  console.error('error: could not locate portfolio-monorepo root');
  process.exit(2);
}

const schemaModule = await import(
  path.join(REPO_ROOT, 'packages/schema/src/index.ts')
);
const ALL_SECTION_KINDS = schemaModule.ALL_SECTION_KINDS;
if (!Array.isArray(ALL_SECTION_KINDS)) {
  console.error('error: ALL_SECTION_KINDS not exported from @portfolio/schema');
  process.exit(2);
}

function readFirst(dir, candidates) {
  for (const rel of candidates) {
    const p = path.join(dir, rel);
    if (existsSync(p)) return { path: p, text: readFileSync(p, 'utf8') };
  }
  return null;
}

const variantDir = process.argv[2];
if (!variantDir) {
  console.error('usage: node audit.mjs <variant-dir>');
  process.exit(2);
}

const manifest = readFirst(variantDir, ['src/manifest.ts', 'manifest.ts']);
if (!manifest) {
  console.error(`error: no manifest.ts found under ${variantDir}`);
  process.exit(2);
}

const dispatch = readFirst(variantDir, [
  'src/section.tsx',
  'src/section.ts',
  'section.tsx',
  'section.ts',
]);
const dispatchText = dispatch?.text ?? '';
const usesFallbackSection = /\bFallbackSection\b/.test(dispatchText);

/**
 * Parse the supportedKinds field from the manifest text.
 *
 * Recognized forms:
 *   supportedKinds: ALL_SECTION_KINDS
 *   supportedKinds: ALL_SECTION_KINDS.filter((k) => k !== 'X')
 *   supportedKinds: ALL_SECTION_KINDS.filter((k) => !['X','Y'].includes(k))
 *   supportedKinds: ['hero', 'lede', ...]
 */
function parseSupportedKinds(text) {
  const allMatch = text.match(/supportedKinds\s*:\s*ALL_SECTION_KINDS\s*([,\n}])/);
  if (allMatch) {
    return new Set(ALL_SECTION_KINDS);
  }
  const filterSingleMatch = text.match(
    /supportedKinds\s*:\s*ALL_SECTION_KINDS\s*\.filter\s*\(\s*\(?\s*\w+\s*\)?\s*=>\s*\w+\s*!==?\s*['"]([^'"]+)['"]\s*,?\s*\)/s,
  );
  if (filterSingleMatch) {
    return new Set(ALL_SECTION_KINDS.filter((k) => k !== filterSingleMatch[1]));
  }
  const filterListMatch = text.match(
    /supportedKinds\s*:\s*ALL_SECTION_KINDS\s*\.filter\s*\(\s*\(?\s*\w+\s*\)?\s*=>\s*!\s*\[([^\]]+)\]\s*\.includes\(\s*\w+\s*\)\s*,?\s*\)/s,
  );
  if (filterListMatch) {
    const excluded = filterListMatch[1]
      .split(',')
      .map((s) => s.trim().replace(/^['"]/, '').replace(/['"]$/, ''))
      .filter(Boolean);
    return new Set(ALL_SECTION_KINDS.filter((k) => !excluded.includes(k)));
  }
  // Inline literal — find supportedKinds: [ ... ]
  const literalIdx = text.search(/supportedKinds\s*:\s*\[/);
  if (literalIdx !== -1) {
    const open = text.indexOf('[', literalIdx);
    let depth = 1;
    let i = open + 1;
    while (i < text.length && depth > 0) {
      const ch = text[i];
      if (ch === '[') depth++;
      else if (ch === ']') {
        depth--;
        if (depth === 0) break;
      }
      i++;
    }
    const block = text.slice(open + 1, i);
    const ids = [...block.matchAll(/['"]([a-z-]+)['"]/g)].map((m) => m[1]);
    return new Set(ids);
  }
  return null;
}

function parseStringArray(text, name) {
  const m = text.match(new RegExp(`${name}\\s*:\\s*\\[([^\\]]*)\\]`));
  if (!m) return null;
  return [...m[1].matchAll(/['"]([^'"]+)['"]/g)].map((x) => x[1]);
}

/**
 * Count the number of items in a named array-of-objects field by counting
 * `id:` occurrences inside the bracketed block. Handles nested brackets.
 */
function countItemsByIdField(text, name) {
  const re = new RegExp(`${name}\\s*:\\s*\\[`, 'g');
  const m = re.exec(text);
  if (!m) return 0;
  let depth = 1;
  let i = m.index + m[0].length;
  while (i < text.length && depth > 0) {
    const ch = text[i];
    if (ch === '[') depth++;
    else if (ch === ']') {
      depth--;
      if (depth === 0) break;
    }
    i++;
  }
  const block = text.slice(m.index + m[0].length, i);
  // Match id: as an object key (not inside a string). Count occurrences at
  // a position that follows '{', ',', or whitespace at line-start.
  return [...block.matchAll(/(^|[\{,\s])id\s*:/g)].length;
}

const supportedKinds = parseSupportedKinds(manifest.text);
if (!supportedKinds) {
  console.error('FAIL: could not parse supportedKinds from manifest');
  process.exit(1);
}

const themes = parseStringArray(manifest.text, 'themes') ?? [];
const colorSchemesCount = countItemsByIdField(manifest.text, 'colorSchemes');
const typographyPresetsCount = countItemsByIdField(manifest.text, 'typographyPresets');

let hardFails = 0;
let warnings = 0;

for (const kind of ALL_SECTION_KINDS) {
  if (!supportedKinds.has(kind)) {
    console.log(`FAIL: supportedKinds is missing '${kind}'`);
    hardFails++;
  }
}
for (const kind of supportedKinds) {
  // Bespoke renderer check: case '<kind>': in dispatch, OR FallbackSection routing.
  const caseRe = new RegExp(`case\\s+['"]${kind}['"]`);
  if (!caseRe.test(dispatchText) && !usesFallbackSection) {
    console.log(
      `FAIL: section dispatch has no case for '${kind}' and no FallbackSection routing`,
    );
    hardFails++;
  }
}

if (!themes.includes('light')) {
  console.log("FAIL: themes is missing 'light'");
  hardFails++;
}
if (!themes.includes('dark')) {
  console.log("FAIL: themes is missing 'dark'");
  hardFails++;
}

if (colorSchemesCount <= 1) {
  console.log(
    `WARN: only ${colorSchemesCount} color scheme(s) declared. Multiple is encouraged unless your metaphor justifies one (document in DESIGN.md).`,
  );
  warnings++;
}

if (typographyPresetsCount <= 1) {
  console.log(
    `WARN: only ${typographyPresetsCount} typography preset(s) declared. Multiple is encouraged unless your metaphor justifies one (document in DESIGN.md).`,
  );
  warnings++;
}

// Soft check: if themes claims bright/black, the styles file should have
// [data-theme="X"] blocks for those values.
const stylesPath = path.join(variantDir, 'src/styles.css');
let stylesText = '';
try {
  stylesText = readFileSync(stylesPath, 'utf8');
} catch {
  // No styles.css in expected location; skip the soft check.
}

for (const claimed of ['bright', 'black']) {
  if (themes.includes(claimed)) {
    const re = new RegExp(`\\[data-theme=["']${claimed}["']\\]`);
    if (!re.test(stylesText)) {
      console.log(
        `WARN: themes declares '${claimed}' but styles.css has no [data-theme="${claimed}"] block. ` +
          `Add the block or remove the claim.`,
      );
      warnings++;
    }
  }
}

if (hardFails > 0) {
  console.log(`\n${hardFails} hard failure(s), ${warnings} warning(s)`);
  process.exit(1);
}
console.log(`\naudit clean. ${warnings} warning(s).`);
process.exit(0);
