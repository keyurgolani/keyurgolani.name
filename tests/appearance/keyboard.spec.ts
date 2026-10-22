import type { Page } from '@playwright/test';
import { expect, test } from '../harness/fixtures';
import { DOCUMENT, FIXTURE_APP, openFixtures, ROUTE } from './fixture-page';

// The primitives by keyboard alone (#19, Slice 3): the skip link, a tab
// order that reaches every control in the document and none in a plate,
// and each composite's keys: tabs, the dialog, the tooltip, disclosures,
// radios, and toasts.

test.use({ appOptions: FIXTURE_APP });

const INTERACTION = { tag: '@interaction', annotation: [ROUTE] };

/** What has focus: its slot, its name or text, and whether it's in a plate. */
async function focused(page: Page) {
  return page.evaluate(() => {
    const element = document.activeElement;
    if (!element || element === document.body) return null;
    return {
      slot: element.getAttribute('data-ui-slot'),
      text: (element.getAttribute('aria-label') ?? element.textContent ?? '').trim(),
      id: element.id,
      tag: element.tagName.toLowerCase(),
      inPlate: element.closest('[data-appearance-boundary="plate"]') !== null,
    };
  });
}

test(
  'the first Tab reaches the skip link, which skips to the main content',
  INTERACTION,
  async ({ page }) => {
    await openFixtures(page);
    await page.keyboard.press('Tab');
    const skip = page.locator(`${DOCUMENT} [data-ui-slot="skip-link"]`);
    await expect(skip).toBeFocused();
    await expect(skip).toHaveText('Skip to the fixtures');
    await expect(skip).toHaveAttribute('href', '#main');
    // Out of sight until it has focus, then on screen.
    const box = await skip.boundingBox();
    expect(box && box.width > 1 && box.height > 1).toBe(true);
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(/#main$/);
    // The next stop is the main content's first control, past the header.
    await page.keyboard.press('Tab');
    expect(await focused(page)).toMatchObject({ slot: 'action', text: 'Publish revision' });
  },
);

test(
  'Tab reaches every control in the document boundary, in order, and none in a plate',
  INTERACTION,
  async ({ page }) => {
    await openFixtures(page);
    // What the document offers by Tab: every enabled control, one tab per tablist.
    const reachable = await page.locator(DOCUMENT).evaluate((boundary) => {
      const controls = boundary.querySelectorAll<HTMLElement>(
        'a[href], button, input, select, textarea, summary, [tabindex], [role="link"]',
      );
      return [...controls].filter((element) => {
        if (element.closest('[data-appearance-boundary="plate"], [hidden], dialog:not([open])')) {
          return false;
        }
        if ((element as HTMLButtonElement).disabled || element.tabIndex < 0) return false;
        // Closed details hide their content; radios of a group take one stop.
        if (element.closest('details:not([open]) > :not(summary)')) return false;
        return true;
      }).length;
    });
    const stops: NonNullable<Awaited<ReturnType<typeof focused>>>[] = [];
    for (let press = 0; press < reachable + 20; press += 1) {
      await page.keyboard.press('Tab');
      const now = await focused(page);
      if (now === null) break;
      if (stops.length > 0 && now.id && now.id === stops[0]!.id) break;
      stops.push(now);
    }
    expect(stops.filter((stop) => stop.inPlate)).toEqual([]);
    const names = stops.map((stop) => stop.text);
    for (const name of [
      'Skip to the fixtures',
      'Appearance',
      'Publish revision',
      'Validating',
      'Go to the forms',
      'Summary',
      'Explain confidence',
      'Open decision note',
      'Show a toast',
    ]) {
      expect(
        names.some((text) => text.startsWith(name)),
        name,
      ).toBe(true);
    }
    // Disabled controls take no stop, and neither does a link that goes
    // nowhere; one that's loading keeps its place.
    expect(names.includes('Unavailable')).toBe(false);
    expect(names.includes('Archived link')).toBe(false);
    expect(stops.find((stop) => stop.text === 'Validating')).toMatchObject({ tag: 'button' });
    // A tablist is one stop: only its selected tab.
    expect(stops.filter((stop) => stop.slot === 'tabs.tab')).toHaveLength(1);
  },
);

test(
  "the tabs move focus and selection with the arrow keys, Home, and End, and show only the selected tab's panel",
  INTERACTION,
  async ({ page }) => {
    await openFixtures(page);
    const tablist = page.locator(DOCUMENT).getByRole('tablist', { name: 'Evidence views' });
    const tab = (name: string) => tablist.getByRole('tab', { name });
    const panel = (id: string) => page.locator(`#evidence-views--panel-${id}`);
    await tab('Summary').focus();
    await expect(tab('Summary')).toHaveAttribute('aria-selected', 'true');
    await page.keyboard.press('ArrowRight');
    await expect(tab('Activity')).toBeFocused();
    await expect(tab('Activity')).toHaveAttribute('aria-selected', 'true');
    await expect(tab('Summary')).toHaveAttribute('aria-selected', 'false');
    await expect(panel('activity')).toBeVisible();
    await expect(panel('summary')).toBeHidden();
    await page.keyboard.press('End');
    await expect(tab('Sources')).toBeFocused();
    await page.keyboard.press('ArrowRight');
    await expect(tab('Summary')).toBeFocused();
    await page.keyboard.press('ArrowLeft');
    await expect(tab('Sources')).toBeFocused();
    await page.keyboard.press('Home');
    await expect(tab('Summary')).toBeFocused();
    // Roving focus: one tab in the tab order, the selected one.
    expect(await tablist.locator('[role="tab"][tabindex="0"]').count()).toBe(1);
    // Tab leaves the tablist for the selected panel.
    await page.keyboard.press('Tab');
    await expect(panel('summary')).toBeFocused();
  },
);

test(
  'the dialog opens from its trigger, holds focus, closes on Escape and on its close action, and gives focus back',
  INTERACTION,
  async ({ page }) => {
    await openFixtures(page);
    const trigger = page.locator(DOCUMENT).getByRole('button', { name: 'Open decision note' });
    const dialog = page.getByRole('dialog', { name: 'Decision note' });
    await expect(trigger).toHaveAttribute('aria-haspopup', 'dialog');
    await trigger.focus();
    await page.keyboard.press('Enter');
    await expect(dialog).toBeVisible();
    expect(await dialog.evaluate((element) => element.matches(':modal'))).toBe(true);
    await expect(dialog).toHaveAccessibleDescription("Why the basin's status moved to verified.");
    // The page behind it can't scroll, and focus stays inside.
    expect(await page.evaluate(() => getComputedStyle(document.documentElement).overflow)).toBe(
      'hidden',
    );
    for (let press = 0; press < 6; press += 1) {
      await page.keyboard.press('Tab');
      const inside = await page.evaluate(
        () =>
          document.activeElement?.closest('dialog') !== null ||
          document.activeElement === document.body,
      );
      expect(inside, `Tab ${press + 1}`).toBe(true);
    }
    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();
    await expect(trigger).toBeFocused();
    // Again, closed by its own action this time.
    await page.keyboard.press('Enter');
    await expect(dialog).toBeVisible();
    await dialog.getByRole('button', { name: 'Close decision note' }).click();
    await expect(dialog).toBeHidden();
    await expect(trigger).toBeFocused();
    expect(await page.evaluate(() => getComputedStyle(document.documentElement).overflow)).not.toBe(
      'hidden',
    );
  },
);

test(
  'the tooltip shows while its action has focus, closes on Escape, and describes the action',
  INTERACTION,
  async ({ page }) => {
    await openFixtures(page);
    const action = page.locator(DOCUMENT).getByRole('button', { name: 'Explain confidence' });
    const tooltip = page.locator('#confidence');
    await expect(action).toHaveAccessibleDescription(
      'Confidence combines recency, agreement, and coverage.',
    );
    await expect(tooltip).toHaveAttribute('role', 'tooltip');
    await expect(tooltip).toBeHidden();
    await action.focus();
    await expect(tooltip).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(tooltip).toBeHidden();
    await expect(action).toBeFocused();
    // Hovered, it shows after its delay, and stays while the pointer is on it.
    await page.keyboard.press('Tab');
    await expect(action).not.toBeFocused();
    await action.hover();
    await expect(tooltip).toBeVisible();
    await tooltip.hover();
    await page.waitForTimeout(400);
    await expect(tooltip).toBeVisible();
  },
);

test(
  'a disclosure opens and closes from its summary, and a radio group moves by arrow keys past a choice it lacks',
  INTERACTION,
  async ({ page }) => {
    await openFixtures(page);
    const disclosure = page.locator('#why');
    const summary = disclosure.locator('summary');
    await summary.focus();
    await page.keyboard.press('Enter');
    await expect(disclosure).toHaveAttribute('open', '');
    await page.keyboard.press('Space');
    await expect(disclosure).not.toHaveAttribute('open', '');

    const group = page.getByRole('group', { name: 'Review depth' }).first();
    const comfortable = group.getByRole('radio', { name: 'Comfortable' });
    await comfortable.focus();
    await expect(comfortable).toBeChecked();
    await page.keyboard.press('ArrowDown');
    await expect(group.getByRole('radio', { name: 'Compact' })).toBeChecked();
    // Dense needs a wider screen: it says so, and the arrows pass over it.
    const dense = group.getByRole('radio', { name: 'Dense' });
    await expect(dense).toBeDisabled();
    await expect(dense).toHaveAccessibleDescription('Needs a wider screen.');
    await page.keyboard.press('ArrowDown');
    await expect(comfortable).toBeChecked();
  },
);

test(
  'a toast is announced in the polite region without taking focus, and one with an action waits to be dismissed',
  INTERACTION,
  async ({ page }) => {
    await openFixtures(page);
    const region = page.locator('#toasts');
    await expect(region).toHaveAttribute('role', 'status');
    const toasts = region.locator('[data-ui-slot="toast"]');
    const buttons = page.locator(DOCUMENT);
    await buttons.getByRole('button', { name: 'Show a toast', exact: true }).click();
    const show = buttons.getByRole('button', { name: 'Show a toast with an action' });
    await show.focus();
    await page.keyboard.press('Enter');
    await expect(toasts).toHaveCount(2);
    await expect(show).toBeFocused();
    // The plain one goes by itself; the one with an action stays.
    await expect(toasts).toHaveCount(1, { timeout: 10_000 });
    const toast = toasts.first();
    await expect(toast).toContainText('Revision 17 was archived.');
    await toast.getByRole('button', { name: 'Undo' }).click();
    await expect(region.locator('[data-ui-slot="toast"]')).toHaveText(/Revision 17 is back\./);
    await region.getByRole('button', { name: 'Dismiss' }).click();
    await expect(region.locator('[data-ui-slot="toast"]')).toHaveCount(0);
  },
);
