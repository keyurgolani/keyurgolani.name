import type { APIResponse, Page, Route } from '@playwright/test';
import { expect, test } from '../harness/fixtures';
import { ownerSecret } from '../harness/owner-secret.mjs';
import { ownerApp } from '../harness/profile-matrix';
import { headerProblems, STUDIO_CSP } from '../harness/route-headers.mjs';

// Studio's pages under owner (#2), against the built server with the
// password provider: the sign-in page, with and without JavaScript, its
// rate limit's announcements, the Studio shell at /studio behind
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
    // No page has a theme script any more (#19, Slice 4), and Studio's never did.
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
    // The toggle shows what was typed.
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
  'keyboard only, the owner reaches the password, the toggle, and Sign in in that order, shows the password with Space, and signs in with Enter',
  { annotation: [SIGN_IN] },
  async ({ page, app }) => {
    await page.goto('/studio/sign-in');
    const password = page.getByLabel('Password');
    const toggle = page.getByRole('button', { name: 'Show password' });
    // The toggle is there once the page has hydrated, and the scripted post with it.
    await expect(toggle).toBeVisible();
    await page.keyboard.press('Tab');
    await expect(password).toBeFocused();
    await page.keyboard.type('not the owner password at all');
    await page.keyboard.press('Tab');
    await expect(toggle).toBeFocused();
    await page.keyboard.press('Space');
    await expect(password).toHaveAttribute('type', 'text');
    await expect(page.getByRole('button', { name: 'Hide password' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    await page.keyboard.press('Space');
    await expect(password).toHaveAttribute('type', 'password');
    await page.keyboard.press('Tab');
    await expect(page.getByRole('button', { name: 'Sign in' })).toBeFocused();
    await page.keyboard.press('Enter');
    const alert = notice(page);
    await expect(alert).toHaveText("That password didn't work.");
    await expect(alert).toBeFocused();
    // From the alert, Tab is back at the password, and Enter there signs in.
    await page.keyboard.press('Tab');
    await expect(password).toBeFocused();
    await page.keyboard.press('ControlOrMeta+A');
    await page.keyboard.type(secret.password);
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(`${app.origin}/studio`);
    await expect(page.getByText('Signed in')).toBeVisible();
  },
);

test(
  'a password pasted from the clipboard goes into the field as it was, and signs the owner in',
  { annotation: [SIGN_IN] },
  async ({ page, context, app }) => {
    await context.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: app.origin });
    await page.goto('/studio/sign-in');
    await expect(page.getByRole('button', { name: 'Show password' })).toBeVisible();
    await page.evaluate((text) => navigator.clipboard.writeText(text), secret.password);
    const password = page.getByLabel('Password');
    await password.focus();
    await page.keyboard.press('ControlOrMeta+V');
    await expect(password).toHaveValue(secret.password);
    await page.getByRole('button', { name: 'Sign in' }).click();
    await expect(page).toHaveURL(`${app.origin}/studio`);
    await expect(page.getByText('Signed in')).toBeVisible();
  },
);

/** A JSON error envelope, as auth.login answers with one. */
const envelope = (code: string) =>
  JSON.stringify({ error: { code, message: 'Stood in for by the test.', requestId: 'stub' } });

test(
  'every sign-in state shows in its alert, with JavaScript and without, and each is attached as a screenshot',
  { annotation: [SIGN_IN] },
  async ({ browser, page, app }, testInfo) => {
    const shot = async (on: Page, name: string) => {
      await testInfo.attach(`sign-in-${name}.png`, {
        body: await on.screenshot({ fullPage: true }),
        contentType: 'image/png',
      });
    };
    const password = page.getByLabel('Password');
    const alert = notice(page);
    // With JavaScript, each answer the scripted post can meet. The server
    // gives a wrong password itself; the route stands in for the rest.
    const answers: [name: string, text: string, answer?: (route: Route) => Promise<void>][] = [
      ['wrong-password', "That password didn't work."],
      [
        'rate-limited',
        'Too many attempts. Try again in 30 seconds.',
        (route) =>
          route.fulfill({
            status: 429,
            headers: { 'retry-after': '30', 'content-type': 'application/json' },
            body: envelope('rate_limited'),
          }),
      ],
      [
        'network-failure',
        "Couldn't reach the server. Check your connection, then try again.",
        (route) => route.abort('failed'),
      ],
      [
        'server-error',
        'Something went wrong on the server. Try again soon.',
        (route) =>
          route.fulfill({
            status: 500,
            contentType: 'application/json',
            body: envelope('internal_error'),
          }),
      ],
    ];
    for (const [name, text, answer] of answers) {
      await page.unrouteAll();
      if (answer) await page.route('**/api/studio/auth.login', answer);
      await page.goto('/studio/sign-in');
      await password.fill('not the owner password at all');
      await page.getByRole('button', { name: 'Sign in' }).click();
      await expect(alert, name).toHaveText(text);
      await expect(alert, name).toBeFocused();
      await shot(page, name);
    }
    // Submitting: the post is held until the screenshot is taken.
    await page.unrouteAll();
    let release = () => {};
    const held = new Promise<void>((resolve) => (release = resolve));
    await page.route('**/api/studio/auth.login', async (route) => {
      await held;
      await route.abort('failed');
    });
    await page.goto('/studio/sign-in');
    await password.fill('not the owner password at all');
    await page.getByRole('button', { name: 'Sign in' }).click();
    await expect(alert).toHaveText('Signing in…');
    await expect(alert).toBeFocused();
    await shot(page, 'submitting');
    release();
    await expect(alert).toHaveText(
      "Couldn't reach the server. Check your connection, then try again.",
    );
    await page.unrouteAll();
    // The states a redirect names, which the page renders from its URL.
    for (const [state, text] of [
      ['signed_out', "You're signed out."],
      ['session_ended', 'Your session ended. Sign in again to go on.'],
    ] as const) {
      await page.goto(`/studio/sign-in?state=${state}`);
      await expect(alert, state).toHaveText(text);
      await expect(alert, state).toBeFocused();
      await shot(page, state.replace('_', '-'));
    }

    // Without JavaScript, the server renders each state a form post's
    // redirect names, the rate limit's time with it.
    const context = await browser.newContext({ javaScriptEnabled: false, baseURL: app.origin });
    try {
      const plain = await context.newPage();
      for (const [query, text] of [
        ['state=failed', "That password didn't work."],
        ['state=rate_limited&retryAfter=30', 'Too many attempts. Try again in 30 seconds.'],
        ['state=error', 'Something went wrong on the server. Try again soon.'],
        ['state=signed_out', "You're signed out."],
        ['state=session_ended', 'Your session ended. Sign in again to go on.'],
      ] as const) {
        await plain.goto(`/studio/sign-in?${query}`);
        await expect(notice(plain), query).toHaveText(text);
        await shot(plain, `no-js-${query.slice('state='.length).split('&')[0]!.replace('_', '-')}`);
      }
      await expect(plain.locator('p.studio-countdown')).toHaveCount(0);
      await plain.goto('/studio/sign-in?state=rate_limited&retryAfter=30');
      await expect(plain.locator('p.studio-countdown')).toHaveText('30 seconds left.');
    } finally {
      await context.close();
    }
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
