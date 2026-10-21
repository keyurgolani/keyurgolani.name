#!/usr/bin/env node
/**
 * preview-matrix.mjs: capture screenshots of the bundled sample in a variant,
 * from the dev server start.sh runs under the demo profile:
 * /sample?variant=<id>, in light and dark, at a desktop and a phone
 * viewport. Color, type, and display modes beyond those are the appearance
 * system's (#19). An unregistered id is a 404: it prints a hint and exits 1.
 * Lazily uses Playwright if installed; otherwise prints the install command
 * and exits 0 (informational, not a hard failure).
 *
 *   node preview-matrix.mjs <id>
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

const USAGE = 'usage: node preview-matrix.mjs <id>';
const [id, ...extra] = process.argv.slice(2);
if (!id || id.startsWith('--') || extra.length > 0) {
  console.error(USAGE);
  process.exit(2);
}
// The dev server start.sh runs, on $PORT when it is set.
const url = `http://localhost:${process.env.PORT || 3000}/sample?${new URLSearchParams({ variant: id })}`;

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
const outDir = path.join(REPO_ROOT || process.cwd(), '.variant-preview', id);

// The host's starting themes, each at a desktop and a phone viewport.
const themes = ['light', 'dark'];
const viewports = {
  desktop: { width: 1440, height: 900 },
  phone: { width: 375, height: 667 },
};
// The page is server-rendered, so its boundary is there on load; a missing one
// shouldn't take Playwright's 30 s default to report.
const ATTRIBUTE_TIMEOUT_MS = 5_000;

const browser = await chromium.launch();
try {
  capture: for (const theme of themes) {
    for (const [name, viewport] of Object.entries(viewports)) {
      const context = await browser.newContext({ viewport });
      // The pre-hydration theme script reads the visitor's choice from localStorage.
      await context.addInitScript((value) => {
        window.localStorage.setItem('portfolio:theme', value);
      }, theme);
      const page = await context.newPage();
      try {
        const response = await page.goto(url, { waitUntil: 'networkidle', timeout: 15_000 });
        if (response?.status() === 404) {
          console.error(
            `${url} is a 404: ${id} isn't a registered variant. Run pnpm check:variants to see why, then restart start.sh.`,
          );
          process.exitCode = 1;
          break capture;
        }
        if (!response?.ok()) {
          console.error(
            `${url} answered ${response?.status() ?? 'nothing'}. Is start.sh running the dev server?`,
          );
          process.exitCode = 1;
          break capture;
        }
        const rendered = await page
          .locator('[data-variant]')
          .first()
          .getAttribute('data-variant', { timeout: ATTRIBUTE_TIMEOUT_MS });
        if (rendered !== id) {
          console.error(`${url} renders ${rendered ?? 'no variant'}, not ${id}.`);
          process.exitCode = 1;
          break capture;
        }
        const filename = `${theme}-${name}.png`;
        mkdirSync(outDir, { recursive: true });
        await page.screenshot({ path: path.join(outDir, filename), fullPage: true });
        console.log(`captured ${filename}`);
      } catch (err) {
        console.error(`failed ${theme} at ${name}: ${err.message}`);
        process.exitCode = 1;
      } finally {
        await context.close();
      }
    }
  }
} finally {
  await browser.close();
}
if (!process.exitCode) console.log('done. screenshots in ' + outDir);
