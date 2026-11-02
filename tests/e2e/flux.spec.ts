import { contractFixture } from '../../packages/variant-contract/src/node/fixtures';
import { expect, test } from '../harness/fixtures';
import { appFor, textPastTheEdges } from './flux-shared';
import { inPage } from '../quality/lib/a11y/probe';

// Flux's checks in a browser (variants-10 brief §5.10; K-4 b, c, e): two
// loops at most, both drifting only while the field is on screen and the
// tab shows, and paused by Pause (WCAG 2.2.2); under reduced motion nothing
// loops and nothing asks for frames; the Index opens as a dialog over the
// page, Close focused, and Escape gives focus back to Index; each sheet
// tab's drip clears its word (FX-M16); no text runs past the window's edges
// from 320 to 1440 (the long-text fixture's are flux-long-text.spec.ts); and
// with no script every destination is a link and Copy email isn't offered
// (FX-S53). On the complete fixture, under read-only.

const FIXTURE = contractFixture('complete');
const annotation = [
  { type: 'route', description: '/' },
  { type: 'profile', description: 'read-only' },
];

const APP = appFor(FIXTURE);

test.use({ viewport: { width: 1440, height: 900 }, appOptions: APP });

/** The page's infinite animations and whether each is running. */
const loops = () =>
  document
    .getAnimations()
    .filter((animation) => animation.effect?.getTiming().iterations === Infinity)
    .map((animation) => animation.playState);

/** How many frames the page asks for in a second. */
const framesInASecond = () =>
  new Promise<number>((resolve) => {
    let frames = 0;
    const real = window.requestAnimationFrame;
    window.requestAnimationFrame = (cb) => {
      frames += 1;
      return real(cb);
    };
    setTimeout(() => {
      window.requestAnimationFrame = real;
      resolve(frames);
    }, 1000);
  });

test(
  'two loops at most: they drift while the field shows, rest once it scrolls away, and ask for no frames',
  { annotation },
  async ({ page }) => {
    await page.goto('/', { waitUntil: 'networkidle' });
    await expect(page.locator('[data-variant="flux"]')).toHaveCount(1);
    await expect(page.locator('.fx-field[data-kit-runtime]')).toHaveCount(1);
    await expect.poll(() => page.evaluate(loops)).toEqual(['running', 'running']);
    expect(await page.evaluate(framesInASecond)).toBe(0);
    await page.evaluate(() => document.getElementById('fx--sheet-record')?.scrollIntoView());
    await expect.poll(() => page.evaluate(loops)).toEqual(['paused', 'paused']);
  },
);

test('Pause holds both loops where they are (WCAG 2.2.2)', { annotation }, async ({ page }) => {
  await page.goto('/', { waitUntil: 'networkidle' });
  await expect.poll(() => page.evaluate(loops)).toEqual(['running', 'running']);
  await page.locator('.fx-pause button').click();
  await expect.poll(() => page.evaluate(loops)).toEqual(['paused', 'paused']);
});

test.describe('under reduced motion', () => {
  test(
    'nothing loops and nothing asks for frames: the field is its still',
    { annotation },
    async ({ page }) => {
      await page.emulateMedia({ reducedMotion: 'reduce' });
      await page.goto('/', { waitUntil: 'networkidle' });
      await page.waitForTimeout(500);
      expect((await page.evaluate(loops)).filter((state) => state === 'running')).toEqual([]);
      expect(await page.evaluate(framesInASecond)).toBe(0);
      await expect(page.locator('.fx-ink[data-mode="w"]').first()).toBeVisible();
    },
  );
});

test(
  'the Index opens over the page with Close focused, and Escape gives focus back',
  { annotation },
  async ({ page }) => {
    await page.goto('/', { waitUntil: 'networkidle' });
    const open = page.locator('[data-fx-open-index]');
    await expect(open).toBeVisible();
    await expect(page.locator('.fx-tool--plain')).toBeHidden();
    await open.click();
    const dialog = page.getByRole('dialog', { name: 'Index' });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByRole('button', { name: 'Close' })).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();
    await expect(open).toBeFocused();
  },
);

test(
  'the Index keeps focus inside, leaves the page inert, closes on a followed link, and Close gives focus back',
  { annotation },
  async ({ page }) => {
    await page.goto('/', { waitUntil: 'networkidle' });
    const open = page.locator('[data-fx-open-index]');
    const dialog = page.getByRole('dialog', { name: 'Index' });
    const close = dialog.getByRole('button', { name: 'Close' });
    await open.click();
    await expect(close).toBeFocused();
    // The page under it is inert: main and the bar.
    expect(
      await page.evaluate(() =>
        [document.querySelector('main'), document.querySelector('.fx-bar')].map(
          (el) => el?.closest('[inert]') !== null,
        ),
      ),
    ).toEqual([true, true]);
    // Shift+Tab from Close wraps to the last link, and Tab from there wraps back to Close.
    await page.keyboard.press('Shift+Tab');
    const last = dialog.locator('a').last();
    await expect(last).toBeFocused();
    await page.keyboard.press('Tab');
    await expect(close).toBeFocused();
    // Close gives focus back to Index.
    await close.click();
    await expect(dialog).toBeHidden();
    await expect(open).toBeFocused();
    expect(
      await page.evaluate(() => document.querySelector('main')?.closest('[inert]')),
    ).toBeNull();
    // A followed link closes it and lands on its sheet.
    await open.click();
    await dialog.locator('a[href$="#fx--sheet-record"]').click();
    await expect(dialog).toBeHidden();
    await expect(page).toHaveURL(/#fx--sheet-record$/);
    await expect
      .poll(() =>
        page.evaluate(() => {
          const top = document.getElementById('fx--sheet-record')!.getBoundingClientRect().top;
          return top >= 0 && top < window.innerHeight;
        }),
      )
      .toBe(true);
  },
);

test(
  'under reduced motion the strip shows only once the page has scrolled (MF1b)',
  { annotation },
  async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.goto('/', { waitUntil: 'networkidle' });
    const strip = () =>
      page.evaluate(
        () => getComputedStyle(document.querySelector('.fx-bar')!, '::before').visibility,
      );
    await expect.poll(strip).toBe('hidden');
    await page.evaluate(() => window.scrollTo(0, 200));
    await expect.poll(strip).toBe('visible');
  },
);

for (const width of [320, 390, 768, 1440]) {
  test(
    `at ${width}: every sheet tab's drip clears its word (FX-M16), and nothing scrolls sideways`,
    { annotation },
    async ({ page }) => {
      await page.setViewportSize({ width, height: 900 });
      await page.goto('/', { waitUntil: 'networkidle' });
      const overlaps = await page.evaluate(() =>
        [...document.querySelectorAll('.fx-sheet__tab')].flatMap((tab) => {
          const drip = tab.querySelector('.fx-sheet__drip')!.getBoundingClientRect();
          const word = tab.querySelector('.fx-sheet__word')!;
          const range = document.createRange();
          range.selectNodeContents(word);
          return [...range.getClientRects()].filter(
            (r) =>
              r.left < drip.right &&
              drip.left < r.right &&
              r.top < drip.bottom &&
              drip.top < r.bottom,
          ).length > 0
            ? [word.textContent]
            : [];
        }),
      );
      expect(overlaps).toEqual([]);
      expect(await page.evaluate(textPastTheEdges)).toEqual([]);
    },
  );
}

test.describe('with no script', () => {
  test.use({ javaScriptEnabled: false });
  test(
    'every destination is a link, Index is the contents list, and Copy email is not offered',
    { annotation },
    async ({ page }) => {
      await page.goto('/', { waitUntil: 'networkidle' });
      await expect(page.locator('h1')).toHaveCount(1);
      await expect(page.locator('.fx-tool--plain')).toBeVisible();
      await expect(page.locator('[data-fx-open-index]')).toBeHidden();
      await expect(page.locator('[data-fx-copy]')).toBeHidden();
      const tabs = page.locator('.fx-tabs a');
      expect(await tabs.count()).toBeGreaterThan(1);
      await expect(page.locator('.fx-index')).toBeVisible();
    },
  );
  test(
    'a fragment that lands on or in a closed fold reads it open, and the page carries no fold mark',
    { annotation },
    async ({ page }) => {
      await page.goto('/', { waitUntil: 'networkidle' });
      await expect(page.locator('.fx[data-fx-folds]')).toHaveCount(0);
      // A section whose own fold is closed, or a closed fold's inner anchor.
      const id = await page.evaluate(
        () =>
          [...document.querySelectorAll<HTMLElement>('[id]')].find(
            (each) =>
              each.querySelector(':scope > details.fx-fold:not([open])') !== null ||
              each.closest('details.fx-fold:not([open]) > :not(summary)') !== null,
          )?.id ?? null,
      );
      expect(id, 'a fragment on or in a closed fold').not.toBeNull();
      await page.goto(`/#${id}`, { waitUntil: 'networkidle' });
      const body = page
        .locator(`[id="${id}"] > details.fx-fold > .fx-fold__body`)
        .or(page.locator(`details.fx-fold:has([id="${id}"]) > .fx-fold__body`))
        .first();
      await expect(body).toBeVisible();
    },
  );
});

test(
  'with script, a fragment in a closed fold opens it and marks the page, and its summary still closes it',
  { annotation },
  async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/', { waitUntil: 'networkidle' });
    await expect(page.locator('.fx[data-fx-folds]')).toHaveCount(1);
    const id = await page.evaluate(
      () =>
        [...document.querySelectorAll<HTMLElement>('[id]')].find(
          (each) =>
            each.querySelector(':scope > details.fx-fold:not([open])') !== null ||
            each.closest('details.fx-fold:not([open]) > :not(summary)') !== null,
        )?.id ?? null,
    );
    expect(id, 'a fragment on or in a closed fold').not.toBeNull();
    await page.goto(`/#${id}`, { waitUntil: 'networkidle' });
    await expect(page.locator('.fx[data-fx-folds]')).toHaveCount(1);
    const fold = page
      .locator(`[id="${id}"] > details.fx-fold`)
      .or(page.locator(`details.fx-fold:has([id="${id}"])`))
      .first();
    await expect(fold).toHaveAttribute('open', '');
    await expect(fold.locator('> .fx-fold__body')).toBeVisible();
    // The no-script rule has stepped aside: the summary closes the fold, with the fragment still the target.
    await fold.locator('> summary').click();
    await expect(fold).not.toHaveAttribute('open', '');
    await expect(fold.locator('> .fx-fold__body')).toBeHidden();
  },
);

/** The phone dock's boxes: the tabs shown, the tools, the nav, and the name's word. */
const dock = () => {
  const box = (el: Element | null) => (el ? el.getBoundingClientRect() : null);
  const shown = (el: Element) =>
    el.getClientRects().length > 0 && getComputedStyle(el).visibility !== 'hidden';
  const tabs = [...document.querySelectorAll('.fx-bar .fx-tabs a')].filter(shown).map((a) => {
    const word = a.querySelector('.fx-tab__word')!;
    const r = box(a)!;
    return {
      tab: a.getAttribute('data-fx-tab'),
      left: r.left,
      right: r.right,
      top: r.top,
      bottom: r.bottom,
      clipped: word.scrollWidth > word.clientWidth + 1,
      shownWidth: word.clientWidth,
      letters: word.textContent!.trim().length,
      fontSize: Number.parseFloat(getComputedStyle(word).fontSize),
    };
  });
  const tools = [...document.querySelectorAll('.fx-bar__tools > *')]
    .map((each) => each.querySelector('button:not([hidden]), summary, a') ?? each)
    .filter(shown)
    .map((el) => {
      const r = box(el)!;
      return { left: r.left, right: r.right, top: r.top, bottom: r.bottom };
    });
  const nav = box(document.querySelector('.fx-bar__nav'))!;
  return { tabs, tools, nav: { left: nav.left, right: nav.right }, width: innerWidth };
};

for (const width of [320, 360, 390]) {
  test(
    `at ${width}, with the visitor's Appearance in the dock: with each destination current, no tab lies over a tool, the drop never cuts a tab, and the name shows five letters or more, or none (B1)`,
    { annotation },
    async ({ page }) => {
      await page.setViewportSize({ width, height: 800 });
      await page.goto('/', { waitUntil: 'networkidle' });
      await expect(page.locator('.fx-bar__appearance summary')).toBeVisible();
      const sheets = await page.evaluate(() =>
        [...document.querySelectorAll<HTMLElement>('.fx-sheet[data-sheet]')].map((el) => el.id),
      );
      expect(sheets.length).toBeGreaterThan(1);
      // The bar's destinations: every sheet but More, which the bar doesn't list (the Index does).
      const destinations = await page.evaluate(() =>
        [...document.querySelectorAll('.fx-bar .fx-tabs__dest a')].map((a) =>
          a.getAttribute('href'),
        ),
      );
      expect(destinations.length).toBeGreaterThan(1);
      for (const place of ['', ...sheets]) {
        await page.evaluate(
          (id) =>
            id
              ? document.getElementById(id)!.scrollIntoView({ block: 'start' })
              : window.scrollTo(0, 0),
          place,
        );
        // This place's own destination is the current one, or none at the top and on More: polled
        // for the place itself, so the last place's, before the bar catches up, never passes.
        const own = place && destinations.includes(`#${place}`) ? [`#${place}`] : [];
        await expect
          .poll(() =>
            page.evaluate(() =>
              [...document.querySelectorAll('.fx-bar .fx-tabs__dest[data-current] a')].map((a) =>
                a.getAttribute('href'),
              ),
            ),
          )
          .toEqual(own);
        const seen = await page.evaluate(dock);
        const at = `${width}, ${place || 'the top'}`;
        const reach = 4;
        for (const tab of seen.tabs) {
          for (const tool of seen.tools)
            expect(
              tab.right + reach <= tool.left || tab.left >= tool.right + reach,
              `${at}: ${tab.tab} over a tool`,
            ).toBe(true);
          expect(tab.right, `${at}: the drop cuts ${tab.tab}`).toBeLessThanOrEqual(
            seen.nav.right + 0.5,
          );
          expect(tab.right, `${at}: ${tab.tab} past the window`).toBeLessThanOrEqual(seen.width);
          if (tab.tab === 'top') {
            // An ellipsis, if any, after five letters or more (about 0.45em a letter, and the ellipsis).
            if (tab.clipped)
              expect(tab.shownWidth, `${at}: the name cut short`).toBeGreaterThanOrEqual(
                tab.fontSize * 0.45 * 6,
              );
          } else {
            expect(tab.clipped, `${at}: ${tab.tab}'s word cut`).toBe(false);
          }
        }
        // The destination being read is in the dock; the name, if it gave way, is gone whole.
        if (own.length > 0)
          expect(
            seen.tabs.some((tab) => tab.tab !== 'top'),
            at,
          ).toBe(true);
      }
    },
  );
}

for (const [width, height] of [
  [390, 844],
  [1440, 900],
] as const) {
  test(
    `at ${width}: the visitor's Appearance closes on Escape (focus back on it), on a press outside, and when focus leaves it, so nothing it covers takes focus (SF-P2-5)`,
    { annotation },
    async ({ page }) => {
      await page.setViewportSize({ width, height });
      await page.goto('/', { waitUntil: 'networkidle' });
      const details = page.locator('.fx-bar__appearance details');
      const summary = details.locator('> summary');
      const panel = details.locator('> [data-ui-slot="disclosure.content"]');
      // Escape, from inside it.
      await summary.click();
      await expect(details).toHaveAttribute('open', '');
      await panel.locator('select, input').first().focus();
      await page.keyboard.press('Escape');
      await expect(details).not.toHaveAttribute('open', '');
      await expect(summary).toBeFocused();
      // A press outside it: on the page's open ground, away from the panel and its tool.
      await summary.click();
      await expect(details).toHaveAttribute('open', '');
      const spot = await panel.evaluate((el) => {
        const r = el.getBoundingClientRect();
        for (let y = 20; y < innerHeight - 20; y += 23)
          for (let x = 20; x < innerWidth - 20; x += 37) {
            if (x >= r.left && x <= r.right && y >= r.top && y <= r.bottom) continue;
            const at = document.elementFromPoint(x, y);
            if (at && !at.closest('a, button, summary, input, select, label, details, [tabindex]'))
              return { x, y };
          }
        return null;
      });
      expect(spot).not.toBeNull();
      await page.mouse.click(spot!.x, spot!.y);
      await expect(details).not.toHaveAttribute('open', '');
      // Focus leaving it, by Tab from its last control, or Shift+Tab from its tool: it closes.
      await summary.click();
      await panel.locator('button:visible').last().focus();
      await page.keyboard.press('Tab');
      await expect(details).not.toHaveAttribute('open', '');
      expect(await panel.evaluate((el) => el.contains(document.activeElement))).toBe(false);
      await summary.click();
      await summary.focus();
      await page.keyboard.press('Shift+Tab');
      await expect(details).not.toHaveAttribute('open', '');
    },
  );
}

test(
  'at 320, with the Appearance open, Tab walks its own controls in view, none hidden, and leaving it shuts it (SF-P2-5, M2, M3)',
  { annotation },
  async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 640 });
    await page.goto('/', { waitUntil: 'networkidle' });
    const details = page.locator('.fx-bar__appearance details');
    const summary = details.locator('> summary');
    await summary.click();
    await summary.focus();
    const walked: string[] = [];
    let left = false;
    for (let stop = 0; stop < 20 && !left; stop++) {
      await page.keyboard.press('Tab');
      const at = await page.evaluate(() => {
        const d = document.querySelector<HTMLDetailsElement>('.fx-bar__appearance details')!;
        const box = d.querySelector('[data-ui-slot="disclosure.content"]')!;
        const a = document.activeElement as HTMLElement | null;
        if (!a || !box.contains(a)) return { inside: false, open: d.open, name: '', shown: false };
        const r = a.getBoundingClientRect();
        const inView =
          r.top >= 0 && r.bottom <= innerHeight && r.left >= 0 && r.right <= innerWidth;
        const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
        const own = hit !== null && (hit === a || a.contains(hit) || hit.contains(a));
        return {
          inside: true,
          open: d.open,
          name: `${a.tagName.toLowerCase()} ${(a.getAttribute('aria-label') ?? a.textContent ?? '').trim().slice(0, 24)}`,
          shown: inView && own,
        };
      });
      if (!at.inside) {
        // Focus has left it, and it shut.
        expect(at.open).toBe(false);
        left = true;
      } else {
        walked.push(at.name);
        expect(at.shown, `${at.name}: hidden or off the window`).toBe(true);
      }
    }
    expect(left).toBe(true);
    expect(walked.length).toBeGreaterThan(1);
  },
);

test(
  'a control a save disables drops focus to nowhere, and the Appearance stays open',
  { annotation },
  async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/', { waitUntil: 'networkidle' });
    const details = page.locator('.fx-bar__appearance details');
    await details.locator('> summary').click();
    const control = details.locator('[data-ui-slot="disclosure.content"] select').first();
    await control.focus();
    await control.evaluate((el) => ((el as HTMLSelectElement).disabled = true));
    await page.waitForTimeout(200);
    await expect(details).toHaveAttribute('open', '');
  },
);

test(
  'in print the whole record prints: every sheet and fold, every field on screen, and the bar in ink (q2 print)',
  { annotation },
  async ({ page }) => {
    await page.goto('/', { waitUntil: 'networkidle' });
    await expect(page.locator('.fx[data-fx-live]')).toHaveCount(1);
    // The harness's own inventory (the quality print row's): every field on screen, then in print.
    const screen = await inPage<string[]>(page, { kind: 'inventory' });
    await page.emulateMedia({ media: 'print' });
    const printed = new Set(await inPage<string[]>(page, { kind: 'inventory' }));
    const gone = screen.filter(
      (item) => !printed.has(item) && !/^(?:control|button label): /.test(item),
    );
    expect(gone).toEqual([]);
    // Every sheet, and every fold's body, is on the paper.
    const hidden = await page.evaluate(() => [
      ...[...document.querySelectorAll('.fx-sheet')]
        .filter((el) => getComputedStyle(el).display === 'none')
        .map((el) => `sheet ${el.id}`),
      ...[...document.querySelectorAll('details.fx-fold > :not(summary)')]
        .filter((el) => getComputedStyle(el).display === 'none' || !el.getClientRects().length)
        .map(
          (el) => `fold ${el.closest('details')?.querySelector('summary')?.textContent?.trim()}`,
        ),
    ]);
    expect(hidden).toEqual([]);
    // Every word in the bar prints as ink, with no fill: none is the canvas colour on paper.
    const words = await page.evaluate(() => {
      const probe = document.createElement('span');
      probe.style.color = 'var(--color-text-primary)';
      document.querySelector('.fx')!.append(probe);
      const ink = getComputedStyle(probe).color;
      probe.remove();
      return [...document.querySelectorAll<HTMLElement>('.fx-tabs .fx-tab')].map((tab) => ({
        word: tab.textContent?.trim(),
        ok:
          getComputedStyle(tab.querySelector('.fx-tab__word') ?? tab).color === ink &&
          getComputedStyle(tab).backgroundColor === 'rgba(0, 0, 0, 0)',
      }));
    });
    expect(words.length).toBeGreaterThan(1);
    for (const word of words) expect(word.ok, `${word.word} prints as ink`).toBe(true);
  },
);

test(
  "in print the Index is the contents list near the top: its heading and every section title, none of the dialog chrome, the bar's plain Index link (q2 print, the lead)",
  { annotation },
  async ({ page }) => {
    await page.goto('/', { waitUntil: 'networkidle' });
    await expect(page.locator('.fx[data-fx-live]')).toHaveCount(1);
    await page.emulateMedia({ media: 'print' });
    const paper = await page.evaluate(() => {
      const shown = (el: Element | null) =>
        Boolean(el) && getComputedStyle(el!).display !== 'none' && el!.getClientRects().length > 0;
      const text = (el: Element) => (el.textContent ?? '').replace(/\s+/g, ' ').trim();
      const index = document.querySelector('.fx-index')!;
      const titles = [...index.querySelectorAll('.fx-index__sections li')];
      // Where each starts on the paper: from the document's top, the page scrolled to its top.
      scrollTo(0, 0);
      const top = (selector: string) =>
        document.querySelector(selector)!.getBoundingClientRect().top + scrollY;
      return {
        heading: shown(index.querySelector('.fx-index__title'))
          ? text(index.querySelector('.fx-index__title')!)
          : null,
        titles: [...new Set(titles.map(text))],
        unprinted: titles.filter((li) => !shown(li)).map(text),
        chrome: [
          '.fx-index__close',
          '[data-fx-open-index]',
          '.fx-pause',
          '.fx-bar__appearance',
        ].filter((selector) => [...document.querySelectorAll(selector)].some(shown)),
        // The bar's plain Index link, which prints: a link to the contents list.
        opener: [...document.querySelectorAll<HTMLAnchorElement>('.fx-bar a.fx-tool--plain')]
          .filter(shown)
          .map((a) => `${a.getAttribute('href')} ${a.getAttribute('aria-label') ?? text(a)}`),
        order: [top('.fx-bar'), top('.fx-index'), top('.fx-main')],
      };
    });
    expect(paper.heading).toBe('Index');
    // Every section title the Index lists prints, each one in the harness's own print inventory: 30
    // on the complete fixture, 28 of them the Index's alone (the q2 cell's 28; the other two are
    // the page's text too).
    expect(paper.titles).toHaveLength(30);
    expect(paper.unprinted).toEqual([]);
    const printed = new Set(await inPage<string[]>(page, { kind: 'inventory' }));
    expect(paper.titles.filter((title) => !printed.has(`text: ${title}`))).toEqual([]);
    expect(printed.has('heading: Index')).toBe(true);
    // None of the dialog's chrome, nor the bar's live button, Pause or Appearance.
    expect(paper.chrome).toEqual([]);
    // The bar's plain Index link prints, pointing at the contents list just below.
    expect(paper.opener).toEqual([`#${await page.locator('.fx-index').getAttribute('id')} Index`]);
    expect(printed.has(`link: #${await page.locator('.fx-index').getAttribute('id')} Index`)).toBe(
      true,
    );
    // Near the top: after the bar, before the page.
    const [bar, index, main] = paper.order;
    expect(bar).toBeLessThan(index!);
    expect(index).toBeLessThan(main!);
  },
);
