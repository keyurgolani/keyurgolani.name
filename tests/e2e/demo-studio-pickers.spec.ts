import type { Page } from '@playwright/test';
import { expect, test } from '../harness/fixtures';
import { DEMO_APP } from '../harness/profile-matrix';
import { checkedIn, DEMO_FRAME, openTask, pick, picker, reveal } from '../harness/studio-tasks';

// Demo Studio's grown pickers (P-5 slice 3, the round 5b mockups): the typography picker's
// web fonts as stills, Studio's own hashed images, painted in its ink, so Studio's document
// never loads a web font; hover previews nothing but scheme and mode, so pointing at a type
// option fetches nothing; and the stills keep their 1:1 size when the reader doubles the text
// (A N-7), with nothing cut (WCAG 1.4.4). The phone sheet's height is checked against the snap
// table it names, measured from the page, never from the value it was set from (item 7).

const DEMO = { type: 'profile', description: 'demo' };
const STUDIO = { type: 'route', description: '/studio' };

test.use({ appOptions: DEMO_APP });

const previewPane = (page: Page) => page.getByRole('region', { name: 'Preview', exact: true });
const types = (page: Page) => picker(page, 'Typography');

async function open(page: Page): Promise<void> {
  const response = await page.goto('/studio');
  expect(response?.status()).toBe(200);
  await openTask(page, 'Appearance');
  await expect(
    page.getByRole('button', { name: 'Reset demo', includeHidden: true }).first(),
  ).toBeAttached();
}

/** Every font request from now on, by URL, in Studio's document or any frame. */
function fontRequests(page: Page): string[] {
  const seen: string[] = [];
  page.context().on('request', (request) => {
    if (request.resourceType() === 'font' || /\.woff2?(?:$|\?)/.test(request.url())) {
      seen.push(request.url());
    }
  });
  return seen;
}

/** The typography rail's visible stills: each one's drawn width over its rem width, and whether an ancestor cuts it. */
async function stillsIn(page: Page) {
  return page.locator('.studio-picker--type').evaluate((group) => {
    const root = Number.parseFloat(getComputedStyle(document.documentElement).fontSize);
    return [...group.querySelectorAll<HTMLImageElement>('img.studio-still')]
      .filter((img) => img.getClientRects().length > 0)
      .map((img) => {
        const box = img.getBoundingClientRect();
        const natural = (Number(img.getAttribute('width')) * root) / 16;
        const row = img.closest('label')!.getBoundingClientRect();
        let clip: DOMRect | null = null;
        for (let at = img.parentElement; at; at = at.parentElement) {
          const style = getComputedStyle(at);
          if (style.overflowX !== 'visible') {
            clip = at.getBoundingClientRect();
            break;
          }
        }
        return {
          src: img.getAttribute('src') ?? '',
          alt: img.alt,
          scale: box.width / natural,
          inRow: box.left >= row.left - 0.5 && box.right <= row.right + 0.5,
          clipped: clip !== null && (box.left < clip.left - 0.5 || box.right > clip.right + 0.5),
        };
      });
  });
}

test(
  "the typography picker shows each web-font pack as Studio's own stills, by its signature role, and the system packs by name, and Studio's document loads no font",
  { annotation: [STUDIO, DEMO] },
  async ({ page }) => {
    const fonts = fontRequests(page);
    const stills: { url: string; bytes: number; type: string }[] = [];
    page.on('response', async (response) => {
      if (new URL(response.url()).pathname.startsWith('/_portfolio/studio/')) {
        const body = await response.body().catch(() => Buffer.alloc(0));
        stills.push({
          url: response.url(),
          bytes: body.length,
          type: response.headers()['content-type'] ?? '',
        });
      }
    });
    await page.setViewportSize({ width: 1440, height: 900 });
    await open(page);
    const group = types(page);
    await reveal(group);
    await page
      .getByRole('group', { name: 'Type styles' })
      .getByRole('button', { name: /^All/ })
      .click();
    // Two runs, each with its head: web fonts as pictures, then the fonts every device has.
    await expect(page.locator('.studio-picker--type > .studio-choices__head')).toHaveText([
      /^Web fonts 9\s*Shown as pictures here\./,
      /^On every device 6\s*System fonts, nothing to download$/,
    ]);
    const web = group.locator('label[data-option]:has(img.studio-still)');
    await expect(web).toHaveCount(9);
    // Each web pack's row: two stills, its "Aa" and its line, named by the role they show.
    await expect(
      group.locator('label[data-option="field-serif"] img.studio-still').first(),
    ).toHaveAttribute('alt', 'Field Serif: its quote face, serif');
    await expect(
      group.locator('label[data-option="console-mono"] img.studio-still').nth(1),
    ).toHaveAttribute('alt', /: its label face, mono$/);
    await expect(
      group.locator('label[data-option="field-serif"] input'),
    ).toHaveAccessibleDescription(/Its pictures show its quote face and its display face\./);
    // A system pack sets its name in its own stack, with no picture.
    const system = group.locator('label[data-option]:not(:has(img.studio-still))');
    await expect(system).toHaveCount(6);
    for (const style of await system
      .locator('.studio-type__aa')
      .evaluateAll((spans) => spans.map((span) => (span as HTMLElement).style.fontFamily))) {
      expect(style).not.toBe('');
    }
    // No font anywhere in Studio's own document: its stacks name no family a pack hosts.
    const named = await page.evaluate(() =>
      [...document.querySelectorAll<HTMLElement>('.studio-split__rail [style*="font-family"]')].map(
        (each) => each.style.fontFamily,
      ),
    );
    for (const stack of named) {
      expect(stack).not.toMatch(
        /Fraunces|Inter|JetBrains|Archivo|Space Grotesk|Newsreader|IBM Plex/,
      );
    }
    await page.locator('label[data-option="field-serif"]').scrollIntoViewIfNeeded();
    await expect.poll(() => stills.length).toBeGreaterThanOrEqual(18);
    for (const still of stills) {
      expect(still.type).toBe('image/png');
      expect(still.bytes).toBeGreaterThan(0);
      expect(still.bytes).toBeLessThanOrEqual(4096);
      expect(new URL(still.url).pathname).toMatch(
        /^\/_portfolio\/studio\/[a-z0-9-]+-(?:aa|line)\.[0-9a-f]{12}\.png$/,
      );
    }
    // Each still is its own picture: no two rows share one.
    const sources = (await stillsIn(page)).map(({ src }) => src);
    expect(new Set(sources).size).toBe(sources.length);
    const studioFonts = fonts.filter((url) => !url.includes('/_portfolio/font/'));
    expect(studioFonts).toEqual([]);
    expect(
      await page.evaluate(() =>
        performance
          .getEntriesByType('resource')
          .filter((entry) => /\.woff2?(?:$|\?)/.test(entry.name))
          .map((entry) => entry.name),
      ),
    ).toEqual([]);
  },
);

test(
  'pointing at a type option or a design language changes nothing and fetches no font; only a click commits, and the frame loads its fonts then',
  { annotation: [STUDIO, DEMO] },
  async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await open(page);
    const iframe = previewPane(page).locator(DEMO_FRAME);
    await expect(iframe).toHaveAttribute('src', /^\/sample\?/);
    const src = await iframe.getAttribute('src');
    const fonts = fontRequests(page);
    const group = types(page);
    await reveal(group);
    const chosen = await checkedIn(group);
    const target = await group
      .locator('label[data-option]:has(img.studio-still)')
      .evaluateAll(
        (labels, current) =>
          labels.map((label) => label.getAttribute('data-option')).find((id) => id !== current),
        chosen,
      );
    const option = group.locator(`label[data-option="${target}"]`);
    await option.scrollIntoViewIfNeeded();
    await option.hover();
    await page.waitForTimeout(400);
    expect(await checkedIn(group)).toBe(chosen);
    expect(await iframe.getAttribute('src')).toBe(src);
    await expect(page.locator('.studio-split__intent')).toHaveCount(0);
    const languages = picker(page, 'Design language');
    await reveal(languages);
    await languages.locator('label[data-option]:not(:has(> input:checked))').first().hover();
    await page.waitForTimeout(400);
    expect(await iframe.getAttribute('src')).toBe(src);
    expect(fonts).toEqual([]);
    await reveal(group);
    await pick(group, target!);
    // The sample frame takes the pack over its channel, in the same document (DEM-2), and only
    // now loads its fonts.
    const frame = await (await iframe.elementHandle())!.contentFrame();
    await expect(frame!.locator('[data-variant]').first()).toHaveAttribute(
      'data-typography',
      target!,
    );
    await expect.poll(() => fonts.length).toBeGreaterThan(0);
  },
);

test(
  'at 200% text the rail grows with the text and every still keeps its 1:1 size, nothing cut; at 100% too; and a 1440 window at 200% keeps the rail and its preview, never the sheet (A N-7, WCAG 1.4.4, P1-2)',
  { annotation: [STUDIO, DEMO] },
  async ({ page }) => {
    for (const [width, height, text] of [
      [1440, 900, 16],
      [1920, 1080, 32],
      [1440, 900, 32],
    ] as const) {
      await page.setViewportSize({ width, height });
      const cdp = await page.context().newCDPSession(page);
      await cdp.send('Page.setFontSizes', { fontSizes: { standard: text, fixed: 13 } });
      await open(page);
      expect(await page.evaluate(() => getComputedStyle(document.documentElement).fontSize)).toBe(
        `${text}px`,
      );
      const rail = await page.locator('.studio-split__rail').boundingBox();
      // 20rem at 1x, 17.5rem under 64rem: the rail is the text's width, not a fixed 320px.
      expect(Math.round(rail!.width)).toBe(text === 16 ? 320 : 560);
      // Beside the preview, never a sheet under it; and the preview loads, with no ask.
      await expect(page.locator('.studio-split__handle')).toBeHidden();
      const pane = (await previewPane(page).boundingBox())!;
      expect(pane.x, `${width} at ${text}px`).toBeGreaterThanOrEqual(rail!.x + rail!.width - 1);
      expect(pane.width, `${width} at ${text}px`).toBeGreaterThan(width / 2);
      await expect(previewPane(page).getByRole('button', { name: 'Show preview' })).toHaveCount(0);
      const group = types(page);
      await reveal(group);
      await page
        .getByRole('group', { name: 'Type styles' })
        .getByRole('button', { name: /^All/ })
        .click();
      for (const row of await group.locator('label[data-option]:has(img.studio-still)').all()) {
        await row.scrollIntoViewIfNeeded();
      }
      const drawn = await stillsIn(page);
      expect(drawn.length).toBe(18);
      for (const still of drawn) {
        expect.soft(still.scale, `${still.src} at ${text}px`).toBeGreaterThanOrEqual(0.95);
        expect.soft(still.inRow, `${still.src} inside its row`).toBe(true);
        expect.soft(still.clipped, `${still.src} uncut`).toBe(false);
      }
      await cdp.detach();
    }
  },
);

test(
  "at 390 the sheet rests where its snap table says, measured from the page, and its handle moves it through the table's snaps",
  { annotation: [STUDIO, DEMO] },
  async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await open(page);
    const handle = page.locator('.studio-split__handle');
    const rail = page.locator('.studio-split__rail');
    // The table, as the product declares it: 25%, 45% and 90% of the screen, resting at 45%.
    const snaps = [25, 45, 90];
    let at = 1;
    for (let step = 0; step < snaps.length; step += 1) {
      const snap = snaps[at]!;
      await expect(handle).toHaveAccessibleName(`Controls height, ${snap}% of the screen`);
      // The independent measure: where the sheet's top really is.
      await expect
        .poll(async () => {
          const box = await rail.boundingBox();
          return Math.round(((844 - box!.y) / 844) * 100);
        })
        .toBe(snap);
      await handle.click();
      at = (at + 1) % snaps.length;
    }
  },
);

/** The index's rows, top to bottom: each one's axis, its short name, its value, and its box. */
async function indexRows(page: Page) {
  return page.locator('.studio-split__index > .studio-split__section').evaluateAll((sections) =>
    sections.map((section) => {
      const summary = section.querySelector(':scope > details > summary')!;
      const visible = (selector: string) => {
        const element = summary.querySelector<HTMLElement>(selector);
        return element !== null && element.getClientRects().length > 0 ? element : null;
      };
      const name = visible('.studio-split__look-name');
      const box = summary.getBoundingClientRect();
      return {
        id: section.getAttribute('data-section'),
        axis: visible('.studio-split__look-axis')?.textContent ?? null,
        short: visible('.studio-split__look-short')?.textContent ?? null,
        value: name?.textContent ?? null,
        // A value that runs past its box, or onto a second line, is cut or wrapped.
        whole: name ? name.scrollWidth <= name.clientWidth + 1 : true,
        lines: name ? Math.round(name.getBoundingClientRect().height / 17) : 0,
        open: (section.querySelector(':scope > details') as HTMLDetailsElement).open,
        top: box.top,
        bottom: box.bottom,
        height: box.height,
      };
    }),
  );
}

test(
  'wide, the rail is one index: a row per axis, recipes first, each its picture, axis and value, opening its panel under it, one at a time, with Display mode pinned at its foot (the round 5b mockups)',
  { annotation: [STUDIO, DEMO] },
  async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await open(page);
    const rows = await indexRows(page);
    expect(rows.map(({ id }) => id)).toEqual([
      'recipes',
      'variant',
      'colorScheme',
      'typography',
      'designLanguage',
    ]);
    expect(rows.map(({ axis }) => axis)).toEqual([
      'Start from a recipe',
      'Composition',
      'Color scheme',
      'Typography',
      'Design language',
    ]);
    // Every axis row shows its current value beside its picture, whole.
    for (const row of rows.slice(1)) {
      expect(row.value, row.id!).not.toBeNull();
      expect(row.whole, row.id!).toBe(true);
    }
    // Composition opens first, its panel right under its row and above the next row.
    expect(rows.filter(({ open }) => open).map(({ id }) => id)).toEqual(['variant']);
    const panel = (await page
      .locator('section[data-section="variant"] .studio-split__panel')
      .boundingBox())!;
    expect(panel.y).toBeGreaterThanOrEqual(rows[1]!.bottom - 1);
    expect(panel.y + panel.height).toBeLessThanOrEqual(rows[2]!.top + 1);
    // Opening another row closes the first: one panel at a time.
    await page.locator('section[data-section="typography"] > details > summary').click();
    const after = await indexRows(page);
    expect(after.filter(({ open }) => open).map(({ id }) => id)).toEqual(['typography']);
    // Display mode is at the rail's foot, open, and the rail itself doesn't scroll: the open
    // panel's body does.
    const rail = page.locator('.studio-split__rail');
    const [railBox, footBox] = await Promise.all([
      rail.boundingBox(),
      page.locator('.studio-split__pinned').boundingBox(),
    ]);
    expect(Math.abs(railBox!.y + railBox!.height - (footBox!.y + footBox!.height))).toBeLessThan(2);
    await expect(page.locator('.studio-split__pinned')).toContainText('Display mode');
    await expect(picker(page, 'Display mode')).toBeVisible();
    expect(await rail.evaluate((element) => element.scrollHeight <= element.clientHeight + 1)).toBe(
      true,
    );
    const body = page.locator('section[data-section="typography"] .studio-split__fold-body');
    expect(await body.evaluate((element) => getComputedStyle(element).overflowY)).toBe('auto');
    expect(await body.evaluate((element) => element.scrollHeight > element.clientHeight)).toBe(
      true,
    );
  },
);

test(
  "on a laptop's browser, 1440x780 and 1280x720, the index is one line an axis, each naming its axis beside its value, none cut (A N-6)",
  { annotation: [STUDIO, DEMO] },
  async ({ page }) => {
    for (const [width, height] of [
      [1440, 780],
      [1280, 720],
    ] as const) {
      await page.setViewportSize({ width, height });
      await open(page);
      const rows = await indexRows(page);
      expect(
        rows.map(({ short }) => short),
        `${width}x${height}`,
      ).toEqual(['Recipes', 'Layout', 'Color', 'Type', 'Style']);
      for (const row of rows) {
        expect(row.height, `${row.id} at ${width}x${height}`).toBeLessThanOrEqual(37);
        if (row.value === null) continue;
        expect(row.whole, `${row.id}'s value whole`).toBe(true);
        expect(row.lines, `${row.id}'s value on one line`).toBe(1);
      }
      // Still pinned: the rail doesn't scroll, and Display mode is in sight at its foot.
      await expect(picker(page, 'Display mode')).toBeInViewport();
      const rail = page.locator('.studio-split__rail');
      expect(
        await rail.evaluate((element) => element.scrollHeight <= element.clientHeight + 1),
      ).toBe(true);
    }
  },
);

test(
  'at 320x568 the stage row steps aside for the frame, and the ⋯ menu holds the device widths, the page and Redo, so every action stays in reach (A P2-F)',
  { annotation: [STUDIO, DEMO] },
  async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 568 });
    await open(page);
    await expect(page.locator('.studio-split__tools')).toBeHidden();
    // The top bar keeps Undo; Redo moves to the menu at this width.
    await expect(page.getByRole('button', { name: 'Undo', exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Redo', exact: true })).toBeHidden();
    await page.getByRole('button', { name: /^More:/ }).click();
    const menu = page.locator('.studio-more .studio-menu__panel');
    const widths = menu.getByRole('radiogroup', { name: 'Device width' });
    await expect(widths).toBeVisible();
    await expect(menu.getByRole('radiogroup', { name: 'Page' })).toBeVisible();
    await expect(menu.getByRole('button', { name: 'Redo', exact: true })).toBeVisible();
    // One of each in reach: the bar's are out of the accessibility tree.
    await expect(page.getByRole('radiogroup', { name: 'Device width' })).toHaveCount(1);
    // A width picked in the menu is the frame's.
    const tablet = widths.locator('label[data-option="tablet"]');
    await tablet.click();
    await expect(tablet.locator('input')).toBeChecked();
    // No sideways scroll at 320.
    expect(await page.evaluate(() => document.scrollingElement!.scrollWidth)).toBeLessThanOrEqual(
      320,
    );
    await page.keyboard.press('Escape');
    // The preview's share of the screen, recorded against the 55% target (a deviation, P-5 item 9).
    const ask = page.getByRole('button', { name: 'Show preview' });
    if (await ask.isVisible()) await ask.click();
    const stage = (await previewPane(page).boundingBox())!;
    const share = stage.height / 568;
    test
      .info()
      .annotations.push({ type: 'preview share at 320x568', description: share.toFixed(3) });
    expect(share).toBeGreaterThanOrEqual(0.35);
  },
);

test(
  "at 200% text on a phone the bar holds its name on one line, whole words or an ellipsis, its whole name still the heading's, and nothing in the bar reaches the stage (P0-1, WCAG 1.4.4)",
  { annotation: [STUDIO, DEMO] },
  async ({ page }) => {
    for (const [width, height] of [
      [390, 844],
      [320, 568],
    ] as const) {
      await page.setViewportSize({ width, height });
      const cdp = await page.context().newCDPSession(page);
      await cdp.send('Page.setFontSizes', { fontSizes: { standard: 32, fixed: 26 } });
      await open(page);
      const heading = page.getByRole('heading', { name: 'Portfolio Studio', level: 1 });
      await expect(heading).toBeVisible();
      const bar = (await page.locator('.studio-split__top').boundingBox())!;
      const name = await heading.evaluate((element) => {
        // What it shows: the text no clip hides (a visually hidden word is still the heading's
        // name, never what shows), by its lines, each text node's own boxes by their tops.
        const shown = (node: Node) => {
          for (
            let at = node.parentElement;
            at && at !== element.parentElement;
            at = at.parentElement
          ) {
            if (getComputedStyle(at).clipPath !== 'none') return false;
          }
          return true;
        };
        const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
        const tops: number[] = [];
        let text = '';
        for (let node = walker.nextNode(); node; node = walker.nextNode()) {
          if (!shown(node)) continue;
          text += node.textContent ?? '';
          const range = document.createRange();
          range.selectNodeContents(node);
          for (const rect of range.getClientRects()) {
            if (rect.width > 0 && !tops.some((top) => Math.abs(top - rect.top) < 3)) {
              tops.push(rect.top);
            }
          }
        }
        // Cut: the box that clips the name, the link or the heading, holds less than its text.
        const box = element.querySelector<HTMLElement>('.studio-mark__home') ?? element;
        const style = getComputedStyle(element);
        return {
          lines: tops.length,
          text: text.trim(),
          cut: box.scrollWidth > box.clientWidth + 1,
          wrap: style.overflowWrap,
          break: style.wordBreak,
        };
      });
      expect(name.lines, `${width}: one line`).toBe(1);
      // A whole word shows, never a letter and an ellipsis: "Studio", or the whole name.
      expect(name.cut, `${width}: "${name.text}" shows whole`).toBe(false);
      expect(['Studio', 'Portfolio Studio'], `${width}`).toContain(name.text);
      expect(name.wrap, 'never broken inside a word').toBe('normal');
      expect(name.break).toBe('normal');
      // The sheet's current value too: whole words, never two letters and an ellipsis.
      await page.getByRole('tab', { name: 'Type', exact: true }).click();
      const value = page.locator('section[data-section="typography"] .studio-split__current-name');
      await expect(value).toBeVisible();
      expect(
        await value.evaluate(
          (element) =>
            element.scrollWidth <= element.clientWidth + 1 &&
            getComputedStyle(element).textOverflow !== 'ellipsis',
        ),
        `${width}: the current value whole`,
      ).toBe(true);
      // Every text box in the bar stays inside it, above the stage.
      const stage = (await previewPane(page).boundingBox())!;
      const boxes = await page.locator('.studio-split__top').evaluate((top) =>
        [...top.querySelectorAll<HTMLElement>('h1, .studio-mark__tag, button')]
          .filter((element) => element.getClientRects().length > 0)
          .map((element) => {
            const box = element.getBoundingClientRect();
            return { what: element.className || element.tagName, top: box.top, bottom: box.bottom };
          }),
      );
      expect(boxes.length).toBeGreaterThan(1);
      for (const box of boxes) {
        expect(box.bottom, `${box.what} at ${width}`).toBeLessThanOrEqual(bar.y + bar.height + 0.5);
        expect(box.bottom, `${box.what} above the stage`).toBeLessThanOrEqual(stage.y + 0.5);
      }
      await cdp.detach();
    }
  },
);

/** What a wide panel shows on open: its body's visible band under the sticky top and head. */
async function panelView(page: Page, section: string) {
  return page
    .locator(`section[data-section="${section}"] .studio-split__fold-body`)
    .evaluate((body) => {
      const band = body.getBoundingClientRect();
      const top =
        body.querySelector('.studio-picker__top')?.getBoundingClientRect().bottom ?? band.top;
      const checked = body.querySelector('label input:checked')?.closest('label');
      const box = checked?.getBoundingClientRect();
      // The head stuck at the band's top, if any: the last head whose top is at the cover line.
      const heads = [
        ...body.querySelectorAll<HTMLElement>('.studio-choices__head, .studio-listhead'),
      ]
        .map((head) => head.getBoundingClientRect())
        .filter((rect) => rect.height > 0 && rect.top < band.bottom && rect.bottom > top - 1);
      const under = Math.max(
        top,
        ...heads.filter((rect) => rect.top <= top + 1).map((r) => r.bottom),
      );
      const stills = [...body.querySelectorAll<HTMLImageElement>('img.studio-still')]
        .map((img) => img.closest('label')!.getBoundingClientRect())
        .filter((row) => row.top >= under - 1 && row.bottom <= band.bottom + 1);
      return {
        // Said so a failure names its geometry: the rail's fit, the band, and the option's box.
        fit: body.closest<HTMLElement>('.studio-split__rail')?.dataset.fit,
        band: [Math.round(band.top), Math.round(band.bottom)],
        under: Math.round(under),
        option: box ? [Math.round(box.top), Math.round(box.bottom)] : null,
        scrolled: body.scrollTop,
        checkedWhole: box ? box.top >= under - 1 && box.bottom <= band.bottom + 1 : false,
        // An option cut by the sticky stack at the band's top, more than a ring's room of it
        // showing: its swatch or drawing under the stack, its name in view (P1-A).
        sliced: [...body.querySelectorAll('label[data-option]')]
          .map((label) => label.getBoundingClientRect())
          .filter((rect) => rect.height > 0 && rect.top < under - 1 && rect.bottom > under + 6)
          .length,
        headInView: heads.length > 0 && heads[0]!.top <= band.bottom,
        wholeStillRows: stills.length,
      };
    });
}

test(
  'a wide panel opens on whole groups: the checked option shows with its group head, never under a sliced row, and Type opens on its web fonts, so a pack is picked by its look at 1280x720 and 1440x780 (P1-3, P1-4)',
  { annotation: [STUDIO, DEMO] },
  async ({ page }) => {
    for (const [width, height] of [
      [1440, 900],
      [1440, 780],
      [1280, 720],
    ] as const) {
      await page.setViewportSize({ width, height });
      await open(page);
      for (const section of ['colorScheme', 'designLanguage', 'variant']) {
        await page.locator(`section[data-section="${section}"] > details > summary`).click();
        await expect(page.locator(`section[data-section="${section}"] > details`)).toHaveAttribute(
          'open',
          '',
        );
        // The panel brings its checked one in once it has opened (its toggle event's task).
        let last: unknown = null;
        await expect
          .poll(
            async () => {
              const seen = await panelView(page, section);
              last = seen;
              return seen.checkedWhole;
            },
            { message: `${section} at ${width}x${height}: the checked one whole` },
          )
          .toBe(true)
          .catch((error: Error) => {
            // The geometry it saw last, so a failure names its cause.
            throw new Error(`${error.message}\n${JSON.stringify(last)}`);
          });
        const view = await panelView(page, section);
        expect(view.headInView, `${section} at ${width}x${height}: a group head`).toBe(true);
        expect(view.sliced, `${section} at ${width}x${height}: no row sliced at the top`).toBe(0);
      }
      await page.locator('section[data-section="typography"] > details > summary').click();
      await expect
        .poll(async () => (await panelView(page, 'typography')).wholeStillRows, {
          message: `Type at ${width}x${height}: a whole row of pictures`,
        })
        .toBeGreaterThanOrEqual(1);
      const type = await panelView(page, 'typography');
      expect(type.scrolled, `Type at ${width}x${height} opens at its top`).toBe(0);
      expect(
        type.wholeStillRows,
        `Type at ${width}x${height}: a whole row of pictures`,
      ).toBeGreaterThanOrEqual(1);
      // The pinned foot's hint folds into its About on a short rail, so the panel keeps the room.
      const hint = page.locator('.studio-split__pinned .studio-axis__hint');
      if (height < 900) await expect(hint).toBeHidden();
      else await expect(hint).toBeVisible();
    }
  },
);

test(
  'every Style and Type option shows its whole name, at 1440 and on a phone, with no ellipsis and no tier tag taking its room (P1-1)',
  { annotation: [STUDIO, DEMO] },
  async ({ page }) => {
    for (const [width, height] of [
      [1440, 900],
      [390, 844],
    ] as const) {
      await page.setViewportSize({ width, height });
      await open(page);
      for (const [name, tab] of [
        ['Design language', 'Style'],
        ['Typography', 'Type'],
      ] as const) {
        const group = picker(page, name);
        // A phone's sheet shows one axis a tab; wide, its fold opens.
        const sheetTab = page.getByRole('tab', { name: tab, exact: true });
        if (await sheetTab.isVisible()) await sheetTab.click();
        await reveal(group);
        const cut = await group.locator('.studio-choice__label').evaluateAll((labels) =>
          labels
            .filter((label) => label.getClientRects().length > 0)
            .filter((label) => {
              const style = getComputedStyle(label);
              // A word broken across two lines is cut too: each word sets on one line.
              const broken = [...label.childNodes]
                .filter((node) => node.nodeType === Node.TEXT_NODE)
                .some((node) => {
                  const text = node.textContent ?? '';
                  for (const match of text.matchAll(/\S+/g)) {
                    const range = document.createRange();
                    range.setStart(node, match.index);
                    range.setEnd(node, match.index + match[0].length);
                    const tops = new Set(
                      [...range.getClientRects()]
                        .filter((rect) => rect.width > 0)
                        .map((rect) => Math.round(rect.top)),
                    );
                    if (tops.size > 1) return true;
                  }
                  return false;
                });
              return (
                broken ||
                style.textOverflow === 'ellipsis' ||
                label.scrollWidth > label.clientWidth + 1 ||
                label.scrollHeight > label.clientHeight + 1
              );
            })
            .map((label) => label.textContent),
        );
        expect(cut, `${name} at ${width}`).toEqual([]);
        await expect(group.locator('.studio-choice__tier')).toHaveCount(0);
      }
    }
  },
);

test(
  'a phone on its side, at 844x390, shows a whole option in its sheet on open and on each tab it opens (P1-B)',
  { annotation: [STUDIO, DEMO] },
  async ({ page }) => {
    await page.setViewportSize({ width: 844, height: 390 });
    await open(page);
    const whole = (section: string) =>
      page.locator(`section[data-section="${section}"]`).evaluate((panel) => {
        const tabs = document.querySelector('.studio-split__tabs')?.getBoundingClientRect();
        const floor = Math.max(0, tabs?.bottom ?? 0);
        return [...panel.querySelectorAll('label[data-option]')].some((label) => {
          const box = label.getBoundingClientRect();
          return (
            box.height > 0 &&
            box.top >= floor - 1 &&
            box.bottom <= innerHeight + 1 &&
            box.left >= -1 &&
            box.right <= innerWidth + 1
          );
        });
      });
    await expect.poll(() => whole('variant'), { message: 'Layout on open' }).toBe(true);
    for (const [tab, section] of [
      ['Type', 'typography'],
      ['Color', 'colorScheme'],
    ] as const) {
      await page.getByRole('tab', { name: tab, exact: true }).click();
      await expect.poll(() => whole(section), { message: tab }).toBe(true);
    }
  },
);
