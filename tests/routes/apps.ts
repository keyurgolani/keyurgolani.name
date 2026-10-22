// The servers the route specs start, each from the fixture host's build,
// which registers the fallback composition and two fixture variants:
// fixture-chapters (chapters/{chapter} under home, credits under work) and
// fixture-notes (notes under home). Their packages are in
// tests/fixtures/variants/.
import { readFileSync } from 'node:fs';
import { expect, type Page } from '@playwright/test';
import { DEFAULT_SITE } from '../harness/app-server.mjs';
import type { AppOptions } from '../harness/fixtures';

const SITE = readFileSync(DEFAULT_SITE, 'utf8');
const UNREGISTERED = '\n  variant: missing-variant\n';

/** read-only on the harness's portfolio fixture, its site document selecting `variant`. */
export function readOnlyApp(variant: string): AppOptions {
  if (!SITE.includes(UNREGISTERED)) {
    throw new Error(`${DEFAULT_SITE} no longer selects missing-variant.`);
  }
  return { fixtureHost: true, siteText: SITE.replace(UNREGISTERED, `\n  variant: ${variant}\n`) };
}

/** demo on the bundled sample, whose site selects Editorial Evidence, unregistered until #13. */
export const DEMO_APP: AppOptions = {
  fixtureHost: true,
  env: { PORTFOLIO_PROFILE: 'demo', PORTFOLIO_SOURCE_DIR: '' },
  portfolio: null,
  site: null,
};

/** A file the fixture host adds to public/, as an owner adds an avatar or a resume. */
export const PUBLIC_FILE = { name: 'fixture-public.txt', text: 'A file from public/.\n' };

export const READ_ONLY = { type: 'profile', description: 'read-only' };
export const DEMO = { type: 'profile', description: 'demo' };

/**
 * That `path` answers with the app's 404 page, straight from the server and
 * rendered there: its heading, the portfolio's language, and a link home.
 * A spec runs it with JavaScript off, so a page the browser has to fill in
 * fails it.
 */
export async function expectNotFoundPage(page: Page, path: string): Promise<void> {
  const what = path.length > 60 ? `${path.slice(0, 60)}...` : path;
  const response = await page.goto(path);
  expect(response?.status(), what).toBe(404);
  // No redirect on the way: the 404 is the path's own.
  expect(response?.request().redirectedFrom(), what).toBeNull();
  await expect(page.getByRole('heading', { level: 1 }), what).toHaveText('Page not found');
  // Both apps' portfolios are in English.
  await expect(page.locator('html'), what).toHaveAttribute('lang', 'en');
  await expect(page.getByRole('main').getByRole('link', { name: 'Home' }), what).toHaveAttribute(
    'href',
    '/',
  );
}
