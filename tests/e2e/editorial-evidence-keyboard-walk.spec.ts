import { readFileSync } from 'node:fs';
import path from 'node:path';
import type { Page } from '@playwright/test';
import { fixtureSiteSelecting } from '../../packages/variant-contract/src/contract-fixtures';
import { contractFixture } from '../../packages/variant-contract/src/node/fixtures';
import { expect, test } from '../harness/fixtures';
import { highContrastViolations, incompleteContrastFindings } from '../quality/lib/a11y/contrast';
import { watchEnhancements } from '../quality/lib/a11y/conditions';
import { keyboardFindings } from '../quality/lib/a11y/interaction';
import { axeFor } from '../quality/lib/axe';
import { axeRunOptions } from '../quality/lib/run-cell';

// Editorial Evidence's chapter index at 1440 shows a chapter's section links only while that
// chapter is the one being read. A quality cell runs axe and the contrast sampler before its
// keyboard walk, and the sampler scrolls each element it samples into view and back. Under more
// contrast nothing covers the reading line at the very top of the page, so on the way back the
// index never left the fourth chapter: the page sat at its top with that chapter's 9 section
// links shown. The walk counted them as owed, and once its first stops had scrolled the page and
// they folded away, read them as links Tab never reached. After the cell's own axe run and
// sampler, the walk owes what Tab can reach from where it starts, and a control Tab really can't
// reach is still reported. On the complete contract fixture, Art Deco on Blue Orange Color Safe
// in Drafting Grotesk, high contrast.

const FIXTURE = contractFixture('complete');
const DIR = path.dirname(FIXTURE.files.portfolio);
const annotation = [{ type: 'route', description: '/' }];
const tag = '@interaction';

test.use({
  viewport: { width: 1440, height: 900 },
  appOptions: {
    portfolio: FIXTURE.files.portfolio,
    siteText: fixtureSiteSelecting(readFileSync(FIXTURE.files.site, 'utf8'), 'editorial-evidence')
      .replace(/designLanguage: .*/, 'designLanguage: art-deco')
      .replace(/colorScheme: .*/, 'colorScheme: blue-orange-color-safe')
      .replace(/typography: .*/, 'typography: drafting-grotesk')
      .replace(/displayMode: .*/, 'displayMode: high-contrast'),
    sourceFiles: Object.fromEntries(
      FIXTURE.unitFiles.map((file) => [file, readFileSync(path.join(DIR, file), 'utf8')]),
    ),
  },
});

/** The home page under more contrast, after the cell's axe run and contrast sampler. */
async function afterTheSampler(page: Page) {
  await page.emulateMedia({ contrast: 'more' });
  const watch = watchEnhancements(page);
  try {
    await page.goto('/', { waitUntil: 'networkidle' });
    await page.evaluate(() => document.fonts.ready);
    await watch.settled();
  } finally {
    watch.stop();
  }
  const results = await highContrastViolations(
    page,
    await axeFor(page)
      .options(axeRunOptions({ swept: false, forced: false, highContrast: true }))
      .analyze(),
  );
  await incompleteContrastFindings(page, results, false);
}

test(
  'after the contrast sampler at 1440 under more contrast, the keyboard walk owes only what Tab can reach from where it starts',
  { annotation, tag },
  async ({ page }) => {
    test.setTimeout(240_000);
    await afterTheSampler(page);
    const findings = await keyboardFindings(page, { focus: true, occlusion: true });
    expect(findings.filter((each) => each.rule === 'reachable')).toEqual([]);
  },
);

test(
  "after the contrast sampler, a control on the page that Tab can't reach is still reported, and only it",
  { annotation, tag },
  async ({ page }) => {
    test.setTimeout(240_000);
    await afterTheSampler(page);
    // A button at the top of the issue that hands focus on as it gets it: Tab never rests on it.
    await page.evaluate(() => {
      const main = document.querySelector('main');
      const skipped = document.createElement('button');
      skipped.type = 'button';
      skipped.id = 'zz-skipped';
      skipped.textContent = 'Skipped';
      main?.prepend(skipped);
      skipped.addEventListener('focus', () => {
        const next = [...document.querySelectorAll<HTMLElement>('main a[href]')].find(
          (link) => link.getClientRects().length > 0,
        );
        next?.focus();
      });
    });
    const findings = await keyboardFindings(page, { focus: true, occlusion: true });
    expect(findings.filter((each) => each.rule === 'reachable').map((each) => each.path)).toEqual([
      '#zz-skipped',
    ]);
  },
);
