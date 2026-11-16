// A CI read (laid in by the proof kit, never in a head's tree): Obsidian Atelier on the complete
// fixture in Glassmorphism, Lavender Dusk and Accessible Reading, dark, at 1024 by 768 with no preference,
// as the quality cell runs it. Tab walks from the page's top to the Custom section's "Recording title"
// link, the cell's target, and then on Linux the spec writes what the focus check reads there, and the
// ring's geometry: the link's boxes and outline, and on each side of the ring's centre line what paints
// under it, top first, with each layer's background, border and text colours. Then a shot round the link
// focused and one blurred. Self-contained: it imports only the harness and the quality library.
// Out: $PROOF_LOOK_OUT/recording-title.json, recording-title-focused.png, recording-title-blurred.png.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { Page } from '@playwright/test';
import { fixtureSiteSelecting } from '../../packages/variant-contract/src/contract-fixtures';
import { contractFixture } from '../../packages/variant-contract/src/node/fixtures';
import { expect, test } from '../harness/fixtures';
import { focusFindings } from '../quality/lib/a11y/interaction';
import { inPage, type Active } from '../quality/lib/a11y/probe';
import { sweepSiteText } from '../quality/lib/server';

const FIXTURE = contractFixture('complete');
const DIR = path.dirname(FIXTURE.files.portfolio);

test.use({
  appOptions: {
    portfolio: FIXTURE.files.portfolio,
    siteText: sweepSiteText(
      fixtureSiteSelecting(readFileSync(FIXTURE.files.site, 'utf8'), 'obsidian-atelier'),
    ),
    sourceFiles: Object.fromEntries(
      FIXTURE.unitFiles.map((file) => [file, readFileSync(path.join(DIR, file), 'utf8')]),
    ),
  },
  viewport: { width: 1024, height: 768 },
  colorScheme: 'light',
});

const PACKS = {
  language: 'glassmorphism',
  scheme: 'lavender-dusk',
  type: 'accessible-reading',
  mode: 'dark',
} as const;

const frames = (page: Page) =>
  page.evaluate(
    () => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done))),
  );

/** The link's ring as laid out now: its boxes, outline and what paints under the centre line. */
function geometry(page: Page) {
  return page.evaluate(() => {
    const el = document.activeElement as HTMLElement;
    const r = (n: number) => Math.round(n * 10) / 10;
    const box = (b: DOMRect) => [r(b.left), r(b.top), r(b.right), r(b.bottom)];
    const label = (at: Element) =>
      `${at.localName}${at.id ? `#${at.id}` : ''}${typeof at.className === 'string' && at.className.trim() ? `.${at.className.trim().split(/\s+/).join('.')}` : ''}`;
    const cs = getComputedStyle(el);
    const b = el.getBoundingClientRect();
    const w = Number.parseFloat(cs.outlineWidth) || 0;
    const o = Number.parseFloat(cs.outlineOffset) || 0;
    const d = o + w / 2;
    const [x0, y0, x1, y1] = [b.left - d, b.top - d, b.right + d, b.bottom + d];
    const at = (f: number, a: number, z: number) => a + (z - a) * f;
    const sides: Record<string, [number, number][]> = {
      top: [0.1, 0.3, 0.5, 0.7, 0.9].map((f) => [at(f, x0, x1), y0]),
      bottom: [0.1, 0.3, 0.5, 0.7, 0.9].map((f) => [at(f, x0, x1), y1]),
      start: [0.25, 0.5, 0.75].map((f) => [x0, at(f, y0, y1)]),
      end: [0.25, 0.5, 0.75].map((f) => [x1, at(f, y0, y1)]),
    };
    const under = Object.fromEntries(
      Object.entries(sides).map(([side, points]) => [
        side,
        points.map(([x, y]) => ({
          at: [r(x), r(y)],
          stack: document
            .elementsFromPoint(x, y)
            .slice(0, 5)
            .map((layer) => {
              const s = getComputedStyle(layer);
              return {
                el: label(layer),
                bg: s.backgroundColor,
                image: s.backgroundImage === 'none' ? undefined : s.backgroundImage.slice(0, 80),
                border: `${s.borderTopWidth} ${s.borderTopColor} | ${s.borderBottomWidth} ${s.borderBottomColor}`,
                color: s.color,
                decoration:
                  s.textDecorationLine === 'none'
                    ? undefined
                    : `${s.textDecorationLine} ${s.textDecorationColor}`,
              };
            }),
        })),
      ]),
    );
    const parents = [];
    for (let p = el.parentElement, i = 0; p && i < 6; p = p.parentElement, i += 1) {
      const s = getComputedStyle(p);
      parents.push({
        el: label(p),
        box: box(p.getBoundingClientRect()),
        bg: s.backgroundColor,
        image: s.backgroundImage === 'none' ? undefined : s.backgroundImage.slice(0, 80),
        overflow: `${s.overflowX} ${s.overflowY}`,
        border: `${s.borderTopWidth} ${s.borderTopColor} | ${s.borderBottomWidth} ${s.borderBottomColor}`,
      });
    }
    return {
      text: (el.textContent ?? '').trim(),
      box: box(b),
      lines: [...el.getClientRects()].map(box),
      outline: `${cs.outlineWidth} ${cs.outlineStyle} ${cs.outlineColor}, offset ${cs.outlineOffset}`,
      color: cs.color,
      decoration: `${cs.textDecorationLine} ${cs.textDecorationColor} ${cs.textDecorationThickness}, offset ${cs.textUnderlineOffset}`,
      font: `${cs.fontFamily.split(',')[0]} ${cs.fontSize}/${cs.lineHeight} ${cs.fontWeight}`,
      display: cs.display,
      padding: cs.padding,
      margin: cs.margin,
      under,
      parents,
      scroll: [scrollX, scrollY],
    };
  });
}

test('read the Recording title link ring at 1024 in dark', async ({ page, app }) => {
  test.setTimeout(180_000);
  const out = process.env.PROOF_LOOK_OUT ?? '';
  expect(out, 'PROOF_LOOK_OUT').not.toBe('');
  mkdirSync(out, { recursive: true });
  await page.context().addCookies([
    {
      name: 'portfolio_appearance',
      value: new URLSearchParams(PACKS).toString(),
      url: app.origin,
    },
  ]);
  await page.goto('/', { waitUntil: 'networkidle' });
  const boundary = page.locator('[data-appearance-boundary]').first();
  await expect(boundary).toHaveAttribute('data-design-language', PACKS.language);
  await expect(boundary).toHaveAttribute('data-color-scheme', PACKS.scheme);
  await expect(boundary).toHaveAttribute('data-typography', PACKS.type);
  await expect(boundary).toHaveAttribute('data-display-mode', PACKS.mode);
  await page.evaluate(() => document.fonts.ready);
  const link = page.locator('#custom a', { hasText: 'Recording title' }).first();
  await expect(link).toHaveCount(1);
  // Tab from the page's top, as the cell's walk does, to the link.
  await page.mouse.move(0, 0);
  await page.evaluate(() => {
    (document.activeElement as HTMLElement | null)?.blur();
    window.scrollTo(0, 0);
  });
  let presses = 0;
  while (presses < 400 && !(await link.evaluate((el) => el === document.activeElement))) {
    await page.keyboard.press('Tab');
    presses += 1;
  }
  expect(await link.evaluate((el) => el === document.activeElement), 'Tab reaches the link').toBe(
    true,
  );
  await frames(page);
  const active = await inPage<Active>(page, { kind: 'active' });
  const resting = await geometry(page);
  const findings = await focusFindings(page, active);
  await frames(page);
  const read = {
    presses,
    path: active.path,
    reach: active.reach,
    findings,
    resting,
  };
  writeFileSync(path.join(out, 'recording-title.json'), `${JSON.stringify(read, null, 2)}\n`);
  const b = (await link.boundingBox())!;
  const x = Math.max(0, b.x - 24);
  const y = Math.max(0, b.y - 24);
  const clip = {
    x,
    y,
    width: Math.min(1024 - x, b.width + 48),
    height: Math.min(768 - y, b.height + 48),
  };
  await page.screenshot({
    path: path.join(out, 'recording-title-focused.png'),
    clip,
    animations: 'disabled',
    caret: 'hide',
  });
  await link.evaluate((el) => (el as HTMLElement).blur());
  await frames(page);
  await page.screenshot({
    path: path.join(out, 'recording-title-blurred.png'),
    clip,
    animations: 'disabled',
    caret: 'hide',
  });
});
