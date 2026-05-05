#!/usr/bin/env node
// Scans packages/variant-* and experiments/variant-* (curated only by default)
// for variant packages and generates apps/web/src/lib/registry.generated.ts.
//
// A variant is recognized by `portfolio.variant === true` in its package.json.
// Set INCLUDE_EXPERIMENTS=1 to also include experiments/variant-* (used for
// preview during candidate-evaluation phases).

import { readdirSync, readFileSync, writeFileSync, statSync, existsSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..', '..', '..');
const APPS_WEB = path.resolve(__dirname, '..');
const OUTPUT = path.join(APPS_WEB, 'src', 'lib', 'registry.generated.ts');
const STYLES_OUTPUT = path.join(APPS_WEB, 'src', 'lib', 'registry.styles.generated.ts');

const ROOTS = [path.join(ROOT, 'packages')];
if (process.env.INCLUDE_EXPERIMENTS === '1') {
  ROOTS.push(path.join(ROOT, 'experiments'));
}

function discoverVariants() {
  const found = [];
  for (const base of ROOTS) {
    if (!existsSync(base)) continue;
    let entries;
    try {
      entries = readdirSync(base);
    } catch {
      continue;
    }
    for (const name of entries) {
      if (!name.startsWith('variant-')) continue;
      const dir = path.join(base, name);
      let st;
      try {
        st = statSync(dir);
      } catch {
        continue;
      }
      if (!st.isDirectory()) continue;
      const pkgPath = path.join(dir, 'package.json');
      if (!existsSync(pkgPath)) continue;
      let pkg;
      try {
        pkg = JSON.parse(readFileSync(pkgPath, 'utf8'));
      } catch {
        continue;
      }
      const cfg = pkg.portfolio;
      if (!cfg || cfg.variant !== true) continue;
      const slug = cfg.slug ?? name.replace(/^variant-/, '');
      const isExperiment = base.endsWith('experiments');
      found.push({ pkg: pkg.name, slug, dir, isExperiment });
    }
  }
  return found;
}

function safeIdent(slug) {
  return slug.replace(/[^a-zA-Z0-9_]/g, '_');
}

function generateStyles(variants) {
  const lines = [];
  lines.push('// AUTO-GENERATED — do not edit by hand.');
  lines.push("// Regenerate with `pnpm --filter @portfolio/web build:registry`.");
  lines.push('//');
  lines.push('// Side-effect imports for every registered variant\'s stylesheet. The host');
  lines.push('// layout imports this single file so all variants get their CSS injected,');
  lines.push("// without hard-coding any one variant's import path.");
  lines.push('');
  for (const v of variants) {
    lines.push(`import '${v.pkg}/styles.css';`);
  }
  if (variants.length === 0) {
    lines.push('// (no variants discovered)');
  }
  lines.push('');
  lines.push('export {};');
  return lines.join('\n') + '\n';
}

function generate(variants) {
  const lines = [];
  lines.push('// AUTO-GENERATED — do not edit by hand.');
  lines.push("// Regenerate with `pnpm --filter @portfolio/web build:registry`.");
  lines.push('// Includes experiments only when INCLUDE_EXPERIMENTS=1.');
  lines.push('');
  lines.push("import type { VariantManifest, VariantModule } from '@portfolio/kit';");
  lines.push('');
  for (const v of variants) {
    lines.push(`import { manifest as ${safeIdent(v.slug)}Manifest } from '${v.pkg}';`);
  }
  lines.push('');
  lines.push('export interface RegistryEntry {');
  lines.push('  manifest: VariantManifest;');
  lines.push('  load: () => Promise<VariantModule>;');
  lines.push('  experimental: boolean;');
  lines.push('}');
  lines.push('');
  lines.push('export const REGISTRY: Record<string, RegistryEntry> = {');
  for (const v of variants) {
    lines.push(`  '${v.slug}': {`);
    lines.push(`    manifest: ${safeIdent(v.slug)}Manifest,`);
    lines.push(`    load: () => import('${v.pkg}'),`);
    lines.push(`    experimental: ${v.isExperiment ? 'true' : 'false'},`);
    lines.push('  },');
  }
  lines.push('};');
  lines.push('');
  lines.push('export const MANIFESTS: VariantManifest[] = Object.values(REGISTRY).map((e) => e.manifest);');
  return lines.join('\n') + '\n';
}

function ensureDir(p) {
  const dir = path.dirname(p);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
}

function main() {
  const variants = discoverVariants();
  ensureDir(OUTPUT);
  writeFileSync(OUTPUT, generate(variants));
  ensureDir(STYLES_OUTPUT);
  writeFileSync(STYLES_OUTPUT, generateStyles(variants));
  const labels = variants.map((v) => `${v.slug}${v.isExperiment ? '*' : ''}`);
  console.log(
    `[registry] Wrote ${path.relative(ROOT, OUTPUT)} with ${variants.length} variant(s)` +
      (labels.length ? `: ${labels.join(', ')}` : '') +
      (process.env.INCLUDE_EXPERIMENTS === '1' ? ' (experiments included)' : ''),
  );
}

main();
