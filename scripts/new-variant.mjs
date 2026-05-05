#!/usr/bin/env node
/**
 * Scaffold a new variant package by cloning packages/variant-template.
 *
 *   node scripts/new-variant.mjs <slug>
 *
 * Slug must be lowercase, hyphen-separated, and not collide with an
 * existing variant package. The script:
 *
 *   1. Copies packages/variant-template → packages/variant-<slug>
 *   2. Rewrites package name (@portfolio/variant-<slug>)
 *   3. Sets `portfolio.variant: true` and updates `portfolio.slug`
 *   4. Updates the manifest's `slug` and `name`
 *   5. Reminds you to run `pnpm install` and `pnpm --filter @portfolio/web build:registry`
 */

import { cpSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const TEMPLATE_DIR = path.join(ROOT, 'packages', 'variant-template');

function fail(message) {
  console.error(`error: ${message}`);
  process.exit(1);
}

function toTitleCase(slug) {
  return slug
    .split('-')
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

function main() {
  const [, , slugArg] = process.argv;
  if (!slugArg) fail('usage: node scripts/new-variant.mjs <slug>');
  const slug = slugArg.trim().toLowerCase();
  if (!/^[a-z][a-z0-9]*(-[a-z0-9]+)*$/.test(slug)) {
    fail(`slug must be lowercase + hyphen-separated; got "${slugArg}"`);
  }
  if (slug === 'template') fail('"template" is reserved — pick a different slug.');

  const targetDir = path.join(ROOT, 'packages', `variant-${slug}`);
  if (existsSync(targetDir)) fail(`target already exists: ${targetDir}`);
  if (!existsSync(TEMPLATE_DIR)) fail(`template missing at ${TEMPLATE_DIR}`);

  cpSync(TEMPLATE_DIR, targetDir, { recursive: true });

  // Update package.json: name, portfolio block.
  const pkgPath = path.join(targetDir, 'package.json');
  const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'));
  pkg.name = `@portfolio/variant-${slug}`;
  pkg.keywords = ['portfolio-variant'];
  pkg.portfolio = { variant: true, slug };
  writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n', 'utf8');

  // Update manifest: slug + name.
  const manifestPath = path.join(targetDir, 'src', 'manifest.ts');
  let manifest = readFileSync(manifestPath, 'utf8');
  const titleCased = toTitleCase(slug);
  manifest = manifest
    .replace(/slug:\s*'template'/, `slug: '${slug}'`)
    .replace(/name:\s*'Template'/, `name: '${titleCased}'`);
  writeFileSync(manifestPath, manifest, 'utf8');

  // Add as a workspace dependency of apps/web so it gets symlinked into
  // apps/web/node_modules and the auto-generated registry can resolve it.
  const hostPkgPath = path.join(ROOT, 'apps', 'web', 'package.json');
  if (existsSync(hostPkgPath)) {
    const hostPkg = JSON.parse(readFileSync(hostPkgPath, 'utf8'));
    hostPkg.dependencies = hostPkg.dependencies ?? {};
    hostPkg.dependencies[`@portfolio/variant-${slug}`] = 'workspace:*';
    writeFileSync(hostPkgPath, JSON.stringify(hostPkg, null, 2) + '\n', 'utf8');
  }

  console.log(`created packages/variant-${slug}/`);
  console.log(`added @portfolio/variant-${slug} to apps/web dependencies`);
  console.log('next steps:');
  console.log('  1. pnpm install');
  console.log('  2. pnpm --filter @portfolio/web build:registry');
  console.log(`  3. open packages/variant-${slug}/src/manifest.ts and fill in tagline/description/aesthetic`);
}

main();
