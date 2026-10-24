import { readFileSync } from 'node:fs';
import path from 'node:path';
import type { Response } from '@playwright/test';
import { fixtureSiteSelecting } from '../../packages/variant-contract/src/contract-fixtures';
import { contractFixture } from '../../packages/variant-contract/src/node/fixtures';
import { expect, test } from '../harness/fixtures';
import { loadHome } from '../harness/motion';

// Spatial Bento's stage (#16) where the browser has no WebGL, as the suite's
// Chromium has none: the still, no exit to offer, and nothing of the stage
// fetched, so three.js stays off the static path. spatial-stage.spec.ts
// runs every other path with software WebGL.

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
});

test(
  'unsupported: the still, no exit to offer, and none of the stage loaded',
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
    await expect(page.locator('.sb-stage__exit')).toHaveCount(0);
    // three.js is the stage's chunk alone, which a browser without WebGL never fetches.
    expect(responses.length).toBeGreaterThan(0);
    for (const response of responses) {
      expect(await response.text(), response.url()).not.toContain('WebGLRenderer');
    }
  },
);
