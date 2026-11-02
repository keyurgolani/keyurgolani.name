import { readFileSync } from 'node:fs';
import path from 'node:path';
import type { Page } from '@playwright/test';
import { fixtureSiteSelecting } from '../../packages/variant-contract/src/contract-fixtures';
import { contractFixture } from '../../packages/variant-contract/src/node/fixtures';
import { expect, test } from '../harness/fixtures';

// Mission Control's checks in a browser (variants-10 brief §5.8, step 10),
// for its home slice: the wall is full bleed and sums to the window at 1440
// (MC-M2), the readouts are square with their figures on one line (MC-M3),
// the largest type on the first view is a readout figure (MC-M1), a rail
// word shows at once on keyboard focus (MC-S6), nothing runs a frame loop
// or an endless animation at rest or under reduced motion (no clock until
// K-7), and a phone has no sideways scroll, its rail docked at the foot.
// On the complete fixture, under read-only.

const FIXTURE = contractFixture('complete');
const DIR = path.dirname(FIXTURE.files.portfolio);
const annotation = [
  { type: 'route', description: '/' },
  { type: 'profile', description: 'read-only' },
];

test.use({
  appOptions: {
    portfolio: FIXTURE.files.portfolio,
    siteText: fixtureSiteSelecting(readFileSync(FIXTURE.files.site, 'utf8'), 'mission-control'),
    sourceFiles: Object.fromEntries(
      FIXTURE.unitFiles.map((file) => [file, readFileSync(path.join(DIR, file), 'utf8')]),
    ),
  },
});

test(
  'the wall is full bleed: the rail, then the panels to the window’s edge (MC-M2)',
  { annotation },
  async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('/', { waitUntil: 'networkidle' });
    await expect(page.locator('[data-variant="mission-control"]')).toHaveCount(1);
    const edges = await page.evaluate(() => {
      const rail = document.querySelector('.mc-rail')!.getBoundingClientRect();
      const wall = document.querySelector('.mc-board--overview .mc-wall')!.getBoundingClientRect();
      return {
        rail: Math.round(rail.width),
        left: Math.round(wall.left),
        right: Math.round(wall.right),
      };
    });
    expect(edges.rail).toBe(52);
    // One seam from the rail, one from the window's edge, and nothing more.
    expect(edges.left - edges.rail).toBeLessThanOrEqual(6);
    expect(1440 - edges.right).toBeLessThanOrEqual(6);
  },
);

test(
  'the readouts are square, their figures on one baseline, the largest type in view (MC-M1, MC-M3)',
  { annotation },
  async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('/', { waitUntil: 'networkidle' });
    const readouts = page.locator('.mc-readout');
    if ((await readouts.count()) === 0) test.skip(true, 'the fixture has no metrics');
    const measured = await page.evaluate(() => {
      const squares = [...document.querySelectorAll('.mc-readout')].map((el) => {
        const box = el.getBoundingClientRect();
        return Math.abs(box.width - box.height);
      });
      const figures = [...document.querySelectorAll('.mc-readout__figure')];
      const rows = new Map<number, number[]>();
      for (const figure of figures) {
        const box = figure.closest('.mc-readout')!.getBoundingClientRect();
        const list = rows.get(Math.round(box.top)) ?? [];
        list.push(Math.round(figure.getBoundingClientRect().bottom));
        rows.set(Math.round(box.top), list);
      }
      const figureSize = parseFloat(getComputedStyle(figures[0]!).fontSize);
      const name = parseFloat(getComputedStyle(document.querySelector('h1')!).fontSize);
      return { squares, rows: [...rows.values()], figureSize, name };
    });
    for (const off of measured.squares) expect(off).toBeLessThanOrEqual(1);
    for (const row of measured.rows)
      expect(Math.max(...row) - Math.min(...row)).toBeLessThanOrEqual(1);
    expect(measured.figureSize).toBeGreaterThan(measured.name);
  },
);

test(
  'each readout’s focus ring sits inside its square, on all four sides (C2)',
  { annotation },
  async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('/', { waitUntil: 'networkidle' });
    const links = page.locator('.mc-readout__link');
    const n = await links.count();
    if (n === 0) test.skip(true, 'the fixture has no metrics');
    // Keyboard focus, so :focus-visible matches: from the stop before the first square, Tab.
    await links.first().focus();
    await page.keyboard.press('Shift+Tab');
    for (let i = 0; i < n; i++) {
      await page.keyboard.press('Tab');
      await expect(links.nth(i)).toBeFocused();
      // The ring's outer edge, the link's box grown by the offset and the width, against the
      // square's: inside it on all four sides, so neither the panel's clip nor the next
      // square covers any of it.
      const ring = await links.nth(i).evaluate((link) => {
        const style = getComputedStyle(link);
        const reach = parseFloat(style.outlineOffset) + parseFloat(style.outlineWidth);
        const square = link.closest('.mc-readout')!.getBoundingClientRect();
        const box = link.getBoundingClientRect();
        return {
          style: style.outlineStyle,
          width: parseFloat(style.outlineWidth),
          sides: [
            box.top - reach - square.top,
            square.right - (box.right + reach),
            square.bottom - (box.bottom + reach),
            box.left - reach - square.left,
          ].map((gap) => Math.round(gap * 10) / 10),
        };
      });
      expect(ring.style).not.toBe('none');
      expect(ring.width).toBeGreaterThan(0);
      for (const gap of ring.sides)
        expect(gap, `the ring inside its square: ${ring.sides}`).toBeGreaterThanOrEqual(-0.5);
    }
  },
);

test(
  'on a desk a focused status link shows its whole ring: no box that clips the name cuts it (the quality focus-contrast check)',
  { annotation },
  async ({ page }) => {
    for (const width of [1440, 1024]) {
      await page.setViewportSize({ width, height: 900 });
      await page.goto('/', { waitUntil: 'networkidle' });
      const links = page.locator('.mc-status__where a');
      expect(await links.count(), `${width}: the status line's links`).toBeGreaterThan(0);
      // Keyboard focus, so :focus-visible matches.
      await page.keyboard.press('Tab');
      for (const link of await links.all()) {
        await link.focus();
        const ring = await link.evaluate((a) => {
          const style = getComputedStyle(a);
          const reach = parseFloat(style.outlineOffset) + parseFloat(style.outlineWidth);
          const box = a.getBoundingClientRect();
          const cuts: string[] = [];
          for (let up = a.parentElement; up && up !== document.body; up = up.parentElement) {
            const s = getComputedStyle(up);
            if (!/hidden|clip/.test(`${s.overflowX} ${s.overflowY}`)) continue;
            // What it clips to: its padding box.
            const b = up.getBoundingClientRect();
            const sides = [
              box.top - reach - (b.top + parseFloat(s.borderTopWidth)),
              b.right - parseFloat(s.borderRightWidth) - (box.right + reach),
              b.bottom - parseFloat(s.borderBottomWidth) - (box.bottom + reach),
              box.left - reach - (b.left + parseFloat(s.borderLeftWidth)),
            ].map((gap) => Math.round(gap * 10) / 10);
            if (sides.some((gap) => gap < -0.5)) cuts.push(`${up.className}: ${sides}`);
          }
          return { focused: a.matches(':focus-visible'), width: style.outlineWidth, cuts };
        });
        expect(ring.focused, `${width}: keyboard focus`).toBe(true);
        expect(ring.width, `${width}: a ring`).not.toBe('0px');
        expect(ring.cuts, `${width}: the ring inside every clip`).toEqual([]);
      }
    }
  },
);

test(
  'under larger text the status line keeps one line and its readings go out whole, never cut, and it stays its sticky offset tall (the quality root-text reflow check)',
  { annotation },
  async ({ page }) => {
    for (const [width, scale] of [
      [1024, 2],
      [1440, 2],
      [1440, 1.5],
      [1024, 1.25],
      [1024, 1],
    ] as const) {
      await page.setViewportSize({ width, height: 768 });
      await page.goto('/', { waitUntil: 'networkidle' });
      // As the quality harness enlarges root text.
      await page.evaluate(
        (s) => document.documentElement.style.setProperty('font-size', `${s * 100}%`, 'important'),
        scale,
      );
      await page.evaluate(
        () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))),
      );
      const line = await page.evaluate(() => {
        const status = document.querySelector('.mc-status')!;
        const style = getComputedStyle(status);
        const box = status.getBoundingClientRect();
        const inner = {
          left: box.left + parseFloat(style.paddingLeft) - 0.5,
          right: box.right - parseFloat(style.paddingRight) + 0.5,
        };
        const cut: string[] = [];
        let shown = 0;
        for (const reading of status.querySelectorAll('.mc-status__signals > li')) {
          if (reading.getClientRects().length === 0) continue;
          shown += 1;
          const r = reading.getBoundingClientRect();
          // Whole: inside the line, on its one row, and no box between clips it.
          if (
            r.left < inner.left ||
            r.right > inner.right ||
            r.top < box.top ||
            r.bottom > box.bottom
          )
            cut.push(`${reading.textContent}: ${Math.round(r.left)}-${Math.round(r.right)}`);
          for (let up = reading.parentElement; up && up !== status; up = up.parentElement) {
            const s = getComputedStyle(up);
            if (/hidden|clip/.test(`${s.overflowX} ${s.overflowY}`))
              cut.push(`${reading.textContent}: under ${up.className}'s clip`);
          }
        }
        const end = status.querySelector('.mc-status__end')!.getBoundingClientRect();
        const offset = document.createElement('div');
        offset.style.blockSize = 'var(--layout-sticky-offset)';
        status.parentElement!.append(offset);
        const sticky = offset.getBoundingClientRect().height;
        offset.remove();
        return {
          cut,
          shown,
          readings: status.querySelectorAll('.mc-status__signals > li').length,
          height: box.height,
          sticky,
          endInside: end.right <= inner.right,
          sideways: document.documentElement.scrollWidth > innerWidth,
        };
      });
      const at = `${width} at ${scale * 100}% text`;
      expect(line.cut, `${at}: readings cut`).toEqual([]);
      expect(line.endInside, `${at}: the visitor control inside the line`).toBe(true);
      expect(line.sideways, `${at}: no sideways scroll`).toBe(false);
      expect(
        Math.abs(line.height - line.sticky),
        `${at}: ${line.height} tall, offset ${line.sticky}`,
      ).toBeLessThanOrEqual(1);
      // At 1024 and 100% text it holds every reading, as it always has.
      if (scale === 1) expect(line.shown, `${at}: the readings`).toBe(line.readings);
    }
  },
);

test('a rail word shows at once on keyboard focus (MC-S6)', { annotation }, async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/', { waitUntil: 'networkidle' });
  const link = page.locator('.mc-rail__link').first();
  await link.focus();
  await expect(link.locator('.mc-rail__label')).toHaveCSS('opacity', '1');
});

test(
  'nothing runs a frame loop or an endless animation at rest, with motion or reduced (K-4 c)',
  { annotation },
  async ({ page }) => {
    for (const reducedMotion of ['no-preference', 'reduce'] as const) {
      await page.emulateMedia({ reducedMotion });
      await page.setViewportSize({ width: 1440, height: 900 });
      await page.goto('/', { waitUntil: 'networkidle' });
      const counted = await page.evaluate(async () => {
        let frames = 0;
        const real = window.requestAnimationFrame;
        window.requestAnimationFrame = (callback) => {
          frames += 1;
          return real(callback);
        };
        await new Promise((resolve) => setTimeout(resolve, 1500));
        window.requestAnimationFrame = real;
        const endless = document
          .getAnimations()
          .filter((animation) => animation.effect?.getTiming().iterations === Infinity).length;
        return { frames, endless };
      });
      expect(counted).toEqual({ frames: 0, endless: 0 });
    }
  },
);

test(
  'a phone: no sideways scroll at 390 or 320, the rail docked at the foot as icons with names (MC-S4)',
  { annotation },
  async ({ page }) => {
    for (const width of [390, 320]) {
      await page.setViewportSize({ width, height: 800 });
      await page.goto('/', { waitUntil: 'networkidle' });
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
        width,
      );
      const rail = await page.locator('.mc-rail').boundingBox();
      expect(Math.round(rail!.y + rail!.height)).toBe(800);
      for (const link of await page.locator('.mc-rail__link').all())
        await expect(link).toHaveAccessibleName(/\S/);
    }
  },
);

/**
 * The dock once it has stopped moving: a frame for the focus change to restyle it, then its step
 * aside or back (an ease-out under no-preference, instant under reduce) run to its end.
 */
async function dockSettled(page: Page) {
  await page.evaluate(async () => {
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    const rail = document.querySelector('.mc-rail');
    // A step reversed mid-way cancels one transition and starts another: wait out each.
    for (let round = 0; round < 5; round++) {
      const moving = rail?.getAnimations() ?? [];
      if (moving.length === 0) break;
      await Promise.allSettled(moving.map((motion) => motion.finished));
    }
  });
}

test(
  'a phone by keyboard: no focused control sits under the docked rail or the status line, and Shift+Tab brings the dock back (WCAG 2.4.11, the quality occlusion check)',
  { annotation },
  async ({ page }) => {
    for (const [width, height] of [
      [390, 844],
      [320, 640],
    ] as const) {
      await page.setViewportSize({ width, height });
      await page.goto('/', { waitUntil: 'networkidle' });
      const covered: string[] = [];
      let last = '';
      for (let press = 0; press < 400; press++) {
        await page.keyboard.press('Tab');
        await dockSettled(page);
        const stop = await page.evaluate(() => {
          const active = document.activeElement;
          if (!active || active === document.body || !active.closest('.mc-root')) return null;
          const box = active.getBoundingClientRect();
          const hit = document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2);
          const cover = hit && !active.contains(hit) ? hit.closest('.mc-rail, .mc-status') : null;
          const key = `${active.tagName}#${active.id}:${(active.textContent ?? '').trim().slice(0, 40)}:${Math.round(box.top + scrollY)}`;
          return { key, cover: cover && !cover.contains(active) ? cover.className : null };
        });
        if (!stop) {
          if (last) break;
          continue;
        }
        if (stop.key === last) break;
        last = stop.key;
        if (stop.cover) covered.push(`${stop.key} under ${stop.cover}`);
      }
      expect(covered, `${width}x${height}`).toEqual([]);
      // Back onto the dock from the page, it's in the window again.
      await page.locator('.mc-main a[href]').first().focus();
      await page.keyboard.press('Tab');
      for (let press = 0; press < 40; press++) {
        await page.keyboard.press('Shift+Tab');
        if (await page.evaluate(() => Boolean(document.activeElement?.closest('.mc-rail')))) break;
      }
      await dockSettled(page);
      const rail = (await page.locator('.mc-rail').boundingBox())!;
      expect(Math.round(rail.y + rail.height), `${width}: the dock is back`).toBe(height);
    }
  },
);

test(
  'on Letter or A4 paper the rail prints its words beside its icons, not clipped to a pixel (print)',
  { annotation },
  async ({ page }) => {
    await page.emulateMedia({ media: 'print' });
    // A page box's width in CSS px with Chrome's default margins: Letter about 739, A4 about 718.
    for (const width of [739, 718]) {
      await page.setViewportSize({ width, height: 1000 });
      await page.goto('/', { waitUntil: 'networkidle' });
      const labels = await page.evaluate(() =>
        [...document.querySelectorAll('.mc-rail__label')].map((label) => {
          const box = label.getBoundingClientRect();
          return {
            text: label.textContent ?? '',
            width: box.width,
            height: box.height,
            clip: getComputedStyle(label).clipPath,
          };
        }),
      );
      expect(labels.length, `the rail's words at ${width}`).toBeGreaterThan(1);
      for (const label of labels) {
        expect(label.clip, `${label.text} at ${width}`).toBe('none');
        expect(label.width, `${label.text} at ${width}`).toBeGreaterThan(1);
        expect(label.height, `${label.text} at ${width}`).toBeGreaterThan(1);
      }
    }
  },
);
