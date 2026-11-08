import type { Page } from '@playwright/test';
import { expect, test } from '../harness/fixtures';
import { ownerSecret } from '../harness/owner-secret.mjs';
import { command, seedDraft, signIn } from '../harness/preview-grants';
import { openTask, optionsIn, pick, picker } from '../harness/studio-tasks';
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
// Written while Studio opened on Content: each tab starts where the owner last left it, in
// Content, and a task link still moves it on (OWN-3 lands a fresh tab on Appearance).
test.use({ studioLastTask: 'content' });
test.describe.configure({ mode: 'serial' });

/**
 * What Playwright says when a route outlives its page, its context or the test: the closed-target
 * message, or "Test ended." when the test finishes first (#214's plant saw both). Playwright gives
 * no closed state for a context or a finished test, so page.isClosed() and these two are the checks.
 */
const CLOSED = /Target page, context or browser has been closed|Test ended/;

/**
 * A route handler's work, on a page that may have gone by the time it runs (#214): a test that
 * ends on a navigation, or as its last checks pass, can close the context while a chunk the next
 * page asked for is still in route.fetch. Only that is swallowed; any other failure fails the test.
 */
async function unlessGone(page: Page, work: () => Promise<unknown>): Promise<void> {
  try {
    await work();
  } catch (error) {
    if (page.isClosed() || CLOSED.test(String(error))) return;
    throw error;
  }
}

// The chunk handlers below can still be running as a test ends: let them go before the context
// closes, as studio-signout.spec.ts's W2 does.
test.afterEach(async ({ page }) => {
  await page.unrouteAll({ behavior: 'ignoreErrors' });
});

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
    await openTask(page, 'Appearance');
    const form = page.getByRole('form', { name: 'Appearance' });
    const composition = picker(form, 'Composition the site shows');
    // The workspace renders its options once the draft is in: wait for two, as #124 does.
    await expect(composition.locator('label[data-option]').nth(1)).toBeAttached();
    const current = await composition
      .locator('label:has(> input:checked)')
      .getAttribute('data-option');
    const target = (await optionsIn(composition)).find((value) => value !== current);
    expect(target, 'another composition this build offers').toBeTruthy();
    await pick(composition, target!);

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
    await page.getByRole('button', { name: 'Save draft' }).click();
    await sent;

    await openTask(page, 'Content');
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
    // In the workspace the state lines sit in its quiet section, read but not shown.
    await expect(line(page, 'Draft')).toHaveText(/^Saved draft, version \d+\.$/);
    // The owner adapter's chunk, the one script that names its commands, is refused; the rest load.
    const refused: string[] = [];
    await page.route(/\/_next\/static\/chunks\/.*\.js/, (route) =>
      unlessGone(page, async () => {
        const response = await route.fetch();
        const body = await response.text();
        if (!/["']draft\.applyEdits["']/.test(body)) return route.fulfill({ response, body });
        refused.push(route.request().url());
        return route.abort('blockedbyclient');
      }),
    );
    await page.reload();
    await expect
      .poll(() => refused.length, "the owner adapter's chunk is asked for, and refused")
      .toBe(1);
    const alert = page.getByRole('alert').filter({ hasText: "Studio couldn't load" });
    // Refused at once, or past the shell's 5 second wait for a chunk that hangs.
    await expect(alert).toBeVisible({ timeout: 20_000 });
    await expect(page.getByRole('button', { name: 'Reload Studio' })).toBeFocused();
    await expect(page.locator('[aria-busy="true"]')).toHaveCount(0);
    // Each task link's fragment still names an element.
    for (const id of ['content', 'appearance', 'history']) {
      await expect(page.locator(`[id="${id}"]`)).toHaveCount(1);
    }
  },
);

/** The owner adapter's chunk, the one script that names its commands. */
const OWNER_CHUNK = /["']draft\.applyEdits["']/;

test(
  "when the store can't read the draft as Studio loads, it says so with Try again, which takes focus, and nothing stays loading",
  { annotation: [STUDIO] },
  async ({ page, app }) => {
    await signIn(page, app, secret.password);
    // The store answers draft.getWorking with a 503, as an unreachable data directory does.
    let refuse = true;
    await page.route(/\/api\/studio\/draft\.getWorking/, (route) =>
      refuse
        ? route.fulfill({
            status: 503,
            contentType: 'application/json',
            body: JSON.stringify({
              error: {
                code: 'storage_unavailable',
                message: "The data directory can't be used right now.",
                requestId: 'req_e2e',
              },
            }),
          })
        : route.fallback(),
    );
    await page.goto('/studio');
    const alert = page.getByRole('alert').filter({ hasText: "Studio couldn't read the draft" });
    await expect(alert).toBeVisible({ timeout: 20_000 });
    const again = page.getByRole('button', { name: 'Try again' });
    await expect(again).toBeFocused();
    await expect(page.locator('[aria-busy="true"]')).toHaveCount(0);
    // The task's heading stays, so the owner knows where they were.
    await expect(page.getByRole('heading', { level: 2, name: 'Content' })).toBeVisible();
    // The store is back: Try again reads the draft, and focus goes to the task area.
    refuse = false;
    await again.press('Enter');
    // In the split the state lines sit in the quiet section, so the line is read, not seen.
    await expect(line(page, 'Draft')).toHaveText(/^Saved draft, version \d+\.$/);
    await expect(alert).toHaveCount(0);
    await expect(page.locator('#studio-main')).toBeFocused();
  },
);

test(
  "when the part that reaches the store arrives after Studio said it couldn't load, Studio loads, and focus goes to the task area",
  { annotation: [STUDIO] },
  async ({ page, app }) => {
    await signIn(page, app, secret.password);
    await page.goto('/studio');
    await expect(line(page, 'Draft')).toHaveText(/^Saved draft, version \d+\.$/);
    // The owner adapter's chunk comes 7 seconds late, past the shell's 5 second wait.
    await page.route(/\/_next\/static\/chunks\/.*\.js/, (route) =>
      unlessGone(page, async () => {
        const response = await route.fetch();
        const body = await response.text();
        if (OWNER_CHUNK.test(body)) await new Promise((done) => setTimeout(done, 7_000));
        return route.fulfill({ response, body });
      }),
    );
    await page.reload();
    const alert = page.getByRole('alert').filter({ hasText: "Studio couldn't load" });
    await expect(alert).toBeVisible({ timeout: 20_000 });
    await expect(page.getByRole('button', { name: 'Reload Studio' })).toBeFocused();
    // It arrives: the draft loads, the alert goes, and focus doesn't fall to the page's body.
    await expect(line(page, 'Draft')).toHaveText(/^Saved draft, version \d+\.$/, {
      timeout: 20_000,
    });
    await expect(alert).toHaveCount(0);
    await expect(page.locator('#studio-main')).toBeFocused();
  },
);

/** Every auth.logout `page` sends, from now on (row 88). */
function logoutsOf(page: Page): string[] {
  const sent: string[] = [];
  page.on('request', (request) => {
    if (request.method() === 'POST' && request.url().endsWith('/api/studio/auth.logout'))
      sent.push(request.url());
  });
  return sent;
}

// Row 88's two below run last in this serial file, the guard first: a red on main skips only what follows it.
test(
  "when the store can't read the draft, Sign out is still ready and signs out: one auth.logout, then sign-in (row 88, guard)",
  { annotation: [STUDIO] },
  async ({ page, app }) => {
    await signIn(page, app, secret.password);
    await page.route(/\/api\/studio\/draft\.getWorking/, (route) =>
      route.fulfill({
        status: 503,
        contentType: 'application/json',
        body: JSON.stringify({
          error: {
            code: 'storage_unavailable',
            message: "The data directory can't be used right now.",
            requestId: 'req_e2e',
          },
        }),
      }),
    );
    const logouts = logoutsOf(page);
    await page.goto('/studio');
    const alert = page.getByRole('alert').filter({ hasText: "Studio couldn't read the draft" });
    await expect(alert).toBeVisible({ timeout: 20_000 });
    // The shell isn't ready, and Sign out doesn't wait for it to be.
    const signOut = page.getByRole('button', { name: 'Sign out' });
    await expect(signOut).not.toHaveAttribute('aria-disabled', 'true');
    await signOut.click();
    await expect(page).toHaveURL(`${app.origin}/studio/sign-in?state=signed_out`);
    expect(logouts, 'one auth.logout').toHaveLength(1);
  },
);

test(
  "when the part that reaches the store doesn't arrive, Sign out still signs out beside Studio couldn't load: one auth.logout, then sign-in (row 88)",
  { annotation: [STUDIO] },
  async ({ page, app }) => {
    await signIn(page, app, secret.password);
    await page.goto('/studio');
    await expect(page.locator('.studio-state__lines')).toBeAttached();
    // The owner adapter's chunk is refused; the rest load (as :160 does, which a draft seeded before it reads).
    const refused: string[] = [];
    // The sign-in page's own chunks come through here too, after the sign-out (#214).
    await page.route(/\/_next\/static\/chunks\/.*\.js/, (route) =>
      unlessGone(page, async () => {
        const response = await route.fetch();
        const body = await response.text();
        if (!OWNER_CHUNK.test(body)) return route.fulfill({ response, body });
        refused.push(route.request().url());
        return route.abort('blockedbyclient');
      }),
    );
    const logouts = logoutsOf(page);
    await page.reload();
    await expect
      .poll(() => refused.length, "the owner adapter's chunk is asked for, and refused")
      .toBe(1);
    const alert = page.getByRole('alert').filter({ hasText: "Studio couldn't load" });
    await expect(alert).toBeVisible({ timeout: 20_000 });
    const signOut = page.getByRole('button', { name: 'Sign out' });
    await expect
      .soft(signOut, 'Sign out is ready without the adapter')
      .not.toHaveAttribute('aria-disabled', 'true');
    await signOut.click();
    // Soft, so a run that stays on /studio says how many auth.logout requests went too.
    await expect.soft(page).toHaveURL(`${app.origin}/studio/sign-in?state=signed_out`);
    expect(logouts, 'one auth.logout').toHaveLength(1);
  },
);
