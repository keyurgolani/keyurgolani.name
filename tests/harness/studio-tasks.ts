import { expect, type Locator, type Page } from '@playwright/test';

// Opening a Studio task the way the owner does (#8): through its link in the
// "Studio tasks" navigation, once the shell has loaded the draft. A
// fragment-only page.goto('/studio#<task>') right after signIn() sometimes
// never landed on the task (#129), and gave no page state when it didn't, so
// each step here fails on its own, with what the page shows. A fresh tab
// lands on Appearance, and a tab back on the task it last used (OWN-3), so a
// spec opens the task it wants, or sets studioLastTask. In the
// Appearance workspace (the Studio mockup, owner direction, 2026-10-25) the
// owner's task links sit in the top bar, and Demo Studio's behind its source
// menu, or at a phone's width behind the bar's menu, which this opens first.
// The state lines sit in that menu or out of sight, so the shell counts as
// loaded once they're in the page. The Appearance pickers' helpers live here
// too (lane B, the redesign brief's 3.6), one place for both Studios' specs.

/**
 * Demo Studio's frame of the latest document. While the stage's double-buffered frame swaps
 * (demo-frame.tsx, P-5 slice 4), the document on screen stays under the next one as a second
 * iframe, marked leaving, until the next has painted: this is the next one, and the only one
 * once the swap is done, so a spec that waits on a pick's document never sees two.
 */
export const DEMO_FRAME = 'iframe:not([data-twin="leaving"])';

/**
 * Opens the task whose link is named `label`, such as Appearance or Publish
 * history, and checks the link marks it as the current page.
 */
export async function openTask(page: Page, label: string): Promise<void> {
  await attached(page, page.locator('.studio-state__lines'), `${label}: the shell loads the draft`);
  const navigation = page.getByRole('navigation', { name: 'Studio tasks' });
  const link = navigation.getByRole('link', { name: label, exact: true });
  const menu = page.locator('button[data-task-menu]').first();
  if (!(await link.isVisible()) && (await menu.count()) > 0) await menu.click();
  await shows(page, link, `${label}: the task's link shows`);
  const href = await link.getAttribute('href');
  await link.click();
  // A workspace's menu closes as its link is followed, so the check reads the link shown or not.
  await expect(
    page.locator(`nav[aria-label="Studio tasks"] a.studio-shell__task[href="${href}"]`).first(),
  ).toHaveAttribute('aria-current', 'page');
}

/** Waits for `target`, and on failure, logs the step and the main region's text. */
export async function shows(page: Page, target: Locator, step: string): Promise<void> {
  try {
    await expect(target).toBeVisible();
  } catch (error) {
    await logMain(page, step);
    throw error;
  }
}

/** Waits for `target` in the page, shown or behind a disclosure, and on failure logs as shows() does. */
async function attached(page: Page, target: Locator, step: string): Promise<void> {
  try {
    await expect(target).toBeAttached();
  } catch (error) {
    await logMain(page, step);
    throw error;
  }
}

async function logMain(page: Page, step: string): Promise<void> {
  const text = await page
    .locator('main')
    .innerText()
    .catch(() => '(no main)');
  console.log(`studio: ${step} failed; the page shows:\n${text}`);
}

/**
 * An Appearance picker's radio group, by its accessible name, shown or in a
 * closed section of the rail's accordion, which pick() opens.
 */
export const picker = (scope: Page | Locator, name: string) =>
  scope.getByRole('radiogroup', { name, exact: true, includeHidden: true });

/** The value a picker has checked, by its option's data-option: each option is a label around a native radio. */
export const checkedIn = (group: Locator) =>
  group.locator('label:has(> input:checked)').getAttribute('data-option');

/**
 * Before the composition picker is read, every family in it, as pick() does: with more than 8
 * compositions ready it opens on the checked one's family (pickers.tsx), so a read of the open
 * family alone misses the rest (demo-studio-compare's grid of four counted 3 of 14). Its section
 * opens first, as for a pick. One out of reach, a phone's sheet on another tab with no section to
 * open, reads as it stands. Any other picker has no families and reads as it stands.
 */
async function underAll(group: Locator): Promise<void> {
  const box = group.locator(
    'xpath=ancestor::*[contains(concat(" ", normalize-space(@class), " "), " studio-compositions ")]',
  );
  if ((await box.count()) === 0) return;
  const fold = group.locator('xpath=ancestor::details[contains(@class, "studio-split__fold")]');
  if (!(await group.isVisible()) && (await fold.count()) === 0) return;
  await reveal(group);
  await showAllFamilies(group);
}

/** The data-option of every option in `group` that `selector` matches, in order, the composition picker's under All. */
async function valuesIn(group: Locator, selector: string): Promise<string[]> {
  await underAll(group);
  return group
    .locator(selector)
    .evaluateAll((radios) => radios.map((radio) => radio.getAttribute('data-option') ?? ''));
}

/** Every value a picker offers, in order, by data-option: one held off too, as Case study with none. */
export const optionsIn = (group: Locator) => valuesIn(group, 'label[data-option]');

/** The options `group` lets the owner pick, in order: every one it lists but those held off. */
export const readyIn = (group: Locator) =>
  valuesIn(group, 'label[data-option]:not(:has(> input:disabled))');

/** The options `group` lists but holds off, as compositions still in progress (A2). */
export const heldIn = (group: Locator) =>
  valuesIn(group, 'label[data-option]:has(> input:disabled)');

/**
 * Opens the rail's section that holds `group`, when it's a closed one: on wide
 * screens the axes are an accordion, one open at a time.
 */
export async function reveal(group: Locator): Promise<void> {
  if (await group.isVisible()) return;
  const fold = group.locator('xpath=ancestor::details[contains(@class, "studio-split__fold")]');
  if ((await fold.count()) > 0) await fold.locator(':scope > summary').click();
  await expect(group).toBeVisible();
}

/**
 * Shows every family in the composition picker that holds `group`, by its All chip: with more
 * than 8 compositions ready the picker opens on the current one's family (pickers.tsx), so one
 * from another family isn't in the group until All is pressed. Nothing when it has no chips.
 */
export async function showAllFamilies(group: Locator): Promise<void> {
  const name = 'Layout families, ready ones';
  const chips = group
    .locator('xpath=ancestor::*')
    .filter({ has: group.page().getByRole('group', { name, exact: true }) })
    .last()
    .getByRole('group', { name, exact: true });
  if ((await chips.count()) === 0) return;
  const all = chips.getByRole('button', { name: /^All/ });
  if ((await all.getAttribute('aria-pressed')) !== 'true') await all.click();
  await expect(all).toHaveAttribute('aria-pressed', 'true');
}

/** Checks `value` in a picker, by a click on its option, opening its section first. */
export async function pick(group: Locator, value: string): Promise<void> {
  await reveal(group);
  const option = group.locator(`label[data-option="${value}"]`);
  // A composition from another family than the checked one's shows under All.
  if ((await option.count()) === 0) await showAllFamilies(group);
  await option.scrollIntoViewIfNeeded();
  await option.click();
  await expect(option.locator('input')).toBeChecked();
}
