import type { Page, Request, Route } from '@playwright/test';
import { expect, test } from '../harness/fixtures';
import { ownerSecret } from '../harness/owner-secret.mjs';
import { seedDraft, signIn } from '../harness/preview-grants';
import { ownerApp } from '../harness/profile-matrix';
import { openTask } from '../harness/studio-tasks';
import { failureStateFindings } from '../quality/lib/a11y/conditions';

// Owner Studio when its shell doesn't load (row 88c), against the built
// server with the password provider. Failed enhancement as the quality
// harness takes it (tests/quality/lib/a11y/conditions.ts:838-848, which E's
// Studio read ran): every script chunk the page's HTML doesn't load itself is
// refused, and every font. The shell's chunks are among them, as next/dynamic
// names them only by preload links. Or those chunks are held, as on a
// connection that stalls. Either way the page says "Studio couldn't load."
// with Reload Studio, which takes focus, and Sign out, which ends the session
// (F1's lib/studio/sign-out.ts). A shell that arrives after the alert takes
// over, unless the owner pressed something in it first.
const STUDIO = { type: 'route', description: '/studio' };

const secret = ownerSecret();
test.use({ appOptions: ownerApp(secret.hash) });

const SIGNED_OUT = '/studio/sign-in?state=signed_out';
const JOURNAL_KEY = 'portfolio-studio:journal:v1';
/** The shell's own wait (load-boundary.tsx's STUDIO_LOAD_TIMEOUT_MS), and margin past it. */
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

/** Failed enhancement on `page`: its optional chunks and its fonts refused. Returns what it refused. */
async function failEnhancement(page: Page, origin: string): Promise<string[]> {
  const own = await ownScripts(page, origin);
  const refused: string[] = [];
  await page.route('**/*', (route) => {
    const request = route.request();
    if (optional(request, own) || request.resourceType() === 'font') {
      refused.push(request.url());
      return route.abort('blockedbyclient');
    }
    return route.fallback();
  });
  return refused;
}

/** The optional chunks held until `release`, as on a connection that stalls. Returns what it held. */
async function holdShell(
  page: Page,
  origin: string,
): Promise<{ readonly held: string[]; readonly release: () => void }> {
  const own = await ownScripts(page, origin);
  const held: string[] = [];
  let release = () => {};
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route('**/*', async (route: Route) => {
    if (!optional(route.request(), own)) return route.fallback();
    held.push(route.request().url());
    await gate;
    // A page that reloaded or left has no request to go on with.
    await route.fallback().catch(() => {});
  });
  return { held, release };
}

const alert = (page: Page) => page.getByRole('alert').filter({ hasText: "Studio couldn't load." });
const reloadStudio = (page: Page) => page.getByRole('button', { name: 'Reload Studio' });
const signOut = (page: Page) => page.getByRole('button', { name: 'Sign out' });

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
  "with the shell's chunks refused, /studio says Studio couldn't load, with Reload Studio, which takes focus, and Sign out, and nothing still loading (row 88c, R1)",
  { annotation: [STUDIO] },
  async ({ page, app }) => {
    await signIn(page, app, secret.password);
    const refused = await failEnhancement(page, app.origin);
    await page.goto('/studio');
    await expect.poll(() => refused.length, 'the optional chunks are asked for').toBeGreaterThan(0);
    await expect(alert(page)).toBeVisible({ timeout: PAST_TIMEOUT_MS });
    await expect(reloadStudio(page)).toBeFocused();
    await expect(alert(page).getByRole('button', { name: 'Sign out' })).toBeVisible();
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
  "with the shell's chunks refused, Sign out sends one auth.logout and lands on sign-in, signed out (row 88c, R3)",
  { annotation: [STUDIO] },
  async ({ page, app }) => {
    await signIn(page, app, secret.password);
    await failEnhancement(page, app.origin);
    const logouts = logoutsOf(page);
    await page.goto('/studio');
    await expect(alert(page)).toBeVisible({ timeout: PAST_TIMEOUT_MS });
    await signOut(page).click();
    await expect.soft(page).toHaveURL(`${app.origin}${SIGNED_OUT}`);
    expect(logouts, 'one auth.logout').toHaveLength(1);
  },
);

test(
  "with the shell's chunks refused and unsaved text in the journal, Sign out asks first, and Discard clears the journal before auth.logout goes (row 88c, R4)",
  { annotation: [STUDIO] },
  async ({ page, app }) => {
    const draft = await seedDraft(app, 'Rowan Unloaded');
    await signIn(page, app, secret.password);
    // Unsaved text, while the shell still loads.
    await openTask(page, 'Content');
    await page.getByRole('button', { name: 'Source', exact: true }).click();
    const portfolio = page.getByLabel(/^portfolio\.(?:yml|json)$/);
    await expect(portfolio).toHaveValue(draft.documents.portfolio.sourceText);
    await portfolio.fill(`${draft.documents.portfolio.sourceText}# not saved yet\n`);
    const journal = () => page.evaluate((key) => localStorage.getItem(key), JOURNAL_KEY);
    await expect
      .poll(async () => (JSON.parse((await journal()) ?? '[]') as unknown[]).length)
      .toBe(1);
    // Then a load whose shell doesn't come.
    await failEnhancement(page, app.origin);
    await page.reload();
    await expect(alert(page)).toBeVisible({ timeout: PAST_TIMEOUT_MS });
    let atRequest: string | null | undefined;
    await page.route('**/api/studio/auth.logout', async (route) => {
      atRequest = await journal();
      await route.continue();
    });
    await signOut(page).click();
    await page
      .getByRole('dialog', { name: 'Keep your unsaved changes?' })
      .getByRole('button', { name: 'Discard them and sign out' })
      .click();
    await expect(page).toHaveURL(`${app.origin}${SIGNED_OUT}`);
    expect(atRequest, 'the journal as auth.logout went').toBeNull();
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
  'Reload Studio pressed before a held shell is released reloads, and the late shell is ignored (row 88c, H3)',
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
