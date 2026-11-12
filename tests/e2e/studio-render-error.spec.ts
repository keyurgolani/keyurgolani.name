import { renameSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { Page } from '@playwright/test';
import { expect, test } from '../harness/fixtures';
import { ownerSecret } from '../harness/owner-secret.mjs';
import { seedDraft, signIn } from '../harness/preview-grants';
import { ownerApp } from '../harness/profile-matrix';

// What reaches the browser when an owner Studio page throws as it renders (row 89's evidence, and
// row 88c-RC2's starting point; draft, unrun until RC2's tickets queue).
//
// Read at 04dc5e378: (studio) has no Suspense boundary and no loading.tsx, so a throw fails Fizz's
// shell, and Next 16.4.1 answers with its empty error document (app-render.js, getErrorRSCPayload):
// <html id="__next_error__"> with nothing in its body. error.tsx is a client error boundary, so it
// is never in the server's HTML. With JavaScript off, that empty document is all there is. With
// JavaScript on, whatever Next's client renders from the error payload is what shows: by reading,
// error.tsx, "Something went wrong" and "Studio couldn't load." with Reload Studio, and under owner
// the Sign out form, keep or discard (row 88c-RC2; RC1 offered no Sign out). No test made a Studio
// render throw before this one, so that is unseen.
//
// The throw, test-only and with no code changed: /studio/preview reads the working draft as it
// renders (previewable, server/owner/preview.ts), and the store's getWorking rethrows a read it
// can't make (packages/core/src/store/drafts.ts). With the data directory's drafts/ moved aside
// and a plain file in its place, listing drafts/ fails with ENOTDIR, whoever the server runs as.
// Sign-in and the session read nothing under drafts/, so the page's guard still passes first.
// The test puts drafts/ back by renaming, deleting nothing.

const secret = ownerSecret();
test.use({ appOptions: ownerApp(secret.hash) });
test.use({ studioLastTask: 'content' });

const PREVIEW_PAGE = '/studio/preview';
const PAGE = { type: 'route', description: PREVIEW_PAGE };

/** Makes the store's drafts/ unlistable until the returned function puts it back, once. */
function blockDrafts(dataDir: string): () => void {
  const drafts = path.join(dataDir, 'drafts');
  const aside = `${drafts}.held`;
  renameSync(drafts, aside);
  writeFileSync(drafts, 'not a directory (row 89, studio-render-error.spec.ts)\n');
  let blocked = true;
  return () => {
    if (!blocked) return;
    blocked = false;
    renameSync(drafts, `${drafts}.blocker`);
    renameSync(aside, drafts);
  };
}

/**
 * The text `page`'s body renders, trimmed: innerText, as textContent would count the inline scripts
 * that carry Next's error payload, which render nothing.
 */
const bodyText = async (page: Page) => ((await page.locator('body').innerText()) ?? '').trim();

test(
  'an owner render that throws answers the empty error document, so without JavaScript the page is blank and offers nothing (row 89, 88c-RC2)',
  { annotation: [PAGE] },
  async ({ browser, page, app }, testInfo) => {
    await seedDraft(app, 'Thrown Person');
    await signIn(page, app, secret.password);
    const dataDir = app.env.PORTFOLIO_DATA_DIR;
    expect(dataDir, 'the owner app has a data directory').toBeTruthy();
    const restore = blockDrafts(dataDir!);
    try {
      // The server's answer, as a browser without JavaScript gets it.
      const answer = await page.request.get(PREVIEW_PAGE);
      const html = await answer.text();
      await testInfo.attach('render-error.html', { body: html, contentType: 'text/html' });
      expect.soft(answer.status(), 'a server error').toBe(500);
      expect.soft(html, "Next's empty error document").toMatch(/<html[^>]*id="__next_error__"/);
      expect.soft(html, 'never error.tsx').not.toContain('Something went wrong');
      expect.soft(html, 'no Sign out').not.toMatch(/>Sign out</);
      expect.soft(html, 'none of the page').not.toContain('Preview controls');

      // The same in a browser with JavaScript off, signed in as the owner.
      const context = await browser.newContext({
        javaScriptEnabled: false,
        baseURL: app.origin,
        storageState: await page.context().storageState(),
      });
      try {
        const plain = await context.newPage();
        const shown = await plain.goto(PREVIEW_PAGE);
        expect.soft(shown?.status(), 'a server error').toBe(500);
        expect.soft(await bodyText(plain), 'a blank page').toBe('');
        await expect.soft(plain.getByRole('button')).toHaveCount(0);
        await testInfo.attach('render-error-no-js.png', {
          body: await plain.screenshot({ fullPage: true }),
          contentType: 'image/png',
        });
      } finally {
        await context.close();
      }
    } finally {
      restore();
    }
  },
);

test(
  "an owner render that throws shows error.tsx once its script runs: Studio couldn't load, with Reload Studio focused and the owner's Sign out form (row 89, 88c-RC2)",
  { annotation: [PAGE] },
  async ({ page, app }, testInfo) => {
    await seedDraft(app, 'Thrown Person');
    await signIn(page, app, secret.password);
    const dataDir = app.env.PORTFOLIO_DATA_DIR;
    expect(dataDir, 'the owner app has a data directory').toBeTruthy();
    const restore = blockDrafts(dataDir!);
    try {
      const shown = await page.goto(PREVIEW_PAGE);
      expect.soft(shown?.status(), 'a server error').toBe(500);
      const reload = page.getByRole('button', { name: 'Reload Studio' });
      // What the client renders from the error payload: error.tsx by reading, or Next's own page.
      await expect
        .soft(page.getByRole('heading', { name: 'Something went wrong' }), 'error.tsx')
        .toBeVisible({ timeout: 15_000 });
      await testInfo.attach('render-error-js.txt', {
        body: await bodyText(page),
        contentType: 'text/plain',
      });
      await testInfo.attach('render-error-js.png', {
        body: await page.screenshot({ fullPage: true }),
        contentType: 'image/png',
      });
      await expect
        .soft(page.getByRole('alert').filter({ hasText: "Studio couldn't load." }))
        .toBeVisible();
      await expect.soft(reload).toBeFocused();
      // Under owner, the Sign out form, keep or discard (row 88c-RC2).
      await expect.soft(page.getByRole('button', { name: 'Sign out', exact: true })).toBeVisible();
      await expect
        .soft(page.getByRole('button', { name: 'Discard unsaved changes and sign out' }))
        .toBeVisible();
      await expect.soft(page.getByRole('form', { name: 'Preview controls' })).toHaveCount(0);
      // Once the store reads again, Reload Studio brings the page back.
      restore();
      await reload.click();
      await expect(page.getByRole('form', { name: 'Preview controls' })).toBeVisible();
    } finally {
      // Once only: a restore above makes this one a no-op.
      restore();
    }
  },
);
