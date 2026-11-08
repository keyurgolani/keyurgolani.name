import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fixtureSiteSelecting } from '../../packages/variant-contract/src/contract-fixtures';
import { contractFixture } from '../../packages/variant-contract/src/node/fixtures';
import { expect, test } from '../harness/fixtures';

// The quality cells shell complete / and /work/project-name × platform-neutral at 390x844 print, on the
// complete fixture (rc-preflight on 04dc5e378): each errored before any check, page.screenshot's "Clipped
// area is either empty or outside the resulting image". On paper the status line shows all its
// destinations again, in a row that doesn't wrap, so at a phone's width it ran past the page's right edge
// and the contrast sampler was handed a box outside the shot. On paper nothing runs past the page's edge.
// One language a file: each is a server of its own.

const FIXTURE = contractFixture('complete');
const DIR = path.dirname(FIXTURE.files.portfolio);

test.use({
  viewport: { width: 390, height: 844 },
  isMobile: true,
  hasTouch: true,
  appOptions: {
    portfolio: FIXTURE.files.portfolio,
    siteText: fixtureSiteSelecting(readFileSync(FIXTURE.files.site, 'utf8'), 'shell')
      .replace(/designLanguage: .*/, 'designLanguage: platform-neutral')
      .replace(/colorScheme: .*/, 'colorScheme: warm-parchment')
      .replace(/typography: .*/, 'typography: humanist-ui')
      .replace(/displayMode: .*/, 'displayMode: system'),
    sourceFiles: Object.fromEntries(
      FIXTURE.unitFiles.map((file) => [file, readFileSync(path.join(DIR, file), 'utf8')]),
    ),
  },
});

for (const route of ['/', '/work/project-name'])
  test(
    `on ${route} at a phone's width, on paper its destinations wrap inside the page and nothing runs past its edge`,
    { annotation: [{ type: 'route', description: route }] },
    async ({ page }) => {
      await page.goto(route, { waitUntil: 'networkidle' });
      await page.emulateMedia({ media: 'print' });
      const wins = page.locator('.sh-tmux__win');
      expect(await wins.count()).toBeGreaterThan(1);
      const width = await page.evaluate(() => document.documentElement.clientWidth);
      for (const win of await wins.all()) {
        const box = await win.boundingBox();
        expect(box, 'a destination has a box on paper').not.toBeNull();
        expect(box!.x + box!.width).toBeLessThanOrEqual(width + 0.5);
      }
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
        width,
      );
    },
  );
