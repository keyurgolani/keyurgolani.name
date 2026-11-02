import type { Page } from '@playwright/test';
import { expect, test } from '../harness/fixtures';
import { DEMO_APP } from '../harness/profile-matrix';
import {
  checkedIn,
  DEMO_FRAME,
  openTask,
  optionsIn,
  pick,
  picker,
  readyIn,
  reveal,
} from '../harness/studio-tasks';
import { axeFor } from '../quality/lib/axe';

// Demo Studio's Compare, page switch, and preview on intent (the Studio
// mockup's compareMode; the design director's ST-M5 and ST-S1; the dossier's
// ST4 and ST5). Compare pins the look as A and the rail keeps editing B: side
// by side or a wipe, never more than two live frames, at one scale; a grid of
// stills that loads no frame; a bar naming what differs, with Swap and Stop.
// The page switch keeps the selection. Pointing at an option shows it in the
// frame and leaving puts the choice back, with nothing chosen.

const DEMO = { type: 'profile', description: 'demo' };
const STUDIO = { type: 'route', description: '/studio' };

test.use({ appOptions: DEMO_APP });
test.describe.configure({ mode: 'serial' });

const frames = (page: Page) => page.locator(`.studio-split__stage ${DEMO_FRAME}`);
const bar = (page: Page) => page.getByRole('group', { name: 'Compare A and B' });
/**
 * The scheme each live frame's document shows on its boundary: a scheme goes to a frame in place,
 * over its channel, so its src keeps the one it loaded with (DEM-2).
 */
const shownSchemes = async (page: Page) =>
  Promise.all(
    Array.from({ length: await frames(page).count() }, (_, index) =>
      frames(page)
        .nth(index)
        .contentFrame()
        .locator('[data-variant]')
        .first()
        .getAttribute('data-color-scheme', { timeout: 1000 })
        .catch(() => null),
    ),
  );

async function open(page: Page): Promise<void> {
  await page.setViewportSize({ width: 1440, height: 900 });
  const response = await page.goto('/studio');
  expect(response?.status()).toBe(200);
  await openTask(page, 'Appearance');
  await expect(frames(page)).toHaveCount(1);
  await expect(frames(page)).toHaveAttribute('src', /^\/sample/);
}

/** An option on `name`'s picker other than the checked one. */
async function other(page: Page, name: string): Promise<string> {
  const group = picker(page, name);
  const current = await checkedIn(group);
  const value = (await optionsIn(group)).find((each) => each !== current);
  expect(value, name).toBeDefined();
  return value!;
}

test(
  'Compare pins A, keeps editing B in the rail, names each difference, and opens as a wipe while only token axes differ',
  { annotation: [STUDIO, DEMO] },
  async ({ page }) => {
    await open(page);
    await page.getByRole('button', { name: 'Compare', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Compare', exact: true })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    await expect(page.getByText("You're editing B. A stays pinned as it was.")).toBeVisible();
    await expect(bar(page)).toContainText('No differences yet');
    // Two live frames, never more, each named for its side.
    await expect(frames(page)).toHaveCount(2);
    await expect(frames(page).nth(0)).toHaveAttribute('title', /^(A, pinned|B, editing): /);
    // A scheme for B: one difference, a wipe, and B's frame alone follows.
    const scheme = await other(page, 'Color scheme');
    await pick(picker(page, 'Color scheme'), scheme);
    await expect(bar(page)).toContainText('1 difference');
    await expect(bar(page)).toContainText('Everything else matches.');
    const slider = page.getByRole('slider', { name: 'Wipe between A and B' });
    await expect(slider).toHaveAttribute('aria-valuenow', '50');
    await slider.focus();
    await page.keyboard.press('ArrowLeft');
    await expect(slider).toHaveAttribute('aria-valuenow', '45');
    await page.keyboard.press('End');
    await expect(slider).toHaveAttribute('aria-valuenow', '100');
    const titles = await frames(page).evaluateAll((all) =>
      all.map((each) => each.getAttribute('title') ?? ''),
    );
    expect(titles.some((title) => title.startsWith('A, pinned'))).toBe(true);
    expect(titles.some((title) => title.startsWith('B, editing'))).toBe(true);
    await expect.poll(() => shownSchemes(page)).toContain(scheme);
    // A composition for B: side by side, at one scale.
    const composition = await other(page, 'Composition');
    await pick(picker(page, 'Composition'), composition);
    await expect(bar(page)).toContainText('2 differences');
    await expect(page.getByRole('region', { name: 'A, pinned' })).toBeVisible();
    await expect(page.getByRole('region', { name: 'B, editing' })).toBeVisible();
    const [a, b] = await frames(page).evaluateAll((all) =>
      all.map((each) => each.getBoundingClientRect().width),
    );
    expect(Math.abs(a! - b!)).toBeLessThan(2);
    // Readable is the 1024 width for both.
    await page.getByRole('button', { name: 'Readable 1024' }).click();
    await expect(frames(page).first()).toHaveCSS('width', '1024px');
    await expect(frames(page).last()).toHaveCSS('width', '1024px');
    expect((await axeFor(page).exclude('iframe').analyze()).violations).toEqual([]);
    // Swap: B takes A's look.
    const before = await checkedIn(picker(page, 'Composition'));
    await page.getByRole('button', { name: 'Swap A and B' }).click();
    await expect.poll(() => checkedIn(picker(page, 'Composition'))).not.toBe(before);
    // Stop: one frame again.
    await page.getByRole('button', { name: 'Stop comparing' }).click();
    await expect(frames(page)).toHaveCount(1);
    await expect(bar(page)).toHaveCount(0);
  },
);

test(
  'Vary: Scheme is A and three schemes as four live frames of the same composition, each with its own scheme, and never a fifth frame (P0-2b)',
  { annotation: [STUDIO, DEMO] },
  async ({ page }) => {
    await open(page);
    const compositions = picker(page, 'Composition');
    await reveal(compositions);
    // A's composition, by the name its card shows.
    const composition = (await compositions
      .locator('label:has(> input:checked) .studio-choice__label')
      .textContent())!.trim();
    await page.getByRole('button', { name: 'Compare compositions' }).click();
    // The bar says what every plate keeps of A, in place of A against B (M1).
    const held = bar(page).locator('.studio-compare__held');
    await expect(held).toHaveText(/^Varying the composition\. Every plate keeps A's .+ mode\.$/);
    await page
      .getByRole('radiogroup', { name: 'Vary' })
      .locator('label[data-option="colorScheme"]')
      .click();
    await expect(held).toHaveText(
      new RegExp(
        `^Varying the color scheme\\. Every plate keeps A's ${composition.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}, .+, .+ and .+ mode\\.$`,
      ),
    );
    await expect(bar(page)).not.toContainText(' vs ');
    const plates = page.locator('.studio-plate');
    await expect(plates).toHaveCount(4);
    // Only A wears a letter; the others are their scheme's name, never B, C or D (M1).
    await expect(page.locator('.studio-plate .studio-compare__tag')).toHaveText(['A']);
    const live = page.locator('.studio-plate iframe');
    await expect(live).toHaveCount(4, { timeout: 20_000 });
    await expect(page.locator('.studio-plate__view[data-compare-live="live"]')).toHaveCount(4);
    expect(await page.locator('iframe').count()).toBe(4);
    // Each plate's name is its scheme's, and its frame's name starts with the same.
    const names = (
      await plates.evaluateAll((items) =>
        items.map((item) => item.getAttribute('aria-label') ?? ''),
      )
    ).map((label) => label.replace(/^A, pinned: /, ''));
    expect(new Set(names).size).toBe(4);
    for (const [at, name] of names.entries()) {
      expect(name).not.toMatch(/^[A-D]$/);
      expect(await plates.nth(at).locator(DEMO_FRAME).getAttribute('title')).toMatch(
        new RegExp(`^${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}: `),
      );
    }
    // Each frame is its plate's selection: one composition, four schemes, each applied.
    const shown = async () =>
      Promise.all(
        (await live.elementHandles()).map(async (handle) => {
          const frame = await handle.contentFrame();
          const root = frame!.locator('[data-variant]').first();
          await root.waitFor({ timeout: 20_000 });
          return {
            variant: await root.getAttribute('data-variant'),
            scheme: await root.getAttribute('data-color-scheme'),
          };
        }),
      );
    const seen = await shown();
    expect(new Set(seen.map(({ variant }) => variant)).size).toBe(1);
    expect(new Set(seen.map(({ scheme }) => scheme)).size).toBe(4);
    // Each plate is a true 1440 by 900 page, scaled to fit, and the plate is its frame's size:
    // the frame's bottom meets the plate's, with no stage under it (DEM-3).
    for (const [at, handle] of (await live.elementHandles()).entries()) {
      const frame = await handle.contentFrame();
      expect(await frame!.evaluate(() => [innerWidth, innerHeight])).toEqual([1440, 900]);
      const [frameBottom, plateBottom] = await handle.evaluate((node: Element) => [
        node.getBoundingClientRect().bottom,
        node.closest('.studio-plate')!.getBoundingClientRect().bottom,
      ]);
      expect(Math.abs(frameBottom! - plateBottom!), `plate ${at}`).toBeLessThanOrEqual(2);
    }
    // The head is the name and actions alone: no language specimen (DEM-3).
    await expect(page.locator('.studio-plate .studio-language')).toHaveCount(0);
    // The pointer takes the one heavy slot; the rest stay static.
    await plates.nth(2).locator('.studio-plate__view').hover();
    await expect(page.locator('.studio-plate__view[data-motion="full"]')).toHaveCount(1);
    await expect(page.locator('.studio-plate__view[data-motion="static"]')).toHaveCount(3);
    expect(await page.locator('iframe').count()).toBeLessThanOrEqual(4);
    // The schemes page by Next 3, never "+30", with where the page is beside it, which
    // describes it; its name is what it shows (M3, WCAG 2.5.3).
    const position = page.locator('.studio-compare__position');
    await expect(position).toHaveText(/^Schemes 1 to 3 of \d+ besides A$/);
    const next = page.getByRole('button', { name: 'Next 3', exact: true });
    await expect(next).toHaveAccessibleDescription(/^Schemes 1 to 3 of \d+ besides A$/);
    await next.click();
    await expect(position).toHaveText(/^Schemes 4 to 6 of \d+ besides A$/);
    await expect(plates).toHaveCount(4);
    expect(await page.locator('iframe').count()).toBeLessThanOrEqual(4);
  },
);

test(
  'the grid of four is four plates, live once in view and never more than four frames, pages to the rest of the compositions, and Use this edits B',
  { annotation: [STUDIO, DEMO] },
  async ({ page }) => {
    await open(page);
    const compositions = picker(page, 'Composition');
    await reveal(compositions);
    await page.getByRole('button', { name: 'Compare compositions' }).click();
    // No frame of its own: only the plates', four at most (round 5, P0-2b).
    expect(
      await page
        .locator('iframe')
        .evaluateAll((all) => all.every((frame) => frame.closest('.studio-plate') !== null)),
    ).toBe(true);
    expect(await page.locator('iframe').count()).toBeLessThanOrEqual(4);
    const plates = page.locator('.studio-plate');
    // The ready ones only: a composition in progress is never a plate (A2).
    const count = (await readyIn(compositions)).length;
    await expect(plates).toHaveCount(Math.min(4, count));
    await expect(page.locator('.studio-plate[data-pinned="true"]')).toHaveCount(1);
    // The 2x2 fills the stage: four plates of one size, two by two.
    const boxes = await plates.evaluateAll((items) =>
      items.map((item) => {
        const { x, y, width, height } = item.getBoundingClientRect();
        return {
          x: Math.round(x),
          y: Math.round(y),
          width: Math.round(width),
          height: Math.round(height),
        };
      }),
    );
    expect(new Set(boxes.map(({ x }) => x)).size).toBe(2);
    expect(new Set(boxes.map(({ y }) => y)).size).toBe(2);
    // The rest of the compositions are a page away, still four plates.
    if (count > 4) {
      const next = page.getByRole('button', { name: 'Next 3', exact: true });
      await next.click();
      await expect(plates).toHaveCount(4);
      // Every later page is four plates too, the last of them the last three and A.
      const pages = Math.ceil((count - 1) / 3);
      for (let at = 2; at < pages; at += 1) {
        await next.click();
        await expect(plates).toHaveCount(4);
      }
      await page.getByRole('button', { name: 'Back to the first', exact: true }).click();
      await expect(plates).toHaveCount(4);
    }
    const before = await checkedIn(compositions);
    // Use this makes B the plate's whole selection: its name and the notice say every pick
    // that moves, here the composition alone, since B started as A (M2). The name starts with
    // the visible "Use this" (WCAG 2.5.3, Label in Name).
    const use = page.getByRole('button', { name: /^Use this: make B / }).first();
    await expect(use).toHaveText('Use this');
    const moved = (await use.getAttribute('aria-label'))!.replace(/^Use this: make B /, '');
    await use.click();
    await expect.poll(() => checkedIn(compositions)).not.toBe(before);
    await expect(page.getByRole('status')).toContainText(`B is now ${moved}.`);
    // Vary the scheme: A and three neighbours.
    await page
      .getByRole('radiogroup', { name: 'Vary' })
      .locator('label[data-option="colorScheme"]')
      .click();
    await expect(plates).toHaveCount(4);
    expect((await axeFor(page).exclude('iframe').analyze()).violations).toEqual([]);
  },
);

test(
  'the page switch shows Home, its Work section, or the sample case study, keeping the selection',
  { annotation: [STUDIO, DEMO] },
  async ({ page }) => {
    await open(page);
    const frame = frames(page);
    const query = new URL((await frame.getAttribute('src'))!, 'http://x').search;
    const pages = page.getByRole('radiogroup', { name: 'Page' });
    await pages.locator('label[data-option="case"]').click();
    // Each document with its own channel nonce in its fragment (DEM-2), but Work's, whose
    // fragment is its section's.
    const nonce = '#nonce=[A-Za-z0-9_-]{22}';
    await expect(frame).toHaveAttribute(
      'src',
      new RegExp(`^/sample/work/[a-z0-9-]+\\${query}${nonce}$`),
    );
    await pages.locator('label[data-option="work"]').click();
    await expect(frame).toHaveAttribute('src', `/sample${query}#work`);
    await pages.locator('label[data-option="home"]').click();
    await expect(frame).toHaveAttribute('src', new RegExp(`^/sample\\${query}${nonce}$`));
  },
);

test(
  'pointing at a scheme changes nothing, with no "Previewing" over the frame, and a click keeps it',
  { annotation: [STUDIO, DEMO] },
  async ({ page }) => {
    await open(page);
    const frame = frames(page);
    const schemes = picker(page, 'Color scheme');
    await reveal(schemes);
    const chosen = await checkedIn(schemes);
    const value = await other(page, 'Color scheme');
    const option = schemes.locator(`label[data-option="${value}"]`);
    await option.scrollIntoViewIfNeeded();
    // What the frame's document shows, which a click changes in place (DEM-2).
    const scheme = async () => (await shownSchemes(page))[0];
    const before = await frame.getAttribute('src');
    const url = page.url();
    const entries = await page.evaluate(() => history.length);
    await option.hover();
    // Longer than Owner Studio's 50ms settle, and nothing moves.
    await page.waitForTimeout(400);
    expect(await frame.getAttribute('src')).toBe(before);
    await expect(page.locator('.studio-split__intent')).toHaveCount(0);
    expect(await checkedIn(schemes)).toBe(chosen);
    expect(page.url()).toBe(url);
    expect(await page.evaluate(() => history.length)).toBe(entries);
    await option.click();
    await expect.poll(scheme).toBe(value);
    await expect(option.locator('input')).toBeChecked();
  },
);
