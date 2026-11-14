import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fixtureSiteSelecting } from '../../packages/variant-contract/src/contract-fixtures';
import { contractFixture } from '../../packages/variant-contract/src/node/fixtures';
import { expect, test } from '../harness/fixtures';

// Obsidian Atelier: the quality cells obsidian-atelier complete /work/project-name x platform-neutral at
// 390x844 default (system, light, dark and high contrast) record occlusion/obscured on the host's skip
// link: focused, it shows at the page's top-left in the flow, and OA's chrome (position absolute,
// z-index 3) paints its name link over it, so a keyboard visitor's first stop is hidden under the name.
// Focused, the skip link is on top, the element at its own center, on a work's page and home. OA's
// stylesheet styles none of the platform's slots (composition.test.tsx), so the lift is the
// platform's: the skip link's shared focus style. One language a file: each is a server of its own.

const FIXTURE = contractFixture('complete');
const DIR = path.dirname(FIXTURE.files.portfolio);

test.use({
  viewport: { width: 390, height: 844 },
  isMobile: true,
  hasTouch: true,
  appOptions: {
    portfolio: FIXTURE.files.portfolio,
    siteText: fixtureSiteSelecting(readFileSync(FIXTURE.files.site, 'utf8'), 'obsidian-atelier')
      .replace(/designLanguage: .*/, 'designLanguage: platform-neutral')
      .replace(/colorScheme: .*/, 'colorScheme: warm-parchment')
      .replace(/typography: .*/, 'typography: humanist-ui')
      .replace(/displayMode: .*/, 'displayMode: system'),
    sourceFiles: Object.fromEntries(
      FIXTURE.unitFiles.map((file) => [file, readFileSync(path.join(DIR, file), 'utf8')]),
    ),
  },
});

for (const route of ['/work/project-name', '/'])
  test(
    `on ${route} at 390, the focused skip link is the element at its own center`,
    { annotation: [{ type: 'route', description: route }] },
    async ({ page }) => {
      await page.goto(route, { waitUntil: 'networkidle' });
      await page.keyboard.press('Tab');
      const skip = page.locator('[data-ui-slot="skip-link"]');
      await expect(skip).toBeFocused();
      const hit = await skip.evaluate((el) => {
        const r = el.getBoundingClientRect();
        const top = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
        const own = top !== null && (top === el || el.contains(top));
        const name = top
          ? `${top.localName}${[...top.classList].map((each) => `.${each}`).join('')}`
          : 'nothing';
        return own ? 'itself' : name;
      });
      expect(hit).toBe('itself');
    },
  );
