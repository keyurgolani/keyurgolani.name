import { readFileSync } from 'node:fs';
import path from 'node:path';
import type { Response } from '@playwright/test';
import { fixtureSiteSelecting } from '../../packages/variant-contract/src/contract-fixtures';
import { contractFixture } from '../../packages/variant-contract/src/node/fixtures';
import { expect, test } from '../harness/fixtures';
import { loadHome } from '../harness/motion';

// Spatial Bento's stage (#16) where the browser has no WebGL: the still, the
// exit there but disabled, and nothing of the stage fetched, so three.js
// stays off the static path. Chromium launches with its 3D APIs off, since
// whether its default build has WebGL depends on the platform: the suite's
// on macOS has none, and CI's on Linux has SwiftShader's.
// spatial-stage.spec.ts runs every other path with software WebGL.

const FIXTURE = contractFixture('complete');
const DIR = path.dirname(FIXTURE.files.portfolio);
const READ_ONLY = { type: 'profile', description: 'read-only' };
const annotation = [{ type: 'route', description: '/' }, READ_ONLY];

test.use({
  appOptions: {
    portfolio: FIXTURE.files.portfolio,
    siteText: fixtureSiteSelecting(readFileSync(FIXTURE.files.site, 'utf8'), 'spatial-bento'),
    sourceFiles: Object.fromEntries(
      FIXTURE.unitFiles.map((file) => [file, readFileSync(path.join(DIR, file), 'utf8')]),
    ),
  },
  viewport: { width: 1280, height: 800 },
  launchOptions: { args: ['--disable-3d-apis'] },
});

test(
  'unsupported: the still, the exit disabled, and none of the stage loaded',
  { annotation },
  async ({ page }) => {
    const responses: Response[] = [];
    page.on('response', (response) => {
      if (response.request().resourceType() === 'script') responses.push(response);
    });
    await loadHome(page, '/');
    await expect
      .poll(() => page.locator('.sb-stage').getAttribute('data-stage-reason'))
      .toBe('unsupported');
    await expect(page.locator('canvas[data-spatial-canvas]')).toHaveCount(0);
    await expect(page.locator('.sb-still__plane--near')).toBeVisible();
    const exit = page.getByRole('button', { name: 'Spatial stage' });
    await expect(exit).toBeDisabled();
    await expect(exit).toHaveAttribute('aria-pressed', 'false');
    await expect(exit).toHaveAccessibleDescription("The 3D stage isn't available here.");
    // The browser really has no WebGL2, so this is the path a device without it takes.
    expect(
      await page.evaluate(() => document.createElement('canvas').getContext('webgl2') === null),
    ).toBe(true);
    // three.js is the stage's chunk alone, which a browser without WebGL never fetches.
    expect(responses.length).toBeGreaterThan(0);
    for (const response of responses) {
      expect(await response.text(), response.url()).not.toContain('WebGLRenderer');
    }
  },
);
