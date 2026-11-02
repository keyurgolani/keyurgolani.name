import { readFileSync } from 'node:fs';
import { COLOR_ROLES } from '../../packages/appearance/src/roles';
import { BUSY_LIMIT_MS, notBusy, STILL_BUSY } from './lib/a11y/conditions';
import { axeFor } from './lib/axe';
import { EGRESS_GUARD_URL, FIXED_CLOCK_URL, FIXED_TIME } from './lib/clock';
import { elementDetailsScript } from './lib/probes';
import { startApp } from '../harness/app-server.mjs';
import { defaultTuple } from './cells';
import { canaryPassword } from './lib/artifacts.mjs';
import { CANARY_COOKIE, qualityWeb, runCanary } from './lib/env';
import { appOptionsFor } from './lib/server';
import { createAuthSession, recordSessionSecrets } from './lib/session';
import { cellHeaders, expect, test } from './fixtures';

// The harness's own checks against the quality build (#11, Slice 1), on the
// harness project's server (lib/server.ts's HARNESS_SERVER): the server's
// clock, and the token-role match on #19's primitives page,
// /_fixtures/appearance (the quality build sets APPEARANCE_FIXTURES=1),
// which renders every slot in the boundary. The host's site pages render
// the same boundary (#19, Slice 4).

const READ_ONLY = { type: 'profile', description: 'read-only' };

test(
  'a page settles once nothing on it is aria-busy, and one that never clears it is no settled page: its cell fails, saying so',
  { annotation: [{ type: 'route', description: '/' }, READ_ONLY] },
  async ({ page }) => {
    // A page that fetches its content after load, as #8's Studio does, clears aria-busy once it lands.
    await page.setContent(
      '<main><p id="loading" aria-busy="true">Loading…</p><script>setTimeout(() => document.getElementById("loading").removeAttribute("aria-busy"), 300)</script></main>',
    );
    expect(await notBusy(page)).toBe(true);
    // One that never does waits out the limit and answers false, which fails the cell with STILL_BUSY.
    await page.setContent('<main><p aria-busy="true">Loading…</p></main>');
    const started = Date.now();
    expect(await notBusy(page)).toBe(false);
    expect(Date.now() - started).toBeGreaterThanOrEqual(BUSY_LIMIT_MS - 100);
    expect(STILL_BUSY).toBe('the page still says it\'s loading, aria-busy="true", after 10 s');
  },
);

test(
  'the server starts with the clock and the socket guard preloaded, and the guard says it loaded',
  { annotation: [{ type: 'route', description: '/' }, READ_ONLY] },
  async ({ app }) => {
    const preloads = (app.env.NODE_OPTIONS ?? '').split(/\s+/);
    expect(preloads).toContain(`--import=${FIXED_CLOCK_URL}`);
    expect(preloads).toContain(`--import=${EGRESS_GUARD_URL}`);
    await expect
      .poll(() => readFileSync(app.log, 'utf8'), { message: "the guard's line in the server log" })
      .toContain('[egress-guard] loaded');
  },
);

test(
  "the server runs on the fixed clock: every line it logs says the fixture's day",
  { annotation: [{ type: 'route', description: '/' }, READ_ONLY] },
  async ({ app, request }) => {
    // The sitemap names no date (#22), so each JSON line the server logs,
    // from startup on, is stamped from its clock instead.
    expect((await request.get('/', { maxRedirects: 0 })).status()).toBe(200);
    const days = () =>
      readFileSync(app.log, 'utf8')
        .split('\n')
        .filter((line) => line.startsWith('{'))
        .map((line) => (JSON.parse(line) as { ts: string }).ts.slice(0, 10));
    await expect.poll(days, { message: 'lines the server logged' }).not.toEqual([]);
    expect(new Set(days())).toEqual(new Set([FIXED_TIME.slice(0, 10)]));
  },
);

test(
  "the token role is the boundary role the element's color resolves to, hard-coded for any other, and none outside a boundary",
  { annotation: [{ type: 'route', description: '/_fixtures/appearance' }, READ_ONLY] },
  async ({ page }) => {
    const response = await page.goto('/_fixtures/appearance');
    expect(response?.status()).toBe(200);
    // A visible primary action, by its role and name, marked so the probe can find it.
    const publish = page
      .locator('[data-appearance-boundary="document"]')
      .getByRole('button', { name: 'Publish revision' })
      .first();
    await expect(publish).toHaveAttribute('data-emphasis', 'primary');
    await publish.evaluate((element) => element.setAttribute('data-quality-probe', 'action'));
    await page.evaluate(() => {
      const boundary = document.querySelector('[data-appearance-boundary="document"]')!;
      const hard = document.createElement('p');
      hard.id = 'quality-hard-coded';
      hard.textContent = 'Hard-coded';
      hard.style.color = 'rgb(1, 2, 3)';
      boundary.append(hard);
      const outside = document.createElement('p');
      outside.id = 'quality-outside';
      outside.textContent = 'Outside';
      document.body.append(outside);
    });
    // axe sets window.axe, which the role and name come from.
    await axeFor(page).analyze();
    const primary = '[data-quality-probe="action"]';
    const [action, hard, outside] = await page.evaluate(elementDetailsScript, {
      selectors: [primary, '#quality-hard-coded', '#quality-outside'],
      property: 'color' as const,
      roles: [...COLOR_ROLES],
    });
    expect(action?.found, 'a primary action renders in the document boundary').toBe(true);
    // A primary action's text is on-accent, or a role that resolves to the same color.
    const sameAsOnAccent = await page.evaluate(
      ({ selector, roles }) => {
        const boundary = document.querySelector('[data-appearance-boundary="document"]')!;
        const probe = document.createElement('span');
        boundary.append(probe);
        const colorOf = (role: string) => {
          probe.style.color = `var(--color-${role})`;
          return getComputedStyle(probe).color;
        };
        const target = colorOf('on-accent');
        const matching = roles.filter((role) => colorOf(role) === target);
        probe.remove();
        return {
          matching,
          element: getComputedStyle(document.querySelector(selector)!).color,
          target,
        };
      },
      { selector: primary, roles: [...COLOR_ROLES] },
    );
    expect(sameAsOnAccent.element).toBe(sameAsOnAccent.target);
    expect(sameAsOnAccent.matching).toContain(action!.tokenRole);
    expect(action?.semanticRole).toBe('button');
    expect(action?.uiSlot).toBe('action');
    expect(action?.accessibleName).toBe('Publish revision');
    expect(hard?.tokenRole).toBe('hard-coded');
    expect(outside?.found).toBe(true);
    expect(outside?.tokenRole).toBeUndefined();
  },
);

test(
  "a signed-in cell's page sends its session's own CSRF token, so a command passes ownerAuth's CSRF check; with the canary in that header instead, as before, it's refused",
  {
    annotation: [
      { type: 'route', description: '/studio' },
      { type: 'profile', description: 'owner' },
    ],
  },
  async ({ browser }, testInfo) => {
    const canary = runCanary();
    // An owner server of its own, as a session cell's, on the harness's fixture.
    const owner = appOptionsFor(
      { source: 'complete', tuple: defaultTuple('fallback', 'system'), profile: 'owner' },
      qualityWeb(),
      canary,
    );
    const app = await startApp({ ...owner, logFile: testInfo.outputPath('owner-server.log') });
    try {
      const session = await createAuthSession({
        origin: app.origin,
        password: canaryPassword(canary),
      });
      recordSessionSecrets(session, process.env.QUALITY_SECRETS_FILE);
      // A command from the signed-in page, as Studio sends one, under a cell's extra headers.
      const command = async (cellAuth: 'none' | 'session') => {
        const context = await browser.newContext();
        try {
          await context.addCookies([
            { name: CANARY_COOKIE, value: canary, url: app.origin },
            ...session.storageState.cookies,
          ]);
          await context.setExtraHTTPHeaders(cellHeaders(canary, cellAuth));
          const page = await context.newPage();
          await page.goto(`${app.origin}/studio`);
          return await page.evaluate(async (token) => {
            const response = await fetch('/api/studio/draft.create', {
              method: 'POST',
              headers: { 'content-type': 'application/json', 'x-csrf-token': token },
              body: '{}',
            });
            const body = (await response.json().catch(() => ({}))) as {
              error?: { code?: string };
            };
            return { status: response.status, code: body.error?.code ?? null };
          }, session.csrfToken);
        } finally {
          await context.close();
        }
      };
      const signedIn = await command('session');
      expect(signedIn.code, "the session cell's command").not.toBe('request_origin_rejected');
      expect([200, 409], JSON.stringify(signedIn)).toContain(signedIn.status);
      // The canary in the CSRF header replaces the page's own, and ownerAuth refuses it.
      expect(await command('none')).toEqual({ status: 403, code: 'request_origin_rejected' });
    } finally {
      await app.stop();
    }
  },
);
