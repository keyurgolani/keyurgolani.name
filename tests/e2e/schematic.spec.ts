import { readFileSync } from 'node:fs';
import path from 'node:path';
import type { Locator, Page } from '@playwright/test';
import { fixtureSiteSelecting } from '../../packages/variant-contract/src/contract-fixtures';
import { contractFixture } from '../../packages/variant-contract/src/node/fixtures';
import { expect, test } from '../harness/fixtures';
import { decodePng, deltaEOk, pixel } from '../quality/lib/pixels';

// Schematic's checks in a browser (variants-10 brief §5.4, step 11): the
// title block holds the cover sheet's bottom-right corner (SC-M1) and the
// sheet border carries zone references on all four edges; the drawing index
// opens as a dialog from Index, and a link in it closes it and lands; with
// no script the Index link lands on the footer's index; nothing loops at
// idle; the draw-on never holds the text (M1, SC-S8); and a phone has no
// sideways scroll, with the two-item bar naming the sheet. On the complete
// fixture, under read-only.

const annotation = [
  { type: 'route', description: '/' },
  { type: 'profile', description: 'read-only' },
];

/** A contract fixture served with schematic selected. */
function appFor(name: string) {
  const fixture = contractFixture(name);
  const dir = path.dirname(fixture.files.portfolio);
  return {
    portfolio: fixture.files.portfolio,
    siteText: fixtureSiteSelecting(readFileSync(fixture.files.site, 'utf8'), 'schematic'),
    sourceFiles: Object.fromEntries(
      fixture.unitFiles.map((file) => [file, readFileSync(path.join(dir, file), 'utf8')]),
    ),
  };
}

const APP = appFor('complete');

test.use({ viewport: { width: 1440, height: 900 }, appOptions: APP });

// A sheet in the middle of the set, by its link in the footer's index.
async function middleSheet(page: Page) {
  const links = page.locator('.sx-foot__index .sx-index__head a');
  const count = await links.count();
  expect(count).toBeGreaterThan(2);
  return (await links.nth(Math.floor(count / 2)).getAttribute('href'))!;
}

// Whether the focused element (or a fragment's target) overlaps a piece of
// sticky chrome that is on screen. Elements inside the chrome, and boxes
// taller than a third of the viewport, aren't judged.
/** The phone folds above an element (not around it, not inside it), and how many of them are closed. */
async function foldsAbove(target: Locator) {
  return target.evaluate((el) => {
    const line = el.getBoundingClientRect().top;
    const above = [
      ...document.querySelectorAll<HTMLDetailsElement>('details[data-sx-fold]'),
    ].filter(
      (fold) => !fold.contains(el) && !el.contains(fold) && fold.getBoundingClientRect().top < line,
    );
    return { above: above.length, closed: above.filter((fold) => !fold.open).length };
  });
}

async function clearance(page: Page, chrome: string, target?: string) {
  // Three frames, so the enhancement's clearance (two frames after focus) has run.
  await page.evaluate(
    () =>
      new Promise((done) =>
        requestAnimationFrame(() => requestAnimationFrame(() => requestAnimationFrame(done))),
      ),
  );
  return page.evaluate(
    ({ chrome, target }) => {
      const el = target ? document.getElementById(target) : document.activeElement;
      const bars = [...document.querySelectorAll(chrome)]
        .map((bar) => ({ bar, r: bar.getBoundingClientRect() }))
        .filter(({ r }) => r.height > 0 && r.top < innerHeight && r.bottom > 0);
      const none = {
        judged: false,
        overlap: false,
        top: 0,
        barTop: innerHeight,
        barBottom: 0,
        what: '',
      };
      if (!el || el === document.body) return none;
      const a = el.getBoundingClientRect();
      const judged =
        bars.length > 0 && !bars.some(({ bar }) => bar.contains(el)) && a.height <= innerHeight / 3;
      const over = bars.find(
        ({ r }) =>
          a.right > r.left + 1 &&
          a.left < r.right - 1 &&
          a.bottom > r.top + 1 &&
          a.top < r.bottom - 1,
      );
      return {
        judged,
        overlap: judged && over !== undefined,
        top: a.top,
        barTop: Math.min(innerHeight, ...bars.map(({ r }) => r.top)),
        barBottom: Math.max(0, ...bars.map(({ r }) => r.bottom)),
        what: `${el.outerHTML.slice(0, 120)} at ${Math.round(a.top)}..${Math.round(a.bottom)}, scroll-margin ${getComputedStyle(el).scrollMarginTop} ${getComputedStyle(el).scrollMarginBottom}, bars ${bars.map(({ r }) => `${Math.round(r.top)}..${Math.round(r.bottom)}`).join(' ')}`,
      };
    },
    { chrome, target },
  );
}

test(
  'the title block holds the cover sheet’s bottom-right corner, and the border is zoned on four edges',
  { annotation },
  async ({ page }) => {
    await page.goto('/', { waitUntil: 'networkidle' });
    const box = (selector: string) => page.locator(selector).first().boundingBox();
    const field = (await box('.sx-sheet--cover .sx-field'))!;
    const block = (await box('.sx-sheet--cover .sx-tb'))!;
    // Bottom-right: its end edges sit within a gutter of the field's.
    expect(field.x + field.width - (block.x + block.width)).toBeLessThan(48);
    expect(field.y + field.height - (block.y + block.height)).toBeLessThan(48);
    expect(block.x).toBeGreaterThan(field.x + field.width / 3);
    for (const edge of ['top', 'bottom', 'start', 'end']) {
      await expect(page.locator(`.sx-sheet--cover .sx-zones--${edge} li`).first()).toBeVisible();
    }
    // The title block names the sheets: at most five destinations (N1).
    const links = page.locator('.sx-sheet--cover .sx-tb nav a');
    expect(await links.count()).toBeLessThanOrEqual(5);
  },
);

test(
  'every sheet carries its own title block in its bottom-right corner, with its number and Index (SC-M1)',
  { annotation },
  async ({ page }) => {
    await page.goto('/', { waitUntil: 'networkidle' });
    const sheets = page.locator('.sx-set > .sx-sheet');
    const count = await sheets.count();
    expect(count).toBeGreaterThan(0);
    for (let i = 0; i < count; i++) {
      const sheet = sheets.nth(i);
      const field = (await sheet.locator('.sx-field').first().boundingBox())!;
      const block = (await sheet.locator('.sx-tb[data-at="sheet"]').boundingBox())!;
      expect(field.x + field.width - (block.x + block.width)).toBeLessThan(48);
      expect(field.y + field.height - (block.y + block.height)).toBeLessThan(48);
      await expect(sheet.locator('.sx-run')).toContainText(`S-0${i + 1}`);
    }
  },
);

test(
  'Index, one link to the footer’s index, opens the drawing index as a dialog, its state announced; a modified click follows the link; a link in the dialog closes it and lands',
  { annotation },
  async ({ page }) => {
    await page.goto('/', { waitUntil: 'networkidle' });
    const index = page.locator('.sx-sheet--cover a[data-sx-open]');
    await expect(index).toBeVisible();
    await index.click();
    const dialog = page.locator('dialog.sx-dialog');
    await expect(dialog).toBeVisible();
    await expect(index).toHaveAttribute('aria-expanded', 'true');
    await expect(index).toHaveAttribute('aria-haspopup', 'dialog');
    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();
    await expect(index).toBeFocused();
    await expect(index).toHaveAttribute('aria-expanded', 'false');
    // A modified click asks for the link itself: the dialog stays shut, and the browser follows it.
    const followed = await index.evaluate((el) => {
      const event = new MouseEvent('click', { bubbles: true, cancelable: true, metaKey: true });
      el.dispatchEvent(event);
      return !event.defaultPrevented;
    });
    expect(followed).toBe(true);
    await expect(dialog).toBeHidden();
    await index.click();
    const link = dialog.locator('ol a').first();
    const href = (await link.getAttribute('href'))!;
    await link.click();
    await expect(dialog).toBeHidden();
    await expect(page).toHaveURL(new RegExp(`${href}$`));
  },
);

test('the draw-on runs once on load, linework only (M4)', { annotation }, async ({ page }) => {
  await page.goto('/', { waitUntil: 'commit' });
  await page.waitForSelector('h1');
  await expect
    .poll(
      () =>
        page.evaluate(
          () =>
            document
              .getAnimations()
              .filter((a) => (a as CSSAnimation).animationName?.startsWith('schematic-')).length,
        ),
      { timeout: 2000, intervals: [50] },
    )
    .toBeGreaterThan(0);
  // Only pseudo-elements and the two figure boxes draw: the text never animates.
  // Every animation counts, CSS or script, but a CSS transition (a colour
  // settling as a stylesheet lands), which the test names once, so a later
  // script animation on body text still fails M4.
  const { targets, transitions } = await page.evaluate(() => {
    const where = (el: Element) => `${el.tagName.toLowerCase()}.${String(el.className)}`;
    const targets: string[] = [];
    const transitions: string[] = [];
    for (const a of document.getAnimations()) {
      const effect = a.effect as KeyframeEffect | null;
      if (effect?.pseudoElement || !effect?.target) continue;
      if (a instanceof CSSTransition) {
        transitions.push(`${a.transitionProperty} ${where(effect.target)}`);
        continue;
      }
      const name = a instanceof CSSAnimation ? a.animationName : a.id || 'script';
      targets.push(`${name} ${where(effect.target)}`);
    }
    return { targets, transitions };
  });
  if (transitions.length > 0)
    console.log(
      `draw-on check: ${transitions.length} transitions left out: ${transitions.join('; ')}`,
    );
  for (const target of targets) expect(target).toMatch(/ \w+\.sx-(iface|depth)__box/);
});

test(
  'nothing loops at idle, and the draw-on never holds the text',
  { annotation },
  async ({ page }) => {
    await page.addInitScript(() => {
      const w = window as unknown as { __sxFrames: number };
      w.__sxFrames = 0;
      const raf = window.requestAnimationFrame.bind(window);
      window.requestAnimationFrame = (cb) => {
        w.__sxFrames += 1;
        return raf(cb);
      };
    });
    await page.goto('/', { waitUntil: 'commit' });
    await page.waitForSelector('h1');
    // Mid draw-on, the name and the thesis are already at full opacity, every ancestor included.
    const opacity = await page.evaluate(() => {
      const product = (el: Element | null) => {
        let value = 1;
        for (let node = el; node; node = node.parentElement)
          value *= Number(getComputedStyle(node).opacity);
        return value;
      };
      return [
        product(document.querySelector('h1')),
        product(document.querySelector('.sx-elev__w')),
      ];
    });
    expect(opacity).toEqual([1, 1]);
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(1500);
    const running = await page.evaluate(
      () => document.getAnimations().filter((a) => a.playState === 'running').length,
    );
    expect(running).toBe(0);
    // At rest no frame is asked for: no loop, in script or in CSS.
    await page.evaluate(() => ((window as unknown as { __sxFrames: number }).__sxFrames = 0));
    await page.waitForTimeout(2000);
    expect(
      await page.evaluate(() => (window as unknown as { __sxFrames: number }).__sxFrames),
    ).toBe(0);
  },
);

test(
  'every focus stop clears the running marker, and a fragment target opens above it (K-12)',
  { annotation },
  async ({ page }) => {
    await page.goto('/', { waitUntil: 'networkidle' });
    let judged = 0;
    for (let i = 0; i < 80; i++) {
      await page.keyboard.press('Tab');
      const c = await clearance(page, '.sx-run');
      if (c.judged) judged++;
      expect(c.overlap, `tab ${i + 1}: ${c.what}`).toBe(false);
    }
    expect(judged).toBeGreaterThan(0);
    // A jump by fragment to a sheet further down: its top edge, and so its heading, sits above the marker.
    const href = await middleSheet(page);
    await page.evaluate((hash) => {
      location.hash = hash;
    }, href);
    await page.waitForTimeout(300);
    const c = await clearance(page, '.sx-run', href.slice(1));
    expect(c.top).toBeGreaterThanOrEqual(0);
    expect(c.top).toBeLessThan(c.barTop);
  },
);

test(
  'a pointer click on a link partly under the running marker never moves the page (K-12)',
  { annotation },
  async ({ page }) => {
    await page.goto('/', { waitUntil: 'networkidle' });
    // A link that shares the marker's columns, scrolled so half of it sits under the stuck marker.
    const point = await page.evaluate(() => {
      // A link, or a closed view's summary, which spans the sheet into the marker's columns.
      for (const link of document.querySelectorAll<HTMLElement>('.sx-set :is(a[href], summary)')) {
        if (link.closest('.sx-run, .sx-tb') || link.getClientRects().length === 0) continue;
        const sheet = link.closest('.sx-sheet');
        const marker = sheet?.querySelector('.sx-run');
        if (!sheet || !marker) continue;
        const a = link.getBoundingClientRect();
        const r = marker.getBoundingClientRect();
        if (a.width === 0 || a.height === 0 || a.right <= r.left + 4 || a.left >= r.right - 4)
          continue;
        // Stuck, the marker's top sits at the viewport's bottom less its inset and height.
        const inset = innerHeight - parseFloat(getComputedStyle(marker).insetBlockEnd) - r.height;
        window.scrollBy({ top: a.top + a.height / 2 - inset, behavior: 'instant' });
        const b = link.getBoundingClientRect();
        const m = marker.getBoundingClientRect();
        if (!(b.bottom > m.top + 1 && b.top < m.top - 1)) continue;
        const x = Math.max(b.left, m.left) + 2;
        const y = b.top + 1;
        const hit = document.elementFromPoint(x, y);
        if (!hit || !link.contains(hit)) continue;
        // Neither navigates nor toggles: the click only focuses it, as a pointer does.
        link.addEventListener('click', (event) => event.preventDefault(), { capture: true });
        return { x, y, scrollY, what: link.outerHTML.slice(0, 100) };
      }
      return null;
    });
    expect(point, 'a link or summary that can sit partly under a marker').not.toBeNull();
    await page.mouse.click(point!.x, point!.y);
    await page.evaluate(
      () =>
        new Promise((done) =>
          requestAnimationFrame(() => requestAnimationFrame(() => requestAnimationFrame(done))),
        ),
    );
    const after = await page.evaluate(() => scrollY);
    expect(Math.abs(after - point!.scrollY), point!.what).toBeLessThanOrEqual(1);
  },
);

test(
  'scrolled to a sheet, its link in the title block carries aria-current (S7)',
  { annotation },
  async ({ page }) => {
    await page.goto('/', { waitUntil: 'networkidle' });
    const links = page.locator('.sx-sheet--cover a[data-sx-sheet]');
    expect(await links.count()).toBeGreaterThan(2);
    const target = (await links.nth(2).getAttribute('href'))!;
    await page.locator(target).evaluate((el) => el.scrollIntoView({ block: 'start' }));
    await expect(links.nth(2)).toHaveAttribute('aria-current', 'location');
    await expect(page.locator('.sx-sheet--cover a[aria-current]')).toHaveCount(1);
  },
);

test(
  'a link followed in the Index takes focus to its target, in view, not back to the opener (focus after a dialog link)',
  { annotation },
  async ({ page }) => {
    await page.goto('/', { waitUntil: 'networkidle' });
    await page.locator('.sx-sheet--cover a[data-sx-open]').focus();
    await page.keyboard.press('Enter');
    const dialog = page.locator('dialog.sx-dialog');
    await expect(dialog).toBeVisible();
    const link = dialog.locator('.sx-index__sheet ol a').nth(1);
    const href = (await link.getAttribute('href'))!;
    await link.focus();
    await page.keyboard.press('Enter');
    await expect(dialog).toBeHidden();
    await expect(page).toHaveURL(new RegExp(`${href}$`));
    const where = await page.evaluate((id) => {
      const target = document.getElementById(id)!;
      const active = document.activeElement!;
      const r = active.getBoundingClientRect();
      return {
        inside: target.contains(active),
        inView: r.bottom > 0 && r.top < innerHeight,
        what: active.outerHTML.slice(0, 80),
      };
    }, href.slice(1));
    expect(where.inside, where.what).toBe(true);
    expect(where.inView, where.what).toBe(true);
  },
);

test(
  'on paper the hero’s call to action and any further drawings print (print keeps content, hides chrome)',
  { annotation },
  async ({ page }) => {
    await page.goto('/', { waitUntil: 'networkidle' });
    await page.emulateMedia({ media: 'print' });
    await expect(page.locator('.sx-actions a').first()).toBeVisible();
    await expect(page.locator('.sx-run').first()).toBeHidden();
    // The cover's Index prints as what it is, a reference to the footer's drawing index.
    const index = page.locator('.sx-sheet--cover a[data-sx-open]');
    await expect(index).toBeVisible();
    await expect(page.locator(`footer ${(await index.getAttribute('href'))!}`)).toBeVisible();
  },
);

test(
  'the pinned chrome’s controls are 44 px or more (WCAG 2.5.8, pinned)',
  { annotation },
  async ({ page }) => {
    await page.goto('/', { waitUntil: 'networkidle' });
    const marker = page.locator('.sx-run a[data-sx-open]').first();
    await marker.scrollIntoViewIfNeeded();
    const box = (await marker.boundingBox())!;
    expect(box.height).toBeGreaterThanOrEqual(44);
    expect(box.width).toBeGreaterThanOrEqual(44);
  },
);

test.describe('under reduced motion', () => {
  test.use({ contextOptions: { reducedMotion: 'reduce' } });
  test(
    'the clearance still holds for keyboard focus, and nothing animates (K-12)',
    { annotation },
    async ({ page }) => {
      await page.goto('/', { waitUntil: 'networkidle' });
      for (let i = 0; i < 60; i++) {
        await page.keyboard.press('Tab');
        const c = await clearance(page, '.sx-run');
        expect(c.overlap, `tab ${i + 1}: ${c.what}`).toBe(false);
      }
      const running = await page.evaluate(
        () => document.getAnimations().filter((a) => a.playState === 'running').length,
      );
      expect(running).toBe(0);
    },
  );
});

test(
  'every sheet’s corner sits clear below its last view, at 1440 and 390 (no row under or against the title block)',
  { annotation },
  async ({ page }) => {
    for (const viewport of [
      { width: 1440, height: 900 },
      { width: 390, height: 844 },
    ]) {
      await page.setViewportSize(viewport);
      await page.goto('/', { waitUntil: 'networkidle' });
      const sheets = await page.locator('.sx-set > .sx-sheet[data-sheet]').evaluateAll((all) =>
        all.map((sheet) => {
          const views = [...sheet.querySelectorAll('.sx-views .sx-view')];
          const corner = sheet.querySelector('.sx-tb[data-at="sheet"]')!.getBoundingClientRect();
          return {
            sheet: sheet.getAttribute('data-sheet'),
            last: Math.max(...views.map((view) => view.getBoundingClientRect().bottom)),
            corner: corner.top,
          };
        }),
      );
      expect(sheets.length).toBeGreaterThan(0);
      for (const sheet of sheets)
        // Clear of it by a gap, never flush on the last row.
        expect(sheet.last, `${viewport.width}: ${sheet.sheet}`).toBeLessThanOrEqual(
          sheet.corner - 8,
        );
    }
  },
);

test(
  'a fresh arrival at a closed view’s fragment opens its fold, on screen, on a desktop',
  { annotation },
  async ({ page }) => {
    await page.goto('/', { waitUntil: 'networkidle' });
    const id = (await page
      .locator('section.sx-view:has(> details[data-sx-outline])')
      .last()
      .getAttribute('id'))!;
    await page.goto('about:blank');
    await page.goto(`/#${id}`, { waitUntil: 'networkidle' });
    await page.waitForTimeout(300);
    const target = page.locator(`[id="${id}"]`);
    await expect(target.locator(':scope > details')).toHaveAttribute('open', '');
    const top = await target.evaluate((el) => el.getBoundingClientRect().top);
    expect(top).toBeGreaterThanOrEqual(0);
    expect(top).toBeLessThan(900 / 2);
  },
);

test(
  'the hero’s title names the cover sheet on one line in the title block, at 1440 and 390',
  { annotation },
  async ({ page }, testInfo) => {
    for (const viewport of [
      { width: 1440, height: 900 },
      { width: 390, height: 844 },
    ]) {
      await page.setViewportSize(viewport);
      await page.goto('/', { waitUntil: 'networkidle' });
      const block = page.locator('.sx-sheet--cover .sx-tb');
      const title = block.locator('.sx-tb__sheet-title');
      await expect(title).toBeVisible();
      await expect(title).toHaveText('Hero label');
      const lines = await title.evaluate(
        (el) => el.getBoundingClientRect().height / parseFloat(getComputedStyle(el).lineHeight),
      );
      expect(lines).toBeLessThan(1.5);
      await block.screenshot({ path: testInfo.outputPath(`hero-title-${viewport.width}.png`) });
    }
  },
);

test(
  'a schedule sets its counts as a quantity column from the fourth grid line at 1440, and on the right at 390',
  { annotation },
  async ({ page }) => {
    for (const viewport of [
      { width: 1440, height: 900 },
      { width: 390, height: 844 },
    ]) {
      await page.setViewportSize(viewport);
      await page.goto('/', { waitUntil: 'networkidle' });
      const rows = await page.locator('.sx-schedule').evaluateAll((schedules) =>
        schedules.map((schedule) => {
          const views = schedule.closest('.sx-views')!.getBoundingClientRect();
          const gutter =
            parseFloat(getComputedStyle(schedule.closest('.sx-views')!).columnGap) || 0;
          const columns = viewportColumns();
          function viewportColumns() {
            return getComputedStyle(schedule.closest('.sx-views')!).gridTemplateColumns.split(' ')
              .length;
          }
          const track = (views.width - gutter * (columns - 1)) / columns;
          const line4 = views.left + 3 * (track + gutter);
          return [...schedule.querySelectorAll('summary')].flatMap((summary) => {
            const count = summary.querySelector('.sx-vt__count');
            if (!count) return [];
            const c = count.getBoundingClientRect();
            const row = summary.getBoundingClientRect();
            return [{ left: c.left, right: c.right, rowRight: row.right, line4, columns }];
          });
        }),
      );
      const counts = rows.flat();
      expect(counts.length, `${viewport.width}`).toBeGreaterThan(0);
      for (const count of counts) {
        if (viewport.width >= 768) {
          expect(count.columns).toBe(8);
          expect(Math.abs(count.left - count.line4), `${viewport.width}`).toBeLessThanOrEqual(2);
        } else {
          expect(count.rowRight - count.right, `${viewport.width}`).toBeLessThan(64);
        }
      }
      // No leader is drawn between a title and its count.
      const leaders = await page
        .locator('.sx-schedule summary')
        .evaluateAll(
          (all) => all.filter((s) => getComputedStyle(s, '::before').content !== 'none').length,
        );
      expect(leaders).toBe(0);
    }
  },
);

test(
  'the footer index’s focus ring encloses each sheet’s number, at 1440 and 390 (P2 change 7)',
  { annotation },
  async ({ page }, testInfo) => {
    for (const viewport of [
      { width: 1440, height: 900 },
      { width: 390, height: 844 },
    ]) {
      await page.setViewportSize(viewport);
      await page.goto('/', { waitUntil: 'networkidle' });
      const heads = page.locator('.sx-foot__index .sx-index__head:has(a)');
      expect(await heads.count()).toBeGreaterThan(2);
      // Nothing of a linked head sits outside its link, so no ring can cross its number.
      const loose = await heads.evaluateAll((all) =>
        all.flatMap((head) =>
          [...head.childNodes]
            .filter((node) => !(node instanceof HTMLAnchorElement) && node.textContent?.trim())
            .map((node) => node.textContent!.trim()),
        ),
      );
      expect(loose, `${viewport.width}`).toEqual([]);
      const first = heads.first().locator('a');
      await first.evaluate((el) => el.scrollIntoView({ block: 'center', behavior: 'instant' }));
      await page.keyboard.press('Shift');
      await first.focus();
      const ring = await first.evaluate((el) => {
        const style = getComputedStyle(el);
        const out = Number.parseFloat(style.outlineOffset) + Number.parseFloat(style.outlineWidth);
        const box = el.getBoundingClientRect();
        const no = el.querySelector('[data-type-role="numeric"]')!.getBoundingClientRect();
        return {
          visible: el.matches(':focus-visible') && style.outlineStyle !== 'none',
          encloses:
            no.left >= box.left - out && no.right <= box.right + out && no.top >= box.top - out,
          clip: {
            x: Math.max(0, box.left - 24),
            y: Math.max(0, box.top - 24),
            width: Math.min(innerWidth - Math.max(0, box.left - 24), box.width + 48),
            height: box.height + 48,
          },
        };
      });
      expect(ring.visible, `${viewport.width}`).toBe(true);
      expect(ring.encloses, `${viewport.width}`).toBe(true);
      await page.screenshot({
        path: testInfo.outputPath(`focus-footer-index-${viewport.width}.png`),
        clip: ring.clip,
      });
    }
  },
);

test(
  'the footer title block’s Appearance cell holds the visitor’s control, filled, at 1440 and 390 (P2 change 7)',
  { annotation },
  async ({ page }, testInfo) => {
    for (const viewport of [
      { width: 1440, height: 900 },
      { width: 390, height: 844 },
    ]) {
      await page.setViewportSize(viewport);
      await page.goto('/', { waitUntil: 'networkidle' });
      const cell = page.locator('.sx-foot .sx-tb .sx-tb__control');
      const control = cell.locator('[data-visitor-control-slot] [data-ui-slot]').first();
      await expect(control, `${viewport.width}`).toBeVisible();
      await cell.scrollIntoViewIfNeeded();
      const fit = await cell.evaluate((el) => {
        const box = el.getBoundingClientRect();
        const slot = el.querySelector('[data-visitor-control-slot]')!.getBoundingClientRect();
        const disclosure = el.querySelector('[data-ui-slot="disclosure"]');
        return {
          inside: slot.left >= box.left - 1 && slot.right <= box.right + 1,
          // The cell's lines rule the control, so it draws none of its own, and it fills the cell.
          ruled: disclosure ? getComputedStyle(disclosure).borderTopWidth : null,
          fills: slot.width >= box.width * 0.75,
          overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
        };
      });
      expect(fit.inside, `${viewport.width}`).toBe(true);
      expect(fit.ruled, `${viewport.width}`).toBe('0px');
      expect(fit.fills, `${viewport.width}`).toBe(true);
      expect(fit.overflow, `${viewport.width}`).toBeLessThanOrEqual(0);
      await page
        .locator('.sx-foot .sx-tb')
        .screenshot({ path: testInfo.outputPath(`foot-appearance-${viewport.width}.png`) });
      // Opened, its choices stay on the page.
      const summary = cell.locator('[data-ui-slot="disclosure.summary"]').first();
      if (await summary.count()) {
        await summary.click();
        await page.waitForTimeout(300);
        const wide = await page.evaluate(
          () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
        );
        expect(wide, `${viewport.width} open`).toBeLessThanOrEqual(0);
        await page.screenshot({
          path: testInfo.outputPath(`foot-appearance-${viewport.width}-open.png`),
        });
      }
    }
  },
);

test(
  'a schedule row’s chevron sits on the row’s centre line and inside its rule, at 1440 and 390 (P2 review)',
  { annotation },
  async ({ page }) => {
    for (const viewport of [
      { width: 1440, height: 900 },
      { width: 390, height: 844 },
    ]) {
      await page.setViewportSize(viewport);
      await page.goto('/', { waitUntil: 'networkidle' });
      const row = page.locator('.sx-schedule summary.sx-vt').first();
      await row.evaluate((el) => el.scrollIntoView({ block: 'center', behavior: 'instant' }));
      const box = (await row.boundingBox())!;
      const title = (await row.locator('.sx-vt__title').boundingBox())!;
      // The chevron alone: the row's end shot with it, then without it.
      const clip = { x: box.x + box.width - 48, y: box.y, width: 56, height: box.height };
      const shown = decodePng(await page.screenshot({ clip }));
      const style = await page.addStyleTag({
        content: '.sx-schedule summary.sx-vt::after { visibility: hidden !important; }',
      });
      const hidden = decodePng(await page.screenshot({ clip }));
      await style.evaluate((el) => (el as Element).remove());
      let [top, bottom, right] = [Infinity, -Infinity, -Infinity];
      for (let i = 0; i < shown.width * shown.height; i++) {
        if (deltaEOk(pixel(shown, i), pixel(hidden, i)) < 0.05) continue;
        const [x, y] = [i % shown.width, Math.floor(i / shown.width)];
        [top, bottom, right] = [Math.min(top, y), Math.max(bottom, y), Math.max(right, x)];
      }
      expect(right, `${viewport.width}: a chevron drawn`).toBeGreaterThan(-Infinity);
      const centre = box.y + (top + bottom + 1) / 2;
      expect(
        Math.abs(centre - (title.y + title.height / 2)),
        `${viewport.width}: off the title's centre line`,
      ).toBeLessThanOrEqual(2);
      expect(clip.x + right + 1, `${viewport.width}: past the row's rule`).toBeLessThanOrEqual(
        box.x + box.width + 0.5,
      );
    }
  },
);

test(
  'every fold’s control is the dashed box with a chevron, a description’s too, never the browser’s triangle (P2 review)',
  { annotation },
  async ({ page }) => {
    await page.goto('/', { waitUntil: 'networkidle' });
    const summaries = page.locator('.sx-abstract > summary');
    expect(await summaries.count()).toBeGreaterThan(0);
    const looks = await summaries.evaluateAll((all) =>
      all.map((el) => {
        const style = getComputedStyle(el);
        return {
          display: style.display,
          border: style.borderTopStyle,
          chevron: getComputedStyle(el, '::after').content,
        };
      }),
    );
    for (const look of looks) {
      expect(look.display).not.toBe('list-item');
      expect(look.border).toBe('dashed');
      expect(look.chevron).toBe('""');
    }
  },
);

test(
  'with the root text at 200% at 1024, nothing on the cover or in a title block runs past the page or is cut by its own box (the quality cells’ root-text reflow)',
  { annotation },
  async ({ page }) => {
    await page.setViewportSize({ width: 1024, height: 768 });
    await page.goto('/', { waitUntil: 'networkidle' });
    await page.evaluate(() =>
      document.documentElement.style.setProperty('font-size', '200%', 'important'),
    );
    await page.waitForTimeout(300);
    const found = await page.evaluate(() => {
      // The page, and the cover's and the title blocks' parts (the complete fixture's spills, and
      // the gate's); the sample's tables at 200% are a known P3 gap. Visually hidden text is
      // clipped on purpose.
      const width = document.documentElement.clientWidth;
      const out: string[] = [];
      if (document.documentElement.scrollWidth > width)
        out.push(`page ${document.documentElement.scrollWidth} in ${width}`);
      for (const el of document.querySelectorAll<HTMLElement>('.sx-sheet--cover *, .sx-tb *')) {
        const box = el.getBoundingClientRect();
        if (box.width === 0 || el.closest('.sx-hidden')) continue;
        const style = getComputedStyle(el);
        if (box.right > width + 1) out.push(`${el.className}: right ${Math.round(box.right)}`);
        if (style.overflowX !== 'visible' && el.scrollWidth > el.clientWidth + 1)
          out.push(`${el.className}: ${el.scrollWidth} in ${el.clientWidth}`);
      }
      return out;
    });
    expect(found).toEqual([]);
  },
);

test.describe('under more contrast', () => {
  test(
    'the drafting grid and the section hatching go, so no text sits on a grid line (the quality cells’ contrast-more row)',
    { annotation },
    async ({ page }) => {
      await page.emulateMedia({ contrast: 'more' });
      await page.goto('/', { waitUntil: 'networkidle' });
      const grids = await page
        .locator('.sx-field')
        .evaluateAll((all) => all.map((el) => getComputedStyle(el).backgroundImage));
      expect(grids.length).toBeGreaterThan(0);
      for (const grid of grids) expect(grid).toBe('none');
    },
  );
  test(
    'the site’s own data-contrast="more" on the boundary takes the grid away too, with no media emulation',
    { annotation },
    async ({ page }) => {
      await page.goto('/', { waitUntil: 'networkidle' });
      const before = await page
        .locator('.sx-field')
        .first()
        .evaluate((el) => getComputedStyle(el).backgroundImage);
      expect(before).not.toBe('none');
      // The boundary, the outermost element with data-variant, carries data-contrast.
      await page
        .locator('[data-appearance-boundary][data-variant="schematic"]')
        .first()
        .evaluate((el) => el.setAttribute('data-contrast', 'more'));
      const grids = await page
        .locator('.sx-field')
        .evaluateAll((all) => all.map((el) => getComputedStyle(el).backgroundImage));
      for (const grid of grids) expect(grid).toBe('none');
    },
  );
});

test.describe('with no script', () => {
  test.use({ javaScriptEnabled: false });
  test(
    'Index is a link to the footer’s drawing index, and every fold is open',
    { annotation },
    async ({ page }) => {
      await page.goto('/', { waitUntil: 'networkidle' });
      const link = page.locator('.sx-sheet--cover a[data-sx-open]');
      await expect(link).toBeVisible();
      const href = (await link.getAttribute('href'))!;
      await expect(page.locator(`footer ${href}`)).toBeVisible();
      for (const fold of await page.locator('details[data-sx-fold]').all()) {
        await expect(fold).toHaveAttribute('open', '');
      }
    },
  );
});

test.describe('on a phone', () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test(
    'a reader who scrolls before the enhancement loads keeps their place on a fresh fragment visit',
    { annotation },
    async ({ page }) => {
      // Schematic's enhancement held back, as on a slow phone: the page
      // hydrates, and the reader moves, before the chunk that carries it
      // (the one naming its phone folds) lands. Routing is on from the first
      // load, which keeps the HTTP cache out of the way.
      let hold = false;
      let release!: () => void;
      const held = new Promise<void>((done) => (release = done));
      let asked!: () => void;
      const requested = new Promise<void>((done) => (asked = done));
      await page.route('**/_next/static/chunks/**', async (route) => {
        const response = await route.fetch();
        const body = await response.text();
        if (hold && body.includes('details[data-sx-fold]')) {
          asked();
          await held;
        }
        await route.fulfill({ response, body });
      });
      await page.goto('/', { waitUntil: 'networkidle' });
      const id = (await page
        .locator('section.sx-view:has(> details[data-sx-outline])')
        .last()
        .getAttribute('id'))!;
      hold = true;
      await page.goto('about:blank');
      await page.goto(`/#${id}`, { waitUntil: 'commit' });
      await requested;
      await page.waitForTimeout(600);
      // The reader scrolls up 600 px meanwhile.
      await page.evaluate(() => scrollBy({ top: -600, behavior: 'instant' }));
      await page.waitForTimeout(400);
      const target = page.locator(`[id="${id}"]`);
      const before = await target.evaluate((el) => el.getBoundingClientRect().top);
      release();
      // The enhancement has attached once the Index controls are buttons.
      await expect(page.locator('.sx-phone a[data-sx-open]')).toBeVisible();
      await page.waitForTimeout(600);
      const after = await target.evaluate((el) => el.getBoundingClientRect().top);
      expect(Math.abs(after - before)).toBeLessThanOrEqual(2);
    },
  );

  test(
    'a reload of a fragment visit keeps the reader’s own place, never the fragment’s',
    { annotation },
    async ({ page }) => {
      await page.goto('/', { waitUntil: 'networkidle' });
      const id = (await page
        .locator('section.sx-view:has(> details[data-sx-outline])')
        .last()
        .getAttribute('id'))!;
      await page.goto('about:blank');
      await page.goto(`/#${id}`, { waitUntil: 'networkidle' });
      await page.waitForTimeout(300);
      await page.evaluate(() => scrollBy({ top: -600, behavior: 'instant' }));
      await page.waitForTimeout(300);
      const record = page.locator('.sx-set > .sx-sheet[data-sheet]').nth(3);
      const before = await record.evaluate((el) => el.getBoundingClientRect().top);
      await page.reload({ waitUntil: 'networkidle' });
      await page.waitForTimeout(600);
      const after = await page
        .locator('.sx-set > .sx-sheet[data-sheet]')
        .nth(3)
        .evaluate((el) => el.getBoundingClientRect().top);
      expect(Math.abs(after - before)).toBeLessThanOrEqual(2);
    },
  );

  test(
    'a sheet’s closed views run together in its schedules, no view folding on its own between them, each row with its count (S-01)',
    { annotation },
    async ({ page }) => {
      await page.goto('/', { waitUntil: 'networkidle' });
      // No view sits closed on its own outside a schedule, splitting a run of them
      // (the fixture's custom note splits About's run on purpose: it stays open).
      const loose = await page.evaluate(
        () =>
          [...document.querySelectorAll('.sx-views section.sx-view > details:not([open])')].filter(
            (fold) => !fold.closest('.sx-schedule'),
          ).length,
      );
      expect(loose).toBe(0);
      const about = page.locator('.sx-set > .sx-sheet[data-sheet]').first();
      expect(await about.locator('.sx-schedule').count()).toBeGreaterThan(0);
      const rows = await page.locator('.sx-schedule > .sx-view').evaluateAll((all) =>
        all.map((view) => ({
          id: view.id,
          kind: view.getAttribute('data-kind'),
          count: view.querySelector('.sx-vt__count')?.textContent?.trim() ?? '',
        })),
      );
      expect(rows.length).toBeGreaterThan(0);
      // Every row counts something from the content (P2 change 4): a list its
      // entries, a quotation one, GitHub its repositories or its profile.
      expect(rows.some((row) => row.kind === 'practice')).toBe(true);
      expect(rows.some((row) => row.kind === 'quote')).toBe(true);
      expect(rows.some((row) => row.kind === 'github')).toBe(true);
      for (const row of rows) expect(row.count, row.id).not.toBe('');
    },
  );

  test(
    'arriving at a fragment in Record, the target stays where the browser put it as the folds close',
    { annotation },
    async ({ page }) => {
      await page.goto('/', { waitUntil: 'networkidle' });
      const record = page.locator('.sx-set > .sx-sheet[data-sheet]').nth(3);
      const id = await record.locator('.sx-view').first().getAttribute('id');
      // A fresh arrival, not a same-document hash change: the page loads with the fragment.
      await page.goto('about:blank');
      await page.goto(`/#${id}`, { waitUntil: 'networkidle' });
      const how = await page.evaluate(
        () =>
          (performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming | undefined)
            ?.type,
      );
      expect(how).toBe('navigate');
      await page.waitForTimeout(500);
      const top = await page.locator(`[id="${id}"]`).evaluate((el) => ({
        top: el.getBoundingClientRect().top,
        margin: parseFloat(getComputedStyle(el).scrollMarginTop),
      }));
      expect(Math.abs(top.top - top.margin)).toBeLessThanOrEqual(2);
      // Chromium's scroll anchoring hides a fold closing above the target;
      // WebKit has none, so the folds above must not close at all.
      const folds = await foldsAbove(page.locator(`[id="${id}"]`));
      expect(folds.above).toBeGreaterThan(0);
      expect(folds.closed).toBe(0);
    },
  );

  test(
    'a reload mid-page keeps the reader’s place within 2 px as the folds settle',
    { annotation },
    async ({ page }) => {
      await page.goto('/', { waitUntil: 'networkidle' });
      const record = page.locator('.sx-set > .sx-sheet[data-sheet]').nth(3);
      await record.evaluate((el) => el.scrollIntoView({ block: 'start', behavior: 'instant' }));
      await page.waitForTimeout(300);
      const before = await record.evaluate((el) => el.getBoundingClientRect().top);
      await page.reload({ waitUntil: 'networkidle' });
      await page.waitForTimeout(500);
      const after = await page
        .locator('.sx-set > .sx-sheet[data-sheet]')
        .nth(3)
        .evaluate((el) => el.getBoundingClientRect().top);
      expect(Math.abs(after - before)).toBeLessThanOrEqual(2);
      // A reload keeps every fold above the reader as the server sent it, open
      // (scroll anchoring would hide the jump in Chromium, not in WebKit).
      const folds = await foldsAbove(page.locator('.sx-set > .sx-sheet[data-sheet]').nth(3));
      expect(folds.above).toBeGreaterThan(0);
      expect(folds.closed).toBe(0);
    },
  );

  test(
    'Skills, followed from the Sheet dialog, lands open (a view link opens its fold)',
    { annotation },
    async ({ page }) => {
      await page.goto('/', { waitUntil: 'networkidle' });
      // Skills is a closed view in About's outline (re-check R2): any view behind a closed disclosure.
      const section = page
        .locator('section.sx-view:has(> details[data-sx-outline], > details[data-sx-fold])')
        .first();
      const folded = section.locator(':scope > details');
      const id = (await section.getAttribute('id'))!;
      await expect(folded).not.toHaveAttribute('open', '');
      await page.locator('.sx-phone a[data-sx-open]').click();
      await page.locator(`dialog.sx-dialog a[href="#${id}"]`).click();
      await expect(page).toHaveURL(new RegExp(`#${id}$`));
      await expect(folded).toHaveAttribute('open', '');
    },
  );

  test(
    'tabbing inside the open Sheet dialog never moves the page behind it',
    { annotation },
    async ({ page }) => {
      await page.goto('/', { waitUntil: 'networkidle' });
      await page
        .locator('.sx-sheet--cover')
        .evaluate(() => scrollTo({ top: 3000, behavior: 'instant' }));
      const y = await page.evaluate(() => scrollY);
      await page.locator('.sx-phone a[data-sx-open]').focus();
      await page.keyboard.press('Enter');
      await expect(page.locator('dialog.sx-dialog')).toBeVisible();
      for (let i = 0; i < 12; i++) {
        await page.keyboard.press('Tab');
        await page.evaluate(
          () => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done))),
        );
      }
      expect(await page.evaluate(() => scrollY)).toBe(y);
      // The case the clearance would act on: a stop in the dialog that sits
      // under the phone bar. The dialog scrolls a link there, and keyboard
      // focus lands on it; the page behind still holds still.
      const under = await page.evaluate(() => {
        const dialog = document.querySelector<HTMLDialogElement>('dialog.sx-dialog')!;
        const bar = document.querySelector('.sx-phone')!.getBoundingClientRect();
        const line = bar.bottom - 8;
        const room = dialog.scrollHeight - dialog.clientHeight - dialog.scrollTop;
        const link = [...dialog.querySelectorAll<HTMLAnchorElement>('a[href]')].find((a) => {
          const d = a.getBoundingClientRect().top - line;
          return d > 0 && d <= room;
        });
        if (!link) return { found: false, overlaps: false, visible: false };
        dialog.scrollTop += link.getBoundingClientRect().top - line;
        link.focus({ preventScroll: true });
        const a = link.getBoundingClientRect();
        return {
          found: true,
          overlaps: a.top < bar.bottom && a.bottom > bar.top,
          visible: link.matches(':focus-visible'),
        };
      });
      expect(under).toEqual({ found: true, overlaps: true, visible: true });
      await page.evaluate(
        () =>
          new Promise((done) =>
            requestAnimationFrame(() => requestAnimationFrame(() => requestAnimationFrame(done))),
          ),
      );
      expect(await page.evaluate(() => scrollY)).toBe(y);
    },
  );

  test(
    'closing the dialog returns focus to its opener without moving the page, even with the opener under the phone bar',
    { annotation },
    async ({ page }) => {
      await page.goto('/', { waitUntil: 'networkidle' });
      const opener = page.locator('.sx-sheet--cover .sx-tb a[data-sx-open]');
      await expect(opener).toBeVisible();
      // Keyboard modality, then the opener focused and opened from the keyboard.
      await page.keyboard.press('Tab');
      await opener.evaluate((el: HTMLElement) => el.focus());
      await page.keyboard.press('Enter');
      await expect(page.locator('dialog.sx-dialog')).toBeVisible();
      // While the dialog is open, the page behind puts the opener under the phone bar.
      await opener.evaluate((el) => {
        const bar = document.querySelector('.sx-phone')!.getBoundingClientRect();
        window.scrollBy({
          top: el.getBoundingClientRect().top - (bar.bottom - 12),
          behavior: 'instant',
        });
      });
      const y = await page.evaluate(() => scrollY);
      const under = await opener.evaluate((el) => {
        const a = el.getBoundingClientRect();
        const bar = document.querySelector('.sx-phone')!.getBoundingClientRect();
        return a.top < bar.bottom && a.bottom > bar.top;
      });
      expect(under).toBe(true);
      await page.keyboard.press('Escape');
      await expect(page.locator('dialog.sx-dialog')).toBeHidden();
      await expect(opener).toBeFocused();
      await page.evaluate(
        () =>
          new Promise((done) =>
            requestAnimationFrame(() => requestAnimationFrame(() => requestAnimationFrame(done))),
          ),
      );
      // The returned focus is the dialog's move, not the reader's: no clearance nudge.
      expect(await page.evaluate(() => scrollY)).toBe(y);
    },
  );

  test(
    'the phone bar names the sheet being read, and its controls are 44 px or more',
    { annotation },
    async ({ page }) => {
      await page.goto('/', { waitUntil: 'networkidle' });
      const here = page.locator('.sx-phone a[data-sx-open] [data-sx-here]');
      const sheet = page.locator('.sx-set > .sx-sheet[data-sheet]').nth(1);
      const no = (await sheet.getAttribute('data-sheet'))!;
      await sheet.evaluate((el) => el.scrollIntoView({ block: 'start', behavior: 'instant' }));
      await expect(here).toContainText(no);
      for (const target of [
        page.locator('.sx-phone a[data-sx-open]'),
        page.locator('.sx-phone__name'),
      ]) {
        const box = (await target.boundingBox())!;
        expect(box.height).toBeGreaterThanOrEqual(44);
      }
    },
  );
  test(
    'no sideways scroll, and the bar names the sheet being read',
    { annotation },
    async ({ page }) => {
      await page.goto('/', { waitUntil: 'networkidle' });
      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      );
      expect(overflow).toBeLessThanOrEqual(0);
      const sheet = page.locator('.sx-phone a[data-sx-open]');
      await expect(sheet).toBeVisible();
      await expect(sheet).toContainText('Sheet');
    },
  );

  test(
    'a fragment target and every focus stop above it clear the phone bar (K-12)',
    { annotation },
    async ({ page }) => {
      await page.goto('/', { waitUntil: 'networkidle' });
      const href = await middleSheet(page);
      await page.evaluate((hash) => {
        location.hash = hash;
      }, href);
      await page.waitForTimeout(300);
      const jump = await clearance(page, '.sx-phone', href.slice(1));
      expect(jump.top).toBeGreaterThanOrEqual(jump.barBottom);
      // Backwards from the target: every stop scrolled in from above lands below the bar.
      for (let i = 0; i < 30; i++) {
        await page.keyboard.press('Shift+Tab');
        const c = await clearance(page, '.sx-phone');
        expect(c.overlap, `shift-tab ${i + 1}: ${c.what}`).toBe(false);
      }
    },
  );
});
