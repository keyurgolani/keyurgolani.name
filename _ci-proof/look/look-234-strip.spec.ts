// Look shots for one CI proof (laid in by the proof kit, never in a head's tree): Horizontal
// Cinema's home on the complete contract fixture under forced colours at 1024, in the light and
// the dark palette. The Strip | List switch, shot with a margin round it, and beside it each of
// its links' ink and ground as computed, resolved to sRGB, with the ratio between them.
// Out: $PROOF_LOOK_OUT/1024-<palette>-views.png and 1024-<palette>-views.json.
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
    test(`look 1024 forced ${palette}: the Strip | List switch and its inks`, async ({ page }) => {
      const out = process.env.PROOF_LOOK_OUT ?? '';
      expect(out, 'PROOF_LOOK_OUT').not.toBe('');
      mkdirSync(out, { recursive: true });
      await page.goto('/', { waitUntil: 'networkidle' });
      await page.evaluate(() => document.fonts.ready);
      const views = page.locator('.hc-chrome__views').filter({ visible: true });
      await expect(views).toHaveCount(1);
      const read = await views.evaluate((el) => {
        const canvas = document.createElement('canvas');
        canvas.width = 1;
        canvas.height = 1;
        const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
        const rgba = (value: string) => {
          ctx.clearRect(0, 0, 1, 1);
          ctx.fillStyle = '#000';
          ctx.fillStyle = value;
          ctx.fillRect(0, 0, 1, 1);
          const [r, g, b, a] = ctx.getImageData(0, 0, 1, 1).data;
          return [r!, g!, b!, a! / 255];
        };
        const lum = ([r, g, b]: number[]) => {
          const c = [r!, g!, b!].map((v) => {
            const s = v / 255;
            return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
          });
          return 0.2126 * c[0]! + 0.7152 * c[1]! + 0.0722 * c[2]!;
        };
        const ground = (at: Element | null) => {
          for (; at; at = at.parentElement) {
            const bg = rgba(getComputedStyle(at).backgroundColor);
            if (bg[3]! > 0.99) return bg;
          }
          return rgba(getComputedStyle(document.documentElement).backgroundColor);
        };
        return {
          forced: matchMedia('(forced-colors: active)').matches,
          dark: matchMedia('(prefers-color-scheme: dark)').matches,
          links: [...el.querySelectorAll('a')].map((a) => {
            const s = getComputedStyle(a);
            const ink = rgba(s.color);
            const back = ground(a);
            const [hi, lo] = [lum(ink), lum(back)].sort((x, y) => y - x) as [number, number];
            return {
              text: (a.textContent ?? '').trim(),
              current: a.getAttribute('aria-current'),
              color: s.color,
              background: s.backgroundColor,
              ink: ink.slice(0, 3),
              ground: back.slice(0, 3),
              ratio: Number(((hi + 0.05) / (lo + 0.05)).toFixed(2)),
            };
          }),
        };
      });
      writeFileSync(
        path.join(out, `1024-${palette}-views.json`),
        `${JSON.stringify(read, null, 2)}\n`,
      );
      const b = (await views.boundingBox())!;
      const pad = 24;
      const x = Math.max(0, b.x - pad);
      const y = Math.max(0, b.y - pad);
      await page.screenshot({
        path: path.join(out, `1024-${palette}-views.png`),
        clip: {
          x,
          y,
          width: Math.min(1024 - x, b.width + 2 * pad),
          height: Math.min(768 - y, b.height + 2 * pad),
        },
        animations: 'disabled',
        caret: 'hide',
      });
    });
  });
}
