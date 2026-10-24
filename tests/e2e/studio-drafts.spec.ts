import type { Browser, BrowserContext, Page } from '@playwright/test';
import { expect, test } from '../harness/fixtures';
import { ownerSecret } from '../harness/owner-secret.mjs';
import { ownerApp } from '../harness/profile-matrix';

// The Owner Studio shell over #3's working draft (#8, Slice 1), against the
// built server with the password provider: the seven tasks and the textual
// state model, source mode saving a draft version, a stale save from a
// second tab meeting the newer version with both kept until the owner
// chooses, the local journal across a reload and at sign-out, and a 401
// keeping unsaved text and going to sign-in. One sign-in, kept as storage
// state, serves every context, so the spec stays under sign-in's rate limit.
const STUDIO = { type: 'route', description: '/studio' };
const JOURNAL_KEY = 'portfolio-studio:journal:v1';

const secret = ownerSecret();
test.use({ appOptions: ownerApp(secret.hash) });
test.describe.configure({ mode: 'serial' });

let signedIn: Awaited<ReturnType<BrowserContext['storageState']>> | undefined;

/** A context signed in as the owner, from the one sign-in this spec makes. */
async function owner(browser: Browser, origin: string): Promise<BrowserContext> {
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
  return browser.newContext({ baseURL: origin, storageState: signedIn });
}

const line = (page: Page, label: string) =>
  page
    .locator('.studio-state__line')
    .filter({ has: page.locator('dt', { hasText: new RegExp(`^${label}$`) }) })
    .locator('dd');

/** Opens the content task, starting the working draft when there is none. */
async function content(page: Page): Promise<number> {
  await page.goto('/studio#content');
  const draft = line(page, 'Draft');
  await expect(draft).toHaveText(/^(?:Saved draft, version \d+\.|No saved draft yet\.)$/);
  if ((await draft.textContent()) === 'No saved draft yet.') {
    await page.getByRole('button', { name: 'Start a draft' }).click();
  }
  await expect(draft).toHaveText(/^Saved draft, version \d+\.$/);
  // This spec edits the text: source mode, which the tab keeps across a reload.
  await page.getByRole('button', { name: 'Source', exact: true }).click();
  return Number(/\d+/.exec((await draft.textContent()) ?? '')![0]);
}

const portfolio = (page: Page) => page.getByLabel(/^portfolio\.(?:yml|json)$/);

/** The portfolio's text with a comment of its own at the end, a change that keeps it valid YAML. */
async function edit(page: Page, marker: string): Promise<string> {
  const field = portfolio(page);
  const text = `${(await field.inputValue()).replace(/\n# studio-drafts .*\n?$/, '\n')}# studio-drafts ${marker}\n`;
  await field.fill(text);
  return text;
}

test(
  'the shell lists seven tasks and the state model, and source mode saves a new draft version',
  { annotation: [STUDIO] },
  async ({ browser, app }) => {
    const context = await owner(browser, app.origin);
    try {
      const page = await context.newPage();
      const version = await content(page);
      await expect(
        page.getByRole('navigation', { name: 'Studio tasks' }).getByRole('link'),
      ).toHaveText([
        'Content',
        'Case studies and artifacts',
        'Media',
        'Appearance',
        'Site behavior',
        'Validation',
        'Publish history',
      ]);
      await expect(page.getByRole('link', { name: 'Content' })).toHaveAttribute(
        'aria-current',
        'page',
      );
      // No crawler indexes Studio, and it loads no variant stylesheet or JSON-LD.
      await expect(page.locator('meta[name="robots"]')).toHaveAttribute(
        'content',
        'noindex, nofollow',
      );
      await expect(
        page.locator('link[rel="stylesheet"][href*="/_portfolio/variant/"]'),
      ).toHaveCount(0);
      await expect(page.locator('script[type="application/ld+json"]')).toHaveCount(0);
      // Seven lines, each in words.
      await expect(page.locator('.studio-state__line dt')).toHaveText([
        'This browser',
        'Draft',
        'Preview',
        'Checks',
        'Publish',
        'Published revision',
        'Live',
      ]);
      await expect(line(page, 'This browser')).toHaveText('No unsaved changes.');
      await expect(line(page, 'Preview')).toHaveText(
        'A preview shows the saved draft, and is never live.',
      );
      // The harness's site selects missing-variant, which blocks publishing.
      await expect(line(page, 'Checks')).toHaveText(
        /^Validation failed: \d+ findings? in the saved draft blocks? publishing\.$/,
      );
      await expect(line(page, 'Publish')).toHaveText('Not ready to publish: validation failed.');
      await expect(line(page, 'Live')).toHaveText(
        /^Revision rev_[0-9a-f]{12}, number \d+, is live\./,
      );

      const text = await edit(page, 'first');
      await expect(line(page, 'This browser')).toHaveText(
        'Unsaved changes, kept in this browser until you save.',
      );
      const save = page.waitForRequest((request) =>
        request.url().endsWith('/api/studio/draft.save'),
      );
      await page.getByRole('button', { name: 'Save draft' }).click();
      const sent = await save;
      // The text goes in the JSON body with the version read, never the URL.
      expect(new URL(sent.url()).search).toBe('');
      expect(sent.headers()['content-type']).toBe('application/json');
      expect(sent.postDataJSON()).toMatchObject({ expectedVersion: version });
      await expect(line(page, 'Draft')).toHaveText(`Saved draft, version ${version + 1}.`);
      await expect(line(page, 'This browser')).toHaveText('No unsaved changes.');
      await expect(page.getByRole('status')).toHaveText(
        `Saved the draft as version ${version + 1}.`,
      );
      await page.reload();
      await expect(portfolio(page)).toHaveValue(text);

      // The validation task lists every finding, with its document and fix.
      await page.getByRole('link', { name: 'Validation' }).click();
      await expect(page).toHaveURL(/#validation$/);
      await expect(page.getByRole('heading', { level: 2, name: 'Validation' })).toBeVisible();
      await expect(page.locator('.studio-validation__list li').first()).toContainText(
        'variant.unavailable',
      );
      // A task a later pull request builds says so.
      await page.getByRole('link', { name: 'Media' }).click();
      await expect(page.locator('.studio-task__pending')).toContainText(
        'arrives with a later Studio release',
      );
    } finally {
      await context.close();
    }
  },
);

test(
  "a second tab's stale save meets the newer version, overwrites nothing, and keeps both until the owner chooses",
  { annotation: [STUDIO] },
  async ({ browser, app }) => {
    // Two contexts, so each tab keeps a journal of its own.
    const first = await owner(browser, app.origin);
    const second = await owner(browser, app.origin);
    try {
      const a = await first.newPage();
      const b = await second.newPage();
      const version = await content(a);
      expect(await content(b)).toBe(version);

      const theirs = await edit(a, 'tab a');
      await a.getByRole('button', { name: 'Save draft' }).click();
      await expect(line(a, 'Draft')).toHaveText(`Saved draft, version ${version + 1}.`);

      const mine = await edit(b, 'tab b');
      await b.getByRole('button', { name: 'Save draft' }).click();
      const panel = b.getByRole('region', { name: `Version ${version + 1} was saved first` });
      await expect(panel).toBeVisible();
      await expect(panel).toBeFocused();
      await expect(b.getByRole('status')).toHaveText(
        `Not saved: version ${version + 1} was saved first. Your changes are kept.`,
      );
      // Nothing was overwritten: tab B still holds its text, and the store tab A's.
      await expect(portfolio(b)).toHaveValue(mine);
      await expect(line(b, 'This browser')).toHaveText(
        'Unsaved changes that conflict with a newer saved draft. Choose which to keep.',
      );
      await a.reload();
      await expect(portfolio(a)).toHaveValue(theirs);
      // The newer version is there to read in tab B.
      await panel.getByText(`Show version ${version + 1}`).click();
      await expect(panel.getByLabel(/^portfolio\.(?:yml|json), version \d+$/)).toHaveValue(theirs);
      // And tab B's text survives a reload, as the same conflict.
      await b.reload();
      await expect(portfolio(b)).toHaveValue(mine);
      await expect(
        b.getByRole('region', { name: `Version ${version + 1} was saved first` }),
      ).toBeVisible();

      // Keep my changes saves tab B's text on top of the newer version.
      await b.getByRole('button', { name: 'Keep my changes' }).click();
      await expect(line(b, 'Draft')).toHaveText(`Saved draft, version ${version + 2}.`);
      await a.reload();
      await expect(portfolio(a)).toHaveValue(mine);

      // The other way: tab A's stale save, then Use version, which lets its text go.
      await edit(a, 'tab a again');
      const newest = await edit(b, 'tab b again');
      await b.getByRole('button', { name: 'Save draft' }).click();
      await expect(line(b, 'Draft')).toHaveText(`Saved draft, version ${version + 3}.`);
      await a.getByRole('button', { name: 'Save draft' }).click();
      await a.getByRole('button', { name: `Use version ${version + 3}` }).click();
      await expect(portfolio(a)).toHaveValue(newest);
      await expect(line(a, 'This browser')).toHaveText('No unsaved changes.');
      await expect
        .poll(() => a.evaluate((key) => localStorage.getItem(key), JOURNAL_KEY))
        .toBeNull();
    } finally {
      await first.close();
      await second.close();
    }
  },
);

test(
  'unsaved text survives a reload from the journal, and sign-out asks whether to keep or discard it',
  { annotation: [STUDIO] },
  async ({ browser, app }) => {
    const context = await owner(browser, app.origin);
    try {
      const page = await context.newPage();
      await content(page);
      const text = await edit(page, 'kept');
      await expect
        .poll(() => page.evaluate((key) => localStorage.getItem(key), JOURNAL_KEY))
        .toContain('studio-drafts kept');
      await page.reload();
      await expect(portfolio(page)).toHaveValue(text);
      await expect(line(page, 'This browser')).toHaveText(
        'Unsaved changes, restored from this browser. Save them to the draft.',
      );
      // Sign-out asks first, and Cancel signs nothing out.
      await page.getByRole('button', { name: 'Sign out' }).click();
      const dialog = page.getByRole('dialog', { name: 'Keep your unsaved changes?' });
      await expect(dialog).toBeVisible();
      await dialog.getByRole('button', { name: 'Cancel' }).click();
      await expect(dialog).toBeHidden();
      await page.getByRole('button', { name: 'Sign out' }).click();
      await dialog.getByRole('button', { name: 'Discard them and sign out' }).click();
      await expect(page).toHaveURL(`${app.origin}/studio/sign-in?state=signed_out`);
      expect(await page.evaluate((key) => localStorage.getItem(key), JOURNAL_KEY)).toBeNull();
      // The sign-in page shows nothing of the journal, and the session is over.
      await expect(page.locator('body')).not.toContainText('studio-drafts');
    } finally {
      await context.close();
      // That sign-out ended the spec's session: the next test signs in again.
      signedIn = undefined;
    }
  },
);

test(
  'a 401 keeps the unsaved text in the journal, drops the draft from the page, and goes to sign-in with returnTo',
  { annotation: [STUDIO] },
  async ({ browser, app }) => {
    const context = await owner(browser, app.origin);
    try {
      const page = await context.newPage();
      await content(page);
      await edit(page, 'before the 401');
      await page.route('**/api/studio/draft.save', (route) =>
        route.fulfill({
          status: 401,
          contentType: 'application/json',
          body: JSON.stringify({
            error: { code: 'session_required', message: 'Sign in.', requestId: 'stub' },
          }),
        }),
      );
      await page.getByRole('button', { name: 'Save draft' }).click();
      await expect(page).toHaveURL(
        `${app.origin}/studio/sign-in?state=session_ended&returnTo=%2Fstudio%23content`,
      );
      await expect(page).toHaveTitle(/Portfolio Studio/);
      expect(await page.evaluate((key) => localStorage.getItem(key), JOURNAL_KEY)).toContain(
        'studio-drafts before the 401',
      );
      await expect(page.locator('body')).not.toContainText('studio-drafts');
      // Signed in again, the text comes back from the journal.
      await page.unrouteAll();
      await page.getByLabel('Password').fill(secret.password);
      await page.getByRole('button', { name: 'Sign in' }).click();
      await expect(page).toHaveURL(`${app.origin}/studio#content`);
      await expect(portfolio(page)).toHaveValue(/# studio-drafts before the 401\n$/);
      await expect(line(page, 'This browser')).toHaveText(
        'Unsaved changes, restored from this browser. Save them to the draft.',
      );
    } finally {
      await context.close();
      // Signing in again there replaced the spec's session: the next test signs in afresh.
      signedIn = undefined;
    }
  },
);

/** Every entry the journal holds, as a page in the context reads it. */
async function journal(
  page: Page,
): Promise<{ tabId: string; savedAt: number; documents: { portfolio: { sourceText: string } } }[]> {
  return page.evaluate((key) => JSON.parse(localStorage.getItem(key) ?? '[]'), JOURNAL_KEY);
}

test(
  "two pages in one browser: a page with no edits leaves the other's entry alone, and a later page takes it once its page is gone",
  { annotation: [STUDIO] },
  async ({ browser, app }) => {
    const context = await owner(browser, app.origin);
    try {
      const a = await context.newPage();
      await content(a);
      const text = await edit(a, 'page a only');
      await expect.poll(async () => (await journal(a)).length).toBe(1);
      const [mine] = await journal(a);

      // B opens while A is open: A's text stays A's, and B has none of its own.
      const b = await context.newPage();
      await content(b);
      await expect(line(b, 'This browser')).toHaveText('No unsaved changes.');
      await expect(portfolio(b)).not.toHaveValue(text);
      await b.reload();
      await expect(line(b, 'This browser')).toHaveText('No unsaved changes.');
      await b.close({ runBeforeUnload: true });
      await expect
        .poll(async () => (await journal(a)).map((entry) => entry.tabId))
        .toEqual([mine!.tabId]);
      expect((await journal(a))[0]!.documents.portfolio.sourceText).toBe(text);

      // Once A is gone, a page that opens takes its text, as from a closed tab.
      await a.close({ runBeforeUnload: true });
      const c = await context.newPage();
      await content(c);
      await expect(portfolio(c)).toHaveValue(text);
      await expect(line(c, 'This browser')).toHaveText(
        'Unsaved changes, restored from this browser. Save them to the draft.',
      );
      await expect
        .poll(async () => (await journal(c)).map((entry) => entry.tabId))
        .not.toContain(mine!.tabId);
      // Saved, it leaves the journal empty.
      await c.getByRole('button', { name: 'Save draft' }).click();
      await expect(line(c, 'This browser')).toHaveText('No unsaved changes.');
      await expect.poll(async () => (await journal(c)).length).toBe(0);
    } finally {
      await context.close();
    }
  },
);

test(
  'an entry is dated by its last edit, so opening Studio never extends it, and the sign-in page removes one past 7 days',
  { annotation: [STUDIO] },
  async ({ browser, app }) => {
    const context = await owner(browser, app.origin);
    try {
      const page = await context.newPage();
      await content(page);
      const working = await page.request.get('/api/studio/draft.getWorking');
      const { draft } = (await working.json()).data as {
        draft: {
          draftId: string;
          version: number;
          documents: Record<string, { format: string; sourceText: string }>;
        };
      };
      const hour = 60 * 60 * 1000;
      const seed = (savedAt: number) => [
        {
          tabId: 'seededtab1',
          draftId: draft.draftId,
          baseVersion: draft.version,
          documents: {
            portfolio: {
              format: draft.documents.portfolio!.format,
              sourceText: `${draft.documents.portfolio!.sourceText}# studio-drafts seeded\n`,
            },
            site: draft.documents.site,
            ...(draft.documents.media ? { media: draft.documents.media } : {}),
          },
          savedAt,
        },
      ];
      const savedAt = Date.now() - 165 * hour;
      await page.evaluate(([key, value]) => localStorage.setItem(key, value), [
        JOURNAL_KEY,
        JSON.stringify(seed(savedAt)),
      ] as const);
      // A page that opens restores it, and keeps its date.
      const later = await context.newPage();
      await content(later);
      await expect(portfolio(later)).toHaveValue(/# studio-drafts seeded\n$/);
      await expect.poll(async () => (await journal(later)).length).toBe(1);
      // Past the shell's pause, its own write keeps the date, and so does a reload's.
      await later.waitForTimeout(1_000);
      expect((await journal(later))[0]!.savedAt).toBe(savedAt);
      await later.reload();
      await expect(portfolio(later)).toHaveValue(/# studio-drafts seeded\n$/);
      await later.waitForTimeout(1_000);
      expect((await journal(later))[0]!.savedAt).toBe(savedAt);
      await later.close();
      await page.close();

      // Past 7 days, the sign-in page drops it before anyone signs in. The
      // entry goes in from a page that isn't Studio, so no shell prunes it first.
      const outside = await context.newPage();
      await outside.goto('/api/health');
      await outside.evaluate(([key, value]) => localStorage.setItem(key, value), [
        JOURNAL_KEY,
        JSON.stringify(seed(Date.now() - 7 * 24 * hour - 60_000)),
      ] as const);
      await outside.goto('/studio/sign-in');
      await expect
        .poll(() => outside.evaluate((key) => localStorage.getItem(key), JOURNAL_KEY))
        .toBeNull();
    } finally {
      await context.close();
    }
  },
);

test(
  'two pages in one browser: discarding at sign-out empties the journal, though the other page had unsaved text too',
  { annotation: [STUDIO] },
  async ({ browser, app }) => {
    const context = await owner(browser, app.origin);
    try {
      const a = await context.newPage();
      const b = await context.newPage();
      await content(a);
      await content(b);
      await edit(a, 'discard a');
      await edit(b, 'discard b');
      await expect.poll(async () => (await journal(a)).length).toBe(2);
      await a.getByRole('button', { name: 'Sign out' }).click();
      await a
        .getByRole('dialog', { name: 'Keep your unsaved changes?' })
        .getByRole('button', { name: 'Discard them and sign out' })
        .click();
      await expect(a).toHaveURL(`${app.origin}/studio/sign-in?state=signed_out`);
      await expect(b).toHaveURL(`${app.origin}/studio/sign-in?state=signed_out`);
      // B wrote nothing back as it left.
      await a.waitForTimeout(500);
      expect(await a.evaluate((key) => localStorage.getItem(key), JOURNAL_KEY)).toBeNull();
      await expect(b.locator('body')).not.toContainText('studio-drafts');
    } finally {
      await context.close();
      signedIn = undefined;
    }
  },
);
