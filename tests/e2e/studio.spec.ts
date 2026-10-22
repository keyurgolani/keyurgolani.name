import type { APIResponse, Page } from '@playwright/test';
import { expect, test } from '../harness/fixtures';
import { ownerSecret } from '../harness/owner-secret.mjs';
import { ownerApp } from '../harness/profile-matrix';
import { headerProblems, STUDIO_CSP } from '../harness/route-headers.mjs';

// Studio's pages under owner (#2), against the built server with the
// password provider: the sign-in page, with and without JavaScript, its
// rate limit's announcements, the placeholder /studio behind
// requireOwnerPage, Studio's headers, and signing out of every tab at once.
const STUDIO = { type: 'route', description: '/studio' };
const SIGN_IN = { type: 'route', description: '/studio/sign-in' };

const secret = ownerSecret();
test.use({ appOptions: ownerApp(secret.hash) });

function headersOf(response: APIResponse, path: string) {
  return headerProblems(path, response.headers());
}

/** The sign-in page's own alert, apart from Next's route announcer, which is one too. */
const notice = (page: Page) => page.locator('p.studio-alert');

test(
  'Studio pages render no public inline script or JSON-LD and carry the nonce CSP',
  { annotation: [SIGN_IN] },
  async ({ request }) => {
    const response = await request.get('/studio/sign-in');
    expect(response.status()).toBe(200);
    const nonce = STUDIO_CSP.exec(response.headers()['content-security-policy'] ?? '')?.[1];
    expect(nonce, 'a nonce CSP').toBeTruthy();
    const html = await response.text();
    const scripts = [...html.matchAll(/<script\b[^>]*>/g)].map(([tag]) => tag);
    expect(scripts.length).toBeGreaterThan(0);
    for (const tag of scripts)
      expect(tag, 'a script without the nonce').toContain(`nonce="${nonce}"`);
    expect(html).not.toContain('application/ld+json');
    // The site's theme script sets data-theme before first paint; Studio has none.
    expect(html).not.toContain('data-theme');
  },
);

test(
  'every /studio response, in any case or percent-encoding, carries the nonce CSP, and every /studio and /api/studio response carries no-store, nosniff, and Referrer-Policy and Cross-Origin-Resource-Policy: same-origin',
  { annotation: [STUDIO, SIGN_IN, { type: 'route', description: '/api/studio/[name]' }] },
  async ({ app, request }) => {
    const nonces = new Set<string>();
    for (const [path, status] of [
      ['/studio', 303],
      ['/studio/sign-in', 200],
      ['/studio/sign-in?state=failed', 200],
      ['/studio/nowhere', 404],
      // In any case, as Next matches next.config.ts's header sources.
      ['/Studio', 404],
      ['/STUDIO/sign-in', 404],
      ['/sTuDiO/x', 404],
      // Percent-encoded, as the route table reads it: /studio, so the 303.
      ['/%73tudio', 303],
    ] as const) {
      const response = await request.get(path, { maxRedirects: 0 });
      expect(response.status(), path).toBe(status);
      expect(headersOf(response, new URL(path, app.origin).pathname), path).toEqual([]);
      nonces.add(STUDIO_CSP.exec(response.headers()['content-security-policy'] ?? '')?.[1] ?? '');
    }
    expect(nonces.size, 'every response has its own nonce').toBe(8);
    for (const [path, method] of [
      ['/api/studio/auth.session', 'GET'],
      ['/api/studio/auth.login', 'POST'],
      ['/api/studio/no.such.operation', 'GET'],
    ] as const) {
      const response = await request.fetch(path, {
        method,
        data: method === 'POST' ? {} : undefined,
      });
      expect(headersOf(response, path), path).toEqual([]);
    }
  },
);

test(
  'without JavaScript the sign-in form posts the password and lands where the owner was going, or back with the state',
  { annotation: [SIGN_IN] },
  async ({ browser, app }) => {
    const context = await browser.newContext({ javaScriptEnabled: false, baseURL: app.origin });
    try {
      const page = await context.newPage();
      await page.goto('/studio/sign-in?returnTo=%2Fstudio');
      // The hidden field carries where the owner was going.
      await expect(page.locator('input[name="returnTo"]')).toHaveValue('/studio');
      await page.getByLabel('Password').fill('not the owner password at all');
      await page.getByRole('button', { name: 'Sign in' }).click();
      // /studio is where sign-in goes by default, so the URL leaves it out.
      await expect(page).toHaveURL(`${app.origin}/studio/sign-in?state=failed`);
      await expect(notice(page)).toHaveText("That password didn't work.");
      await page.getByLabel('Password').fill(secret.password);
      await page.getByRole('button', { name: 'Sign in' }).click();
      await expect(page).toHaveURL(new RegExp(`^${app.origin}/studio$`));
      await expect(page.getByText('Signed in')).toBeVisible();
    } finally {
      await context.close();
    }
  },
);

test(
  'the sign-in form carries returnTo in its action URL as well as its field, so a post turned away before its body is read keeps it',
  { annotation: [SIGN_IN] },
  async ({ browser, app }) => {
    const context = await browser.newContext({ javaScriptEnabled: false, baseURL: app.origin });
    try {
      const page = await context.newPage();
      await page.goto('/studio/sign-in?returnTo=%2Fstudio%3Ftab%3Dhistory');
      await expect(page.locator('form')).toHaveAttribute(
        'action',
        '/api/studio/auth.login?returnTo=%2Fstudio%3Ftab%3Dhistory',
      );
      await expect(page.locator('input[name="returnTo"]')).toHaveValue('/studio?tab=history');
      // Signed in, the owner lands there.
      await page.getByLabel('Password').fill(secret.password);
      await page.getByRole('button', { name: 'Sign in' }).click();
      await expect(page).toHaveURL(`${app.origin}/studio?tab=history`);
    } finally {
      await context.close();
    }
  },
);

test(
  'with JavaScript the sign-in form shows a wrong password in an alert that takes focus, then signs the owner in',
  { annotation: [SIGN_IN] },
  async ({ page, app }) => {
    await page.goto('/studio/sign-in');
    const password = page.getByLabel('Password');
    // Paste works, and the toggle shows what was pasted.
    await password.fill('not the owner password at all');
    await page.getByRole('button', { name: 'Show password' }).click();
    await expect(password).toHaveAttribute('type', 'text');
    await page.getByRole('button', { name: 'Hide password' }).click();
    await page.getByRole('button', { name: 'Sign in' }).click();
    const alert = notice(page);
    await expect(alert).toHaveText("That password didn't work.");
    await expect(alert).toBeFocused();
    // The scripted post stays on the page, so the URL names no state.
    await expect(page).toHaveURL(`${app.origin}/studio/sign-in`);
    await password.fill(secret.password);
    await page.getByRole('button', { name: 'Sign in' }).click();
    await expect(page).toHaveURL(`${app.origin}/studio`);
    await expect(page.getByText('Signed in')).toBeVisible();
  },
);

test(
  'a rate limit is announced once with its time, counts down where nothing is announced, and announces once more as it lifts',
  { annotation: [SIGN_IN] },
  async ({ page }) => {
    await page.clock.install();
    await page.route('**/api/studio/auth.login', (route) =>
      route.fulfill({
        status: 429,
        headers: { 'retry-after': '3', 'content-type': 'application/json' },
        body: JSON.stringify({
          error: { code: 'rate_limited', message: 'Too many attempts.', requestId: 'stub' },
        }),
      }),
    );
    await page.goto('/studio/sign-in');
    // Every text the live region takes, in order.
    await page.evaluate(() => {
      const region = document.querySelector('p.studio-alert')!;
      const seen: string[] = [];
      (window as unknown as { announced: string[] }).announced = seen;
      new MutationObserver(() => {
        const text = region.textContent ?? '';
        if (seen.at(-1) !== text) seen.push(text);
      }).observe(region, { childList: true, characterData: true, subtree: true });
    });
    await page.getByLabel('Password').fill('not the owner password at all');
    await page.getByRole('button', { name: 'Sign in' }).click();
    const alert = notice(page);
    const countdown = page.locator('p.studio-countdown');
    await expect(alert).toHaveText('Too many attempts. Try again in 3 seconds.');
    await expect(alert).toBeFocused();
    await expect(countdown).toHaveText('3 seconds left.');
    // The countdown is no live region, and the alert stays as it was.
    for (const name of ['role', 'aria-live', 'aria-atomic']) {
      expect(await countdown.getAttribute(name), name).toBeNull();
    }
    await page.clock.runFor(1_000);
    await expect(countdown).toHaveText('2 seconds left.');
    await page.clock.runFor(1_000);
    await expect(countdown).toHaveText('1 second left.');
    await expect(alert).toHaveText('Too many attempts. Try again in 3 seconds.');
    await page.clock.runFor(1_000);
    await expect(alert).toHaveText('You can try again now.');
    await expect(countdown).toHaveCount(0);
    const announced = await page.evaluate(
      () => (window as unknown as { announced: string[] }).announced,
    );
    expect(announced).toEqual([
      'Signing in…',
      'Too many attempts. Try again in 3 seconds.',
      'You can try again now.',
    ]);
  },
);

test(
  'a Studio page without a session goes to sign-in, keeping the path, and one whose session ended says so',
  { annotation: [STUDIO] },
  async ({ request, app }) => {
    const none = await request.get('/studio', { maxRedirects: 0 });
    expect(none.status()).toBe(303);
    expect(new URL(none.headers()['location'] ?? '', app.origin).href).toBe(
      `${app.origin}/studio/sign-in`,
    );
    // A cookie that names no session gets past proxy.ts, and requireOwnerPage
    // sends it to sign-in with Next's redirect().
    const ended = await request.get('/studio', {
      maxRedirects: 0,
      headers: { cookie: `studio_session=${'x'.repeat(43)}` },
    });
    expect(ended.status()).toBe(307);
    expect(ended.headers()['location']).toBe('/studio/sign-in?state=session_ended');
  },
);

test(
  'logout clears the HTTP cache and signs every other tab out',
  { annotation: [STUDIO] },
  async ({ context, app }) => {
    const first = await context.newPage();
    await first.goto('/studio/sign-in');
    await first.getByLabel('Password').fill(secret.password);
    await first.getByRole('button', { name: 'Sign in' }).click();
    await expect(first).toHaveURL(`${app.origin}/studio`);
    const second = await context.newPage();
    await second.goto('/studio');
    await expect(second.getByText('Signed in')).toBeVisible();

    const logout = first.waitForResponse((response) =>
      response.url().endsWith('/api/studio/auth.logout'),
    );
    await first.getByRole('button', { name: 'Sign out' }).click();
    const response = await logout;
    expect(response.status()).toBe(200);
    // allHeaders(): Chromium keeps Clear-Site-Data out of headers().
    expect((await response.allHeaders())['clear-site-data']).toBe('"cache"');
    await expect(first).toHaveURL(`${app.origin}/studio/sign-in?state=signed_out`);
    await expect(notice(first)).toHaveText("You're signed out.");
    // The other tab heard it on BroadcastChannel('studio-session') and left.
    await expect(second).toHaveURL(`${app.origin}/studio/sign-in?state=signed_out`);
    // And the session is over: /studio sends the next visit to sign-in.
    await second.goto('/studio');
    await expect(second).toHaveURL(/\/studio\/sign-in/);
  },
);
