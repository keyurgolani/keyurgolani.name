// Look shots for one CI read (laid in by the proof kit, never in a head's tree): Horizontal
// Cinema's home on the complete contract fixture under forced colours at 1024, in the light and
// the dark palette. The first text holding 'Credit gallery-photo', shot with a margin round it,
// and beside it every box from that text up to the page: its colour, ground, colour scheme,
// forced-color-adjust and opacity as computed, so the grey's source shows.
// Out: $PROOF_LOOK_OUT/1024-<palette>-credit.png and 1024-<palette>-credit.json.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fixtureSiteSelecting } from '../../packages/variant-contract/src/contract-fixtures';
import { contractFixture } from '../../packages/variant-contract/src/node/fixtures';
import { expect, test } from '../harness/fixtures';

const FIXTURE = contractFixture('complete');
const DIR = path.dirname(FIXTURE.files.portfolio);

test.use({
  appOptions: {
    portfolio: FIXTURE.files.portfolio,
    siteText: fixtureSiteSelecting(readFileSync(FIXTURE.files.site, 'utf8'), 'horizontal-cinema'),
    sourceFiles: Object.fromEntries(
      FIXTURE.unitFiles.map((file) => [file, readFileSync(path.join(DIR, file), 'utf8')]),
    ),
  },
  contextOptions: { forcedColors: 'active' },
  viewport: { width: 1024, height: 768 },
});

for (const palette of ['light', 'dark'] as const) {
  test.describe(palette, () => {
    test.use({ colorScheme: palette });
    test(`look 1024 forced ${palette}: the gallery credit and its chain`, async ({ page }) => {
      const out = process.env.PROOF_LOOK_OUT ?? '';
      expect(out, 'PROOF_LOOK_OUT').not.toBe('');
      mkdirSync(out, { recursive: true });
      await page.goto('/', { waitUntil: 'networkidle' });
      await page.evaluate(() => document.fonts.ready);
      const credit = page
        .locator('body *', { hasText: /^Credit gallery-photo$/ })
        .filter({ visible: true })
        .last();
      await expect(credit).toHaveCount(1);
      await credit.evaluate((el) => el.scrollIntoView({ block: 'center', inline: 'center' }));
      await page.evaluate(
        () => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done))),
      );
      const read = await credit.evaluate((el) => {
        const chain: Record<string, string>[] = [];
        for (let at: Element | null = el; at; at = at.parentElement) {
          const s = getComputedStyle(at);
          chain.push({
            el: `${at.localName}${at.id ? `#${at.id}` : ''}${typeof at.className === 'string' && at.className ? `.${at.className.trim().split(/\s+/).join('.')}` : ''}`,
            color: s.color,
            background: s.backgroundColor,
            colorScheme: s.colorScheme,
            forcedColorAdjust: s.forcedColorAdjust,
            opacity: s.opacity,
            matte: s.getPropertyValue('--layout-matte').trim(),
            onScrim: s.getPropertyValue('--color-on-scrim').trim(),
            scrim: s.getPropertyValue('--color-scrim').trim(),
          });
        }
        return {
          text: (el.textContent ?? '').trim(),
          forced: matchMedia('(forced-colors: active)').matches,
          dark: matchMedia('(prefers-color-scheme: dark)').matches,
          chain,
        };
      });
      writeFileSync(
        path.join(out, `1024-${palette}-credit.json`),
        `${JSON.stringify(read, null, 2)}\n`,
      );
      const b = (await credit.boundingBox())!;
      const pad = 24;
      await page.screenshot({
        path: path.join(out, `1024-${palette}-credit.png`),
        clip: {
          x: Math.max(0, b.x - pad),
          y: Math.max(0, b.y - pad),
          width: Math.min(1024 - Math.max(0, b.x - pad), b.width + 2 * pad),
          height: Math.min(768 - Math.max(0, b.y - pad), b.height + 2 * pad),
        },
        animations: 'disabled',
        caret: 'hide',
      });
    });
  });
}
