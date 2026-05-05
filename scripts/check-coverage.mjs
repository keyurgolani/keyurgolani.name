#!/usr/bin/env node
/**
 * Section-coverage check.
 *
 * For each registered variant package, parses its manifest and verifies:
 *
 *   1. Every entry in `supportedKinds` is a valid kind declared by the
 *      schema. (TypeScript already enforces this on the type side; this
 *      catches drift between hand-edited manifests and the schema.)
 *   2. Reports the set of kinds NOT in `supportedKinds` — those will fall
 *      through to FallbackSection at runtime, which is fine but worth
 *      surfacing explicitly so we don't ship a variant that silently
 *      ignores a kind the author thought they were rendering.
 *
 * Exit code:
 *   0 — every variant declares a valid (subset) of supportedKinds
 *   1 — at least one variant declares a kind unknown to the schema
 *
 * Run: `pnpm check-coverage`
 */

import { readFileSync, readdirSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const PACKAGES_DIR = path.join(ROOT, 'packages');
const SCHEMA_KINDS_INDEX = path.join(ROOT, 'packages', 'schema', 'src', 'kinds', 'index.ts');

function fail(message) {
  console.error(`error: ${message}`);
  process.exit(1);
}

function readAllSectionKinds() {
  const source = readFileSync(SCHEMA_KINDS_INDEX, 'utf8');
  const match = source.match(/ALL_SECTION_KINDS:\s*readonly SectionKind\[\]\s*=\s*\[([\s\S]*?)\]/);
  if (!match) fail(`could not parse ALL_SECTION_KINDS from ${SCHEMA_KINDS_INDEX}`);
  return Array.from(match[1].matchAll(/'([^']+)'/g)).map((m) => m[1]);
}

function readManifestKinds(manifestPath) {
  const source = readFileSync(manifestPath, 'utf8');
  // Match the supportedKinds declaration. Two shapes are accepted:
  //   supportedKinds: ['hero', 'lede', ...]
  //   supportedKinds: ALL_SECTION_KINDS    (treated as full coverage)
  const fullCoverage = /supportedKinds:\s*ALL_SECTION_KINDS\b/.test(source);
  if (fullCoverage) return { fullCoverage: true, kinds: null };
  const match = source.match(/supportedKinds:\s*\[([\s\S]*?)\]/);
  if (!match) return { fullCoverage: false, kinds: [] };
  const kinds = Array.from(match[1].matchAll(/'([^']+)'/g)).map((m) => m[1]);
  return { fullCoverage: false, kinds };
}

function discoverVariantPackages() {
  const out = [];
  for (const name of readdirSync(PACKAGES_DIR)) {
    if (!name.startsWith('variant-')) continue;
    const dir = path.join(PACKAGES_DIR, name);
    const pkgPath = path.join(dir, 'package.json');
    const manifestPath = path.join(dir, 'src', 'manifest.ts');
    if (!existsSync(pkgPath) || !existsSync(manifestPath)) continue;
    let pkg;
    try {
      pkg = JSON.parse(readFileSync(pkgPath, 'utf8'));
    } catch {
      continue;
    }
    const cfg = pkg.portfolio ?? {};
    if (cfg.template === true && cfg.variant !== true) {
      // Skip the bare template; it's not a real variant.
      continue;
    }
    out.push({ name, dir, manifestPath, pkgName: pkg.name ?? name });
  }
  return out;
}

function main() {
  const allKinds = new Set(readAllSectionKinds());
  if (allKinds.size === 0) fail('no section kinds discovered from schema');

  const variants = discoverVariantPackages();
  if (variants.length === 0) {
    console.log('no variants found.');
    return;
  }

  console.log(`schema declares ${allKinds.size} section kinds.\n`);
  console.log(`checking ${variants.length} variant package(s):\n`);

  let invalid = 0;

  for (const v of variants) {
    const declared = readManifestKinds(v.manifestPath);
    const declaredKinds = declared.fullCoverage
      ? new Set(allKinds)
      : new Set(declared.kinds ?? []);

    const unknown = [...declaredKinds].filter((k) => !allKinds.has(k));
    const unsupported = [...allKinds].filter((k) => !declaredKinds.has(k));

    const tag = declared.fullCoverage ? '(full coverage via ALL_SECTION_KINDS)' : '';
    console.log(`  ▸ ${v.pkgName} ${tag}`);
    console.log(`    declared:   ${declaredKinds.size}/${allKinds.size}`);
    if (unknown.length > 0) {
      invalid += 1;
      console.log(`    UNKNOWN:    ${unknown.join(', ')}  ← invalid kinds, fix the manifest`);
    }
    if (unsupported.length > 0) {
      console.log(
        `    fallback:   ${unsupported.join(', ')}  ← will render via FallbackSection`,
      );
    } else if (!declared.fullCoverage && unknown.length === 0) {
      console.log('    fallback:   none — full coverage via explicit list');
    }
    console.log();
  }

  if (invalid > 0) {
    console.error(`✗ ${invalid} variant(s) declare unknown section kinds.`);
    process.exit(1);
  }
  console.log('✓ all variants declare a valid subset of section kinds.');
}

main();
