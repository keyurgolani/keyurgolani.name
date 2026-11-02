import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fixtureSiteSelecting } from '../../packages/variant-contract/src/contract-fixtures';
import { contractFixture } from '../../packages/variant-contract/src/node/fixtures';
import type { Locator } from '@playwright/test';
import { PNG } from 'pngjs';
import { expect, test } from '../harness/fixtures';

// Shell's status line and the index above it (variants-10 brief §5.6): the
// bar is exactly its height token, so the index's foot never sits under it.
// Docked (1280 px and up) the index ends where the bar begins; in the flow
// (below), the index's foot, scrolled to its last place, and the session's
// end both clear it.

const FIXTURE = contractFixture('complete');
const DIR = path.dirname(FIXTURE.files.portfolio);

/**
 * What the bar holds against its box: how far its contents overflow it, and each control that
 * leaves its content box (the ring band round it, then the safe area, stay free). A bar sized
 * by its token that holds taller contents overflows rather than grows, so only this sees it.
 */
const fit = (bar: Locator) =>
  bar.evaluate((el) => {
    const box = el.getBoundingClientRect();
    const s = getComputedStyle(el);
    const top = box.top + parseFloat(s.borderTopWidth) + parseFloat(s.paddingTop);
    const bottom = box.bottom - parseFloat(s.borderBottomWidth) - parseFloat(s.paddingBottom);
    const spills = [...el.querySelectorAll<HTMLElement>('a, button')]
      .map((control) => ({ control, r: control.getBoundingClientRect() }))
      .filter(({ r }) => r.height > 0)
      .filter(({ r }) => r.top < top - 0.1 || r.bottom > bottom + 0.1)
      .map(({ control, r }) => `${control.className}: ${r.top}-${r.bottom} in ${top}-${bottom}`);
    return { overflow: el.scrollHeight - el.clientHeight, spills };
  });

test.use({
  appOptions: {
    portfolio: FIXTURE.files.portfolio,
    siteText: fixtureSiteSelecting(readFileSync(FIXTURE.files.site, 'utf8'), 'shell'),
    sourceFiles: Object.fromEntries(
      FIXTURE.unitFiles.map((file) => [file, readFileSync(path.join(DIR, file), 'utf8')]),
    ),
  },
});

for (const viewport of [
  { width: 1440, height: 900 },
  { width: 1024, height: 768 },
  { width: 768, height: 1024 },
  { width: 390, height: 844 },
]) {
  test(
    `at ${viewport.width}, the status line's top is at or below the index's foot`,
    {
      annotation: [
        { type: 'route', description: '/' },
        { type: 'profile', description: 'read-only' },
      ],
      tag: '@interaction',
    },
    async ({ page }) => {
      await page.setViewportSize(viewport);
      await page.goto('/');
      await expect(page.locator('[data-sh-enhanced]')).toBeAttached();
      const bar = page.locator('[data-sh-tmux]');
      const pane = page.locator('.sh-pane');
      const docked = (await pane.evaluate((el) => getComputedStyle(el).position)) === 'sticky';
      expect(docked).toBe(viewport.width >= 1280);
      // The bar is exactly its token, whatever a glyph in it would make it.
      const sizes = await bar.evaluate((el) => {
        const probe = document.createElement('div');
        probe.style.blockSize = 'var(--layout-bar)';
        el.parentElement!.append(probe);
        const token = probe.getBoundingClientRect().height;
        probe.remove();
        return { bar: el.getBoundingClientRect().height, token };
      });
      expect(Math.abs(sizes.bar - sizes.token)).toBeLessThan(0.5);
      // And what it holds fits that box, its ring band free.
      expect(await fit(bar)).toEqual({ overflow: 0, spills: [] });
      // At the text's usual size the bar keeps the parts its window width gives it: the
      // counter and meter from 48rem up, the window list from 64rem up.
      const shown = (sel: string) =>
        bar.locator(sel).evaluate((el) => getComputedStyle(el).display !== 'none');
      expect(await shown('.sh-tmux__meter')).toBe(viewport.width >= 768);
      expect(await shown('.sh-tmux__wins')).toBe(viewport.width >= 1024);
      // With the script it's fixed to the window's foot (without, it closes the session).
      expect(await bar.evaluate((el) => getComputedStyle(el).position)).toBe('fixed');
      const top = (await bar.boundingBox())!.y;
      if (docked) {
        const box = (await pane.boundingBox())!;
        expect(box.y + box.height).toBeLessThanOrEqual(top + 0.5);
        const button = (await pane.locator('.sh-pane__q').boundingBox())!;
        expect(button.y + button.height).toBeLessThanOrEqual(top + 0.5);
      } else {
        // Below the docked width, with the script, the palette is the index: no in-flow copy.
        await expect(pane).toBeHidden();
      }
      // The session's end clears the bar at the bottom of the page.
      await page.evaluate(() => scrollTo(0, document.documentElement.scrollHeight));
      const end = (await page.locator('.sh-end').boundingBox())!;
      expect(end.y + end.height).toBeLessThanOrEqual((await bar.boundingBox())!.y + 0.5);
    },
  );
}

test(
  'under forced colours the status line stays opaque and holds its controls, and a focused current row shows the ring',
  {
    annotation: [
      { type: 'route', description: '/' },
      { type: 'profile', description: 'read-only' },
    ],
    tag: '@interaction',
  },
  async ({ page }) => {
    await page.emulateMedia({ forcedColors: 'active' });
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('/');
    await expect(page.locator('[data-sh-enhanced]')).toBeAttached();
    expect(await page.evaluate(() => matchMedia('(forced-colors: active)').matches)).toBe(true);
    const ground = await page
      .locator('[data-sh-tmux]')
      .evaluate((el) => getComputedStyle(el).backgroundColor);
    expect(ground).not.toBe('transparent');
    expect(ground).not.toMatch(/^rgba\(.*,\s*0\)$/);
    // And it's the page's own ground and ink (Canvas, CanvasText), not the accent fill's
    // (ButtonText under button-face ink), which is opaque too.
    const own = await page.locator('[data-sh-tmux]').evaluate((el) => {
      const probe = document.createElement('div');
      probe.style.background = 'var(--color-canvas)';
      probe.style.color = 'var(--color-text-primary)';
      el.closest('[data-variant]')!.append(probe);
      const want = getComputedStyle(probe);
      const pair = { background: want.backgroundColor, color: want.color };
      probe.remove();
      const s = getComputedStyle(el);
      return { want: pair, got: { background: s.backgroundColor, color: s.color } };
    });
    expect(own.got).toEqual(own.want);
    // Its rule doesn't take a pixel from the controls' box.
    expect(await fit(page.locator('[data-sh-tmux]'))).toEqual({ overflow: 0, spills: [] });
    // The current row's own edge gives way to the platform's ring when the keyboard is on it.
    // The row is pinned by its target, and the keyboard reaches it from its neighbour in the
    // index: a step out of the index (the current row is its first, after the transcript) would
    // land on the transcript's last link at the page's end, and the spy would move on.
    const pane = page.locator('.sh-pane');
    await expect(pane.locator('.sh-row[aria-current]')).toHaveCount(1);
    // The current row takes no fill, which the text's backplates would break into boxes: its
    // pointer marks it, in the selection colour.
    const row = await pane.locator('.sh-row[aria-current]').evaluate((el) => {
      const probe = document.createElement('div');
      probe.style.color = 'var(--color-selection)';
      el.closest('[data-variant]')!.append(probe);
      const selection = getComputedStyle(probe).color;
      probe.remove();
      return {
        background: getComputedStyle(el).backgroundColor,
        color: getComputedStyle(el.querySelector('.sh-row__ttl')!).color,
        selection,
        pointer: getComputedStyle(el.querySelector('.sh-row__p')!, '::before').content,
      };
    });
    // No fill: alpha 0, whatever colour the forced palette reports it in (Canvas's, at zero).
    expect(row.background).toMatch(/^(transparent|rgba\(\d+, \d+, \d+, 0\))$/);
    expect(row.color).toBe(row.selection);
    expect(row.pointer).not.toBe('none');
    const target = await pane.locator('.sh-row[aria-current]').getAttribute('data-sh-target');
    const current = pane.locator(`.sh-row[data-sh-target="${target}"]`);
    const at = await page.evaluate(() => scrollY);
    const back = await current.evaluate((el) => {
      const rows = [...el.closest('.sh-pane')!.querySelectorAll<HTMLElement>('.sh-row')];
      const i = rows.indexOf(el as HTMLElement);
      const from = rows[i + 1] ?? rows[i - 1]!;
      from.focus({ preventScroll: true });
      return rows[i + 1] !== undefined;
    });
    await page.keyboard.press(back ? 'Shift+Tab' : 'Tab');
    await expect(current).toBeFocused();
    // Nothing moved the page, so the row is still the current one.
    expect(await page.evaluate(() => scrollY)).toBe(at);
    await expect(current).toHaveAttribute('aria-current', 'location');
    const ring = await current.evaluate((el) => {
      const probe = document.createElement('div');
      probe.style.inlineSize = 'var(--ui-focus-width)';
      el.closest('[data-variant]')!.append(probe);
      const width = probe.getBoundingClientRect().width;
      probe.remove();
      const s = getComputedStyle(el);
      return { width, outline: parseFloat(s.outlineWidth), style: s.outlineStyle };
    });
    expect(ring.style).not.toBe('none');
    expect(ring.width).toBeGreaterThan(1);
    expect(Math.abs(ring.outline - ring.width)).toBeLessThan(0.5);
  },
);

test.describe('without a script', () => {
  test.use({ javaScriptEnabled: false });

  for (const viewport of [
    { width: 1440, height: 900 },
    { width: 390, height: 844 },
  ]) {
    test(
      `at ${viewport.width}, the status line closes the session in the flow, after its end, with nothing under it`,
      {
        annotation: [
          { type: 'route', description: '/' },
          { type: 'profile', description: 'read-only' },
        ],
        tag: '@interaction',
      },
      async ({ page }) => {
        await page.setViewportSize(viewport);
        await page.goto('/', { waitUntil: 'load' });
        // Read with scripting off, the session's noscript mark is an element: what the layout keys on.
        await expect(page.locator('.sh-session > noscript > [data-sh-nojs]')).toHaveCount(1);
        const bar = page.locator('[data-sh-tmux]');
        expect(await bar.evaluate((el) => getComputedStyle(el).position)).toBe('relative');
        await page.evaluate(() => scrollTo(0, document.documentElement.scrollHeight));
        const end = (await page.locator('.sh-end').boundingBox())!;
        const box = (await bar.boundingBox())!;
        expect(end.y + end.height).toBeLessThanOrEqual(box.y + 0.5);
        // The page ends at the bar's foot: no room kept under the session for a bar that isn't
        // there, and nothing after it.
        const after = await bar.evaluate(
          (el) =>
            document.documentElement.scrollHeight - (scrollY + el.getBoundingClientRect().bottom),
        );
        expect(Math.abs(after)).toBeLessThan(1);
      },
    );
  }

  test(
    "at 1440, the docked index takes the window's whole height, with no bar to stop short of",
    {
      annotation: [
        { type: 'route', description: '/' },
        { type: 'profile', description: 'read-only' },
      ],
      tag: '@interaction',
    },
    async ({ page }) => {
      await page.setViewportSize({ width: 1440, height: 900 });
      await page.goto('/', { waitUntil: 'load' });
      const height = await page
        .locator('.sh-pane')
        .evaluate((el) => el.getBoundingClientRect().height);
      expect(Math.abs(height - 900)).toBeLessThan(1);
    },
  );

  for (const viewport of [
    { width: 1024, height: 768 },
    { width: 390, height: 844 },
  ]) {
    test(
      `at ${viewport.width}, the in-flow index's foot clears the status line`,
      {
        annotation: [
          { type: 'route', description: '/' },
          { type: 'profile', description: 'read-only' },
        ],
        tag: '@interaction',
      },
      async ({ page }) => {
        await page.setViewportSize(viewport);
        await page.goto('/', { waitUntil: 'load' });
        const pane = page.locator('.sh-pane');
        await expect(pane).toBeVisible();
        const last = pane.locator('.sh-row').last();
        await last.evaluate((el) => el.scrollIntoView({ block: 'end' }));
        const top = (await page.locator('[data-sh-tmux]').boundingBox())!.y;
        const box = (await last.boundingBox())!;
        expect(box.y + box.height).toBeLessThanOrEqual(top + 0.5);
      },
    );
  }

  for (const viewport of [
    { width: 1440, height: 900 },
    { width: 390, height: 844 },
  ]) {
    for (const kind of ['.sh-fold__sum', '.sh-more__sum']) {
      test(
        `at ${viewport.width}, a Tab onto the last ${kind} under the status line brings it out above it, its ring clear (WCAG 2.4.11)`,
        {
          annotation: [
            { type: 'route', description: '/' },
            { type: 'profile', description: 'read-only' },
          ],
          tag: '@interaction',
        },
        async ({ page }) => {
          await page.setViewportSize(viewport);
          await page.goto('/', { waitUntil: 'load' });
          const bar = page.locator('[data-sh-tmux]');
          // Where a bar fixed to the window's foot would start: the summary is set just under
          // that line, the window's last row, whether the bar is there (fixed) or closes the
          // session further down (in the flow, without the script).
          const edge = await bar.evaluate((el) =>
            Math.min(
              el.getBoundingClientRect().top,
              innerHeight - el.getBoundingClientRect().height,
            ),
          );
          // The page's last such summary a visitor reaches: shown, and in no closed fold (a
          // row's fold inside a closed section fold keeps a box under content-visibility, but
          // takes no focus; combo r13).
          const found = await page.evaluate((kind) => {
            const shows = (el: HTMLElement) =>
              el.getClientRects().length > 0 &&
              el.checkVisibility() &&
              !el.parentElement?.parentElement?.closest('details:not([open])');
            const summaries = [...document.querySelectorAll<HTMLElement>(kind)].filter(shows);
            const target = summaries[summaries.length - 1];
            if (!target) return false;
            target.dataset.testUnder = '';
            return true;
          }, kind);
          expect(found).toBe(true);
          const under = page.locator('[data-test-under]');
          // The stop before it is the Tab order's own: the summary focused, then one step back.
          await under.evaluate((el) => (el as HTMLElement).focus({ preventScroll: true }));
          expect(
            await under.evaluate((el) => document.activeElement === el),
            'the summary takes focus',
          ).toBe(true);
          await page.keyboard.press('Shift+Tab');
          const before = await page.evaluate(() => {
            const at = document.activeElement as HTMLElement | null;
            if (!at || at === document.body || at.hasAttribute('data-test-under')) return null;
            at.dataset.testBefore = '';
            return `${at.tagName.toLowerCase()}.${at.className}`;
          });
          expect(before, 'a stop before the summary').not.toBeNull();
          test.info().annotations.push({ type: 'stop before', description: before! });
          // The summary set just under the bar's top edge, in the window, focus on the stop
          // before: the test starts from the case it guards.
          await under.evaluate((el, edge) => {
            scrollBy({ top: el.getBoundingClientRect().top - edge - 4, behavior: 'instant' });
          }, edge);
          expect(await under.evaluate((el) => el.getBoundingClientRect().top)).toBeGreaterThan(
            edge,
          );
          await expect(page.locator('[data-test-before]')).toBeFocused();
          await page.keyboard.press('Tab');
          const landed = await page.evaluate(() => {
            const at = document.activeElement;
            return at ? `${at.tagName.toLowerCase()}.${at.className}` : 'nothing';
          });
          await expect(under, `Tab from ${before} landed on ${landed}`).toBeFocused();
          const box = await under.evaluate((el) => {
            const r = el.getBoundingClientRect();
            const s = getComputedStyle(el);
            const ring = parseFloat(s.outlineWidth) + Math.max(0, parseFloat(s.outlineOffset));
            return { top: r.top, bottom: r.bottom, ring, style: s.outlineStyle };
          });
          expect(box.style).not.toBe('none');
          // Clear of the bar and in the window, its ring too.
          const top = await bar.evaluate((el) =>
            Math.min(el.getBoundingClientRect().top, innerHeight),
          );
          expect(box.bottom + box.ring).toBeLessThanOrEqual(top + 0.5);
          expect(box.top - box.ring).toBeGreaterThanOrEqual(-0.5);
        },
      );
    }
  }
});

test(
  'a focused primary button and a focused body link keep the page between their ring and themselves',
  {
    annotation: [
      { type: 'route', description: '/' },
      { type: 'profile', description: 'read-only' },
    ],
    tag: '@interaction',
  },
  async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('/');
    await expect(page.locator('[data-sh-enhanced]')).toBeAttached();
    for (const sel of [
      '.sh-btn--primary',
      'main .sh-out a[href]:not([data-ui-slot], .sh-btn, .sh-row)',
    ]) {
      const stop = page.locator(sel).first();
      await stop.evaluate((el) => {
        el.setAttribute('data-test-gap', '');
        (el as HTMLElement).scrollIntoView({ block: 'center' });
      });
      // Reached by the keyboard, so the ring shows.
      await page.evaluate(() => {
        // Every Tab stop that shows, a row's fold summary among them.
        const stops = [
          ...document.querySelectorAll<HTMLElement>('a[href], button:not([hidden]), summary'),
        ].filter((el) => el.getClientRects().length > 0);
        const at = stops.findIndex((el) => el.hasAttribute('data-test-gap'));
        stops[at - 1]!.focus({ preventScroll: true });
      });
      await page.keyboard.press('Tab');
      await expect(page.locator('[data-test-gap]')).toBeFocused();
      // The clear band between the ring and the stop: the ring's offset, plus a transparent
      // border, plus the padding of a box with no fill. The platform draws the ring at the
      // language's offset (0 for primer-inspired), in a layer no composition overrides, so
      // Shell builds the band inside the ring's edge.
      const measured = await page.locator('[data-test-gap]').evaluate((el) => {
        const s = getComputedStyle(el);
        const clear = (colour: string) => /rgba\(.*,\s*0\)$|transparent/.test(colour);
        return {
          style: s.outlineStyle,
          gap:
            (parseFloat(s.outlineOffset) || 0) +
            // A clear border is clear only when no fill paints under it: a filled box's
            // background must stop at its padding box (a `background` shorthand resets the clip).
            (clear(s.borderLeftColor) &&
            (clear(s.backgroundColor) || s.backgroundClip !== 'border-box')
              ? parseFloat(s.borderLeftWidth) || 0
              : 0) +
            (clear(s.backgroundColor) ? parseFloat(s.paddingLeft) || 0 : 0),
        };
      });
      expect(measured.style, sel).not.toBe('none');
      expect(measured.gap, sel).toBeGreaterThanOrEqual(1);
      await page.evaluate(() =>
        document.querySelector('[data-test-gap]')?.removeAttribute('data-test-gap'),
      );
    }
  },
);

test(
  "the primary's accent edge is its ::before, inside its clear outer pixel, and under forced colours it keeps the accent's role",
  {
    annotation: [
      { type: 'route', description: '/' },
      { type: 'profile', description: 'read-only' },
    ],
    tag: '@interaction',
  },
  async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    for (const forced of [false, true]) {
      await page.emulateMedia({ forcedColors: forced ? 'active' : 'none' });
      await page.goto('/');
      await expect(page.locator('[data-sh-enhanced]')).toBeAttached();
      const edge = await page
        .locator('.sh-btn--primary')
        .first()
        .evaluate((el) => {
          const probe = document.createElement('div');
          probe.style.borderTop = '1px solid var(--color-accent-text)';
          el.closest('[data-variant]')!.append(probe);
          probe.style.outlineOffset = 'var(--ui-focus-offset)';
          const want = getComputedStyle(probe).borderTopColor;
          const offset = parseFloat(getComputedStyle(probe).outlineOffset) || 0;
          probe.remove();
          const before = getComputedStyle(el, '::before');
          const own = getComputedStyle(el);
          return {
            want,
            content: before.content,
            position: before.position,
            width: before.borderTopWidth,
            colour: before.borderTopColor,
            // The pseudo-element sits on the padding box's corner, inset 0.
            inset: [before.top, before.left].map(parseFloat),
            ownWidth: parseFloat(own.borderTopWidth) || 0,
            ownColour: own.borderTopColor,
            offset,
          };
        });
      const where = forced ? 'forced' : 'normal';
      expect(edge.content, where).not.toBe('none');
      expect(edge.position, where).toBe('absolute');
      expect(edge.width, where).toBe('1px');
      expect(edge.colour, where).toBe(edge.want);
      expect(edge.inset, where).toEqual([0, 0]);
      // The page between the ring and the accent edge: the language's offset, or where that's
      // under a pixel, the button's own clear border, a pixel in all, never both stacked.
      expect(edge.ownWidth + edge.offset, where).toBeGreaterThanOrEqual(1);
      expect(Math.abs(edge.ownWidth - Math.max(0, 1 - edge.offset)), where).toBeLessThan(0.01);
      // Under forced colours the browser draws a border in the system colour, so there the ring
      // meets the button's own edge, in the visitor's palette: the accent edge stays inside.
      if (!forced && edge.ownWidth > 0)
        expect(edge.ownColour, where).toMatch(/^(transparent|rgba\(\d+, \d+, \d+, 0\))$/);
    }
  },
);

test(
  "a focused body link's ring clears its underline: at least a pixel of the page between them, on the block end",
  {
    annotation: [
      { type: 'route', description: '/' },
      { type: 'profile', description: 'read-only' },
    ],
    tag: '@interaction',
  },
  async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('/');
    await expect(page.locator('[data-sh-enhanced]')).toBeAttached();
    // A body link on one line, so its box foot is the ring's inner block-end edge.
    const one = await page.evaluate(() => {
      const links = [
        ...document.querySelectorAll<HTMLElement>(
          'main .sh-out a[href]:not([data-ui-slot], .sh-btn, .sh-row)',
        ),
      ].filter((el) => el.getClientRects().length === 1);
      const link = links[0];
      if (!link) return false;
      link.setAttribute('data-test-gap', '');
      link.scrollIntoView({ block: 'center' });
      return true;
    });
    expect(one).toBe(true);
    await page.evaluate(() => {
      // Every Tab stop that shows, a row's fold summary among them.
      const stops = [
        ...document.querySelectorAll<HTMLElement>('a[href], button:not([hidden]), summary'),
      ].filter((el) => el.getClientRects().length > 0);
      const at = stops.findIndex((el) => el.hasAttribute('data-test-gap'));
      stops[at - 1]!.focus({ preventScroll: true });
    });
    await page.keyboard.press('Tab');
    const link = page.locator('[data-test-gap]');
    await expect(link).toBeFocused();
    // The underline drawn solid in a colour nothing else on the page takes, so its rows read
    // from the pixels; the ring's inner block-end edge is the link's first line's box foot.
    const geo = await link.evaluate((el) => {
      const a = el as HTMLElement;
      a.style.textDecorationStyle = 'solid';
      a.style.textDecorationColor = 'rgb(255, 0, 255)';
      const line = a.getClientRects()[0]!;
      const s = getComputedStyle(a);
      return {
        x: line.left,
        y: line.top,
        width: line.width,
        height: line.height,
        inner: line.bottom + (parseFloat(s.outlineOffset) || 0),
        ring: parseFloat(s.outlineWidth),
        style: s.outlineStyle,
      };
    });
    expect(geo.style).not.toBe('none');
    const pad = Math.ceil(geo.ring) + 2;
    const clip = {
      x: Math.max(0, Math.floor(geo.x)),
      y: Math.max(0, Math.floor(geo.y)),
      width: Math.ceil(geo.width),
      height: Math.ceil(geo.height) + pad,
    };
    const png = PNG.sync.read(await page.screenshot({ clip }));
    const scale = png.width / clip.width;
    // The lowest device row holding the underline's colour, above the ring's inner edge.
    const magenta = (x: number, y: number) => {
      const i = (y * png.width + x) * 4;
      const [r, g, b] = [png.data[i]!, png.data[i + 1]!, png.data[i + 2]!];
      return r - g > 60 && b - g > 60 && Math.abs(r - b) < 70;
    };
    const inner = Math.round((geo.inner - clip.y) * scale);
    let lowest = -1;
    for (let y = 0; y < Math.min(inner, png.height); y++)
      for (let x = 0; x < png.width; x++) if (magenta(x, y)) lowest = y;
    // The underline shows above the ring (none would mean the ring covers it).
    expect(lowest, 'the underline is drawn above the ring').toBeGreaterThanOrEqual(0);
    // And at least one CSS pixel of rows between its foot and the ring's inner edge.
    expect((inner - 1 - lowest) / scale, 'clear rows under the underline').toBeGreaterThanOrEqual(
      1,
    );
  },
);

for (const viewport of [
  { width: 390, height: 844 },
  { width: 320, height: 640 },
]) {
  test(
    `at ${viewport.width} with 200% text, home scrolls no way but down, and the bar keeps jump whole`,
    {
      annotation: [
        { type: 'route', description: '/' },
        { type: 'profile', description: 'read-only' },
      ],
      tag: '@interaction',
    },
    async ({ page }) => {
      await page.setViewportSize(viewport);
      await page.goto('/');
      await expect(page.locator('[data-sh-enhanced]')).toBeAttached();
      // 200% text: the root size doubled, as the tokens are rem-based (WCAG 1.4.4).
      await page.evaluate(() => {
        document.documentElement.style.fontSize = '200%';
      });
      await page.evaluate(
        () => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done))),
      );
      const wide = await page.evaluate(() => {
        const root = document.documentElement;
        // What runs past the window and isn't clipped by a box it's in: the cause, by name.
        const clipped = (el: Element) => {
          for (let up = el.parentElement; up; up = up.parentElement) {
            const o = getComputedStyle(up);
            if (o.overflowX !== 'visible' || o.position === 'fixed') return true;
          }
          return false;
        };
        const over = [...document.querySelectorAll<HTMLElement>('[data-variant] *')]
          .map((el) => ({ el, r: el.getBoundingClientRect() }))
          .filter(({ el, r }) => r.width > 0 && r.right > root.clientWidth + 0.5 && !clipped(el))
          .sort((a, b) => b.r.right - a.r.right)
          .slice(0, 3)
          .map(
            ({ el, r }) => `${el.tagName.toLowerCase()}.${el.className}: ${Math.round(r.right)}`,
          );
        // The widest one's boxes up to the transcript, each with its width and its sizing.
        const top = [...document.querySelectorAll<HTMLElement>('[data-variant] *')]
          .filter((el) => el.getBoundingClientRect().right > root.clientWidth + 0.5 && !clipped(el))
          .sort((a, b) => b.getBoundingClientRect().right - a.getBoundingClientRect().right)[0];
        const chain: string[] = [];
        for (
          let at: HTMLElement | null = top ?? null;
          at && chain.length < 12;
          at = at.parentElement
        ) {
          const st = getComputedStyle(at);
          chain.push(
            `${at.tagName.toLowerCase()}.${at.className}[${Math.round(at.getBoundingClientRect().width)} ${st.display} min:${st.minWidth} cols:${st.gridTemplateColumns}]`,
          );
          if (at.classList.contains('sh-main')) break;
        }
        over.push(`chain: ${chain.join(' < ')}`);
        // Text past its own box (a box in bounds holding a line that isn't), anywhere in the
        // page, the host's parts included, and any box outside the composition.
        const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
        const lines: string[] = [];
        for (let node = walker.nextNode(); node && lines.length < 3; node = walker.nextNode()) {
          const parent = node.parentElement;
          if (!parent || !node.textContent?.trim() || clipped(node as unknown as Element)) continue;
          const range = document.createRange();
          range.selectNodeContents(node);
          const right = Math.max(0, ...[...range.getClientRects()].map((r) => r.right));
          if (right > root.clientWidth + 0.5) {
            const inside = parent.closest('[data-variant]') ? 'in' : 'OUTSIDE';
            lines.push(
              `text ${inside} [data-variant] in ${parent.tagName.toLowerCase()}.${parent.className}: ${Math.round(right)} "${node.textContent.trim().slice(0, 30)}"`,
            );
          }
        }
        const outside = [...document.body.querySelectorAll<HTMLElement>('*')]
          .filter((el) => !el.closest('[data-variant]') && !clipped(el))
          .filter((el) => el.getBoundingClientRect().right > root.clientWidth + 0.5)
          .slice(0, 3)
          .map(
            (el) =>
              `OUTSIDE [data-variant] ${el.tagName.toLowerCase()}.${el.className}: ${Math.round(el.getBoundingClientRect().right)}`,
          );
        over.push(...lines, ...outside);
        return { scroll: root.scrollWidth - root.clientWidth, over };
      });
      expect(wide.scroll, wide.over.join('; ')).toBeLessThanOrEqual(0);
      const jump = (await page.locator('[data-sh-tmux] .sh-tmux__jump:visible').boundingBox())!;
      expect(jump.x + jump.width).toBeLessThanOrEqual(viewport.width + 0.5);
      expect(jump.x).toBeGreaterThanOrEqual(0);
    },
  );
}

test(
  "under forced colours a focused bar control draws its ring in the text's ink, off its edge",
  {
    annotation: [
      { type: 'route', description: '/' },
      { type: 'profile', description: 'read-only' },
    ],
    tag: '@interaction',
  },
  async ({ page }) => {
    await page.emulateMedia({ forcedColors: 'active' });
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('/');
    await expect(page.locator('[data-sh-enhanced]')).toBeAttached();
    for (const sel of ['.sh-tmux__sess', 'button.sh-tmux__jump']) {
      const control = page.locator(`[data-sh-tmux] ${sel}`).first();
      // Reached by the keyboard, so :focus-visible holds: focused, one step back, then on.
      await control.focus();
      await page.keyboard.press('Shift+Tab');
      await page.keyboard.press('Tab');
      await expect(control).toBeFocused();
      const ring = await control.evaluate((el) => {
        const probe = document.createElement('div');
        probe.style.borderTop = 'var(--ui-focus-width) solid var(--color-text-primary)';
        el.closest('[data-variant]')!.append(probe);
        probe.style.outlineOffset = 'var(--ui-focus-offset)';
        const want = getComputedStyle(probe);
        const pair = { width: want.borderTopWidth, colour: want.borderTopColor };
        const off = parseFloat(want.borderTopWidth) + (parseFloat(want.outlineOffset) || 0);
        probe.remove();
        const before = getComputedStyle(el, '::before');
        return {
          want: pair,
          got: { width: before.borderTopWidth, colour: before.borderTopColor },
          content: before.content,
          // Off the control's border box by the ring's width and offset: its inset, measured
          // from the padding box, takes the control's own border too.
          inset: parseFloat(before.top),
          expected: -(off + (parseFloat(getComputedStyle(el).borderTopWidth) || 0)),
        };
      });
      expect(ring.content, sel).not.toBe('none');
      expect(ring.got, sel).toEqual(ring.want);
      expect(Math.abs(ring.inset - ring.expected), sel).toBeLessThan(0.01);
    }
  },
);

test(
  "with the script, the status line is fixed to the window's foot from the first paint, before the enhancement mounts",
  {
    annotation: [
      { type: 'route', description: '/' },
      { type: 'profile', description: 'read-only' },
    ],
    tag: '@interaction',
  },
  async ({ page }) => {
    // The enhancement's chunk never arrives: scripting is on, and the palette never mounts.
    await page.route(/\/_next\/static\/chunks\//, (route) => route.abort());
    for (const viewport of [
      { width: 1440, height: 900 },
      { width: 390, height: 844 },
    ]) {
      await page.setViewportSize(viewport);
      await page.goto('/', { waitUntil: 'load' });
      await expect(page.locator('[data-sh-enhanced]')).toHaveCount(0);
      // Read with scripting on, the noscript mark is text, never an element, so the no-script
      // layout can't take hold, enhancement or none.
      await expect(page.locator('[data-sh-nojs]')).toHaveCount(0);
      await expect(page.locator('.sh-session:has(> * > [data-sh-nojs])')).toHaveCount(0);
      const bar = page.locator('[data-sh-tmux]');
      expect(await bar.evaluate((el) => getComputedStyle(el).position)).toBe('fixed');
      const box = (await bar.boundingBox())!;
      expect(Math.abs(box.y + box.height - viewport.height)).toBeLessThan(1);
    }
  },
);

test(
  "with the script, jump prints: the index link takes the button's place on paper",
  {
    annotation: [
      { type: 'route', description: '/' },
      { type: 'profile', description: 'read-only' },
    ],
    tag: '@interaction',
  },
  async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('/');
    await expect(page.locator('[data-sh-enhanced]')).toBeAttached();
    await page.emulateMedia({ media: 'print' });
    const link = page.locator('[data-sh-tmux] a.sh-tmux__jump');
    await expect(link).toBeVisible();
    await expect(page.locator('[data-sh-tmux] button.sh-tmux__jump')).toBeHidden();
  },
);
