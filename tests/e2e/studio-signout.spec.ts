import type { Page, Request } from '@playwright/test';
import { expect, test } from '../harness/fixtures';
import { ownerSecret } from '../harness/owner-secret.mjs';
import { seedDraft, signIn } from '../harness/preview-grants';
import { ownerApp } from '../harness/profile-matrix';
import { openTask } from '../harness/studio-tasks';

// Studio's Sign out (#8, Slice 1) can't lose a click (row 88), against the
// built server with the password provider. The server renders the button,
// the shell hydrates from a chunk of its own (studio-entry.tsx), and on main
// 7c524568d only the owner adapter, a chunk the hydrated shell asks for,
// can sign out. CI run 42360159561 clicked once the shell had hydrated and
// before the adapter came: the header said "Couldn't sign out. Try again."
// and sent nothing, and the workspace that took over erased the message.
// Each case holds what it needs to land in its wait every run: the page's
// script chunks, the adapter's alone, the first load's answer, or the
// tab's own way to sign-in. And the guards: Discard clears the journal
// before the request, and another tab's discard is never undone.
const STUDIO = { type: 'route', description: '/studio' };

const secret = ownerSecret();
test.use({ appOptions: ownerApp(secret.hash) });

const SIGNED_OUT = '/studio/sign-in?state=signed_out';
const JOURNAL_KEY = 'portfolio-studio:journal:v1';
/** Next's script chunks; the stylesheets go through, since holding them holds DOMContentLoaded too. */
const SCRIPT_CHUNK = /\/_next\/static\/chunks\/[^?#]+\.js(?:[?#].*)?$/;
/** The owner adapter's chunk, the one script that names its commands (studio-recovery.spec.ts). */
const OWNER_CHUNK = /["']draft\.applyEdits["']/;
/** What Playwright says when a route's page, context or browser has gone. */
const CLOSED = /Target page, context or browser has been closed/;
/** How long a click has to land while the chunks are held. */
const LANDS_MS = 1_000;
/**
 * How long W2 looks for "Couldn't sign out" while the owner adapter's chunk is still held: main
 * shows it at once, and it must be read before the adapter loads, since the workspace that takes
 * over then mounts a Sign out of its own, without it. Well under the shell's 5 s BACKEND_TIMEOUT_MS.
 */
const REFUSAL_MS = 1_000;
/** How long a first load's late answer gets to reach a page whose way to sign-in is held. */
const LATE_ANSWER_MS = 1_000;
/**
 * Well past CHOICE_WAIT_MS (session-end.ts, 500 ms), when a plain logout with no choice after it
 * ends a page, so a page timer a busy runner fires late still fires inside the hold.
 */
const PAST_CHOICE_WAIT_MS = 1_500;

/** A promise the test settles when it lets go of what it holds. */
function hold(): { readonly held: Promise<void>; readonly release: () => void } {
  let release = () => {};
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  return { held, release };
}

/** A promise that settles the first time the test calls `signal`. */
function signal(): { readonly seen: Promise<void>; readonly signal: () => void } {
  let fire = () => {};
  const seen = new Promise<void>((resolve) => {
    fire = resolve;
  });
  return { seen, signal: () => fire() };
}

const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** Every Studio operation the page sends, from now on, by name. */
function studioCallsOf(page: Page): string[] {
  const sent: string[] = [];
  page.on('request', (request) => {
    const { pathname } = new URL(request.url());
    if (pathname.startsWith('/api/studio/')) sent.push(pathname.slice('/api/studio/'.length));
  });
  return sent;
}

/** Every auth.logout the page sends, from now on. */
function logoutsOf(page: Page): Request[] {
  const sent: Request[] = [];
  page.on('request', (request) => {
    if (
      request.method() === 'POST' &&
      new URL(request.url()).pathname === '/api/studio/auth.logout'
    )
      sent.push(request);
  });
  return sent;
}

/** Whether `click` settled within LANDS_MS, recorded on the test: main lands it, a not-ready button waits. */
async function landed(click: Promise<void>, what: string): Promise<void> {
  const settled = await Promise.race([
    click.then(
      () => true,
      () => true,
    ),
    pause(LANDS_MS).then(() => false),
  ]);
  test.info().annotations.push({
    type: 'row 88 click',
    description: settled
      ? `the click landed on the server's Sign out ${what}`
      : `the click waited ${what}, for a Sign out that can act`,
  });
}

/** The Studio tasks link named `label`, which carries aria-current once it's the task. */
const taskLink = (page: Page, label: string) =>
  page
    .getByRole('navigation', { name: 'Studio tasks' })
    .getByRole('link', { name: label, exact: true });

const signOutButton = (page: Page) => page.getByRole('button', { name: 'Sign out' });
const couldNotSignOut = (page: Page) => page.getByText("Couldn't sign out. Try again.");

/** The journal's raw text, read from `page`, which shares the origin's localStorage. */
const journalText = (page: Page) => page.evaluate((key) => localStorage.getItem(key), JOURNAL_KEY);

/** Opens Content's source mode on a seeded draft and leaves unsaved text in the journal. */
async function unsavedText(page: Page, saved: string): Promise<void> {
  await openTask(page, 'Content');
  await page.getByRole('button', { name: 'Source', exact: true }).click();
  const portfolio = page.getByLabel(/^portfolio\.(?:yml|json)$/);
  await expect(portfolio).toHaveValue(saved);
  await portfolio.fill(`${saved}# not saved yet\n`);
  await expect
    .poll(async () => (JSON.parse((await journalText(page)) ?? '[]') as unknown[]).length)
    .toBe(1);
}

test(
  "a Sign out clicked once the shell has hydrated, while its owner adapter is still on its way, signs out, and never says it couldn't (row 88, W2)",
  { annotation: [STUDIO] },
  async ({ page, context, app }) => {
    await signIn(page, app, secret.password);
    const tab = await context.newPage();
    const { held, release } = hold();
    const adapter = signal();
    await tab.route(SCRIPT_CHUNK, async (route) => {
      // Every chunk the tab asks for comes through here, the sign-in page's after it signs out
      // too, so the test can end with one still on its way (#205 and #206 on CI Linux). A page
      // that has gone has nothing left to fetch or answer; any other failure still fails the test.
      const fetched = await route
        .fetch()
        .then(async (response) => ({ response, body: await response.text() }))
        .catch((error: unknown) => {
          if (tab.isClosed() || CLOSED.test(String(error))) return null;
          throw error;
        });
      if (fetched === null) return;
      if (OWNER_CHUNK.test(fetched.body)) {
        adapter.signal();
        await held;
      }
      await route.fulfill(fetched).catch((error: unknown) => {
        if (!tab.isClosed() && !CLOSED.test(String(error))) throw error;
      });
    });
    const logouts = logoutsOf(tab);
    await tab.goto('/studio', { waitUntil: 'domcontentloaded' });
    // Only the hydrated shell's effect asks for the owner adapter (studio-shell.tsx).
    await adapter.seen;
    // And the fresh tab's landing task has taken aria-current from the server's Content (OWN-3).
    await expect(taskLink(tab, 'Appearance')).toHaveAttribute('aria-current', 'page');
    const click = signOutButton(tab).click();
    await landed(click, "while the owner adapter's chunk was held");
    // Still held: nothing may say the sign-out was refused.
    await expect
      .soft(couldNotSignOut(tab), 'nothing refused the sign-out')
      .toBeHidden({ timeout: REFUSAL_MS });
    release();
    await click;
    await expect.soft(tab).toHaveURL(`${app.origin}${SIGNED_OUT}`);
    expect(logouts, 'one auth.logout').toHaveLength(1);
    // The sign-in page's chunks may still be on their way: let them go before the context closes.
    await tab.unrouteAll({ behavior: 'ignoreErrors' });
  },
);

test(
  'a Sign out clicked before the shell hydrates waits for it, then signs out, once (row 88, W1)',
  { annotation: [STUDIO] },
  async ({ page, context, app }) => {
    await signIn(page, app, secret.password);
    const tab = await context.newPage();
    const { held, release } = hold();
    const scripts: string[] = [];
    await tab.route(SCRIPT_CHUNK, async (route) => {
      scripts.push(route.request().url());
      await held;
      await route.continue().catch(() => {});
    });
    const calls = studioCallsOf(tab);
    const logouts = logoutsOf(tab);
    // Async chunks don't hold DOMContentLoaded, so the server's markup is all there is.
    await tab.goto('/studio', { waitUntil: 'domcontentloaded' });
    expect(scripts.length, 'a script chunk is held').toBeGreaterThan(0);
    expect(calls, 'no Studio request before the scripts').toEqual([]);
    const button = signOutButton(tab);
    await expect(button).toBeVisible();
    const started = Date.now();
    const click = button.click();
    await landed(click, 'while every script chunk was held');
    await pause(Math.max(0, LANDS_MS - (Date.now() - started)));
    release();
    await click;
    // Soft, so a run that stays on /studio says how many auth.logout requests went too.
    await expect.soft(tab).toHaveURL(`${app.origin}${SIGNED_OUT}`);
    expect(logouts, 'one auth.logout').toHaveLength(1);
  },
);

test(
  "/studio's HTML renders Sign out aria-disabled, and the live page takes it off with no hydration mismatch (row 88)",
  { annotation: [STUDIO] },
  async ({ page, app }) => {
    await signIn(page, app, secret.password);
    const html = await (await page.request.get('/studio')).text();
    const tag = /<button[^>]*>Sign out<\/button>/.exec(html)?.[0] ?? '';
    expect(tag, 'the server renders Sign out').not.toBe('');
    expect.soft(tag, 'not ready before scripts run').toContain('aria-disabled="true"');
    const errors: string[] = [];
    page.on('console', (message) => {
      if (message.type() === 'error') errors.push(message.text());
    });
    page.on('pageerror', (error) => errors.push(error.message));
    await page.goto('/studio');
    await expect(page.locator('.studio-state__lines')).toBeAttached();
    await expect(signOutButton(page)).not.toHaveAttribute('aria-disabled', 'true');
    // React reports a hydration mismatch as a console error (#418, #423 or #425 in production).
    expect(errors.filter((text) => /hydrat|#41[89]|#42[35]/i.test(text))).toEqual([]);
  },
);

test(
  'a sign-out that fails says so, and still says so once the workspace takes over from the header; a second Sign out then works (row 88)',
  { annotation: [STUDIO] },
  async ({ page, context, app }) => {
    await signIn(page, app, secret.password);
    const tab = await context.newPage();
    const draft = hold();
    const draftAsked = signal();
    // The first load's answer is held, so the shell isn't ready and the header stays.
    await tab.route(/\/api\/studio\/draft\.getWorking/, async (route) => {
      const response = await route.fetch();
      draftAsked.signal();
      await draft.held;
      await route.fulfill({ response }).catch(() => {});
    });
    const LOGOUT = '**/api/studio/auth.logout';
    await tab.route(LOGOUT, (route) => route.abort('failed'));
    await tab.goto('/studio');
    // The load is out, so the owner adapter is in (main signs out only through it).
    await draftAsked.seen;
    await expect(taskLink(tab, 'Appearance')).toHaveAttribute('aria-current', 'page');
    await expect(tab.locator('.studio-shell--workspace')).toHaveCount(0);
    await signOutButton(tab).click();
    await expect(couldNotSignOut(tab)).toBeVisible();
    draft.release();
    await expect(tab.locator('.studio-shell--workspace')).toHaveCount(1);
    await expect
      .soft(couldNotSignOut(tab), 'the failure survives the swap to the workspace')
      .toBeVisible();
    await tab.unroute(LOGOUT);
    await signOutButton(tab).click();
    await expect(tab).toHaveURL(`${app.origin}${SIGNED_OUT}`);
  },
);

test(
  "a first load's answer that comes after the sign-out shows nothing of the draft as the tab leaves (row 88)",
  { annotation: [STUDIO] },
  async ({ page, context, app }) => {
    const NAME = 'Rowan Late Answer';
    await seedDraft(app, NAME);
    await signIn(page, app, secret.password);
    const tab = await context.newPage();
    const draft = hold();
    const draftAsked = signal();
    await tab.route(/\/api\/studio\/draft\.getWorking/, async (route) => {
      // Answered by the server while the session still counts, and given to the page later.
      const response = await route.fetch();
      draftAsked.signal();
      await draft.held;
      await route.fulfill({ response }).catch(() => {});
    });
    const way = hold();
    const navigating = signal();
    await tab.route(
      (url) => url.pathname === '/studio/sign-in',
      async (route) => {
        if (route.request().resourceType() === 'document') {
          navigating.signal();
          await way.held;
        }
        await route.continue().catch(() => {});
      },
    );
    await tab.goto('/studio');
    await draftAsked.seen;
    // What the page showed as it left, recorded by the document itself (studio-appearance.spec.ts).
    await tab.evaluate((name) => {
      addEventListener(
        'pagehide',
        () => {
          sessionStorage.setItem(
            'kgn-e2e:left',
            JSON.stringify({
              frames: document.querySelectorAll('iframe.preview-surface__frame').length,
              draftShown: document.body.innerText.includes(name),
            }),
          );
        },
        { capture: true },
      );
    }, NAME);
    const logout = tab.waitForResponse((response) =>
      response.url().endsWith('/api/studio/auth.logout'),
    );
    await signOutButton(tab).click();
    expect((await logout).status()).toBe(200);
    await navigating.seen;
    // The late answer, after the logout's, while the page is still there to take it.
    draft.release();
    await pause(LATE_ANSWER_MS);
    way.release();
    await expect(tab).toHaveURL(`${app.origin}${SIGNED_OUT}`);
    expect(
      JSON.parse((await tab.evaluate(() => sessionStorage.getItem('kgn-e2e:left'))) ?? 'null'),
    ).toEqual({ frames: 0, draftShown: false });
  },
);

test(
  'Discard clears the journal before auth.logout goes (row 88, guard)',
  { annotation: [STUDIO] },
  async ({ page, app }) => {
    const draft = await seedDraft(app, 'Rowan Discard Order');
    await signIn(page, app, secret.password);
    await unsavedText(page, draft.documents.portfolio.sourceText);
    let atRequest: string | null | undefined;
    await page.route('**/api/studio/auth.logout', async (route) => {
      atRequest = await journalText(page);
      await route.continue();
    });
    await signOutButton(page).click();
    await page
      .getByRole('dialog', { name: 'Keep your unsaved changes?' })
      .getByRole('button', { name: 'Discard them and sign out' })
      .click();
    await expect(page).toHaveURL(`${app.origin}${SIGNED_OUT}`);
    expect(atRequest, 'the journal as auth.logout went').toBeNull();
  },
);

test(
  'a tab whose own sign-out is on its way to sign-in goes there once, whatever another tab says on the session channel meanwhile (row 88, F4)',
  { annotation: [STUDIO] },
  async ({ page, context, app }) => {
    await signIn(page, app, secret.password);
    await page.goto('/studio#appearance');
    // Loaded: the state lines come once the owner adapter has read the draft.
    await expect(page.locator('.studio-state__lines')).toBeAttached();
    // Another tab of the site, which hears nothing on the channel and says what it's told.
    const other = await context.newPage();
    await other.goto('/studio/sign-in');
    const { held, release } = hold();
    const signIns: string[] = [];
    const navigating = signal();
    await page.route(
      (url) => url.pathname === '/studio/sign-in',
      async (route) => {
        if (route.request().resourceType() === 'document') {
          signIns.push(new URL(route.request().url()).search);
          navigating.signal();
          await held;
        }
        // A navigation a later one replaced has no request left to go on with.
        await route.continue().catch(() => {});
      },
    );
    await signOutButton(page).click();
    await navigating.seen;
    // A plain logout, as a 401 elsewhere posts, while this tab's own way to sign-in is held.
    await other.evaluate(() => new BroadcastChannel('studio-session').postMessage('logout'));
    await pause(PAST_CHOICE_WAIT_MS);
    release();
    await expect.soft(page).toHaveURL(`${app.origin}${SIGNED_OUT}`);
    expect(signIns, 'one way to sign-in, with no returnTo').toEqual(['?state=signed_out']);
  },
);

test(
  "a tab that signed out keeping its text still drops it when another tab's sign-out says discard (row 88, F4 guard)",
  { annotation: [STUDIO] },
  async ({ page, context, app }) => {
    const draft = await seedDraft(app, 'Rowan Keep Then Discard');
    await signIn(page, app, secret.password);
    await unsavedText(page, draft.documents.portfolio.sourceText);
    const other = await context.newPage();
    await other.goto('/studio/sign-in');
    const { held, release } = hold();
    const navigating = signal();
    await page.route(
      (url) => url.pathname === '/studio/sign-in',
      async (route) => {
        if (route.request().resourceType() === 'document') {
          navigating.signal();
          await held;
        }
        await route.continue().catch(() => {});
      },
    );
    await signOutButton(page).click();
    await page
      .getByRole('dialog', { name: 'Keep your unsaved changes?' })
      .getByRole('button', { name: 'Keep them and sign out' })
      .click();
    await navigating.seen;
    expect(await journalText(other), 'Keep left the text in the journal').not.toBeNull();
    // Another tab's sign-out chose discard while this one's way to sign-in is held.
    await other.evaluate(() =>
      new BroadcastChannel('studio-session').postMessage('logout:discard'),
    );
    await expect.poll(() => journalText(other), 'the discard reached this tab').toBeNull();
    release();
    await expect(page).toHaveURL(/\/studio\/sign-in\?state=signed_out/);
  },
);
