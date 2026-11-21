import { readFileSync } from 'node:fs';
import path from 'node:path';
import type { Page } from '@playwright/test';
import { fixtureSiteSelecting } from '../../packages/variant-contract/src/contract-fixtures';
import { contractFixture } from '../../packages/variant-contract/src/node/fixtures';
import { expect, test } from '../harness/fixtures';
import { decodePng, pixel } from '../quality/lib/pixels';

// The capsule's Index and, below 75rem, its Pause are set on the capsule's surface, and focused
// they keep it under their labels: the band they lay under themselves takes the on-accent colour
// only out from their own boxes, so a label in the text colour never sits on an on-accent ground,
// which a light scheme whose accent is light makes black. Read focused against blurred in each
// control's top padding, above its label: the same pixels. In light warm-parchment with
// humanist type, whose on-accent is black.

const TUPLE = 'bauhaus-geometric/warm-parchment/humanist-ui/system';
const FIXTURE = contractFixture('complete');
const DIR = path.dirname(FIXTURE.files.portfolio);
const [designLanguage, colorScheme, typography, displayMode] = TUPLE.split('/');

test.use({
  appOptions: {
    portfolio: FIXTURE.files.portfolio,
    siteText: fixtureSiteSelecting(readFileSync(FIXTURE.files.site, 'utf8'), 'aurora-glass')
      .replace(/designLanguage: .*/, `designLanguage: ${designLanguage}`)
      .replace(/colorScheme: .*/, `colorScheme: ${colorScheme}`)
      .replace(/typography: .*/, `typography: ${typography}`)
      .replace(/displayMode: .*/, `displayMode: ${displayMode}`),
    sourceFiles: Object.fromEntries(
      FIXTURE.unitFiles.map((file) => [file, readFileSync(path.join(DIR, file), 'utf8')]),
    ),
  },
});

const twoFrames = (page: Page) =>
  page.evaluate(
    () => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done))),
  );

const CASES = [
  { name: 'the Index', selector: '.ag-capsule .ag-capsule__index--live', width: 1440, height: 900 },
  { name: 'the Index', selector: '.ag-capsule .ag-capsule__index--live', width: 1024, height: 768 },
  { name: 'Pause', selector: '.ag-capsule .ag-orn--capsule', width: 1024, height: 768 },
] as const;

for (const each of CASES)
  test(
    `on ${TUPLE} ${each.name}, focused, keeps the capsule's surface under its label at ${each.width}`,
    {
      annotation: [
        { type: 'route', description: '/' },
        { type: 'profile', description: 'read-only' },
      ],
    },
    async ({ page }) => {
      await page.setViewportSize({ width: each.width, height: each.height });
      await page.emulateMedia({
        colorScheme: 'light',
        forcedColors: 'none',
        contrast: 'no-preference',
      });
      await page.goto('/', { waitUntil: 'networkidle' });
      const boundary = page.locator('[data-variant]').first();
      await expect(boundary).toHaveAttribute('data-variant', 'aurora-glass');
      await expect(boundary).toHaveAttribute('data-color-scheme', colorScheme!);
      await page.evaluate(() => document.fonts.ready);
      const control = page.locator(each.selector);
      await expect(control).toHaveCount(1);
      await expect(control).toBeVisible();
      await page.keyboard.press('Shift');
      await control.focus();
      expect(await control.evaluate((el) => el.matches(':focus-visible'))).toBe(true);
      // The control's top padding, inside the box and across its straight middle: above its label.
      const clip = await control.evaluate((el) => {
        const box = el.getBoundingClientRect();
        const top = parseFloat(getComputedStyle(el).paddingBlockStart);
        const end = box.height / 2;
        return {
          x: Math.ceil(box.x + end),
          y: Math.ceil(box.y + 2),
          width: Math.max(1, Math.floor(box.width - 2 * end)),
          height: Math.max(1, Math.floor(top - 3)),
        };
      });
      await twoFrames(page);
      const shot = () => page.screenshot({ clip, animations: 'disabled', caret: 'hide' });
      const focused = decodePng(await shot());
      await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
      await twoFrames(page);
      const blurred = decodePng(await shot());
      let changed = 0;
      for (let i = 0; i < focused.width * focused.height; i++) {
        const [a, b] = [pixel(focused, i), pixel(blurred, i)];
        if (Math.max(...a.map((v, c) => Math.abs(v - b[c]!))) > 2) changed++;
      }
      console.log(
        `label ground ${TUPLE} ${each.width} ${each.name}: clip ${JSON.stringify(clip)}, focused ${JSON.stringify(pixel(focused, 0))} blurred ${JSON.stringify(pixel(blurred, 0))}, changed ${changed} of ${focused.width * focused.height}`,
      );
      expect(changed, 'pixels above the label that focus changes').toBe(0);
    },
  );
