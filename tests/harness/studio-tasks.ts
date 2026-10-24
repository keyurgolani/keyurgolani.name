import { expect, type Locator, type Page } from '@playwright/test';

// Opening a Studio task the way the owner does (#8): through its link in the
// "Studio tasks" navigation, once the shell has loaded the draft. A
// fragment-only page.goto('/studio#<task>') right after signIn() sometimes
// never landed on the task (#129), and gave no page state when it didn't, so
// each step here fails on its own, with what the page shows. The content
// task is the default, so a spec that wants it needs no step.

/**
 * Opens the task whose link reads `label`, such as Appearance or Publish
 * history, and checks the link marks it as the current page.
 */
export async function openTask(page: Page, label: string): Promise<void> {
  await shows(page, page.locator('.studio-state__lines'), `${label}: the shell loads the draft`);
  const link = page
    .getByRole('navigation', { name: 'Studio tasks' })
    .getByRole('link', { name: label, exact: true });
  await shows(page, link, `${label}: the task's link shows`);
  await link.click();
  await expect(link).toHaveAttribute('aria-current', 'page');
}

/** Waits for `target`, and on failure, logs the step and the main region's text. */
export async function shows(page: Page, target: Locator, step: string): Promise<void> {
  try {
    await expect(target).toBeVisible();
  } catch (error) {
    const text = await page
      .locator('main')
      .innerText()
      .catch(() => '(no main)');
    console.log(`studio: ${step} failed; the page shows:\n${text}`);
    throw error;
  }
}
