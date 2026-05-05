#!/usr/bin/env node
/**
 * sync-checks.mjs — drift-prevention CI for docs/skills/.
 *
 * Asserts:
 *   1. Both skills' references/section-kinds.md are content-identical.
 *   2. variant-developer/references/kit-catalog.md mentions every export
 *      reachable from @portfolio/kit (via the package.json exports map).
 *   3. portfolio-author/references/schema.md mentions every kind in
 *      ALL_SECTION_KINDS.
 *   4. Each SKILL.md has valid agentskills frontmatter (name regex,
 *      description ≤1024 chars, name matches parent dir).
 *
 * Exit 0 on success, 1 on any failure with human-readable error.
 */
import { readFileSync, existsSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// __dirname is docs/skills/scripts; up 3 levels = repo root.
const SCRIPT_FILE = fileURLToPath(import.meta.url);
const ROOT = path.dirname(path.dirname(path.dirname(path.dirname(SCRIPT_FILE))));

let failures = 0;
function fail(msg) { console.error('FAIL: ' + msg); failures++; }
function pass(msg) { console.log('ok:   ' + msg); }

function readFileOrNull(p) {
  try { return readFileSync(p, 'utf8'); } catch { return null; }
}

// ─── Check 1: section-kinds.md parity ─────────────────────────────────
function checkSectionKindsParity() {
  const a = path.join(ROOT, 'docs/skills/portfolio-author/references/section-kinds.md');
  const b = path.join(ROOT, 'docs/skills/variant-developer/references/section-kinds.md');
  const aText = readFileOrNull(a);
  const bText = readFileOrNull(b);
  if (aText === null || bText === null) {
    fail(`section-kinds.md missing — portfolio-author: ${aText !== null}, variant-developer: ${bText !== null}`);
    return;
  }
  if (aText !== bText) {
    fail('section-kinds.md differs between portfolio-author and variant-developer');
    return;
  }
  pass('section-kinds.md is identical across both skills');
}

// ─── Check 2: kit-catalog.md parity ───────────────────────────────────
function listExportsInFile(filePath, visited = new Set()) {
  if (visited.has(filePath)) return [];
  visited.add(filePath);
  const text = readFileOrNull(filePath);
  if (text === null) return [];
  const names = new Set();
  // export { foo, bar } [from '...']
  for (const m of text.matchAll(/export\s*\{([^}]+)\}\s*(?:from\s*['"][^'"]+['"])?\s*;?/g)) {
    for (const part of m[1].split(',')) {
      const trimmed = part.trim();
      if (!trimmed || /^type\s/.test(trimmed)) continue;
      const asMatch = trimmed.match(/^(\w+)\s+as\s+(\w+)$/);
      const name = asMatch ? asMatch[2] : trimmed.split(/\s+as\s+/)[0];
      if (/^[A-Za-z_]\w*$/.test(name) && name !== 'type') names.add(name);
    }
  }
  // export function/const/let/var/class
  for (const m of text.matchAll(/export\s+(?:function|const|let|var|class)\s+([A-Za-z_]\w*)/g)) {
    names.add(m[1]);
  }
  // export type/interface — skip (compile-time only).
  // export * from './x' — recurse.
  for (const m of text.matchAll(/export\s*\*\s*from\s*['"]([^'"]+)['"]/g)) {
    const spec = m[1];
    if (!spec.startsWith('.')) continue;
    const dir = path.dirname(filePath);
    const candidates = [
      path.join(dir, spec + '.ts'),
      path.join(dir, spec + '.tsx'),
      path.join(dir, spec, 'index.ts'),
      path.join(dir, spec, 'index.tsx'),
    ];
    for (const c of candidates) {
      if (existsSync(c) && statSync(c).isFile()) {
        for (const n of listExportsInFile(c, visited)) names.add(n);
        break;
      }
    }
  }
  return [...names];
}

function checkKitCatalogParity() {
  const kitPkgPath = path.join(ROOT, 'packages/kit/package.json');
  const kitPkg = readFileOrNull(kitPkgPath);
  if (!kitPkg) {
    fail('kit package.json missing');
    return;
  }
  const pkg = JSON.parse(kitPkg);
  const exportsField = pkg.exports || { '.': './src/index.ts' };
  const entryFiles = new Set();
  for (const [, value] of Object.entries(exportsField)) {
    let p;
    if (typeof value === 'string') p = value;
    else if (value && typeof value === 'object') {
      p = value.import || value.default || value.types || Object.values(value)[0];
    }
    if (p) entryFiles.add(path.join(ROOT, 'packages/kit', p));
  }
  // Always include src/index.ts even if exports is empty.
  entryFiles.add(path.join(ROOT, 'packages/kit/src/index.ts'));

  const allNames = new Set();
  const visited = new Set();
  for (const entry of entryFiles) {
    if (!existsSync(entry)) continue;
    for (const n of listExportsInFile(entry, visited)) allNames.add(n);
  }

  const catalogPath = path.join(ROOT, 'docs/skills/variant-developer/references/kit-catalog.md');
  const catalog = readFileOrNull(catalogPath);
  if (!catalog) {
    fail('kit-catalog.md missing');
    return;
  }
  // A name "covers" if it appears in `\`name\`` form anywhere in the catalog.
  const missing = [...allNames].filter((name) => !catalog.includes('`' + name + '`'));
  if (missing.length) {
    fail(`kit-catalog.md missing entries for: ${missing.join(', ')}`);
    return;
  }
  pass(`kit-catalog.md mentions every kit export (${allNames.size} names)`);
}

// ─── Check 3: schema.md kinds coverage ────────────────────────────────
function checkSchemaMdCoverage() {
  const schemaMdPath = path.join(ROOT, 'docs/skills/portfolio-author/references/schema.md');
  const kindsIndexPath = path.join(ROOT, 'packages/schema/src/kinds/index.ts');
  const schemaMd = readFileOrNull(schemaMdPath);
  const kindsIndex = readFileOrNull(kindsIndexPath);
  if (!schemaMd || !kindsIndex) {
    fail('schema.md or kinds/index.ts missing');
    return;
  }
  const m = kindsIndex.match(/ALL_SECTION_KINDS[^=]*=\s*\[([\s\S]*?)\]/);
  if (!m) {
    fail('could not parse ALL_SECTION_KINDS from packages/schema');
    return;
  }
  const allKinds = m[1].split(',').map((s) => s.trim().replace(/^['"]|['"]$/g, '')).filter(Boolean);
  const missing = allKinds.filter((k) => !schemaMd.includes(`kind: ${k}`));
  if (missing.length) {
    fail(`schema.md missing kinds: ${missing.join(', ')}`);
    return;
  }
  pass(`schema.md mentions every section kind (${allKinds.length} kinds)`);
}

// ─── Check 4: SKILL.md frontmatter validity ───────────────────────────
async function loadYamlParser() {
  // yaml isn't hoisted to repo root in this pnpm workspace. Try fallbacks.
  const candidates = [
    path.join(ROOT, 'packages/schema/node_modules/yaml/dist/index.js'),
    path.join(ROOT, 'apps/web/node_modules/yaml/dist/index.js'),
    path.join(ROOT, 'node_modules/yaml/dist/index.js'),
  ];
  for (const c of candidates) {
    if (existsSync(c)) return import(c);
  }
  // Bare specifier as last resort
  return import('yaml');
}

async function checkSkillMd(skillPath, yamlParser) {
  const text = readFileOrNull(skillPath);
  if (!text) {
    fail(`SKILL.md missing at ${skillPath}`);
    return;
  }
  const m = text.match(/^---\n([\s\S]*?)\n---/);
  if (!m) {
    fail(`${skillPath}: no YAML frontmatter`);
    return;
  }
  let fm;
  try {
    fm = yamlParser.parse(m[1]);
  } catch (e) {
    fail(`${skillPath}: frontmatter not valid YAML — ${e.message}`);
    return;
  }
  const name = fm?.name;
  if (typeof name !== 'string' || !/^[a-z][a-z0-9]*(-[a-z0-9]+)*$/.test(name) || name.length > 64) {
    fail(`${skillPath}: invalid name '${name}' (must be lowercase + hyphens, ≤64 chars)`);
    return;
  }
  const dirName = path.basename(path.dirname(skillPath));
  if (name !== dirName) {
    fail(`${skillPath}: name '${name}' must match parent dir '${dirName}'`);
    return;
  }
  const desc = fm?.description;
  if (typeof desc !== 'string' || desc.length === 0 || desc.length > 1024) {
    fail(`${skillPath}: description length ${desc?.length ?? 'undefined'} (must be 1-1024)`);
    return;
  }
  pass(`${skillPath}: frontmatter valid (name=${name}, desc.len=${desc.length})`);
}

async function main() {
  checkSectionKindsParity();
  checkKitCatalogParity();
  checkSchemaMdCoverage();

  const yamlParser = await loadYamlParser();
  await checkSkillMd(path.join(ROOT, 'docs/skills/portfolio-author/SKILL.md'), yamlParser);
  await checkSkillMd(path.join(ROOT, 'docs/skills/variant-developer/SKILL.md'), yamlParser);

  if (failures > 0) {
    console.error(`\n${failures} failure(s)`);
    process.exit(1);
  }
  console.log('\nall checks passed.');
  process.exit(0);
}

main().catch((e) => {
  console.error('sync-checks crashed:', e);
  process.exit(2);
});
