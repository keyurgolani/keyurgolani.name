import { readFileSync } from 'node:fs';
import path from 'node:path';
import type { Page } from '@playwright/test';
import { fixtureSiteSelecting } from '../../packages/variant-contract/src/contract-fixtures';
import { contractFixture } from '../../packages/variant-contract/src/node/fixtures';
import { expect, test } from '../harness/fixtures';

// Horizontal Cinema sets its quiet inks on the matte as a mix of the scrim's ink and the matte:
// color-mix(in oklab, var(--color-on-scrim) 72%, var(--layout-matte)), and its rules at 24%.
// Under forced colours the two are system colours, and a mix of system colours stays a mix: the
// light palette's quiet ink read a grey at 3.88:1 on the canvas, an image's 10 px credit among
// them. Under forced colours, in the light palette and in the dark one, at 390 and at 1024, on
// the complete contract fixture's home, every text the composition paints reads 4.5:1 or more
// against the ground behind it.

const FIXTURE = contractFixture('complete');
const DIR = path.dirname(FIXTURE.files.portfolio);
const annotation = [
  { type: 'route', description: '/' },
  { type: 'profile', description: 'read-only' },
];

test.use({
  appOptions: {
    portfolio: FIXTURE.files.portfolio,
    siteText: fixtureSiteSelecting(readFileSync(FIXTURE.files.site, 'utf8'), 'horizontal-cinema'),
    sourceFiles: Object.fromEntries(
      FIXTURE.unitFiles.map((file) => [file, readFileSync(path.join(DIR, file), 'utf8')]),
    ),
  },
  contextOptions: { forcedColors: 'active' },
});

/** Every painted text under the composition below 4.5:1 on its ground, as its ink, ground and ratio. */
async function faint(page: Page) {
  await page.goto('/', { waitUntil: 'networkidle' });
  await page.evaluate(() => document.fonts.ready);
  return page.evaluate(() => {
    const canvas = document.createElement('canvas');
    canvas.width = 1;
    canvas.height = 1;
    const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
    // Any computed colour, an oklab() or color() one included, as sRGB channels and alpha.
    const rgba = (value: string): [number, number, number, number] => {
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
    const ratio = (a: number[], b: number[]) => {
      const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x) as [number, number];
      return (hi + 0.05) / (lo + 0.05);
    };
    const root = document.querySelector('[data-variant="horizontal-cinema"]');
    if (!root) return { found: false, texts: 0, faint: [] as string[] };
    const canvasGround = rgba(getComputedStyle(document.documentElement).backgroundColor);
    const out: string[] = [];
    let texts = 0;
    for (const el of root.querySelectorAll<HTMLElement>('*')) {
      if (![...el.childNodes].some((n) => n.nodeType === 3 && n.textContent!.trim())) continue;
      const style = getComputedStyle(el);
      if (style.visibility !== 'visible' || el.getClientRects().length === 0) continue;
      const box = el.getBoundingClientRect();
      if (box.width < 1 || box.height < 1) continue;
      // The ground: the nearest box behind it that paints a colour; text over a picture is left out.
      let ground: number[] | null = null;
      let pictured = false;
      for (let at: Element | null = el; at; at = at.parentElement) {
        const s = getComputedStyle(at);
        if (s.backgroundImage !== 'none' && !s.backgroundImage.startsWith('linear-gradient')) {
          pictured = true;
          break;
        }
        const bg = rgba(s.backgroundColor);
        if (bg[3] > 0.99) {
          ground = bg;
          break;
        }
      }
      if (pictured) continue;
      texts += 1;
      const ink = rgba(style.color);
      const back = ground ?? canvasGround;
      const r = ratio(ink, back);
      if (r < 4.5)
        out.push(
          `${el.localName}.${typeof el.className === 'string' ? el.className : ''} "${(el.textContent ?? '').trim().slice(0, 32)}" ${style.color} on rgb(${back.slice(0, 3).join(', ')}) at ${r.toFixed(2)}:1`,
        );
    }
    return { found: true, texts, faint: out.slice(0, 20) };
  });
}

for (const scheme of ['light', 'dark'] as const) {
  for (const [width, height] of [
    [390, 844],
    [1024, 768],
  ] as const) {
    test.describe(`${scheme} ${width}`, () => {
      test.use({ colorScheme: scheme, viewport: { width, height } });
      test(
        `under forced colours in the ${scheme} palette at ${width}, every text Horizontal Cinema paints reads 4.5:1 or more`,
        { annotation },
        async ({ page }) => {
          const read = await faint(page);
          expect(
            await page.evaluate(() => matchMedia('(forced-colors: active)').matches),
            'forced colours',
          ).toBe(true);
          expect(
            { found: read.found, some: read.texts > 0, faint: read.faint },
            JSON.stringify(read),
          ).toEqual({
            found: true,
            some: true,
            faint: [],
          });
        },
      );
    });
  }
}
