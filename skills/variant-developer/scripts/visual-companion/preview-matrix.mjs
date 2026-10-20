#!/usr/bin/env node
/**
 * preview-matrix.mjs — capture screenshots of the running dev server's home
 * page in every theme. The page renders the variant, color scheme, and
 * typography that config/portfolio.yml selects; set `variant: <slug>` there
 * first. Lazily uses Playwright if installed; otherwise prints install
 * command and exits with code 0 (informational, not a hard failure).
 */
import { mkdirSync, readFileSync } from 'node:fs';
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

// Every theme; scheme and typography come from config/portfolio.yml. Change
// them there and run again for other combinations.
const themes = ['light', 'dark', 'bright', 'black'];

const browser = await chromium.launch();
try {
  for (const theme of themes) {
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    // The theme provider reads its preference from localStorage.
    await context.addInitScript((value) => {
      window.localStorage.setItem('portfolio:theme', value);
    }, theme);
    const page = await context.newPage();
    try {
      await page.goto('http://localhost:3000/', { waitUntil: 'networkidle', timeout: 15_000 });
      const root = page.locator('[data-variant]').first();
      const rendered = await root.getAttribute('data-variant');
      if (rendered !== slug) {
        console.error(
          `the page renders ${rendered ?? 'no variant'}, not ${slug}. Set variant: ${slug} in config/portfolio.yml.`,
        );
        process.exitCode = 1;
        break;
      }
      const scheme = (await root.getAttribute('data-color-scheme')) ?? 'default';
      const typography = (await root.getAttribute('data-typography')) ?? 'default';
      const filename = `${theme}-${scheme}-${typography}.png`;
      await page.screenshot({ path: path.join(outDir, filename), fullPage: true });
      console.log(`captured ${filename}`);
    } catch (err) {
      console.error(`failed ${theme}: ${err.message}`);
    } finally {
      await context.close();
    }
  }
} finally {
  await browser.close();
}
console.log('done. screenshots in ' + outDir);
