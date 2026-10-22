import { expect, test } from '../harness/fixtures';
import {
  DOCUMENT,
  FIXTURE_APP,
  globalListeners,
  openFixtures,
  PLATE,
  PLATES,
  reactHandlers,
  recordGlobalListeners,
  ROUTE,
} from './fixture-page';

// Plates inside the page's own boundary (#19, Slice 3): each renders its own
// selection concurrently with the page's, with unique ids under its own
// prefix, no landmark but the page's one main, no focus, motion, or
// listener of its own, and its language's rules scoped to it, so neither
// the page's language nor its own leaks across a boundary.

test.use({ appOptions: FIXTURE_APP });

test(
  'every id on the page is unique, and each plate starts every id it renders with its own prefix',
  { annotation: [ROUTE] },
  async ({ page }) => {
    await openFixtures(page);
    const ids = await page.locator('[id]').evaluateAll((elements) => elements.map((e) => e.id));
    const repeated = ids.filter((id, index) => ids.indexOf(id) !== index);
    expect(repeated).toEqual([]);
    for (let number = 1; number <= PLATES; number += 1) {
      const plate = page.locator(`[data-fixture-plate="${number}"] ${PLATE}`);
      const inside = await plate
        .locator('[id]')
        .evaluateAll((elements) => elements.map((e) => e.id));
      expect(inside.length, `plate ${number}`).toBeGreaterThan(10);
      expect(
        inside.filter((id) => !id.startsWith(`plate-${number}-`)),
        `plate ${number}`,
      ).toEqual([]);
      // Every reference inside points at an id inside.
      const references = await plate
        .locator('[aria-describedby], [aria-labelledby], [aria-controls], [for], [href^="#"]')
        .evaluateAll((elements) =>
          elements.flatMap((element) =>
            ['aria-describedby', 'aria-labelledby', 'aria-controls', 'for', 'href'].flatMap(
              (name) => (element.getAttribute(name) ?? '').replace(/^#/, '').split(/\s+/),
            ),
          ),
        );
      expect(
        references.filter((id) => id !== '' && !inside.includes(id)),
        `plate ${number}`,
      ).toEqual([]);
    }
  },
);

test(
  "the page keeps its one main and its own landmarks: a plate's are plain elements with no role or name",
  { annotation: [ROUTE] },
  async ({ page }) => {
    await openFixtures(page);
    await expect(page.locator('main')).toHaveCount(1);
    await expect(page.getByRole('main')).toHaveCount(1);
    await expect(page.locator(`${DOCUMENT} > [data-ui-slot="skip-link"]`)).toHaveCount(1);
    const plates = page.locator(PLATE);
    await expect(
      plates.locator('main, nav, header, footer, aside, section[aria-label]'),
    ).toHaveCount(0);
    await expect(plates.locator('[role="navigation"], [role="main"], [role="region"]')).toHaveCount(
      0,
    );
    await expect(plates.locator('[data-ui-slot="skip-link"]')).toHaveCount(0);
    // The page's navigation landmarks are its own.
    await expect(page.getByRole('navigation')).toHaveCount(1);
    // Each plate's main is a div with the plate's main id.
    for (let number = 1; number <= PLATES; number += 1) {
      const main = page.locator(`#plate-${number}-main`);
      await expect(main).toHaveCount(1);
      expect(await main.evaluate((element) => element.tagName)).toBe('DIV');
    }
  },
);

test(
  'a plate is inert and still: nothing in it takes focus, opens, or moves, and its tabs stay sections',
  { tag: '@interaction', annotation: [ROUTE] },
  async ({ page }) => {
    await openFixtures(page);
    const plates = page.locator(PLATE);
    for (let index = 0; index < PLATES; index += 1) {
      const plate = plates.nth(index);
      await expect(plate).toHaveAttribute('inert', '');
      await expect(plate).toHaveAttribute('data-motion', 'static');
      await expect(plate).toHaveAttribute('data-enhancement', 'off');
      const still = await plate.evaluate((element) => {
        const style = getComputedStyle(element);
        return [
          style.getPropertyValue('--ui-motion-fast').trim(),
          style.getPropertyValue('--ui-motion-standard').trim(),
          style.getPropertyValue('--ui-motion-slow').trim(),
          style.getPropertyValue('--ui-motion-emphasis').trim(),
          style.contain,
        ];
      });
      expect(still).toEqual(['0s', '0s', '0s', 'none', 'layout paint']);
    }
    const plate = plates.first();
    // No tablist: the form without JavaScript, even hydrated.
    await expect(plate.locator('[role="tablist"]')).toHaveCount(0);
    await expect(plate.locator('[data-ui-slot="tabs.heading"]')).toHaveCount(2);
    // Focus can't go in, from a script or a click.
    const action = plate.locator('[data-ui-slot="action"]').first();
    await action.evaluate((element) => (element as HTMLElement).focus());
    expect(await action.evaluate((element) => element === document.activeElement)).toBe(false);
    await plate.locator('[aria-haspopup="dialog"]').click({ force: true });
    await expect(plate.locator('dialog')).not.toHaveAttribute('open', '');
    await expect(page.locator('dialog[open]')).toHaveCount(0);
    // Hovered, its tooltip never opens.
    await plate.locator('[data-ui-slot="tooltip.anchor"]').hover({ force: true });
    await page.waitForTimeout(500);
    expect(
      await plate
        .locator('[role="tooltip"]')
        .evaluate((element) => element.matches(':popover-open')),
    ).toBe(false);
  },
);

test(
  'nothing on the page adds a window or document listener the framework does not, before or after its primitives are used',
  { tag: '@interaction', annotation: [ROUTE] },
  async ({ page }) => {
    // The framework's own: what the same build's 404 page adds.
    await recordGlobalListeners(page);
    expect((await page.goto('/no-such-page'))?.status()).toBe(404);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Page not found');
    await page.waitForLoadState('networkidle');
    const framework = await globalListeners(page);

    await openFixtures(page);
    await page.waitForLoadState('networkidle');
    const extra = (listeners: string[]) => listeners.filter((each) => !framework.includes(each));
    expect(extra(await globalListeners(page))).toEqual([]);
    // Using the document's primitives adds none either.
    const overlays = page.locator('#overlays');
    await overlays.getByRole('button', { name: 'Open decision note' }).click();
    await page.keyboard.press('Escape');
    await overlays.getByRole('button', { name: 'Explain confidence' }).hover();
    await overlays.getByRole('tab', { name: 'Activity' }).click();
    await overlays.getByRole('button', { name: 'Show a toast', exact: true }).click();
    await expect(page.locator('#toasts [data-ui-slot="toast"]')).toHaveCount(1);
    expect(extra(await globalListeners(page))).toEqual([]);
  },
);

test(
  'no element in a plate carries a handler, however its primitives were given one',
  { annotation: [ROUTE] },
  async ({ page }) => {
    await openFixtures(page);
    // Every plate holds the live form, whose Field, Checkbox, Radio, Select,
    // and Action each get a handler from their client component.
    await expect(page.locator(`${PLATE} [data-fixture="live-form"]`)).toHaveCount(PLATES);
    // The probe sees the document's own: the live form's and the toast triggers'.
    const live = await reactHandlers(page, '#forms [data-fixture="live-form"]');
    for (const handler of [
      'input#live-note onChange',
      'input#live-track onChange',
      'input#live-depth--option-1 onChange',
      'select#live-basin onChange',
    ]) {
      expect(live, handler).toContain(handler);
    }
    expect(live).toContainEqual(expect.stringMatching(/^button#.* onClick$/));
    expect(await reactHandlers(page, '#overlays')).toContainEqual(
      expect.stringMatching(/^button#.* onClick$/),
    );
    expect(await reactHandlers(page)).toEqual([]);
    // In the page's boundary they answer.
    const form = page.locator('#forms [data-fixture="live-form"]');
    await form.getByRole('textbox', { name: 'Live note' }).fill('Signal');
    await form.getByRole('checkbox', { name: 'Track the note' }).uncheck();
    await form.getByRole('radio', { name: 'Comfortable' }).check();
    await form.getByRole('combobox', { name: 'Live basin' }).selectOption('delta');
    await expect(form.locator('[data-fixture="live-form-state"]')).toHaveText(
      'Signal, not tracked, comfortable, delta',
    );
    await form.getByRole('button', { name: 'Clear the note' }).click();
    await expect(form.locator('[data-fixture="live-form-state"]')).toHaveText(
      'No note, not tracked, comfortable, delta',
    );
  },
);

/** The computed backdrop filter of each surface in `boundary`, outside any boundary nested in it. */
const surfaceFilters = (boundary: Element) =>
  [...boundary.querySelectorAll('[data-ui-slot="surface"]')]
    .filter((surface) => surface.closest('[data-appearance-boundary]') === boundary)
    .map((surface) => getComputedStyle(surface).backdropFilter);

test(
  "a language's rules stop at a nested boundary, in both directions, and each boundary renders its own selection",
  { annotation: [ROUTE] },
  async ({ page }) => {
    // The page in Platform Neutral, which styles nothing beyond its tokens,
    // and plate 3 in Fixture Translucent, whose surfaces blur.
    await openFixtures(page);
    const translucent = page.locator(`[data-fixture-plate="3"] ${PLATE}`);
    await expect(translucent).toHaveAttribute('data-design-language', 'fixture-translucent');
    const inPlate = await translucent.evaluate(surfaceFilters);
    expect(inPlate.length).toBeGreaterThan(0);
    for (const filter of inPlate) expect(filter).toMatch(/^blur\(/);
    const inDocument = await page.locator(DOCUMENT).evaluate(surfaceFilters);
    expect(inDocument.length).toBeGreaterThan(0);
    for (const filter of inDocument) expect(filter).toBe('none');

    // The page in Fixture Translucent: its blur reaches its own surfaces and
    // stops at every plate in another language.
    await openFixtures(page, '?language=fixture-translucent');
    for (const filter of await page.locator(DOCUMENT).evaluate(surfaceFilters)) {
      expect(filter).toMatch(/^blur\(/);
    }
    const neutral = page.locator(`[data-fixture-plate="4"] ${PLATE}`);
    await expect(neutral).toHaveAttribute('data-design-language', 'platform-neutral');
    const inNeutral = await neutral.evaluate(surfaceFilters);
    expect(inNeutral.length).toBeGreaterThan(0);
    for (const filter of inNeutral) expect(filter).toBe('none');
  },
);

test(
  'each boundary takes its own colors and fonts, side by side',
  { annotation: [ROUTE] },
  async ({ page }) => {
    await openFixtures(page);
    const read = (scope: string) =>
      page.locator(scope).evaluate((boundary) => {
        const style = getComputedStyle(boundary);
        return {
          canvas: style.backgroundColor,
          text: style.color,
          font: style.fontFamily,
          scheme: style.colorScheme,
        };
      });
    const documentLook = await read(DOCUMENT);
    // Fixture Dark Only renders dark, beside the page's light.
    const dark = await read(`[data-fixture-plate="1"] ${PLATE}`);
    expect(dark.canvas).not.toBe(documentLook.canvas);
    expect(dark.scheme).toBe('dark');
    // Fixture Font sets its own family, namespaced by its pack, and the page keeps its own.
    const font = await read(`[data-fixture-plate="5"] ${PLATE}`);
    expect(font.font).toMatch(/^"?fixture-font /);
    expect(documentLook.font).not.toMatch(/fixture-font/);
    // High contrast is its own set.
    const contrast = await read(`[data-fixture-plate="4"] ${PLATE}`);
    expect([contrast.canvas, contrast.text]).not.toEqual([documentLook.canvas, documentLook.text]);
  },
);
