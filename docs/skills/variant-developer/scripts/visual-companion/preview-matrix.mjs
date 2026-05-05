#!/usr/bin/env node
/**
 * preview-matrix.mjs — capture screenshots of /preview/<slug> across
 * (theme × colorScheme × typography). Lazily uses Playwright if installed;
 * otherwise prints install command and exits with code 0 (informational,
 * not a hard failure).
 */
import { mkdirSync, existsSync, readFileSync } from 'node:fs';
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

const slug = process.argv[2];
if (!slug) {
  console.error('usage: node preview-matrix.mjs <slug>');
  process.exit(2);
}

let chromium;
try {
  ({ chromium } = await import('playwright'));
} catch {
  console.log('preview-matrix: Playwright not installed.');
  console.log('To enable matrix screenshots, install with:');
  console.log('  pnpm add -Dw playwright');
  console.log('  pnpm exec playwright install chromium');
  console.log('Skipping matrix capture (mockup-mode and dev preview both still work).');
  process.exit(0);
}

const REPO_ROOT = findRepoRoot(fileURLToPath(import.meta.url));
const outDir = path.join(REPO_ROOT || process.cwd(), '.variant-preview', slug);
mkdirSync(outDir, { recursive: true });

// MVP: capture every theme + 'default' scheme/typography.
// A future enhancement can read the variant's manifest.ts to enumerate
// real scheme + preset ids and capture every combination.
const themes = ['light', 'dark', 'bright', 'black'];
const schemes = ['default'];
const presets = ['default'];

const browser = await chromium.launch();
try {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();
  for (const theme of themes) {
    for (const scheme of schemes) {
      for (const preset of presets) {
        const url = `http://localhost:3000/preview/${slug}?theme=${theme}&scheme=${scheme}&typography=${preset}`;
        const filename = `${theme}-${scheme}-${preset}.png`;
        try {
          await page.goto(url, { waitUntil: 'networkidle', timeout: 15_000 });
          await page.screenshot({ path: path.join(outDir, filename), fullPage: true });
          console.log(`captured ${filename}`);
        } catch (err) {
          console.error(`failed ${filename}: ${err.message}`);
        }
      }
    }
  }
} finally {
  await browser.close();
}
console.log('done. screenshots in ' + outDir);
