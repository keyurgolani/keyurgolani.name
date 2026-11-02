import { readFileSync } from 'node:fs';
import path from 'node:path';
import type { Page } from '@playwright/test';
import { fixtureSiteSelecting } from '../../packages/variant-contract/src/contract-fixtures';
import { contractFixture } from '../../packages/variant-contract/src/node/fixtures';
import { expect, test } from '../harness/fixtures';

// Mission Control's correlate in a browser (variants-10 brief §5.8, MC-M4,
// MC-M5; the lead's C1 ruling): resting a fine pointer on a record that
// names others for 220 ms lights every record it names, wherever it is on
// the page, and dims the rest; focus alone, on the record's links or on its
// Linked control, lights nothing, and neither does a touch; the Linked
// control pins, and its popover stays inside the window at a desk's width
// and a phone's; under reduced motion the dim is an instant change; and
// nothing runs a frame loop while it lights. On the complete fixture, under
// read-only.

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

/** The page at a width, with the correlate island mounted and the pointer on the status line. */
async function open(page: Page, width = 1440, height = 900) {
  await page.setViewportSize({ width, height });
  await page.goto('/', { waitUntil: 'networkidle' });
  await expect(page.locator('[data-variant="mission-control"]')).toHaveCount(1);
  await expect(page.locator('[data-mc-enhanced]')).toHaveCount(1);
  await page.mouse.move(width - 2, 2);
}

/** What the wall's marks say now: the source, the lit keys, the unlit ones, and how much dims. */
const marks = (page: Page) =>
  page.evaluate(() => {
    const root = document.querySelector('.mc-root')!;
    const records = [...root.querySelectorAll<HTMLElement>('[data-mc-rec]')];
    const keys = (list: HTMLElement[]) => [...new Set(list.map((r) => r.dataset.mcRec!))].sort();
    return {
      trace: root.getAttribute('data-mc-trace'),
      lit: keys(records.filter((r) => r.hasAttribute('data-mc-lit'))),
      unlit: keys(records.filter((r) => !r.hasAttribute('data-mc-lit'))),
      dim: root.querySelectorAll('[data-mc-dim]').length,
    };
  });

/** The names a record carries. */
const namesOf = async (page: Page, key: string) =>
  (await page
    .locator(`[data-mc-rec="${key}"][data-mc-names]`)
    .first()
    .getAttribute('data-mc-names'))!.split(' ');

test(
  'hovering a record lights every record it names, after the intent wait, and dims the rest in the muted role (MC-M4, C1)',
  { annotation },
  async ({ page }) => {
    await open(page);
    const source = page.locator('[data-mc-names]').first();
    await expect(source).toHaveCount(1);
    const key = (await source.getAttribute('data-mc-rec'))!;
    const names = await namesOf(page, key);
    expect(names.length).toBeGreaterThan(0);
    // Every record it names is on the page.
    for (const id of names)
      expect(await page.locator(`[data-mc-rec="${id}"]`).count()).toBeGreaterThan(0);

    await source.scrollIntoViewIfNeeded();
    // When the pointer reaches the record, and when the wall lights, by the page's own clock.
    await page.evaluate((id) => {
      const root = document.querySelector<HTMLElement>('.mc-root')!;
      const times: { over?: number; lit?: number } = {};
      (window as unknown as { times: typeof times }).times = times;
      root.addEventListener(
        'pointerover',
        (event) => {
          const at = (event.target as Element).closest<HTMLElement>('[data-mc-names]');
          if (at?.dataset.mcRec === id && times.over === undefined) times.over = performance.now();
        },
        { capture: true },
      );
      new MutationObserver(() => {
        if (root.hasAttribute('data-mc-trace') && times.lit === undefined)
          times.lit = performance.now();
      }).observe(root, { attributes: true, attributeFilter: ['data-mc-trace'] });
    }, key);
    await source.hover({ position: { x: 4, y: 4 } });
    await expect.poll(async () => (await marks(page)).trace).toBe(key);

    // Nothing lit within the intent wait: hover intent, not a pass over the wall.
    const times = await page.evaluate(
      () => (window as unknown as { times: { over?: number; lit?: number } }).times,
    );
    expect(times.lit! - times.over!).toBeGreaterThanOrEqual(200);

    const lit = await marks(page);
    expect(lit.lit).toEqual([...new Set([key, ...names])].sort());
    expect(lit.unlit.some((id) => names.includes(id) || id === key)).toBe(false);
    expect(lit.dim).toBeGreaterThan(0);

    // A dimmed record's text takes the muted role, never an opacity.
    const dimmed = await page.evaluate(() => {
      const element = document.querySelector<HTMLElement>('[data-mc-rec][data-mc-dim]')!;
      const probe = document.createElement('span');
      probe.style.color = 'var(--color-text-muted)';
      element.append(probe);
      const muted = getComputedStyle(probe).color;
      probe.remove();
      const style = getComputedStyle(element);
      return { color: style.color, muted, opacity: style.opacity };
    });
    expect(dimmed.color).toBe(dimmed.muted);
    expect(dimmed.opacity).toBe('1');

    // Leaving the record, the wall returns.
    await page.mouse.move(1438, 2);
    await expect.poll(async () => (await marks(page)).trace).toBeNull();
    expect((await marks(page)).dim).toBe(0);
  },
);

test(
  'no Linked control draws over a fold’s summary, at a desk’s width or a phone’s (the design delta’s N2)',
  { annotation },
  async ({ page }) => {
    for (const [width, height] of [
      [1440, 900],
      [390, 844],
    ] as const) {
      await open(page, width, height);
      const overlaps = await page.evaluate(() => {
        const hit = (a: DOMRect, b: DOMRect) =>
          !(a.right <= b.left || b.right <= a.left || a.bottom <= b.top || b.bottom <= a.top);
        const out: string[] = [];
        for (const button of document.querySelectorAll<HTMLElement>('[data-mc-pin]')) {
          const a = button.getBoundingClientRect();
          if (!a.width || !button.checkVisibility()) continue;
          for (const summary of document.querySelectorAll('.mc-fold > summary')) {
            const b = summary.getBoundingClientRect();
            if (b.width && hit(a, b) && !summary.contains(button)) out.push(button.dataset.mcPin!);
          }
        }
        return out;
      });
      expect(overlaps, `${width}`).toEqual([]);
    }
  },
);

test(
  'a record a fragment, a focus move or a pointer brings into view lands below the status line, the visitor control in it (MC-M4, X3)',
  { annotation },
  async ({ page }) => {
    for (const [width, height] of [
      [1440, 900],
      [1024, 768],
    ] as const) {
      await open(page, width, height);
      const status = page.locator('.mc-status');
      await expect(status.locator('[data-ui-slot="appearance-control"]')).toHaveCount(1);
      expect(await status.evaluate((element) => getComputedStyle(element).position)).toBe('sticky');
      // The bar is one line, and the offset everything scrolls to is its height.
      const bar = await status.evaluate((element) => {
        const record = document.querySelector<HTMLElement>('[data-mc-rec]')!;
        return {
          height: element.getBoundingClientRect().height,
          margin: parseFloat(getComputedStyle(record).scrollMarginTop),
        };
      });
      expect(bar.margin).toBeGreaterThanOrEqual(bar.height - 0.5);
      // Every record on the open wall, brought to the top as a fragment would, shows its first corner.
      const under = await page.evaluate(async () => {
        const hidden: string[] = [];
        const records = [
          ...document.querySelectorAll<HTMLElement>('.mc-root [data-mc-rec]'),
        ].filter((record) => record.checkVisibility() && !record.closest('[popover]'));
        for (const record of records) {
          record.scrollIntoView({ block: 'start' });
          await new Promise((resolve) =>
            requestAnimationFrame(() => requestAnimationFrame(resolve)),
          );
          const box = record.getBoundingClientRect();
          const end =
            window.scrollY + window.innerHeight >= document.documentElement.scrollHeight - 1;
          if (end) continue;
          const hit = document.elementFromPoint(box.left + 4, box.top + 4);
          if (hit?.closest('.mc-status')) hidden.push(record.dataset.mcRec!);
        }
        return { checked: records.length, hidden };
      });
      expect(under.checked).toBeGreaterThan(4);
      expect(under.hidden).toEqual([]);
      // A fragment link to a record.
      const id = (await page.locator('[data-mc-names]').first().getAttribute('id'))!;
      await page.evaluate((target) => {
        window.location.hash = target;
      }, id);
      await expect
        .poll(() =>
          page.evaluate(
            (target) => document.getElementById(target)!.getBoundingClientRect().top,
            id,
          ),
        )
        .toBeGreaterThanOrEqual(bar.height - 0.5);
    }
  },
);

test(
  'focus alone lights nothing: a naming record’s links and its Linked control take focus, and the wall stays as it is (MC-M4)',
  { annotation },
  async ({ page }) => {
    await open(page);
    const source = page.locator('[data-mc-names]').first();
    // Its stops on the wall: a closed popover's links aren't stops until it opens, and opening it pins.
    const stops = source.locator('a[href], button').filter({ visible: true });
    expect(await stops.count()).toBeGreaterThan(0);
    for (const stop of await stops.all()) {
      await stop.focus();
      await expect(stop).toBeFocused();
      await page.waitForTimeout(400);
      expect(await marks(page)).toMatchObject({ trace: null, lit: [], dim: 0 });
    }
    // Tabbing through the wall lights nothing either.
    await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
    for (let i = 0; i < 40; i++) {
      await page.keyboard.press('Tab');
      expect((await marks(page)).trace).toBeNull();
    }
  },
);

test(
  'the Linked control pins: its popover lists the named records inside the window, they stay lit while it’s open, and Escape lets go (MC-M4, MC-M5)',
  { annotation },
  async ({ page }) => {
    for (const [width, height] of [
      [1440, 900],
      [390, 844],
    ] as const) {
      await open(page, width, height);
      // The last one on the open wall: the full record's are behind its closed panels.
      const button = page.locator('[data-mc-pin]').filter({ visible: true }).last();
      const key = (await button.getAttribute('data-mc-pin'))!;
      const names = await namesOf(page, key);
      await button.scrollIntoViewIfNeeded();
      await button.click();
      const pop = page.locator(`[data-mc-pop="${key}"]`);
      await expect(pop).toBeVisible();
      await expect(pop.locator('li')).toHaveCount(names.length);
      const box = (await pop.boundingBox())!;
      expect(box.x).toBeGreaterThanOrEqual(0);
      expect(box.y).toBeGreaterThanOrEqual(0);
      expect(box.x + box.width).toBeLessThanOrEqual(width);
      expect(box.y + box.height).toBeLessThanOrEqual(height);
      await expect.poll(async () => (await marks(page)).trace).toBe(key);
      expect((await marks(page)).lit).toEqual([...new Set([key, ...names])].sort());
      // The pointer moving elsewhere doesn't undo a pin.
      await page.mouse.move(width - 2, 2);
      await page.waitForTimeout(300);
      expect((await marks(page)).trace).toBe(key);
      await page.keyboard.press('Escape');
      await expect(pop).toBeHidden();
      await expect.poll(async () => (await marks(page)).trace).toBeNull();
    }
  },
);

test(
  'under reduced motion the dim is an instant change, and lighting runs no frame loop (MC-M4, R3)',
  { annotation },
  async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await open(page);
    await page.evaluate(() => {
      const counter = window as unknown as { frames: number };
      counter.frames = 0;
      const real = window.requestAnimationFrame;
      window.requestAnimationFrame = (callback) => {
        counter.frames += 1;
        return real(callback);
      };
    });
    const source = page.locator('[data-mc-names]').first();
    await source.scrollIntoViewIfNeeded();
    await source.hover({ position: { x: 4, y: 4 } });
    await expect.poll(async () => (await marks(page)).trace).not.toBeNull();
    const timing = await page.evaluate(() => {
      const element = document.querySelector<HTMLElement>('[data-mc-dim]')!;
      return {
        duration: getComputedStyle(element).transitionDuration,
        running: document.getAnimations().length,
        frames: (window as unknown as { frames: number }).frames,
      };
    });
    expect(timing.duration.split(',').every((each) => parseFloat(each) === 0)).toBe(true);
    expect(timing.running).toBe(0);
    expect(timing.frames).toBe(0);
  },
);

test(
  'a touch lights nothing: only a fine hovering mouse or pen carries intent (MC-M4)',
  { annotation },
  async ({ page }) => {
    await open(page);
    const trace = await page.evaluate(async () => {
      const source = document.querySelector<HTMLElement>('[data-mc-names]')!;
      source.dispatchEvent(
        new PointerEvent('pointerover', { pointerType: 'touch', bubbles: true }),
      );
      await new Promise((resolve) => setTimeout(resolve, 400));
      return document.querySelector('.mc-root')!.getAttribute('data-mc-trace');
    });
    expect(trace).toBeNull();
  },
);

test(
  'by keyboard the Linked list is a dialog: opening moves focus to its first link, and Escape or Tab off either end closes it with focus back on its control (MC-M5, the quality containment and focus-return checks)',
  { annotation },
  async ({ page }) => {
    await open(page);
    const button = page.locator('[data-mc-pin]').filter({ visible: true }).first();
    const key = (await button.getAttribute('data-mc-pin'))!;
    const pop = page.locator(`[data-mc-pop="${key}"]`);
    await button.focus();
    await page.keyboard.press('Enter');
    await expect(pop).toBeVisible();
    await expect(pop.locator('a').first()).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(pop).toBeHidden();
    await expect(button).toBeFocused();
    await expect.poll(async () => (await marks(page)).trace).toBeNull();
    // Again, then Shift+Tab off its first link: it closes, with focus on its control.
    await page.keyboard.press('Enter');
    await expect(pop.locator('a').first()).toBeFocused();
    await page.keyboard.press('Shift+Tab');
    await expect(pop).toBeHidden();
    await expect(button).toBeFocused();
    // Every shown Linked control, as the quality harness closes it: Enter, then Tab once more
    // than its links (and once more again) while it's open, then Escape if it still is. Focus is
    // never on the page behind it while it's open, and ends on the control.
    const buttons = page.locator('[data-mc-pin]').filter({ visible: true });
    for (let each = 0; each < (await buttons.count()); each++) {
      const control = buttons.nth(each);
      const list = page.locator(`[data-mc-pop="${(await control.getAttribute('data-mc-pin'))!}"]`);
      await page.keyboard.press('Shift+Tab');
      await control.focus();
      await page.keyboard.press('Enter');
      await expect(list).toBeVisible();
      const links = await list.locator('a').count();
      for (let press = 0; press < links + 2; press++) {
        await page.keyboard.press('Tab');
        if (!(await list.isVisible())) break;
        expect(
          await page.evaluate(() => Boolean(document.activeElement?.closest('[data-mc-pop]'))),
        ).toBe(true);
      }
      if (await list.isVisible()) await page.keyboard.press('Escape');
      await expect(list).toBeHidden();
      await expect(control).toBeFocused();
    }
  },
);

test(
  'a link in the Linked list carries the pin to where it lands: the lights stay, Tab goes on from the record it named, and Escape lets go (MC-M4)',
  { annotation },
  async ({ page }) => {
    await open(page);
    const button = page.locator('[data-mc-pin]').filter({ visible: true }).first();
    const key = (await button.getAttribute('data-mc-pin'))!;
    await button.focus();
    await page.keyboard.press('Enter');
    const pop = page.locator(`[data-mc-pop="${key}"]`);
    const link = pop.locator('a[href^="#"]').first();
    const target = (await link.getAttribute('href'))!.slice(1);
    await link.focus();
    await page.keyboard.press('Enter');
    await expect(pop).toBeHidden();
    await expect.poll(() => page.evaluate(() => window.location.hash)).toBe(`#${target}`);
    // The pin carried: the lights stay with the list closed.
    expect((await marks(page)).trace).toBe(key);
    await page.waitForTimeout(300);
    expect((await marks(page)).trace).toBe(key);
    // Keyboard follows the jump: the next stop is in or after the record it named.
    await page.keyboard.press('Tab');
    const after = await page.evaluate((id) => {
      const named = document.getElementById(id)!;
      const active = document.activeElement!;
      return (
        named.contains(active) ||
        Boolean(named.compareDocumentPosition(active) & Node.DOCUMENT_POSITION_FOLLOWING)
      );
    }, target);
    expect(after, 'Tab goes on from the named record').toBe(true);
    await page.keyboard.press('Escape');
    await expect.poll(async () => (await marks(page)).trace).toBeNull();
  },
);

test('a press anywhere ends a carried pin (MC-M4)', { annotation }, async ({ page }) => {
  await open(page);
  const button = page.locator('[data-mc-pin]').filter({ visible: true }).first();
  const key = (await button.getAttribute('data-mc-pin'))!;
  await button.click();
  const link = page.locator(`[data-mc-pop="${key}"] a[href^="#"]`).first();
  await link.click();
  await expect.poll(async () => (await marks(page)).trace).toBe(key);
  await page.mouse.click(1438, 4);
  await expect.poll(async () => (await marks(page)).trace).toBeNull();
});

test(
  'a press elsewhere closes the Linked list and leaves focus and the scroll where the press put them, never back on a control far off (MC-M5)',
  { annotation },
  async ({ page }) => {
    await open(page);
    const button = page.locator('[data-mc-pin]').filter({ visible: true }).first();
    const key = (await button.getAttribute('data-mc-pin'))!;
    const pop = page.locator(`[data-mc-pop="${key}"]`);
    await button.scrollIntoViewIfNeeded();
    await button.click();
    await expect(pop).toBeVisible();
    // A pointer opens it as a dialog too: focus is on its first link.
    await expect(pop.locator('a').first()).toBeFocused();
    // The visitor reads on: the page scrolls well past the control, the list still open.
    const from = await page.evaluate(() => scrollY);
    await page.mouse.wheel(0, 2400);
    await expect.poll(() => page.evaluate(() => scrollY)).toBeGreaterThan(from + 1200);
    await page.waitForTimeout(200);
    // Still open (an anchored list may be out of sight with its control).
    expect(await pop.evaluate((list) => list.matches(':popover-open'))).toBe(true);
    // Then presses a plain stretch of text in the window.
    const spot = await page.evaluate((id) => {
      const list = document.querySelector(`[data-mc-pop="${id}"]`)!;
      for (const text of document.querySelectorAll('.mc-main :is(p, h2, h3, dd, li)')) {
        const box = text.getBoundingClientRect();
        // Its part in the window, clear of the status line and the foot: a tall paragraph
        // counts by what shows of it.
        const top = Math.max(box.top, 80);
        const bottom = Math.min(box.bottom, innerHeight - 80);
        if (bottom - top < 12 || box.width < 40) continue;
        const [x, y] = [box.left + 8, (top + bottom) / 2];
        const hit = document.elementFromPoint(x, y);
        if (!hit || list.contains(hit)) continue;
        // Not on a control or a stop of the tab order. Main itself takes focus by script only
        // (tabindex -1, the skip link's target), so a press inside it is still plain text.
        if (
          hit.closest(
            'a, button, summary, input, select, textarea, [tabindex]:not([tabindex="-1"]), [popover]',
          )
        )
          continue;
        return { x, y, scrollY };
      }
      return null;
    }, key);
    expect(spot, 'a plain stretch of text in the window').not.toBeNull();
    await page.mouse.click(spot!.x, spot!.y);
    await expect.poll(() => pop.evaluate((list) => list.matches(':popover-open'))).toBe(false);
    await page.waitForTimeout(100);
    expect(await page.evaluate(() => scrollY)).toBe(spot!.scrollY);
    await expect(button).not.toBeFocused();
    await expect.poll(async () => (await marks(page)).trace).toBeNull();
    // A press on main's text moves focus to main. A press outside it, on the sticky status
    // line's own ground, leaves focus on the page itself: the close must leave it there too, not
    // pull it, and the scroll, back to the control far above.
    await button.scrollIntoViewIfNeeded();
    await button.click();
    await expect(pop).toBeVisible();
    const before = await page.evaluate(() => scrollY);
    await page.mouse.wheel(0, 2400);
    await expect.poll(() => page.evaluate(() => scrollY)).toBeGreaterThan(before + 1200);
    await page.waitForTimeout(200);
    expect(await pop.evaluate((list) => list.matches(':popover-open'))).toBe(true);
    const ground = await page.evaluate(() => {
      const status = document.querySelector('.mc-status')!.getBoundingClientRect();
      const y = status.top + status.height / 2;
      // From the line's end inward, the first point on the line itself or on plain text in it.
      for (let x = status.right - 4; x > status.left; x -= 8) {
        const hit = document.elementFromPoint(x, y);
        if (!hit?.closest('.mc-status')) continue;
        if (hit.closest('a, button, summary, input, select, textarea, [tabindex], [popover]'))
          continue;
        return { x, y, scrollY };
      }
      return null;
    });
    expect(ground, 'a plain spot on the status line').not.toBeNull();
    await page.mouse.click(ground!.x, ground!.y);
    await expect.poll(() => pop.evaluate((list) => list.matches(':popover-open'))).toBe(false);
    await page.waitForTimeout(100);
    expect(await page.evaluate(() => scrollY), 'pressed on the status line').toBe(ground!.scrollY);
    await expect(button).not.toBeFocused();
    await expect.poll(async () => (await marks(page)).trace).toBeNull();
  },
);
