#!/usr/bin/env node
/**
 * preview-matrix.mjs — capture screenshots of the bundled sample in a
 * variant, in every theme, from the dev server start.sh runs under the demo
 * profile: /sample?variant=<slug>, with --scheme and --typography for a
 * color scheme and typography preset the variant declares (else its
 * defaults). Lazily uses Playwright if installed; otherwise prints install
 * command and exits with code 0 (informational, not a hard failure).
 *
 *   node preview-matrix.mjs <slug> [--scheme <id>] [--typography <id>]
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

const USAGE = 'usage: node preview-matrix.mjs <slug> [--scheme <id>] [--typography <id>]';
const [slug, ...flags] = process.argv.slice(2);
if (!slug || slug.startsWith('--')) {
  console.error(USAGE);
  process.exit(2);
}
const query = new URLSearchParams({ variant: slug });
for (let index = 0; index < flags.length; index += 2) {
  const name = { '--scheme': 'scheme', '--typography': 'typography' }[flags[index]];
  const value = flags[index + 1];
  if (!name || !value) {
    console.error(USAGE);
    process.exit(2);
  }
  query.set(name, value);
}
// The dev server start.sh runs, on $PORT when it is set.
const url = `http://localhost:${process.env.PORT || 3000}/sample?${query}`;

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

// Every theme, in the scheme and typography the flags pick. Run it again
// with other flags for other combinations.
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
      await page.goto(url, { waitUntil: 'networkidle', timeout: 15_000 });
      const root = page.locator('[data-variant]').first();
      const rendered = await root.getAttribute('data-variant');
      if (rendered !== slug) {
        console.error(
          `${url} renders ${rendered ?? 'no variant'}, not ${slug}. Is ${slug} registered, and is start.sh running the dev server?`,
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
