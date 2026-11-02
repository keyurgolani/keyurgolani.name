import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fixtureSiteSelecting } from '../../packages/variant-contract/src/contract-fixtures';
import { contractFixture } from '../../packages/variant-contract/src/node/fixtures';
import { expect, test } from '../harness/fixtures';

// Singular P2's Contents by keyboard (the lead's conditions on moving the hero's calls to action out
// of panel 1): Tab walks the short version's stops, then the hero's calls to action in his words,
// then the record's index, in the order the dialog shows them. On the complete fixture with
// heroAction: next, under read-only.

const FIXTURE = contractFixture('complete');
const DIR = path.dirname(FIXTURE.files.portfolio);
const annotation = [
  { type: 'route', description: '/' },
  { type: 'profile', description: 'read-only' },
];

// heroAction: cta, so panel 1's band is his first call to action, and a second one, which the
// fixture copy adds to the hero, is Contents'.
const SITE_TEXT = `${fixtureSiteSelecting(readFileSync(FIXTURE.files.site, 'utf8'), 'singular')}
variantControls:
  singular:
    version: 1
    values:
      heroAction: cta
`;
const FIRST = '        label: Hero action\n';
const PORTFOLIO_TEXT = readFileSync(FIXTURE.files.portfolio, 'utf8').replace(
  FIRST,
  `${FIRST}      - url: https://rowan.test/cv.pdf\n        label: Rowan's CV\n`,
);
if (!PORTFOLIO_TEXT.includes("Rowan's CV"))
  throw new Error('the fixture copy has no second call to action');
const APP = {
  portfolio: FIXTURE.files.portfolio,
  siteText: SITE_TEXT,
  sourceFiles: {
    ...Object.fromEntries(
      FIXTURE.unitFiles.map((file) => [file, readFileSync(path.join(DIR, file), 'utf8')]),
    ),
    'portfolio.yml': PORTFOLIO_TEXT,
  },
};

test.use({ viewport: { width: 1440, height: 900 }, appOptions: APP });

test(
  'with heroAction: cta, panel 1’s band is his first call to action, under his label',
  { annotation },
  async ({ page }) => {
    await page.goto('/', { waitUntil: 'networkidle' });
    await expect(page.locator('.sg[data-sg-live]')).toHaveCount(1);
    const band = page.locator('[data-sg-panel="who"] .sg-band__go');
    await expect(band.locator('.sg-band__label')).toHaveText('Hero action');
    await band.click();
    await expect(page.locator('[data-sg-panel="contact"] [data-sg-heading]')).toBeFocused();
  },
);

test(
  'Tab walks Contents: the stops, then his other calls to action in his words, then the record',
  { annotation },
  async ({ page }) => {
    await page.goto('/', { waitUntil: 'networkidle' });
    await expect(page.locator('.sg[data-sg-live]')).toHaveCount(1);
    await page.getByRole('button', { name: 'Contents' }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();
    const stops: { group: string; name: string }[] = [];
    for (let i = 0; i < 80; i += 1) {
      await page.keyboard.press('Tab');
      const at = await page.evaluate(() => {
        const el = document.activeElement as HTMLElement | null;
        if (!el?.closest('dialog')) return null;
        const nav = el.closest('nav');
        const group = nav?.className.match(/sg-contents__(\w+)/)?.[1] ?? 'other';
        return { group, name: (el.textContent ?? '').trim().replace(/^\d+/, '') };
      });
      if (!at) break;
      if (stops.some((s) => s.group === at.group && s.name === at.name)) break;
      stops.push(at);
    }
    const groups = stops.map((s) => s.group).filter((g) => g !== 'other');
    // Each group once, in this order.
    expect(groups.filter((g, i) => g !== groups[i - 1])).toEqual(['short', 'ways', 'record']);
    // His second call to action, in his words; the first is the band's, so not here.
    expect(stops.filter((s) => s.group === 'ways').map((s) => s.name)).toEqual(["Rowan's CV"]);
    await expect(dialog.getByRole('navigation', { name: 'From the opening' })).toHaveCount(1);
  },
);
