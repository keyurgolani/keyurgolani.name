import type { Page, Request } from '@playwright/test';
import { expect, test } from '../harness/fixtures';
import { DEMO_APP } from '../harness/profile-matrix';
import { failureStateFindings } from '../quality/lib/a11y/conditions';

// Demo Studio when its shell doesn't load (row 88c), under demo: failed
// enhancement as the quality harness takes it (tests/quality/lib/a11y/
// conditions.ts:838-848, which E's Studio read ran), every script chunk the
// page's HTML doesn't load itself refused, and every font. The page says
// "Studio couldn't load." with Reload Studio, which takes focus, and no Sign
// out: Demo Studio has no session to end. Its own file, as one composition
// per spec file is how the harness runs a profile's app.
const STUDIO = { type: 'route', description: '/studio' };

test.use({ appOptions: DEMO_APP });

/** The shell's own wait (late-alert.tsx's STUDIO_LOAD_TIMEOUT_MS), and margin past it. */
const PAST_TIMEOUT_MS = 10_000;

/** Failed enhancement on `page` for `path`: its optional chunks and its fonts refused. */
async function failEnhancement(page: Page, path: string): Promise<string[]> {
  const response = await page.request.get(path);
  const html = await response.text();
  const own = new Set(
    [...html.matchAll(/<script[^>]+src="([^"]+)"/g)].map(
      (match) => new URL(match[1]!, response.url()).href,
    ),
  );
  const optional = (request: Request) =>
    request.resourceType() === 'script' &&
    /\/_next\/static\/chunks\//.test(request.url()) &&
    !own.has(request.url());
  const refused: string[] = [];
  await page.route('**/*', (route) => {
    const request = route.request();
    if (optional(request) || request.resourceType() === 'font') {
      refused.push(request.url());
      return route.abort('blockedbyclient');
    }
    return route.fallback();
  });
  return refused;
}

const alert = (page: Page) => page.getByRole('alert').filter({ hasText: "Studio couldn't load." });

test(
  "with Demo Studio's shell chunks refused, /studio says Studio couldn't load, with Reload Studio, which takes focus and reloads, and no Sign out (row 88c, R6)",
  { annotation: [STUDIO, { type: 'profile', description: 'demo' }] },
  async ({ page }) => {
    const refused = await failEnhancement(page, '/studio');
    await page.goto('/studio');
    await expect.poll(() => refused.length, 'the optional chunks are asked for').toBeGreaterThan(0);
    await expect(alert(page)).toBeVisible({ timeout: PAST_TIMEOUT_MS });
    const reload = page.getByRole('button', { name: 'Reload Studio' });
    await expect(reload).toBeFocused();
    await expect(page.getByRole('button', { name: 'Sign out' })).toHaveCount(0);
    expect(await failureStateFindings(page)).toEqual([]);
    const documents: string[] = [];
    page.on('request', (request) => {
      if (request.isNavigationRequest() && new URL(request.url()).pathname === '/studio')
        documents.push(request.url());
    });
    await reload.click();
    await expect.poll(() => documents.length, 'a reload of /studio').toBe(1);
  },
);
