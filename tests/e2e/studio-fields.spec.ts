import type { Browser, BrowserContext, Page } from '@playwright/test';
import { expect, test } from '../harness/fixtures';
import { ownerSecret } from '../harness/owner-secret.mjs';
import { ownerApp } from '../harness/profile-matrix';

// The content task's structured fields over #3's working draft (#8, Slice
// 4), against the built server with the password provider: a field edit is
// the editor's local unsaved change, it saves through the shell's save with
// the version read, the saved text is what source mode shows after a
// reload, a safe extension field included byte for byte, and a validation
// error shows beside its field and in the one complete summary.
const STUDIO = { type: 'route', description: '/studio' };

const secret = ownerSecret();
test.use({ appOptions: ownerApp(secret.hash) });
test.describe.configure({ mode: 'serial' });

const line = (page: Page, label: string) =>
  page
    .locator('.studio-state__line')
    .filter({ has: page.locator('dt', { hasText: new RegExp(`^${label}$`) }) })
    .locator('dd');

const draftVersion = async (page: Page) =>
  Number(/\d+/.exec((await line(page, 'Draft').textContent()) ?? '')![0]);

const portfolio = (page: Page) => page.getByLabel(/^portfolio\.(?:yml|json)$/);
const mode = (page: Page, name: 'Fields' | 'Source') =>
  page.getByRole('group', { name: 'Editing mode' }).getByRole('button', { name, exact: true });
const identity = (page: Page) => page.getByRole('group', { name: 'Identity', exact: true });

let signedIn: Awaited<ReturnType<BrowserContext['storageState']>> | undefined;

/**
 * A page signed in as the owner, from the one sign-in this spec makes, on
 * the content task, with the working draft started when there is none.
 */
async function content(browser: Browser, origin: string): Promise<Page> {
  if (!signedIn) {
    const context = await browser.newContext({ baseURL: origin });
    const page = await context.newPage();
    await page.goto('/studio/sign-in');
    await page.getByLabel('Password').fill(secret.password);
    await page.getByRole('button', { name: 'Sign in' }).click();
    await expect(page).toHaveURL(`${origin}/studio`);
    signedIn = await context.storageState();
    await context.close();
  }
  const context = await browser.newContext({ baseURL: origin, storageState: signedIn });
  const page = await context.newPage();
  await page.goto('/studio#content');
  const draft = line(page, 'Draft');
  await expect(draft).toHaveText(/^(?:Saved draft, version \d+\.|No saved draft yet\.)$/);
  if ((await draft.textContent()) === 'No saved draft yet.') {
    await page.getByRole('button', { name: 'Start a draft' }).click();
  }
  await expect(draft).toHaveText(/^Saved draft, version \d+\.$/);
  return page;
}

/** A safe extension field on the identity, written as source mode would hold it. */
const EXTENSION = `  extensions:\n    "@acme/portfolio-photography":\n      camera: Leica M6 # the one with the dent\n`;

test(
  'a field edit is a local unsaved change, saves the draft with the version read, and source mode shows the same text after a reload, extension fields included',
  { annotation: [STUDIO] },
  async ({ browser, app }) => {
    const page = await content(browser, app.origin);
    // The fields are where the content task opens.
    await expect(mode(page, 'Fields')).toHaveAttribute('aria-pressed', 'true');
    await expect(identity(page)).toBeVisible();

    // Source mode: a safe extension field under the identity, saved.
    await mode(page, 'Source').click();
    const text = await portfolio(page).inputValue();
    expect(text).toContain('  name: Rowan Fixture\n');
    await portfolio(page).fill(
      text.replace('  name: Rowan Fixture\n', `  name: Rowan Fixture\n${EXTENSION}`),
    );
    await page.getByRole('button', { name: 'Save draft' }).click();
    await expect(line(page, 'This browser')).toHaveText('No unsaved changes.');
    const version = await draftVersion(page);

    // Back in the fields: the extension is named and left alone, and an edit is unsaved here.
    await mode(page, 'Fields').click();
    await expect(identity(page)).toContainText(
      'Extension fields, kept as written: @acme/portfolio-photography.',
    );
    const tagline = identity(page).getByLabel('Tagline', { exact: true });
    await expect(tagline).toHaveValue('Builds calm software for testing harnesses.');
    await tagline.fill('Builds calmer software for testing harnesses.');
    await expect(line(page, 'This browser')).toHaveText(
      'Unsaved changes, kept in this browser until you save.',
    );
    await expect(line(page, 'Publish')).toHaveText('Not ready to publish: it has unsaved changes.');

    const save = page.waitForRequest((request) => request.url().endsWith('/api/studio/draft.save'));
    await page.getByRole('button', { name: 'Save draft' }).click();
    const sent = (await save).postDataJSON() as {
      expectedVersion: number;
      documents: { portfolio: { sourceText: string } };
    };
    expect(sent.expectedVersion).toBe(version);
    const saved = sent.documents.portfolio.sourceText;
    // Only the tagline's line changed: the extension field is as written, comment and all.
    expect(saved).toBe(
      text
        .replace('  name: Rowan Fixture\n', `  name: Rowan Fixture\n${EXTENSION}`)
        .replace(
          '  tagline: Builds calm software for testing harnesses.\n',
          '  tagline: Builds calmer software for testing harnesses.\n',
        ),
    );
    await expect(line(page, 'Draft')).toHaveText(`Saved draft, version ${version + 1}.`);
    await expect(line(page, 'This browser')).toHaveText('No unsaved changes.');

    // A reload keeps the tab's mode; source mode then shows exactly the saved text.
    await page.reload();
    await expect(mode(page, 'Fields')).toHaveAttribute('aria-pressed', 'true');
    await expect(identity(page).getByLabel('Tagline', { exact: true })).toHaveValue(
      'Builds calmer software for testing harnesses.',
    );
    await mode(page, 'Source').click();
    await expect(portfolio(page)).toHaveValue(saved);
    await page.context().close();
  },
);

test(
  'a validation error shows beside its field and in the one complete summary, with its document, item, field, cause, and next action',
  { annotation: [STUDIO] },
  async ({ browser, app }) => {
    const page = await content(browser, app.origin);
    await mode(page, 'Fields').click();
    const name = identity(page).getByLabel('Name (required)', { exact: true });
    await name.fill('');
    await page.getByRole('button', { name: 'Save draft' }).click();
    await expect(line(page, 'This browser')).toHaveText('No unsaved changes.');
    await expect(line(page, 'Checks')).toHaveText(
      /^Validation failed: \d+ findings? in the saved draft blocks? publishing\.$/,
    );
    // Beside the field, in words: what's wrong and what to do.
    const field = identity(page).locator('.studio-fields__field[data-pointer="/identity/name"]');
    await expect(field.locator('.studio-fields__finding')).toContainText('is blank');
    await expect(field.locator('.studio-fields__finding')).toContainText(
      'Change it in the Name field of Identity',
    );

    // The one summary, in the validation task.
    await page.getByRole('link', { name: 'Validation', exact: true }).click();
    const entry = page
      .locator('.studio-validation__list li')
      .filter({ has: page.locator('dd', { hasText: /^name$/ }) });
    await expect(entry).toHaveCount(1);
    await expect(entry.locator('dt')).toHaveText(['Document', 'Item', 'Field', 'Cause', 'Next']);
    await expect(entry.locator('dd')).toHaveText([
      /^portfolio\.yml(?:, line \d+)?$/,
      'Identity',
      'name',
      /is blank/,
      /Change it in the Name field of Identity, or in source mode, portfolio\.yml(?:, line \d+)?\.$/,
    ]);

    // Fixed in the field, the error goes on the next save.
    await page.getByRole('link', { name: 'Content', exact: true }).click();
    await identity(page).getByLabel('Name (required)', { exact: true }).fill('Rowan Fixture');
    await page.getByRole('button', { name: 'Save draft' }).click();
    await expect(line(page, 'This browser')).toHaveText('No unsaved changes.');
    await expect(
      identity(page).locator(
        '.studio-fields__field[data-pointer="/identity/name"] .studio-fields__finding',
      ),
    ).toHaveCount(0);
    await page.context().close();
  },
);
