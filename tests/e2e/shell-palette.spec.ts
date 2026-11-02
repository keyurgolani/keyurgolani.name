import { readFileSync } from 'node:fs';
import path from 'node:path';
import type { Locator, Page } from '@playwright/test';
import { fixtureSiteSelecting } from '../../packages/variant-contract/src/contract-fixtures';
import { contractFixture } from '../../packages/variant-contract/src/node/fixtures';
import { expect, test } from '../harness/fixtures';

// Shell's palette and index in a browser (variants-10 brief §5.6, step 9),
// on the complete fixture, under read-only:
// - the jump button opens a modal dialog with an APG combobox: focus in the
//   field, a listbox of options grouped as role=group with aria-labelledby,
//   each named by its plain title, aria-activedescendant moving with the
//   arrows, a polite count, Enter jumping, Esc closing with focus back;
// - mod+k and / open it through the host's document binding (K-4 (d)), and
//   neither fires in the field itself;
// - without a script the index is a nav of real links and jump is one of
//   them;
// - the docked pane collapses to the current directory with the spy, and
//   nothing runs a frame loop at rest;
// - a full-width listing row's content spans most of its width (no dead space).

const FIXTURE = contractFixture('complete');
const DIR = path.dirname(FIXTURE.files.portfolio);
const annotation = [
  { type: 'route', description: '/' },
  { type: 'profile', description: 'read-only' },
];
const tag = '@interaction';
const innerHeightOf = (size: { height: number } | null) => size?.height ?? 0;

test.use({
  appOptions: {
    portfolio: FIXTURE.files.portfolio,
    siteText: fixtureSiteSelecting(readFileSync(FIXTURE.files.site, 'utf8'), 'shell'),
    sourceFiles: Object.fromEntries(
      FIXTURE.unitFiles.map((file) => [file, readFileSync(path.join(DIR, file), 'utf8')]),
    ),
  },
  viewport: { width: 1440, height: 900 },
});

async function load(page: Page): Promise<void> {
  await page.goto('/', { waitUntil: 'networkidle' });
  await expect(page.locator('[data-variant]')).toHaveAttribute('data-variant', 'shell');
  await expect(page.locator('[data-sh-enhanced]')).toHaveCount(1);
}

const dialog = (page: Page) => page.locator('dialog.sh-dlg');
const field = (page: Page) => dialog(page).getByRole('combobox');

/**
 * A jump lands at the target's head: its top where its scroll margin puts it (or as near as
 * the page's end lets it), not merely a pixel of it in view.
 */
async function expectAtHead(page: Page, target: Locator): Promise<void> {
  await expect
    .poll(() =>
      target.evaluate((el) => {
        const top = el.getBoundingClientRect().top;
        const margin = parseFloat(getComputedStyle(el).scrollMarginBlockStart) || 0;
        const end = scrollY >= document.documentElement.scrollHeight - innerHeight - 1;
        return top >= -1 && (top <= margin + 2 || end);
      }),
    )
    .toBe(true);
}

/** The status line's top edge. */
const barTop = (page: Page) =>
  page.locator('[data-sh-tmux]').evaluate((el) => el.getBoundingClientRect().top);

test(
  'the jump button opens the palette, an APG combobox over grouped options',
  { annotation, tag },
  async ({ page }) => {
    await load(page);
    const jump = page.locator('[data-sh-jump]');
    await expect(jump).toBeVisible();
    await expect(page.locator('[data-sh-jump-link]')).toBeHidden();
    await jump.focus();
    await page.keyboard.press('Enter');
    await expect(dialog(page)).toHaveJSProperty('open', true);
    await expect(field(page)).toBeFocused();
    await expect(field(page)).toHaveAttribute('aria-expanded', 'true');
    const listbox = dialog(page).getByRole('listbox');
    await expect(field(page)).toHaveAttribute('aria-controls', (await listbox.getAttribute('id'))!);
    // Groups are role=group, each labelled by its visible head.
    const groups = await listbox
      .locator('[role="group"]')
      .evaluateAll((all) =>
        all.map(
          (group) => document.getElementById(group.getAttribute('aria-labelledby')!)?.textContent,
        ),
      );
    expect(groups.length).toBeGreaterThan(0);
    expect(groups).toContain('Sections');
    // Every option has its plain title as its name.
    const unnamed = await listbox
      .getByRole('option')
      .evaluateAll((all) => all.filter((option) => !option.getAttribute('aria-label')).length);
    expect(unnamed).toBe(0);
    // The arrows move the active option, which the field names.
    const first = await field(page).getAttribute('aria-activedescendant');
    await page.keyboard.press('ArrowDown');
    const second = await field(page).getAttribute('aria-activedescendant');
    expect(second).not.toBe(first);
    await expect(page.locator(`#${second}`)).toHaveAttribute('aria-selected', 'true');
    // A query narrows the list, and the count says how many, politely.
    await page.keyboard.type('zzzzqqqq');
    await expect(dialog(page).locator('[aria-live="polite"]')).toHaveText('0 matches');
    // Esc closes and gives focus back to the button.
    await page.keyboard.press('Escape');
    await expect(dialog(page)).toHaveJSProperty('open', false);
    await expect(jump).toBeFocused();
  },
);

for (const opener of ['[data-sh-jump]', '[data-sh-open]']) {
  test(
    `Enter on an option lands focus in its section, from ${opener}, and the page stays there`,
    { annotation, tag },
    async ({ page }) => {
      await load(page);
      await page.locator(opener).click();
      await page.keyboard.press('ArrowDown');
      await page.keyboard.press('ArrowDown');
      await page.keyboard.press('ArrowDown');
      await page.keyboard.press('Enter');
      await expect(dialog(page)).toHaveJSProperty('open', false);
      const hash = await page.evaluate(() => location.hash.slice(1));
      expect(hash).not.toBe('');
      const landed = page.locator(`[id="${hash}"]`);
      await expectAtHead(page, landed);
      // Focus is in the target, not back on the opener, and nothing scrolls it away.
      expect(await landed.evaluate((el) => el.contains(document.activeElement))).toBe(true);
      const at = await page.evaluate(() => scrollY);
      await page.waitForTimeout(400);
      expect(await page.evaluate(() => scrollY)).toBe(at);
      // A second jump to the same place still lands there.
      await page.evaluate(() => scrollTo(0, 0));
      await page.locator('[data-sh-jump]').click();
      await page.keyboard.press('ArrowDown');
      await page.keyboard.press('ArrowDown');
      await page.keyboard.press('ArrowDown');
      await page.keyboard.press('Enter');
      await expectAtHead(page, landed);
    },
  );
}

test(
  'a jump to a section taller than the window lands at its heading, not its tail',
  { annotation, tag },
  async ({ page }) => {
    // A phone, where most sections are taller than the window.
    await page.setViewportSize({ width: 390, height: 700 });
    await load(page);
    const tall = await page.evaluate(() => {
      const room =
        innerHeight - document.querySelector('[data-sh-tmux]')!.getBoundingClientRect().height;
      const block = [...document.querySelectorAll<HTMLElement>('.sh-block')].find(
        (each) =>
          each.getBoundingClientRect().height > room &&
          document.querySelector(`.sh-row[data-sh-target="${each.id}"]`),
      );
      return block
        ? {
            id: block.id,
            title: document
              .querySelector(`.sh-row[data-sh-target="${block.id}"] .sh-row__ttl`)!
              .textContent!.trim(),
          }
        : null;
    });
    expect(tall, 'the fixture has a section taller than the window').not.toBeNull();
    await page.locator('[data-sh-jump]').click();
    await page.keyboard.type(tall!.title);
    await expect(dialog(page).locator('[role="option"][aria-selected="true"]')).toHaveAttribute(
      'aria-label',
      tall!.title,
    );
    await page.keyboard.press('Enter');
    await expect(dialog(page)).toHaveJSProperty('open', false);
    await expectAtHead(page, page.locator(`[id="${tall!.id}"]`));
  },
);

test(
  'a click on transcript text moves nothing, and the skip link lands at the page head',
  { annotation, tag },
  async ({ page }) => {
    await load(page);
    // A paragraph well down the transcript: its click focuses main, which is taller than the window.
    const text = page.locator('main .sh-prose:visible').nth(1);
    await text.scrollIntoViewIfNeeded();
    const at = await page.evaluate(() => scrollY);
    await text.click({ position: { x: 4, y: 4 } });
    await page.waitForTimeout(200);
    expect(await page.evaluate(() => scrollY)).toBe(at);
    // The skip link: the first stop on a fresh page, and Enter lands on main, its head in view.
    await load(page);
    await page.keyboard.press('Tab');
    await expect(page.locator(':focus')).toHaveAttribute('data-ui-slot', 'skip-link');
    await page.keyboard.press('Enter');
    await expect(page.locator('main')).toBeFocused();
    await page.waitForTimeout(200);
    const head = await page.locator('main h1').evaluate((el) => el.getBoundingClientRect().top);
    expect(head).toBeGreaterThanOrEqual(0);
    expect(head).toBeLessThan(innerHeightOf(await page.viewportSize()));
  },
);

test.describe('at 1024', () => {
  test.use({ viewport: { width: 1024, height: 768 } });
  test(
    'a link Tab reaches under the status line comes out above it, its ring clear',
    { annotation, tag },
    async ({ page }) => {
      await load(page);
      // A link in the transcript, set just under the bar's top edge, and the stop before it.
      const ids = await page.evaluate(() => {
        // Every stop in the transcript that shows, a row's fold summary among them, so the
        // stop before the link is the one Tab leaves.
        const stops = [
          ...document.querySelectorAll<HTMLElement>('main a[href], main summary'),
        ].filter((a) => a.getBoundingClientRect().height > 0);
        const at = stops.findIndex(
          (a, i) => i > 0 && a.matches('a') && a.getBoundingClientRect().top > innerHeight,
        );
        stops[at - 1]!.dataset.testBefore = '';
        stops[at]!.dataset.testUnder = '';
        return at;
      });
      expect(ids).toBeGreaterThan(0);
      const under = page.locator('[data-test-under]');
      const edge = await barTop(page);
      await under.evaluate((el, edge) => {
        scrollBy({ top: el.getBoundingClientRect().top - edge + 4, behavior: 'instant' });
      }, edge);
      await page
        .locator('[data-test-before]')
        .evaluate((el) => (el as HTMLElement).focus({ preventScroll: true }));
      await page.keyboard.press('Tab');
      await expect(under).toBeFocused();
      const box = await under.evaluate((el) => {
        const r = el.getBoundingClientRect();
        const s = getComputedStyle(el);
        const ring = parseFloat(s.outlineWidth) + Math.max(0, parseFloat(s.outlineOffset));
        return { bottom: r.bottom, ring, row: parseFloat(s.scrollMarginBlockStart) || 0 };
      });
      const top = await barTop(page);
      expect(box.bottom + box.ring).toBeLessThanOrEqual(top);
      // Exactly a row above the bar, where the enhancement puts it. The browser's own focus
      // scroll, with the link's scroll margin, centres it instead, so this tells them apart.
      expect(Math.abs(box.bottom - (top - box.row))).toBeLessThan(1);
    },
  );
});

test.describe('at 1024, a row fold', () => {
  test.use({ viewport: { width: 1024, height: 768 } });
  test(
    "a row fold's summary Tab reaches under the status line comes out above it, its ring clear",
    { annotation, tag },
    async ({ page }) => {
      await load(page);
      // The page's last row-fold summary a visitor reaches: shown, and in no closed fold.
      const found = await page.evaluate(() => {
        const summaries = [...document.querySelectorAll<HTMLElement>('.sh-more__sum')].filter(
          (el) =>
            el.getClientRects().length > 0 &&
            el.checkVisibility() &&
            !el.parentElement?.parentElement?.closest('details:not([open])'),
        );
        const target = summaries[summaries.length - 1];
        if (!target) return false;
        target.dataset.testUnder = '';
        return true;
      });
      expect(found).toBe(true);
      const under = page.locator('[data-test-under]');
      // The stop before it is the Tab order's own: the summary focused, then one step back.
      await under.evaluate((el) => (el as HTMLElement).focus({ preventScroll: true }));
      await page.keyboard.press('Shift+Tab');
      await page.evaluate(() => {
        (document.activeElement as HTMLElement).dataset.testBefore = '';
      });
      const edge = await barTop(page);
      await under.evaluate((el, edge) => {
        scrollBy({ top: el.getBoundingClientRect().top - edge + 4, behavior: 'instant' });
      }, edge);
      await expect(page.locator('[data-test-before]')).toBeFocused();
      await page.keyboard.press('Tab');
      await expect(under).toBeFocused();
      // The enhancement lifts it a row above the bar, its ring clear.
      const clear = () =>
        under.evaluate((el) => {
          const s = getComputedStyle(el);
          const ring = parseFloat(s.outlineWidth) + Math.max(0, parseFloat(s.outlineOffset));
          const bar = document.querySelector('[data-sh-tmux]')!.getBoundingClientRect().top;
          return el.getBoundingClientRect().bottom + ring <= bar + 0.5;
        });
      await expect.poll(clear).toBe(true);
    },
  );

  test('Enter and Space open and close a row fold', { annotation, tag }, async ({ page }) => {
    await load(page);
    // The first row fold a visitor reaches: in no closed fold.
    await page.evaluate(() => {
      const fold = [...document.querySelectorAll<HTMLElement>('details.sh-more')].find(
        (el) => el.checkVisibility() && !el.parentElement?.closest('details:not([open])'),
      );
      fold?.setAttribute('data-test-fold', '');
    });
    const fold = page.locator('[data-test-fold]');
    await expect(fold).toHaveCount(1);
    const summary = fold.locator(':scope > summary');
    await summary.focus();
    await expect(summary).toBeFocused();
    await expect(fold).not.toHaveAttribute('open', '');
    await page.keyboard.press('Enter');
    await expect(fold).toHaveAttribute('open', '');
    await page.keyboard.press('Enter');
    await expect(fold).not.toHaveAttribute('open', '');
    await page.keyboard.press('Space');
    await expect(fold).toHaveAttribute('open', '');
    await page.keyboard.press('Space');
    await expect(fold).not.toHaveAttribute('open', '');
  });
});

test(
  'mod+k and / open the palette, and / typed in the field stays text',
  { annotation, tag },
  async ({ page }) => {
    await load(page);
    const at = await page.evaluate(() => scrollY);
    await page.locator('main').click({ position: { x: 10, y: 10 } });
    // Focusing main by a click moves nothing.
    expect(await page.evaluate(() => scrollY)).toBe(at);
    await page.keyboard.press('ControlOrMeta+k');
    await expect(dialog(page)).toHaveJSProperty('open', true);
    await page.keyboard.type('a/b');
    await expect(field(page)).toHaveValue('a/b');
    await page.keyboard.press('Escape');
    await expect(dialog(page)).toHaveJSProperty('open', false);
    await page.keyboard.press('/');
    await expect(dialog(page)).toHaveJSProperty('open', true);
  },
);

test(
  'the docked pane collapses to the current directory, and nothing loops at rest',
  { annotation, tag },
  async ({ page }) => {
    await load(page);
    const pane = page.locator('.sh-pane');
    await expect(pane).toHaveAttribute('data-sh-spy', '');
    expect(await pane.evaluate((el) => getComputedStyle(el).position)).toBe('sticky');
    const open = await pane
      .locator('.sh-grp')
      .evaluateAll(
        (groups) =>
          groups.filter((group) => group.querySelector('ul')!.getBoundingClientRect().height > 0)
            .length,
      );
    expect(open).toBe(1);
    // A folded directory's rows are closed, not removed: Tab unfolds the index on reaching one.
    await pane.locator('.sh-grp:not([data-current]) .sh-row').first().focus();
    await page.keyboard.press('Shift+Tab');
    await page.keyboard.press('Tab');
    const unfolded = await pane
      .locator('.sh-grp')
      .evaluateAll(
        (groups) =>
          groups.filter((group) => group.querySelector('ul')!.getBoundingClientRect().height > 0)
            .length,
      );
    expect(unfolded).toBe(await pane.locator('.sh-grp').count());
    await expect(page.locator(':focus')).toBeInViewport();
    await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
    const openGroups = () =>
      pane
        .locator('.sh-grp')
        .evaluateAll(
          (groups) =>
            groups.filter((group) => group.querySelector('ul')!.getBoundingClientRect().height > 0)
              .length,
        );
    await expect.poll(openGroups).toBe(1);
    // A click on the open button opens the palette and leaves the index folded; the button
    // sits at the pane's foot either way.
    const opener = pane.locator('[data-sh-open]');
    const foot = (await opener.boundingBox())!.y;
    await opener.click();
    await expect(dialog(page)).toHaveJSProperty('open', true);
    expect(await openGroups()).toBe(1);
    await page.keyboard.press('Escape');
    await expect(dialog(page)).toHaveJSProperty('open', false);
    // Shift+Tab from the button reaches the index's last row, folded or not: it unfolds, the
    // row inside the list's scrollport, and the button hasn't moved.
    await page.keyboard.press('Shift+Tab');
    const last = pane.locator('.sh-row').last();
    await expect(last).toBeFocused();
    await expect.poll(openGroups).toBe(await pane.locator('.sh-grp').count());
    const inside = await last.evaluate((el) => {
      const r = el.getBoundingClientRect();
      const port = el.closest('.sh-pane__list')!.getBoundingClientRect();
      return r.top >= port.top - 0.5 && r.bottom <= port.bottom + 0.5;
    });
    expect(inside).toBe(true);
    expect((await opener.boundingBox())!.y).toBeCloseTo(foot, 0);
    await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
    const frames = await page.evaluate(
      () =>
        new Promise<number>((resolve) => {
          let n = 0;
          const original = window.requestAnimationFrame;
          window.requestAnimationFrame = (callback) => {
            n += 1;
            return original(callback);
          };
          setTimeout(() => {
            window.requestAnimationFrame = original;
            resolve(n);
          }, 2000);
        }),
    );
    expect(frames).toBe(0);
    const infinite = await page.evaluate(
      () =>
        document
          .getAnimations()
          .filter((a) => a.effect?.getComputedTiming().iterations === Infinity).length,
    );
    expect(infinite).toBe(0);
  },
);

test(
  'a row a pointer pressed stays folded away when the reading moves on into another directory',
  { annotation, tag },
  async ({ page }) => {
    await load(page);
    const pane = page.locator('.sh-pane');
    expect(await pane.evaluate((el) => getComputedStyle(el).position)).toBe('sticky');
    const openGroups = () =>
      pane
        .locator('.sh-grp')
        .evaluateAll(
          (groups) =>
            groups.filter((group) => group.querySelector('ul')!.getBoundingClientRect().height > 0)
              .length,
        );
    expect(await openGroups()).toBe(1);
    // A row in the open directory, pressed and not released: the press focuses it. (A whole
    // click navigates to the row's section, and Chromium then clears focus, as the section
    // isn't focusable; Firefox keeps it on the row. A held press is the focus both leave.)
    const groups = pane.locator('.sh-grp');
    const at = await groups.evaluateAll((all) =>
      all.findIndex((g) => g.hasAttribute('data-current')),
    );
    expect(at).toBeGreaterThanOrEqual(0);
    expect(at).toBeLessThan((await groups.count()) - 1);
    const group = groups.nth(at);
    const row = group.locator('a.sh-row').first();
    const box = (await row.boundingBox())!;
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await expect(row).toBeFocused();
    expect(await row.evaluate((el) => el.matches(':focus-visible'))).toBe(false);
    expect(await openGroups()).toBe(1);
    // The reading moves on to the last directory's first section, the row still focused.
    const target = await groups.last().locator('a.sh-row').first().getAttribute('data-sh-target');
    await page.locator(`[id="${target}"]`).evaluate((el) => {
      scrollTo({ top: scrollY + el.getBoundingClientRect().top, behavior: 'instant' });
    });
    await expect(groups.last()).toHaveAttribute('data-current', '');
    await expect(row).toBeFocused();
    await expect(group).not.toHaveAttribute('data-current', '');
    expect(await openGroups()).toBe(1);
    await page.waitForTimeout(200);
    expect(await openGroups()).toBe(1);
  },
);

test(
  'a keyboard user who unfolded the index and then presses a row near its foot clicks that row',
  { annotation, tag },
  async ({ page }) => {
    // A short window, so the unfolded index scrolls in its list.
    await page.setViewportSize({ width: 1440, height: 600 });
    await load(page);
    const pane = page.locator('.sh-pane');
    expect(await pane.evaluate((el) => getComputedStyle(el).position)).toBe('sticky');
    // The keyboard on a row: the index unfolds whole.
    await pane.locator('.sh-row').first().focus();
    await page.keyboard.press('Tab');
    const list = pane.locator('.sh-pane__list');
    const scrollable = await list.evaluate((el) => el.scrollHeight > el.clientHeight + 1);
    expect(scrollable, 'the unfolded index scrolls').toBe(true);
    // The last row wholly in the list's scrollport, in a directory that isn't current.
    const id = await list.evaluate((el) => {
      const port = el.getBoundingClientRect();
      const rows = [
        ...el.querySelectorAll<HTMLElement>('.sh-grp:not([data-current]) .sh-row'),
      ].filter((row) => {
        const r = row.getBoundingClientRect();
        return r.height > 0 && r.top >= port.top && r.bottom <= port.bottom;
      });
      const row = rows[rows.length - 1];
      row?.setAttribute('data-test-press', '');
      return row?.getAttribute('href') ?? null;
    });
    expect(id).not.toBeNull();
    const row = pane.locator('[data-test-press]');
    const at = await list.evaluate((el) => el.scrollTop);
    const page0 = await page.evaluate(() => scrollY);
    const box = (await row.boundingBox())!;
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await expect(row).toBeFocused();
    expect(await list.evaluate((el) => el.scrollTop)).toBe(at);
    expect(await page.evaluate(() => scrollY)).toBe(page0);
    await page.mouse.up();
    await expect(page).toHaveURL(new RegExp(`${id}$`));
  },
);

test(
  'a listing row spans most of its width: no dead space',
  { annotation, tag },
  async ({ page }) => {
    await load(page);
    const shares = await page.locator('.sh-ent').evaluateAll((rows) =>
      rows.map((row) => {
        const box = row.getBoundingClientRect();
        const rects: DOMRect[] = [];
        const walker = document.createTreeWalker(row, NodeFilter.SHOW_TEXT);
        for (let node = walker.nextNode(); node; node = walker.nextNode()) {
          if (!node.textContent?.trim()) continue;
          const range = document.createRange();
          range.selectNodeContents(node);
          rects.push(...[...range.getClientRects()].filter((r) => r.width > 0));
        }
        for (const media of row.querySelectorAll('img')) rects.push(media.getBoundingClientRect());
        const span = Math.max(...rects.map((r) => r.right)) - Math.min(...rects.map((r) => r.left));
        return span / box.width;
      }),
    );
    expect(shares.length).toBeGreaterThan(0);
    for (const share of shares) expect(share).toBeGreaterThanOrEqual(0.7);
  },
);

test.describe('without a script', () => {
  test.use({ javaScriptEnabled: false });

  test(
    'the index is a nav of real links, and jump is a link to it',
    { annotation, tag },
    async ({ page }) => {
      await page.goto('/', { waitUntil: 'load' });
      const pane = page.locator('nav.sh-pane');
      await expect(pane).toBeVisible();
      const links = pane.locator('a.sh-row');
      expect(await links.count()).toBeGreaterThan(5);
      const jump = page.locator('[data-sh-jump-link]');
      await expect(jump).toBeVisible();
      await expect(jump).toHaveAttribute('href', `#${await pane.getAttribute('id')}`);
      await expect(page.locator('[data-sh-jump]')).toBeHidden();
      // Every pane link lands on a section that's there.
      const missing = await links.evaluateAll((all) =>
        all
          .map((a) => decodeURIComponent(a.getAttribute('href')!.slice(1)))
          .filter((id) => !document.getElementById(id)),
      );
      expect(missing).toEqual([]);
    },
  );

  test(
    'on a phone the in-flow index is there, jump links to it, and contact is two taps away',
    { annotation, tag },
    async ({ page }) => {
      await page.setViewportSize({ width: 390, height: 844 });
      await page.goto('/', { waitUntil: 'load' });
      await expect(page.locator('nav.sh-pane')).toBeVisible();
      await page.locator('[data-sh-jump-link]').click();
      const contact = await page.locator('.sh-tmux__win[data-dest="contact"]').getAttribute('href');
      const row = page.locator(`nav.sh-pane a.sh-row[href="${contact}"]`).first();
      await expect(row).toBeVisible();
    },
  );

  test(
    'a fold opens from a fragment into it, toggles on a press, and prints open',
    { annotation, tag },
    async ({ page }) => {
      await page.goto('/', { waitUntil: 'load' });
      const id = await page.locator('details[data-sh-fold] > section').first().getAttribute('id');
      expect(id).toBeTruthy();
      const fold = page
        .locator('details[data-sh-fold]')
        .filter({ has: page.locator(`[id="${id}"]`) });
      await expect(fold).not.toHaveAttribute('open', '');
      // A press on its summary opens and closes it.
      await fold.locator('summary').click();
      await expect(fold).toHaveAttribute('open', '');
      await fold.locator('summary').click();
      await expect(fold).not.toHaveAttribute('open', '');
      // The fragment into it: the browser opens it and lands there.
      await page.goto(`/#${id}`, { waitUntil: 'load' });
      await expect(fold).toHaveAttribute('open', '');
      await expect(page.locator(`[id="${id}"]`)).toBeInViewport();
      // In print, a closed fold's content shows.
      await page.goto('/', { waitUntil: 'load' });
      await page.emulateMedia({ media: 'print' });
      const shown = await page
        .locator('details[data-sh-fold] > section')
        .evaluateAll((all) => all.filter((el) => el.getBoundingClientRect().height === 0).length);
      expect(shown).toBe(0);
    },
  );
});

test(
  'with the script, on a phone, the palette is the index: no in-flow copy',
  { annotation, tag },
  async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await load(page);
    await expect(page.locator('nav.sh-pane')).toBeHidden();
    await expect(page.locator('[data-sh-jump]')).toBeVisible();
  },
);

test.describe('on a touch phone', () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });

  test(
    'contact is two taps: jump, then its destination at the head of the list, the keyboard not raised',
    { annotation, tag },
    async ({ page }) => {
      await load(page);
      const contact = await page.locator('.sh-tmux__win[data-dest="contact"]').getAttribute('href');
      expect(contact).toBeTruthy();
      await page.locator('[data-sh-jump]').tap();
      await expect(dialog(page)).toHaveJSProperty('open', true);
      // The field waits for a tap, so no keyboard covers the list.
      await expect(field(page)).not.toBeFocused();
      // The destinations lead the list, in view without a scroll.
      const groups = dialog(page).locator('[role="group"]');
      await expect(groups.first().locator('.sh-dlg__g')).toHaveText('Destinations');
      const option = dialog(page).locator(`[role="option"][data-href="${contact}"]`).first();
      await expect(option).toBeInViewport({ ratio: 1 });
      await option.tap();
      await expect(dialog(page)).toHaveJSProperty('open', false);
      await expect(page).toHaveURL(new RegExp(`${contact}$`));
      await expect(page.locator(`[id="${contact!.slice(1)}"]`)).toBeInViewport();
    },
  );
});

test(
  'a fragment, a palette jump and an index row into a folded part each open it',
  { annotation, tag },
  async ({ page }) => {
    await load(page);
    const ids = await page
      .locator('details[data-sh-fold] > section')
      .evaluateAll((all) => all.map((el) => el.id));
    expect(ids.length).toBeGreaterThanOrEqual(3);
    const foldOf = (id: string) =>
      page.locator('details[data-sh-fold]').filter({ has: page.locator(`[id="${id}"]`) });
    for (const id of ids) await expect(foldOf(id)).not.toHaveAttribute('open', '');
    // An index row (docked at 1440). A directory the reading isn't in is folded in the index,
    // its rows closed to the pointer, so the reading first moves to the fold itself: its
    // summary is what's read there, so the spy makes its directory current, and the index
    // opens it. The fold is found by data (the section with that id inside a fold).
    const row = page.locator(`.sh-pane a.sh-row[data-sh-target="${ids[0]}"]`);
    // The directory by the row it holds: `has` is matched inside each directory, so its
    // locator names the row alone, never the pane round it (combo r9: with `.sh-pane` in it,
    // it matched no directory, and every read of it waited out its timeout).
    const group = page
      .locator('.sh-pane .sh-grp')
      .filter({ has: page.locator(`a.sh-row[data-sh-target="${ids[0]}"]`) });
    await expect(group).toHaveCount(1);
    await foldOf(ids[0]!).evaluate((el) =>
      el.scrollIntoView({ block: 'start', behavior: 'instant' }),
    );
    await expect
      .poll(() => group.evaluate((el) => el.hasAttribute('data-current')), {
        message: `the directory holding #${ids[0]} becomes current once its fold is read`,
        timeout: 5000,
      })
      .toBe(true);
    await expect(row).toBeVisible();
    await row.click();
    await expect(foldOf(ids[0]!)).toHaveAttribute('open', '');
    await expect(page.locator(`[id="${ids[0]}"]`)).toBeInViewport();
    // A palette jump, by its title, lands focus in it.
    const title = await page
      .locator(`.sh-pane a.sh-row[data-sh-target="${ids[1]}"] .sh-row__ttl`)
      .textContent();
    await page.locator('[data-sh-jump]').click();
    await page.keyboard.type(title!.trim());
    await expect(dialog(page).locator('[role="option"][aria-selected="true"]')).toHaveAttribute(
      'data-href',
      `#${ids[1]}`,
    );
    await page.keyboard.press('Enter');
    await expect(foldOf(ids[1]!)).toHaveAttribute('open', '');
    expect(
      await page.locator(`[id="${ids[1]}"]`).evaluate((el) => el.contains(document.activeElement)),
    ).toBe(true);
    // A fragment on arrival.
    await page.goto(`/#${ids[2]}`, { waitUntil: 'networkidle' });
    await expect(page.locator('[data-sh-enhanced]')).toHaveCount(1);
    await expect(foldOf(ids[2]!)).toHaveAttribute('open', '');
    await expect(page.locator(`[id="${ids[2]}"]`)).toBeInViewport();
  },
);

test(
  'a custom section sits in the shell frame, cat <id> printing its own content',
  { annotation, tag },
  async ({ page }) => {
    await load(page);
    const custom = page.locator('section[data-kind="custom"]').first();
    await expect(custom).toHaveAttribute('data-renderer', 'bespoke');
    await expect(custom).toHaveClass(/sh-block/);
    await expect(custom.locator('.sh-cmd')).toHaveAttribute('aria-hidden', 'true');
    await custom.scrollIntoViewIfNeeded();
    // The round's shot of it, when the lane's run asks for one.
    const out = process.env.SHELL_SHOTS;
    if (out) await custom.screenshot({ path: `${out}/state-1440-custom-kind.png` });
  },
);

test(
  "a pointer's press on a docked row scrolls nothing, so the click opens that row; the keyboard's focus still brings its row into the list",
  { annotation, tag },
  async ({ page }) => {
    await load(page);
    const pane = page.locator('.sh-pane');
    expect(await pane.evaluate((el) => getComputedStyle(el).position)).toBe('sticky');
    // Every row is in a scrollable docked list, each with the bar's scroll margin, so any
    // scroll a press starts can move the row out from under the pointer.
    await page.evaluate(() => {
      const w = window as unknown as { shScrolls: number };
      w.shScrolls = 0;
      const original = Element.prototype.scrollIntoView;
      Element.prototype.scrollIntoView = function (
        this: Element,
        arg?: boolean | ScrollIntoViewOptions,
      ) {
        if (this.closest('.sh-pane')) w.shScrolls += 1;
        return original.call(this, arg);
      };
    });
    const scrolls = () =>
      page.evaluate(() => (window as unknown as { shScrolls: number }).shScrolls);
    const row = pane.locator('.sh-grp[data-current] a.sh-row').last();
    const href = await row.getAttribute('href');
    expect(href).toMatch(/#/);
    await row.click();
    await expect(page).toHaveURL(new RegExp(`${href!.slice(href!.indexOf('#'))}$`));
    expect(await scrolls()).toBe(0);
    // The same row reached by the keyboard is brought into the list's scrollport.
    await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
    await pane.locator('.sh-row').first().focus();
    await page.keyboard.press('Tab');
    await expect.poll(scrolls).toBeGreaterThan(0);
  },
);

test(
  'under reduced transparency the palette settles in without fading, so nothing shows through it',
  { annotation, tag },
  async ({ page }) => {
    // The fade it keeps otherwise, so the check below is about the preference, not the engine.
    const keyframes = () =>
      dialog(page).evaluate((el) =>
        el.getAnimations().flatMap((each) => (each.effect as KeyframeEffect).getKeyframes()),
      );
    await load(page);
    await page.locator('[data-sh-jump]').click();
    await expect(dialog(page)).toHaveJSProperty('open', true);
    expect((await keyframes()).some((frame) => 'opacity' in frame)).toBe(true);
    await page.keyboard.press('Escape');
    await expect(dialog(page)).toHaveJSProperty('open', false);

    const cdp = await page.context().newCDPSession(page);
    await cdp.send('Emulation.setEmulatedMedia', {
      features: [{ name: 'prefers-reduced-transparency', value: 'reduce' }],
    });
    await load(page);
    await page.locator('[data-sh-jump]').click();
    await expect(dialog(page)).toHaveJSProperty('open', true);
    const frames = await keyframes();
    // It still moves (reduced motion is another preference), at full opacity from the start.
    expect(frames.some((frame) => 'transform' in frame)).toBe(true);
    expect(frames.some((frame) => 'opacity' in frame)).toBe(false);
    expect(await dialog(page).evaluate((el) => getComputedStyle(el).opacity)).toBe('1');
  },
);

/**
 * axe's target-size spacing test (WCAG 2.5.8) on the links `scope` names: a link under 24px
 * either way has a 24px circle round its centre that meets no other link's box and no other
 * small link's circle. Each crowded pair, by its words.
 */
async function crowded(page: Page, scope: string): Promise<string[]> {
  return page.evaluate((scope) => {
    const links = [...document.querySelectorAll<HTMLElement>(scope)]
      .filter((a) => a.checkVisibility())
      .map((a) => ({ a, r: a.getBoundingClientRect() }));
    const small = (r: DOMRect) => r.width < 24 || r.height < 24;
    const mid = (r: DOMRect) => ({ x: r.x + r.width / 2, y: r.y + r.height / 2 });
    const reach = (p: { x: number; y: number }, r: DOMRect) =>
      Math.hypot(
        Math.max(r.left - p.x, 0, p.x - r.right),
        Math.max(r.top - p.y, 0, p.y - r.bottom),
      );
    const found: string[] = [];
    for (const one of links) {
      if (!small(one.r)) continue;
      const c = mid(one.r);
      const near = links.find(
        (other) =>
          other !== one &&
          (reach(c, other.r) < 11.99 ||
            (small(other.r) && Math.hypot(c.x - mid(other.r).x, c.y - mid(other.r).y) < 23.99)),
      );
      if (near) found.push(`${one.a.textContent?.trim()} ~ ${near.a.textContent?.trim()}`);
    }
    return found;
  }, scope);
}

for (const viewport of [
  { width: 1440, height: 900 },
  { width: 390, height: 844 },
]) {
  test(
    `at ${viewport.width}, links on stacked lines stand 24px apart, a short type's line or not`,
    { annotation, tag },
    async ({ page }) => {
      await page.setViewportSize(viewport);
      await load(page);
      // As it ships: no link crowds another, and none grows into the next line's room.
      expect(await crowded(page, '.sh-kv a, .sh-complete a, .sh-ent__links a')).toEqual([]);
      // A type whose line is under 24px (technical-sans-mono's is 23.25): the lines of links
      // still stand a target apart.
      await page.addStyleTag({ content: "[data-variant='shell'] { line-height: 1.45; }" });
      expect(await crowded(page, '.sh-kv__list a, .sh-complete a, .sh-ent__links a')).toEqual([]);
    },
  );
}

test.describe('at 320', () => {
  test.use({ viewport: { width: 320, height: 568 } });
  test(
    "a folded section's first line wraps in a narrow transcript, never cut by its own box",
    { annotation, tag },
    async ({ page }) => {
      await load(page);
      const metas = await page.locator('.sh-fold__meta').evaluateAll((all) =>
        all
          .filter((el) => (el as HTMLElement).checkVisibility())
          .map((el) => ({
            text: el.textContent ?? '',
            wrap: getComputedStyle(el).whiteSpace,
            clipped: el.scrollWidth > el.clientWidth + 1,
          })),
      );
      expect(metas.length).toBeGreaterThan(0);
      expect(metas.filter((meta) => meta.clipped || meta.wrap === 'nowrap')).toEqual([]);
    },
  );
});

test(
  "at 1440 a folded section's first line keeps to one row",
  { annotation, tag },
  async ({ page }) => {
    await load(page);
    const wraps = await page
      .locator('.sh-fold__meta')
      .evaluateAll((all) =>
        all
          .filter((el) => (el as HTMLElement).checkVisibility())
          .map((el) => getComputedStyle(el).whiteSpace),
      );
    expect(wraps.length).toBeGreaterThan(0);
    expect(new Set(wraps)).toEqual(new Set(['nowrap']));
  },
);
