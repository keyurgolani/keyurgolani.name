// A look-only read on CI Linux: Editorial Evidence's "Pl. 2" link on the complete fixture in the
// release cell's tuple, on a 390x844 touch phone as the cell runs it, in the default, contrast-more
// and forced-colors rows. Focus reaches it twice: by Tab from the top, where the browser leaves the
// page, and by Playwright's scroll then focus(). At each: the focus check's own findings, every point
// of the ring's centre line by side with samples, the link's box, its ring, the boxes near the ring
// that paint (borders, fills, outlines) and what is on top along each side of it, and a clip shot
// focused and blurred. One JSON a read and the shots go to PROOF_LOOK_OUT. It reads and never fails
// on what it finds.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { Locator, Page } from '@playwright/test';
import { fixtureSiteSelecting } from '../../packages/variant-contract/src/contract-fixtures';
import { contractFixture } from '../../packages/variant-contract/src/node/fixtures';
import { test } from '../harness/fixtures';
import { focusFindings } from '../quality/lib/a11y/interaction';
import { inPage, type Active } from '../quality/lib/a11y/probe';
import { everyPoint } from './focus-perimeter';

const OUT = process.env.PROOF_LOOK_OUT ?? path.join('reports', 'ee-pl2-look');
const FIXTURE = contractFixture('complete');
const DIR = path.dirname(FIXTURE.files.portfolio);
test.use({
  isMobile: true,
  hasTouch: true,
  viewport: { width: 390, height: 844 },
  appOptions: {
    portfolio: FIXTURE.files.portfolio,
    siteText: fixtureSiteSelecting(readFileSync(FIXTURE.files.site, 'utf8'), 'editorial-evidence')
      .replace(/designLanguage: .*/, 'designLanguage: platform-neutral')
      .replace(/colorScheme: .*/, 'colorScheme: warm-parchment')
      .replace(/typography: .*/, 'typography: accessible-reading')
      .replace(/displayMode: .*/, 'displayMode: system'),
    sourceFiles: Object.fromEntries(
      FIXTURE.unitFiles.map((file) => [file, readFileSync(path.join(DIR, file), 'utf8')]),
    ),
  },
});

const ROWS = {
  default: { forcedColors: 'none', contrast: 'no-preference' },
  'contrast-more': { forcedColors: 'none', contrast: 'more' },
  'forced-colors': { forcedColors: 'active', contrast: 'no-preference' },
} as const;

const frames = (page: Page) =>
  page.evaluate(
    () => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done))),
  );

/** The link's box and ring, what paints near the ring, and what is on top along each of its sides. */
const geometry = (link: Locator) =>
  link.evaluate((a) => {
    const round = (v: number) => Math.round(v * 100) / 100;
    const box = (el: Element) => {
      const r = el.getBoundingClientRect();
      return [r.x, r.y, r.width, r.height].map(round);
    };
    const name = (el: Element | null) =>
      el
        ? `${el.localName}${el.id ? `#${el.id}` : ''}.${[...el.classList].slice(0, 3).join('.')}`
        : 'none';
    const s = getComputedStyle(a);
    const r = a.getBoundingClientRect();
    const reach = parseFloat(s.outlineOffset) + parseFloat(s.outlineWidth);
    const ring = {
      left: r.left - reach,
      right: r.right + reach,
      top: r.top - reach,
      bottom: r.bottom + reach,
    };
    const near: string[] = [];
    for (const el of document.querySelectorAll('body *')) {
      if (el === a || a.contains(el)) continue;
      const b = el.getBoundingClientRect();
      if (
        b.right < ring.left - 6 ||
        b.left > ring.right + 6 ||
        b.bottom < ring.top - 6 ||
        b.top > ring.bottom + 6
      )
        continue;
      if (b.width > 300 && b.height > 300) continue;
      const c = getComputedStyle(el);
      const borders = ['top', 'right', 'bottom', 'left']
        .filter(
          (side) =>
            parseFloat(c.getPropertyValue(`border-${side}-width`)) > 0 &&
            c.getPropertyValue(`border-${side}-style`) !== 'none',
        )
        .map(
          (side) =>
            `${side} ${c.getPropertyValue(`border-${side}-width`)} ${c.getPropertyValue(`border-${side}-color`)}`,
        );
      const bg = c.backgroundColor !== 'rgba(0, 0, 0, 0)' ? `bg ${c.backgroundColor}` : '';
      const shadow = c.boxShadow !== 'none' ? `shadow ${c.boxShadow.slice(0, 60)}` : '';
      const outline =
        c.outlineStyle !== 'none' && parseFloat(c.outlineWidth) > 0
          ? `outline ${c.outlineWidth} ${c.outlineColor}`
          : '';
      const text =
        el.childNodes.length && !el.children.length
          ? `"${(el.textContent ?? '').trim().slice(0, 20)}"`
          : '';
      near.push(
        `${name(el)} ${JSON.stringify(box(el))} pos ${c.position} ${[...borders, bg, shadow, outline, text].filter(Boolean).join('; ')}`,
      );
    }
    const tops: Record<string, Record<string, number>> = {
      top: {},
      bottom: {},
      left: {},
      right: {},
    };
    const mid = reach - parseFloat(s.outlineWidth) / 2;
    const sample = (side: string, x: number, y: number) => {
      const k = name(document.elementFromPoint(x, y));
      tops[side]![k] = (tops[side]![k] ?? 0) + 1;
    };
    for (let x = r.left - mid; x <= r.right + mid; x += 1) {
      sample('top', x, r.top - mid);
      sample('bottom', x, r.bottom + mid);
    }
    for (let y = r.top - mid; y <= r.bottom + mid; y += 1) {
      sample('left', r.left - mid, y);
      sample('right', r.right + mid, y);
    }
    return {
      scrollY: round(window.scrollY),
      box: box(a),
      outline: `${s.outlineWidth} ${s.outlineStyle} ${s.outlineColor} offset ${s.outlineOffset}`,
      fill: s.backgroundColor,
      display: s.display,
      padding: s.padding,
      lineHeight: s.lineHeight,
      font: `${s.fontFamily.slice(0, 40)} ${s.fontSize}`,
      parents: [a.parentElement, a.closest('.ee-row__line'), a.closest('.ee-row')].map((el) =>
        el ? `${name(el)} ${JSON.stringify(box(el))}` : '-',
      ),
      near,
      tops,
    };
  });

for (const [row, media] of Object.entries(ROWS)) {
  test(`Pl. 2 at 390 on a touch phone, ${row}: the focus check, its ring and what is near it`, async ({
    page,
  }) => {
    test.setTimeout(180_000);
    mkdirSync(OUT, { recursive: true });
    for (const how of ['tab', 'scroll'] as const) {
      await page.emulateMedia({ colorScheme: 'light', ...media });
      await page.goto('/', { waitUntil: 'networkidle' });
      await page.evaluate(() => document.fonts.ready);
      const link = page.getByRole('link', { name: 'Pl. 2', exact: true }).first();
      let presses = 0;
      if (how === 'tab') {
        for (; presses < 200; presses += 1) {
          await page.keyboard.press('Tab');
          if (await link.evaluate((el) => el === document.activeElement)) break;
        }
      } else {
        await link.scrollIntoViewIfNeeded();
        await page.keyboard.press('Shift');
        await link.focus();
      }
      await frames(page);
      const focused = await link.evaluate(
        (el) => el === document.activeElement && el.matches(':focus-visible'),
      );
      const where = await geometry(link);
      const active = await inPage<Active>(page, { kind: 'active' });
      const points = await everyPoint(page, link, active);
      const findings = await focusFindings(page, active);
      const tag = `${row}-${how}`;
      const read = { row, how, presses: presses + 1, focused, active, where, points, findings };
      writeFileSync(path.join(OUT, `pl2-${tag}.json`), JSON.stringify(read, null, 1));
      console.log(
        `ee pl2 ${tag}: focused ${focused}, findings ${JSON.stringify(findings)}, points ${points.points} weak ${points.weak.length} by side ${JSON.stringify(points.sides)}, samples ${JSON.stringify(points.samples)}, where ${JSON.stringify(where)}`,
      );
      const b = (await link.boundingBox())!;
      const clip = {
        x: Math.max(0, Math.floor(b.x - 12)),
        y: Math.max(0, Math.floor(b.y - 12)),
        width: Math.ceil(b.width + 24),
        height: Math.ceil(b.height + 24),
      };
      await link.evaluate((el: HTMLElement) => el.focus());
      await frames(page);
      await page.screenshot({
        path: path.join(OUT, `pl2-${tag}-focused.png`),
        clip,
        animations: 'disabled',
        caret: 'hide',
      });
      await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
      await frames(page);
      await page.screenshot({
        path: path.join(OUT, `pl2-${tag}-blurred.png`),
        clip,
        animations: 'disabled',
        caret: 'hide',
      });
    }
  });
}
