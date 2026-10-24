import type { Page } from '@playwright/test';
import { expect, test } from '../harness/fixtures';
import { ownerSecret } from '../harness/owner-secret.mjs';
import { command, seedDraft, signIn } from '../harness/preview-grants';
import { ownerApp } from '../harness/profile-matrix';

// Keeping the owner's unsaved text (#8, Slice 8), against the built server
// with the password provider: a duplicated tab, whose sessionStorage, and
// so whose journal id, is a copy of its original's, takes an id of its own,
// so neither tab writes over the other's text; and text typed while an
// Appearance apply is in flight, when the apply meets a newer version,
// stays in the editor beside that version, as a stale save's does.
const STUDIO = { type: 'route', description: '/studio' };
const JOURNAL_KEY = 'portfolio-studio:journal:v1';
const TAB_KEY = 'portfolio-studio:tab';

const secret = ownerSecret();
test.use({ appOptions: ownerApp(secret.hash) });
test.describe.configure({ mode: 'serial' });

const line = (page: Page, label: string) =>
  page
    .locator('.studio-state__line')
    .filter({ has: page.locator('dt', { hasText: new RegExp(`^${label}$`) }) })
    .locator('dd');

const portfolio = (page: Page) => page.getByLabel(/^portfolio\.(?:yml|json)$/);

/** The content task's source mode, where these tests edit the text. */
const sourceMode = (page: Page) =>
  page.getByRole('button', { name: 'Source', exact: true }).click();

/** Each journal entry's tab and the portfolio text it keeps. */
const journal = (page: Page) =>
  page.evaluate((key) => {
    const entries = JSON.parse(localStorage.getItem(key) ?? '[]') as {
      tabId: string;
      documents: { portfolio: { sourceText: string } };
    }[];
    return entries.map(({ tabId, documents }) => ({ tabId, text: documents.portfolio.sourceText }));
  }, JOURNAL_KEY);

test(
  "a duplicated tab takes a journal id of its own, so neither tab's unsaved text overwrites the other's",
  { annotation: [STUDIO] },
  async ({ context, app }) => {
    const draft = await seedDraft(app, 'Rowan Twin');
    const first = await context.newPage();
    await signIn(first, app, secret.password);
    await first.goto('/studio#content');
    await sourceMode(first);
    const saved = draft.documents.portfolio.sourceText;
    await expect(portfolio(first)).toHaveValue(saved);
    await portfolio(first).fill(`${saved}# the first tab's\n`);
    await expect.poll(() => journal(first)).toHaveLength(1);
    const original = await first.evaluate((key) => sessionStorage.getItem(key), TAB_KEY);
    expect(original).toBeTruthy();

    // A duplicate starts with a copy of the first tab's sessionStorage, its id included.
    const second = await context.newPage();
    await second.addInitScript(
      ({ key, id }) => {
        if (!sessionStorage.getItem(key)) sessionStorage.setItem(key, id);
      },
      { key: TAB_KEY, id: original! },
    );
    await second.goto('/studio#content');
    await sourceMode(second);
    // The first tab is open and holds its text, so the duplicate shows the saved draft, under a new id.
    await expect(portfolio(second)).toHaveValue(saved);
    await expect
      .poll(() => second.evaluate((key) => sessionStorage.getItem(key), TAB_KEY))
      .not.toBe(original);
    await portfolio(second).fill(`${saved}# the duplicate's\n`);
    await expect.poll(async () => (await journal(second)).length).toBe(2);
    const entries = await journal(second);
    expect(entries.find(({ tabId }) => tabId === original)?.text).toBe(
      `${saved}# the first tab's\n`,
    );
    expect(entries.find(({ tabId }) => tabId !== original)?.text).toBe(
      `${saved}# the duplicate's\n`,
    );
  },
);

test(
  'text typed while an Appearance apply is in flight stays beside the newer version the apply met',
  { annotation: [STUDIO] },
  async ({ page, app }) => {
    const draft = await seedDraft(app, 'Rowan Raced');
    const csrf = await signIn(page, app, secret.password);
    await page.goto('/studio#appearance');
    const form = page.getByRole('form', { name: 'Appearance' });
    const composition = form.getByRole('combobox', { name: 'Composition the site shows' });
    // The workspace renders its options once the draft is in: wait for two, as #124 does.
    await expect(composition.locator('option').nth(1)).toBeAttached();
    const current = await composition.inputValue();
    const target = await composition
      .locator('option')
      .evaluateAll(
        (options, now) =>
          options
            .map((option) => (option as HTMLOptionElement).value)
            .find((value) => value !== now),
        current,
      );
    expect(target, 'another composition this build offers').toBeTruthy();
    await composition.selectOption(target!);

    // Hold the apply until the owner has typed and another save has landed.
    let release = () => {};
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    let arrived = () => {};
    const sent = new Promise<void>((resolve) => {
      arrived = resolve;
    });
    await page.route('**/api/studio/draft.applyEdits', async (route) => {
      arrived();
      await held;
      await route.continue();
    });
    await form.getByRole('button', { name: 'Apply to the draft' }).click();
    await sent;

    await page.getByRole('link', { name: 'Content' }).click();
    await sourceMode(page);
    const typed = `${draft.documents.portfolio.sourceText}# typed while it applied\n`;
    await portfolio(page).fill(typed);
    // Another tab, or the command line, saves first.
    const other = await command(page, csrf, 'draft.save', {
      draftId: draft.draftId,
      expectedVersion: draft.version,
      documents: {
        portfolio: {
          format: 'yaml',
          sourceText: `${draft.documents.portfolio.sourceText}# saved elsewhere\n`,
        },
        site: { format: draft.documents.site.format, sourceText: draft.documents.site.sourceText },
      },
    });
    expect(other.status, JSON.stringify(other.body)).toBe(200);
    release();

    await expect(page.locator('.studio-state__notice')).toHaveText(
      `Not applied: version ${draft.version + 1} was saved first. Your changes are kept.`,
    );
    // The typed text stays, unsaved, beside the newer version, until the owner chooses.
    await expect(portfolio(page)).toHaveValue(typed);
    await expect(line(page, 'This browser')).toHaveText(
      'Unsaved changes that conflict with a newer saved draft. Choose which to keep.',
    );
    await expect(page.getByRole('button', { name: 'Keep my changes' })).toBeVisible();
    await expect(
      page.getByRole('button', { name: `Use version ${draft.version + 1}` }),
    ).toBeVisible();
    await expect.poll(async () => (await journal(page)).map(({ text }) => text)).toEqual([typed]);
  },
);

test(
  "when the part that reaches the store doesn't arrive, Studio says it couldn't load, puts focus on Reload, and stops saying it's loading",
  { annotation: [STUDIO] },
  async ({ page, app }) => {
    await signIn(page, app, secret.password);
    await page.goto('/studio');
    await expect(line(page, 'Draft')).toBeVisible();
    // The owner adapter's chunk, the one script that names its commands, is refused; the rest load.
    const refused: string[] = [];
    await page.route(/\/_next\/static\/chunks\/.*\.js/, async (route) => {
      const response = await route.fetch();
      const body = await response.text();
      if (!/["']draft\.applyEdits["']/.test(body)) return route.fulfill({ response, body });
      refused.push(route.request().url());
      return route.abort('blockedbyclient');
    });
    await page.reload();
    await expect
      .poll(() => refused.length, "the owner adapter's chunk is asked for, and refused")
      .toBe(1);
    const alert = page.getByRole('alert').filter({ hasText: "Studio couldn't load" });
    // Refused at once, or past the shell's 15 second wait for a chunk that hangs.
    await expect(alert).toBeVisible({ timeout: 20_000 });
    await expect(page.getByRole('button', { name: 'Reload Studio' })).toBeFocused();
    await expect(page.locator('[aria-busy="true"]')).toHaveCount(0);
    // Each task link's fragment still names an element.
    for (const id of ['content', 'appearance', 'history']) {
      await expect(page.locator(`[id="${id}"]`)).toHaveCount(1);
    }
  },
);
