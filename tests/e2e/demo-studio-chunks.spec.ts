import { expect, test } from '../harness/fixtures';
import { scriptsDuring } from '../harness/agent-chunks';
import { ownerSecret } from '../harness/owner-secret.mjs';
import { DEMO_APP, ownerApp } from '../harness/profile-matrix';

// Which Studio backend loads where (#9, design note section 2), both ways:
// /studio under demo loads Demo Studio's browser backend and none of Owner
// Studio's adapter, and /studio under owner, signed in, loads the owner's
// adapter and none of the demo's. Each is checked by a string only that
// module holds, in every chunk the page and its frames load.

const STUDIO = { type: 'route', description: '/studio' };

/** A string only lib/studio/owner-backend.ts holds: one of its failure messages. */
const OWNER_ADAPTER_MARKER = 'The data directory is full. Your changes are kept in this browser.';

/** A string only lib/demo/browser-backend.ts holds: the start of its NOT_OFFERED message. */
const DEMO_BACKEND_MARKER = 'The demo changes the appearance only.';

test.describe('under demo', () => {
  test.use({ appOptions: DEMO_APP });

  test(
    "Demo Studio loads the browser backend and none of Owner Studio's adapter",
    { annotation: [STUDIO, { type: 'profile', description: 'demo' }] },
    async ({ page }) => {
      const scripts = await scriptsDuring(page, async () => {
        const response = await page.goto('/studio#appearance');
        expect(response?.status()).toBe(200);
        // The body renders once the backend has loaded.
        await expect(page.getByRole('button', { name: 'Reset demo' })).toBeVisible();
      });
      const bodies = [...scripts.values()];
      expect(bodies.length).toBeGreaterThan(0);
      expect(bodies.some((body) => body.includes(DEMO_BACKEND_MARKER))).toBe(true);
      for (const [url, body] of scripts) {
        expect(body.includes(OWNER_ADAPTER_MARKER), url).toBe(false);
      }
    },
  );
});

test.describe('under owner', () => {
  const secret = ownerSecret();
  test.use({ appOptions: ownerApp(secret.hash) });

  test(
    "Owner Studio, signed in, loads its adapter and none of Demo Studio's backend",
    { annotation: [STUDIO, { type: 'profile', description: 'owner' }] },
    async ({ page, app }) => {
      await page.goto('/studio/sign-in');
      await page.getByLabel('Password').fill(secret.password);
      await page.getByRole('button', { name: 'Sign in' }).click();
      await expect(page).toHaveURL(`${app.origin}/studio`);
      const scripts = await scriptsDuring(page, async () => {
        await page.reload();
        await expect(page.getByText('Signed in')).toBeVisible();
      });
      const bodies = [...scripts.values()];
      expect(bodies.some((body) => body.includes(OWNER_ADAPTER_MARKER))).toBe(true);
      for (const [url, body] of scripts) {
        expect(body.includes(DEMO_BACKEND_MARKER), url).toBe(false);
      }
    },
  );
});
