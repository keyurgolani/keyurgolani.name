import type { Page, Request, Route } from '@playwright/test';
import { expect, test } from '../harness/fixtures';
import { ownerSecret } from '../harness/owner-secret.mjs';
import { signIn } from '../harness/preview-grants';
import { ownerApp } from '../harness/profile-matrix';
import { failureStateFindings } from '../quality/lib/a11y/conditions';

// Owner Studio when its shell doesn't load (row 88c), against the built
// server with the password provider. Failed enhancement as the quality
// harness takes it (tests/quality/lib/a11y/conditions.ts:838-848, which E's
// Studio read ran): every script chunk the page's HTML doesn't load itself is
// refused, and every font. The shell's chunks are among them, as next/dynamic
// names them only by preload links. Or those chunks are held, as on a
// connection that stalls, when the alert comes from late-alert.tsx's root of
// its own. Either way the page says "Studio couldn't load." with Reload
// Studio, which takes focus, and nothing else: no owner code is in the page's
// entry (#9). A shell that arrives after the alert takes over; once Reload is
// pressed, the page reloads.
const STUDIO = { type: 'route', description: '/studio' };

const secret = ownerSecret();
test.use({ appOptions: ownerApp(secret.hash) });

const SIGNED_OUT = '/studio/sign-in?state=signed_out';
/** The shell's own wait (late-alert.tsx's STUDIO_LOAD_TIMEOUT_MS), and margin past it. */
const PAST_TIMEOUT_MS = 10_000;
/** When a held shell is let through: after the 5 s alert. */
const RELEASE_AT_MS = 6_000;

const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** The script URLs /studio's HTML loads itself, which failed enhancement leaves alone. */
async function ownScripts(page: Page, origin: string): Promise<Set<string>> {
  const html = await (await page.request.get('/studio')).text();
  return new Set(
    [...html.matchAll(/<script[^>]+src="([^"]+)"/g)].map(
      (match) => new URL(match[1]!, origin).href,
    ),
  );
}

/** An optional script chunk: one the HTML doesn't load itself. */
const optional = (request: Request, own: Set<string>) =>
  request.resourceType() === 'script' &&
  /\/_next\/static\/chunks\//.test(request.url()) &&
  !own.has(request.url());

/**
 * What Playwright says when a route outlives its page, its context or the test: the closed-target
 * message, or "Test ended." when the test finishes first (#214's plant saw both). Playwright gives
 * no closed state for a context or a finished test, so page.isClosed() and these two are the checks.
 */
const CLOSED = /Target page, context or browser has been closed|Test ended/;

/**
 * A route handler's work, on a page that may have gone by the time it runs (#214): a test that
 * ends on a navigation or a reload can close the context while the next page's requests still come
 * through here. Only that is swallowed; any other failure fails the test.
 */
async function unlessGone(page: Page, work: () => Promise<unknown>): Promise<void> {
  try {
    await work();
  } catch (error) {
    if (page.isClosed() || CLOSED.test(String(error))) return;
    throw error;
  }
}

// Every route here can still be running as a test ends: let them go before the context closes, as
// studio-signout.spec.ts's W2 does.
test.afterEach(async ({ page }) => {
  await page.unrouteAll({ behavior: 'ignoreErrors' });
});

/** Failed enhancement on `page`: its optional chunks and its fonts refused. Returns what it refused. */
async function failEnhancement(page: Page, origin: string): Promise<string[]> {
  const own = await ownScripts(page, origin);
  const refused: string[] = [];
  await page.route('**/*', (route) => {
    const request = route.request();
    if (optional(request, own) || request.resourceType() === 'font') {
      refused.push(request.url());
      return unlessGone(page, () => route.abort('blockedbyclient'));
    }
    return unlessGone(page, () => route.fallback());
  });
  return refused;
}

/**
 * The optional chunks held, as on a connection that stalls, until `release`
 * lets them through or `refuse` refuses them. Returns what it held.
 */
async function holdShell(
  page: Page,
  origin: string,
): Promise<{ readonly held: string[]; readonly release: () => void; readonly refuse: () => void }> {
  const own = await ownScripts(page, origin);
  const held: string[] = [];
  let settle: (how: 'release' | 'refuse') => void = () => {};
  const gate = new Promise<'release' | 'refuse'>((resolve) => {
    settle = resolve;
  });
  await page.route('**/*', async (route: Route) => {
    if (!optional(route.request(), own)) return unlessGone(page, () => route.fallback());
    held.push(route.request().url());
    const how = await gate;
    // A page that reloaded or left has no request to go on with: a reload cancels the held
    // request, whose error isn't the closed-target one, so any error is let go here.
    await (how === 'refuse' ? route.abort('blockedbyclient') : route.fallback()).catch(() => {});
  });
  return { held, release: () => settle('release'), refuse: () => settle('refuse') };
}

const alert = (page: Page) => page.getByRole('alert').filter({ hasText: "Studio couldn't load." });
const reloadStudio = (page: Page) => page.getByRole('button', { name: 'Reload Studio' });
const signOut = (page: Page) => page.getByRole('button', { name: 'Sign out' });
/** The late alert's element, <studio-load-late>, a direct child of <body> (late-alert.tsx). */
const lateNode = (page: Page) => page.locator('body > studio-load-late');
/** React's hydration errors, by their minified codes or their words. */
const HYDRATION = /(?:#|errors\/)(?:418|423|425)\b|hydrat/i;

/** Every console error and page error from now on. */
function errorsOf(page: Page): string[] {
  const errors: string[] = [];
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });
  page.on('pageerror', (error) => errors.push(`${error.name}: ${error.message}`));
  return errors;
}

/** Every request for /studio's document from now on. */
function studioDocuments(page: Page): string[] {
  const sent: string[] = [];
  page.on('request', (request) => {
    if (request.isNavigationRequest() && new URL(request.url()).pathname === '/studio')
      sent.push(request.url());
  });
  return sent;
}

/** Every auth.logout the page sends from now on. */
function logoutsOf(page: Page): string[] {
  const sent: string[] = [];
  page.on('request', (request) => {
    if (request.method() === 'POST' && request.url().endsWith('/api/studio/auth.logout'))
      sent.push(request.url());
  });
  return sent;
}

test(
  "with the shell's chunks refused, /studio says Studio couldn't load, with Reload Studio, which takes focus, and nothing still loading (row 88c, R1)",
  { annotation: [STUDIO] },
  async ({ page, app }) => {
    await signIn(page, app, secret.password);
    const refused = await failEnhancement(page, app.origin);
    await page.goto('/studio');
    await expect.poll(() => refused.length, 'the optional chunks are asked for').toBeGreaterThan(0);
    await expect(alert(page)).toBeVisible({ timeout: PAST_TIMEOUT_MS });
    await expect(reloadStudio(page)).toBeFocused();
    // Reload alone: no owner code is in the page's entry (#9).
    await expect(alert(page).getByRole('button')).toHaveCount(1);
    // The quality harness's own verdict on a failure state, E's read's.
    expect(await failureStateFindings(page)).toEqual([]);
    // It never says the owner is signed out.
    await expect(alert(page)).not.toContainText(/signed out/i);
  },
);

test(
  "with the shell's chunks refused, Reload Studio reloads /studio (row 88c, R2)",
  { annotation: [STUDIO] },
  async ({ page, app }) => {
    await signIn(page, app, secret.password);
    await failEnhancement(page, app.origin);
    await page.goto('/studio');
    await expect(alert(page)).toBeVisible({ timeout: PAST_TIMEOUT_MS });
    const documents = studioDocuments(page);
    await reloadStudio(page).click();
    await expect.poll(() => documents.length, 'a reload of /studio').toBe(1);
  },
);

test(
  "with the shell's chunks held past 5 seconds, /studio says Studio couldn't load, and nothing still says it's loading (row 88c, H1)",
  { annotation: [STUDIO] },
  async ({ page, app }) => {
    await signIn(page, app, secret.password);
    const { held, release } = await holdShell(page, app.origin);
    try {
      await page.goto('/studio', { waitUntil: 'domcontentloaded' });
      await expect.poll(() => held.length, 'the optional chunks are asked for').toBeGreaterThan(0);
      await expect(alert(page)).toBeVisible({ timeout: PAST_TIMEOUT_MS });
      await expect(reloadStudio(page)).toBeFocused();
      expect(await failureStateFindings(page)).toEqual([]);
    } finally {
      release();
    }
  },
);

test(
  'a shell released at 6 seconds takes over from the alert, with focus at its start, and works: Sign out signs out (row 88c, H2)',
  { annotation: [STUDIO] },
  async ({ page, app }) => {
    await signIn(page, app, secret.password);
    const { release } = await holdShell(page, app.origin);
    const logouts = logoutsOf(page);
    const started = Date.now();
    await page.goto('/studio', { waitUntil: 'domcontentloaded' });
    await expect(alert(page)).toBeVisible({ timeout: PAST_TIMEOUT_MS });
    await pause(Math.max(0, RELEASE_AT_MS - (Date.now() - started)));
    release();
    await expect(page.locator('.studio-state__lines')).toBeAttached({ timeout: PAST_TIMEOUT_MS });
    await expect(alert(page)).toHaveCount(0);
    await expect(page.locator('#studio-main')).toBeFocused();
    await signOut(page).click();
    await expect(page).toHaveURL(`${app.origin}${SIGNED_OUT}`);
    expect(logouts, 'one auth.logout').toHaveLength(1);
  },
);

test(
  'Reload Studio pressed before a held shell is released reloads /studio (row 88c, H3)',
  { annotation: [STUDIO] },
  async ({ page, app }) => {
    await signIn(page, app, secret.password);
    const { release } = await holdShell(page, app.origin);
    await page.goto('/studio', { waitUntil: 'domcontentloaded' });
    await expect(alert(page)).toBeVisible({ timeout: PAST_TIMEOUT_MS });
    const documents = studioDocuments(page);
    await reloadStudio(page).click();
    release();
    await expect.poll(() => documents.length, 'a reload of /studio').toBe(1);
  },
);

test(
  'a shell released at 6 seconds takes over from the late alert with no hydration error: the late node goes, the shell shows and works, and Sign out signs out (row 88c, H5 live)',
  { annotation: [STUDIO] },
  async ({ page, app }, testInfo) => {
    await signIn(page, app, secret.password);
    const { release } = await holdShell(page, app.origin);
    const logouts = logoutsOf(page);
    const errors = errorsOf(page);
    const started = Date.now();
    await page.goto('/studio', { waitUntil: 'domcontentloaded' });
    await expect(lateNode(page)).toHaveCount(1, { timeout: PAST_TIMEOUT_MS });
    await expect(alert(page)).toBeVisible();
    await pause(Math.max(0, RELEASE_AT_MS - (Date.now() - started)));
    release();
    await expect(page.locator('.studio-state__lines')).toBeAttached({ timeout: PAST_TIMEOUT_MS });
    await expect(lateNode(page)).toHaveCount(0);
    await expect(alert(page)).toHaveCount(0);
    await expect(page.locator('.studio-load')).not.toHaveAttribute('hidden');
    await expect(page.locator('#studio-main')).toBeVisible();
    await expect(page.locator('#studio-main')).toBeFocused();
    await testInfo.attach('console errors', { body: errors.join('\n'), contentType: 'text/plain' });
    expect(
      errors.filter((each) => HYDRATION.test(each)),
      'no hydration error',
    ).toEqual([]);
    await signOut(page).click();
    await expect(page).toHaveURL(`${app.origin}${SIGNED_OUT}`);
    expect(logouts, 'one auth.logout').toHaveLength(1);
  },
);

test(
  "a shell held past 5 seconds and then refused leaves one alert, the boundary's, with Reload Studio focused (row 88c, H5 rejected)",
  { annotation: [STUDIO] },
  async ({ page, app }) => {
    await signIn(page, app, secret.password);
    const { refuse } = await holdShell(page, app.origin);
    await page.goto('/studio', { waitUntil: 'domcontentloaded' });
    await expect(lateNode(page)).toHaveCount(1, { timeout: PAST_TIMEOUT_MS });
    await expect(alert(page)).toBeVisible();
    refuse();
    await expect(lateNode(page)).toHaveCount(0, { timeout: PAST_TIMEOUT_MS });
    await expect(alert(page)).toHaveCount(1);
    await expect(page.locator('main#studio-load-failure').getByRole('alert')).toBeVisible();
    await expect(reloadStudio(page)).toBeFocused();
    expect(await failureStateFindings(page)).toEqual([]);
  },
);
