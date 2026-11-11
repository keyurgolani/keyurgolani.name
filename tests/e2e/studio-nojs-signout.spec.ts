import type { BrowserContext, Page } from '@playwright/test';
import { expect, test } from '../harness/fixtures';
import { ownerSecret } from '../harness/owner-secret.mjs';
import { signIn } from '../harness/preview-grants';
import { JOURNAL_KEY, seedJournal } from '../harness/studio-journal';
import { ownerApp } from '../harness/profile-matrix';

// Studio's Sign out without JavaScript, and how a native sign-out reaches the other tabs (row
// 88c-RC2, F2(ii) as the owner ruled; draft, unrun until RC2's tickets queue). Sign out is a form
// post to auth.logout from the first byte: auth.logout takes it without a CSRF token on the exact
// Origin with Sec-Fetch-Site same-origin, and answers a 303 to sign-in. Without JavaScript a
// second submit discards this browser's unsaved changes: its answer leaves a pending-discard
// marker, which Studio's next script reads first. The sign-in page it lands on posts the tabs' logout once its script runs, only when it came
// there from this origin.

const secret = ownerSecret();
test.use({ appOptions: ownerApp(secret.hash) });
test.use({ studioLastTask: 'content' });

const STUDIO = { type: 'route', description: '/studio' };
const SIGNED_OUT = '/studio/sign-in?state=signed_out';
/** How long a tab that heard nothing is watched, to say it stayed. */
const QUIET_MS = 2_000;

const signOut = (page: Page) => page.getByRole('button', { name: 'Sign out', exact: true });
const discard = (page: Page) =>
  page.getByRole('button', { name: 'Discard unsaved changes and sign out' });

/** Every auth.logout `page` sends from now on. */
function logoutsOf(page: Page): string[] {
  const sent: string[] = [];
  page.on('request', (request) => {
    if (
      request.method() === 'POST' &&
      new URL(request.url()).pathname === '/api/studio/auth.logout'
    )
      sent.push(request.url());
  });
  return sent;
}

/** A browser with JavaScript off, signed in as the owner `page` is, its storage included. */
async function withoutScript(
  page: Page,
  origin: string,
  browser: { newContext: (options: object) => Promise<BrowserContext> },
): Promise<BrowserContext> {
  return browser.newContext({
    javaScriptEnabled: false,
    baseURL: origin,
    storageState: await page.context().storageState(),
  });
}

/** What the origin's localStorage holds in `context`, read from its storage state. */
async function journalIn(context: BrowserContext, origin: string): Promise<string | null> {
  const { origins } = await context.storageState();
  const stored = origins.find((each) => each.origin === origin)?.localStorage ?? [];
  return stored.find(({ name }) => name === JOURNAL_KEY)?.value ?? null;
}

test(
  'without JavaScript, Sign out posts once, lands on signed out, keeps the unsaved changes, and the session is over (row 88c-RC2)',
  { annotation: [STUDIO] },
  async ({ browser, page, app }, testInfo) => {
    await signIn(page, app, secret.password);
    const seeded = await seedJournal(page);
    const context = await withoutScript(page, app.origin, browser);
    try {
      const plain = await context.newPage();
      const logouts = logoutsOf(plain);
      await plain.goto('/studio');
      await expect(signOut(plain)).toBeVisible();
      await expect(discard(plain)).toBeVisible();
      await testInfo.attach('no-js-sign-out.png', {
        body: await plain.screenshot(),
        contentType: 'image/png',
      });
      await signOut(plain).click();
      await expect(plain).toHaveURL(`${app.origin}${SIGNED_OUT}`);
      expect(logouts, 'one auth.logout').toHaveLength(1);
      expect(await journalIn(context, app.origin), 'keep is the default').toBe(seeded);
      // The old session's cookie, still in the scripted tab's context, no longer counts.
      expect((await page.request.get('/api/studio/auth.session')).status()).toBe(401);
    } finally {
      await context.close();
    }
  },
);

test(
  "without JavaScript, Discard unsaved changes and sign out signs out, and Studio's next script clears the journal before anything restores it, the site's own keys kept (row 88c-RC2)",
  { annotation: [STUDIO] },
  async ({ browser, page, app }) => {
    await signIn(page, app, secret.password);
    // A valid entry, which Studio's prune keeps: only the discard the marker owes removes it.
    const seeded = await seedJournal(page);
    await page.evaluate(() => localStorage.setItem('portfolio.motion.paused', '1'));
    const context = await withoutScript(page, app.origin, browser);
    let after: Awaited<ReturnType<BrowserContext['storageState']>>;
    try {
      const plain = await context.newPage();
      const logouts = logoutsOf(plain);
      await plain.goto('/studio');
      await discard(plain).click();
      await expect(plain).toHaveURL(`${app.origin}${SIGNED_OUT}`);
      expect(logouts, 'one auth.logout').toHaveLength(1);
      after = await context.storageState();
    } finally {
      await context.close();
    }
    // Without script nothing could clear storage at sign-out: Clear-Site-Data says "cache" alone,
    // and the answer left the pending-discard marker.
    const local = after.origins.find((each) => each.origin === app.origin)?.localStorage ?? [];
    expect(local.find(({ name }) => name === JOURNAL_KEY)?.value).toBe(seeded);
    expect(after.cookies.map(({ name }) => name)).toContainEqual(
      expect.stringMatching(/^(?:__Host-)?studio_discard$/),
    );
    // The next page with script, in the same browser, reads the marker first.
    const scripted = await browser.newContext({ baseURL: app.origin, storageState: after });
    try {
      const next = await scripted.newPage();
      await next.goto('/studio/sign-in');
      await expect(next.getByLabel('Password')).toBeVisible();
      await expect
        .poll(() => next.evaluate((key) => localStorage.getItem(key), JOURNAL_KEY))
        .toBeNull();
      expect(await next.evaluate(() => localStorage.getItem('portfolio.motion.paused'))).toBe('1');
      const left = (await scripted.cookies()).map(({ name }) => name);
      expect(
        left.some((name) => /studio_discard$/.test(name)),
        'the marker dropped',
      ).toBe(false);
    } finally {
      await scripted.close();
    }
  },
);

test(
  "a native Sign out sends Studio's other tabs to sign-in, once the page it lands on runs its script (row 88c-RC2)",
  { annotation: [STUDIO] },
  async ({ context, page, app }) => {
    await signIn(page, app, secret.password);
    await page.goto('/studio');
    await expect(page.locator('.studio-state__lines')).toBeAttached();
    // The other tab signs out natively: a form post, its own script never in it.
    const other = await context.newPage();
    await other.goto('/studio', { waitUntil: 'domcontentloaded' });
    await other.evaluate(() =>
      document.querySelector<HTMLFormElement>('form.studio-sign-out')?.submit(),
    );
    await expect(other).toHaveURL(`${app.origin}${SIGNED_OUT}`);
    // The sign-in page's script posts the tabs' logout, and this tab leaves Studio.
    await expect(page).toHaveURL(/\/studio\/sign-in/, { timeout: 10_000 });
  },
);

test(
  "a sign-in page opened at ?state=signed_out from no sign-out of this origin's signs no tab out (row 88c-RC2)",
  { annotation: [STUDIO] },
  async ({ context, page, app }) => {
    await signIn(page, app, secret.password);
    await page.goto('/studio');
    await expect(page.locator('.studio-state__lines')).toBeAttached();
    // Typed, or followed from elsewhere: Sec-Fetch-Site isn't same-origin.
    const other = await context.newPage();
    await other.goto(SIGNED_OUT);
    await expect(other.getByLabel('Password')).toBeVisible();
    await other.waitForTimeout(QUIET_MS);
    await expect(page).toHaveURL(/\/studio(?:#.*)?$/);
    expect((await page.request.get('/api/studio/auth.session')).status()).toBe(200);
  },
);
