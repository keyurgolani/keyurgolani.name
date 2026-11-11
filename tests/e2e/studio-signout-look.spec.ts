import { renameSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { Page, Request, TestInfo } from '@playwright/test';
import { expect, test } from '../harness/fixtures';
import { ownerSecret } from '../harness/owner-secret.mjs';
import { seedDraft, signIn } from '../harness/preview-grants';
import { ownerApp } from '../harness/profile-matrix';

// Row 88c-RC2's look packet, for the coordinator before any push: the three places Sign out's look
// changes. It shoots only, with no assertion on Sign out, so the same file runs at the base, for
// the before, and at the head, for the after.
//   1. /studio without JavaScript: the header's Sign out (after: and the discard beside it), at
//      1440 and 390, as look-no-js-shell-<width>.png.
//   2. /studio with the shell's chunks refused: the load alert (after: Sign out and the discard).
//   3. /studio/preview whose render throws, with JavaScript: error.tsx (after: the same two).
// Both alerts are shot at 1440, 1280 and 390, light and dark, as look-<state>-<width>-<scheme>.png:
// the coordinator's look call on their actions row's gap.

const secret = ownerSecret();
test.use({ appOptions: ownerApp(secret.hash) });
test.use({ studioLastTask: 'content' });

const VIEWPORTS = [
  { width: 1440, height: 900 },
  { width: 390, height: 844 },
] as const;

/**
 * Where both alerts are shot, in each color scheme: the coordinator's look call on their actions
 * row's gap (row 88c-RC2) wants 1280 beside 1440 and 390, light and dark.
 */
const ALERT_VIEWPORTS = [
  { width: 1440, height: 900 },
  { width: 1280, height: 800 },
  { width: 390, height: 844 },
] as const;
const SCHEMES = ['light', 'dark'] as const;

/** Shoots `page` whole, as look-<name>.png in the test's output directory, and attaches it. */
const shoot = async (page: Page, name: string, testInfo: TestInfo) => {
  const file = testInfo.outputPath(`look-${name}.png`);
  await page.screenshot({ fullPage: true, path: file });
  await testInfo.attach(`look-${name}.png`, { path: file, contentType: 'image/png' });
};

/** The script URLs /studio's HTML loads itself; any other chunk is the shell's, and optional. */
async function ownScripts(page: Page, origin: string): Promise<Set<string>> {
  const html = await (await page.request.get('/studio')).text();
  return new Set(
    [...html.matchAll(/<script[^>]+src="([^"]+)"/g)].map(
      (match) => new URL(match[1]!, origin).href,
    ),
  );
}

const optional = (request: Request, own: Set<string>) =>
  request.resourceType() === 'script' &&
  /\/_next\/static\/chunks\//.test(request.url()) &&
  !own.has(request.url());

test('look: /studio without JavaScript, the header Sign out, at 1440 and 390 (row 88c-RC2)', async ({
  browser,
  page,
  app,
}, testInfo) => {
  await signIn(page, app, secret.password);
  for (const viewport of VIEWPORTS) {
    const context = await browser.newContext({
      javaScriptEnabled: false,
      baseURL: app.origin,
      viewport,
      storageState: await page.context().storageState(),
    });
    try {
      const plain = await context.newPage();
      await plain.goto('/studio');
      await expect(plain.getByRole('button', { name: 'Sign out', exact: true })).toBeVisible();
      await shoot(plain, `no-js-shell-${viewport.width}`, testInfo);
    } finally {
      await context.close();
    }
  }
});

test("look: /studio with the shell's chunks refused, the load alert, at 1440, 1280 and 390, light and dark (row 88c-RC2)", async ({
  page,
  app,
}, testInfo) => {
  await signIn(page, app, secret.password);
  const own = await ownScripts(page, app.origin);
  await page.route('**/*', (route) =>
    optional(route.request(), own) || route.request().resourceType() === 'font'
      ? route.abort('blockedbyclient').catch(() => {})
      : route.fallback().catch(() => {}),
  );
  for (const scheme of SCHEMES) {
    await page.emulateMedia({ colorScheme: scheme });
    for (const viewport of ALERT_VIEWPORTS) {
      await page.setViewportSize(viewport);
      await page.goto('/studio');
      await expect(
        page.getByRole('alert').filter({ hasText: "Studio couldn't load." }),
      ).toBeVisible({ timeout: 10_000 });
      await shoot(page, `load-alert-${viewport.width}-${scheme}`, testInfo);
    }
  }
  await page.unrouteAll({ behavior: 'ignoreErrors' });
});

test('look: error.tsx for an owner render that throws, at 1440, 1280 and 390, light and dark (row 88c-RC2)', async ({
  page,
  app,
}, testInfo) => {
  await seedDraft(app, 'Look Person');
  await signIn(page, app, secret.password);
  // The render throw of studio-render-error.spec.ts: drafts/ moved aside, a plain file in its place.
  const drafts = path.join(app.env.PORTFOLIO_DATA_DIR!, 'drafts');
  renameSync(drafts, `${drafts}.held`);
  writeFileSync(drafts, 'not a directory (row 88c-RC2, studio-signout-look.spec.ts)\n');
  try {
    for (const [scheme, viewport] of SCHEMES.flatMap((each) =>
      ALERT_VIEWPORTS.map((size) => [each, size] as const),
    )) {
      await page.emulateMedia({ colorScheme: scheme });
      await page.setViewportSize(viewport);
      // error.tsx offers Sign out once one auth.session query answers 200 (row 88c-RC2 (b)): the
      // shot waits for it where it's asked, and a tree that never asks shoots at once.
      const probed = page
        .waitForResponse(
          (response) => new URL(response.url()).pathname === '/api/studio/auth.session',
          {
            timeout: 10_000,
          },
        )
        .catch(() => null);
      await page.goto('/studio/preview');
      await expect(page.getByRole('heading', { name: 'Something went wrong' })).toBeVisible({
        timeout: 15_000,
      });
      if ((await probed)?.status() === 200) {
        await expect(page.getByRole('button', { name: 'Sign out', exact: true })).toBeVisible();
      }
      await shoot(page, `error-${viewport.width}-${scheme}`, testInfo);
    }
  } finally {
    renameSync(drafts, `${drafts}.blocker`);
    renameSync(`${drafts}.held`, drafts);
  }
});
