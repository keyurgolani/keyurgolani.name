import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fixtureSiteSelecting } from '../../packages/variant-contract/src/contract-fixtures';
import { contractFixture } from '../../packages/variant-contract/src/node/fixtures';
import { expect, test } from '../harness/fixtures';
import { contrast, decodePng, pixel } from '../quality/lib/pixels';

// DIAGNOSTIC (evidence branch only, never landed): row 121 on CI Linux. The quality cells obsidian-atelier
// missing-media / at 390x844 contrast-more, dark and high contrast, record focus/perimeter on the chrome's name
// link (header > a:nth-child(2)), its ring only partly drawn; on macOS both pass. At 390 the ring runs over the
// entrance plaque's first line's box, "Mira Missing" in light ink, and white on it reads 1.21:1. Focused, per
// side of the ring: its band's pixels, those whose change is under 3:1, and of those the ones where the page at
// rest shows something other than the wall's ground (glyph ink), with the plaque line's ink box from the font's
// metrics. Fails only when glyph ink under the ring's foot weakens it, and its message carries the read, so the
// CI log says whether the plaque's ink is what cuts the ring. One display mode a file: each a server of its own.

const FIXTURE = contractFixture('missing-media');
const DIR = path.dirname(FIXTURE.files.portfolio);
/** The records' own path: the chrome's name link. */
const MARK = 'html > body:nth-child(2) > div:nth-child(2) > header:nth-child(2) > a:nth-child(2)';
const LINE = '.oa-plaque__line:nth-child(1)';

export const ringPlaqueOptions = (mode: 'dark' | 'high-contrast') => ({
  portfolio: FIXTURE.files.portfolio,
  siteText: fixtureSiteSelecting(readFileSync(FIXTURE.files.site, 'utf8'), 'obsidian-atelier')
    .replace(/designLanguage: .*/, 'designLanguage: platform-neutral')
    .replace(/colorScheme: .*/, 'colorScheme: warm-parchment')
    .replace(/typography: .*/, 'typography: humanist-ui')
    .replace(/displayMode: .*/, `displayMode: ${mode}`),
  sourceFiles: Object.fromEntries(
    FIXTURE.unitFiles.map((file) => [file, readFileSync(path.join(DIR, file), 'utf8')]),
  ),
});

export function ringPlaque(mode: 'dark' | 'high-contrast') {
  test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  test(`DIAGNOSTIC ${mode}: at 390 with more contrast, does the plaque's ink cut the name link's ring`, async ({
    page,
  }) => {
    await page.emulateMedia({ contrast: 'more' });
    await page.goto('/', { waitUntil: 'networkidle' });
    const mark = page.locator(MARK);
    await expect(mark).toHaveCount(1);
    const line = await page.locator(LINE).evaluate((el) => {
      const s = getComputedStyle(el);
      const ctx = document.createElement('canvas').getContext('2d')!;
      ctx.font = `${s.fontStyle} ${s.fontWeight} ${s.fontSize} ${s.fontFamily}`;
      const m = ctx.measureText((el.textContent ?? '').trim());
      const range = document.createRange();
      range.selectNodeContents(el);
      const lines = [...range.getClientRects()].filter((r) => r.width > 0);
      const lh = parseFloat(s.lineHeight) || parseFloat(s.fontSize) * 1.2;
      const half = (lh - (m.fontBoundingBoxAscent + m.fontBoundingBoxDescent)) / 2;
      const r1 = (n: number) => Math.round(n * 10) / 10;
      return {
        text: (el.textContent ?? '').trim(),
        font: ctx.font.slice(0, 80),
        has: document.fonts.check(`${s.fontSize} ${s.fontFamily.split(',')[0]}`),
        lineHeight: s.lineHeight,
        lines: lines.map((r) => {
          const baseline = r.top + half + m.fontBoundingBoxAscent;
          return {
            box: [r.left, r.top, r.right, r.bottom].map(r1),
            ink: [
              r.left,
              baseline - m.actualBoundingBoxAscent,
              r.right,
              baseline + m.actualBoundingBoxDescent,
            ].map(r1),
          };
        }),
      };
    });
    const box = await mark.evaluate((el) => {
      const r = el.getBoundingClientRect();
      return { left: r.left, top: r.top, right: r.right, bottom: r.bottom };
    });
    const pad = 8;
    const clip = {
      x: Math.max(0, Math.floor(box.left - pad)),
      y: Math.max(0, Math.floor(box.top - pad)),
      width: Math.ceil(box.right - box.left + 2 * pad),
      height: Math.ceil(box.bottom - box.top + 2 * pad),
    };
    const blurred = decodePng(await page.screenshot({ clip, animations: 'disabled' }));
    await mark.evaluate((el) => (el as HTMLElement).focus({ focusVisible: true } as FocusOptions));
    await page.evaluate(
      () => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done))),
    );
    const ring = await mark.evaluate((el) => {
      const s = getComputedStyle(el);
      return {
        focusVisible: el.matches(':focus-visible'),
        width: parseFloat(s.outlineWidth),
        offset: parseFloat(s.outlineOffset),
        color: s.outlineColor,
        style: s.outlineStyle,
      };
    });
    const focused = decodePng(await page.screenshot({ clip, animations: 'disabled' }));
    const scale = focused.width / clip.width;
    // The wall's ground: the commonest colour at rest round the link's box.
    const counts = new Map<string, number>();
    for (let i = 0; i < blurred.width * blurred.height; i++) {
      const k = pixel(blurred, i).join(',');
      counts.set(k, (counts.get(k) ?? 0) + 1);
    }
    const ground = [...counts.entries()]
      .sort((a, b) => b[1] - a[1])[0]![0]
      .split(',')
      .map(Number) as [number, number, number];
    const [inner, outer] = [ring.offset, ring.offset + ring.width];
    const sides = {
      top: {
        x0: box.left - outer,
        x1: box.right + outer,
        y0: box.top - outer,
        y1: box.top - inner,
      },
      bottom: {
        x0: box.left - outer,
        x1: box.right + outer,
        y0: box.bottom + inner,
        y1: box.bottom + outer,
      },
      left: {
        x0: box.left - outer,
        x1: box.left - inner,
        y0: box.top - inner,
        y1: box.bottom + inner,
      },
      right: {
        x0: box.right + inner,
        x1: box.right + outer,
        y0: box.top - inner,
        y1: box.bottom + inner,
      },
    };
    const read = Object.fromEntries(
      Object.entries(sides).map(([side, b]) => {
        let band = 0;
        let weak = 0;
        let weakOnInk = 0;
        for (
          let y = Math.floor((b.y0 - clip.y) * scale);
          y < Math.ceil((b.y1 - clip.y) * scale);
          y++
        )
          for (
            let x = Math.floor((b.x0 - clip.x) * scale);
            x < Math.ceil((b.x1 - clip.x) * scale);
            x++
          ) {
            if (x < 0 || y < 0 || x >= focused.width || y >= focused.height) continue;
            const i = y * focused.width + x;
            band++;
            const [after, before] = [pixel(focused, i), pixel(blurred, i)];
            if (contrast(after, before) >= 3) continue;
            weak++;
            if (contrast(before, ground) >= 1.1) weakOnInk++;
          }
        return [side, { band, weak, weakOnInk }];
      }),
    );
    const report = { mode, ground, ring, box, clip, scale, line, read };
    console.log(`[diag r121] ${JSON.stringify(report)}`);
    expect(ring.focusVisible, 'the name link has focus-visible').toBe(true);
    expect(
      read.bottom!.weakOnInk,
      `glyph ink under the ring's foot weakens it: ${JSON.stringify(report)}`,
    ).toBe(0);
  });
}
