import { expect, test } from '../harness/fixtures';
import { scriptsDuring } from '../harness/agent-chunks';
import { ownerSecret } from '../harness/owner-secret.mjs';
import { DEMO_APP, ownerApp } from '../harness/profile-matrix';

// Which Studio code loads where (#9, design note section 2), both ways:
// /studio under demo loads Demo Studio and its browser backend and none of
// Owner Studio's shell, its transport, its journal, or its adapter, and
// /studio under owner, signed in, loads the owner's and none of Demo
// Studio's. Each is checked by strings only those modules hold, in every
// chunk the page and its frames load.

const STUDIO = { type: 'route', description: '/studio' };

/** Strings only Owner Studio's code holds, with the module each comes from. */
const OWNER_MARKERS = {
  // lib/studio/owner-backend.ts: one of its failure messages.
  'owner adapter': 'The data directory is full. Your changes are kept in this browser.',
  // lib/studio-fetch.ts: the event it sends when a session ends.
  studioFetch: 'studio:auth-required',
  // lib/studio/journal.ts: its key prefix.
  journal: 'portfolio-studio:',
  // _components/shell/studio-shell.tsx: its no-JavaScript notice.
  'owner shell': 'Portfolio Studio needs JavaScript',
};

/** Strings only Demo Studio's code holds, with the module each comes from. */
const DEMO_MARKERS = {
  // lib/demo/browser-backend.ts: the start of its NOT_OFFERED message.
  'browser backend': 'The demo changes the appearance only.',
  // lib/demo/storage.ts: its key prefix.
  'demo storage': 'portfolio-demo:',
  // lib/demo/state-lines.ts, which _components/demo/demo-studio.tsx renders: the sandbox line.
  'demo body': 'Demo sandbox',
};

/** Which of `markers` any of `scripts` holds. */
const found = (scripts: Map<string, string>, markers: Record<string, string>) =>
  Object.entries(markers)
    .filter(([, marker]) => [...scripts.values()].some((body) => body.includes(marker)))
    .map(([name]) => name);

test.describe('under demo', () => {
  test.use({ appOptions: DEMO_APP });

  test(
    "Demo Studio loads its own code and none of Owner Studio's shell, transport, journal, or adapter",
    { annotation: [STUDIO, { type: 'profile', description: 'demo' }] },
    async ({ page }) => {
      const scripts = await scriptsDuring(page, async () => {
        const response = await page.goto('/studio#appearance');
        expect(response?.status()).toBe(200);
        // The body renders once the backend has loaded.
        await expect(page.getByRole('button', { name: 'Reset demo' })).toBeVisible();
      });
      expect(scripts.size).toBeGreaterThan(0);
      expect(found(scripts, DEMO_MARKERS)).toEqual(Object.keys(DEMO_MARKERS));
      // Nor Owner Studio's shell, studioFetch, or its journal.
      expect(found(scripts, OWNER_MARKERS)).toEqual([]);
    },
  );
});

test.describe('under owner', () => {
  const secret = ownerSecret();
  test.use({ appOptions: ownerApp(secret.hash) });

  test(
    "Owner Studio, signed in, loads its own code and none of Demo Studio's body, storage, or backend",
    { annotation: [STUDIO, { type: 'profile', description: 'owner' }] },
    async ({ page, app }) => {
      await page.goto('/studio/sign-in');
      await page.getByLabel('Password').fill(secret.password);
      await page.getByRole('button', { name: 'Sign in' }).click();
      await expect(page).toHaveURL(`${app.origin}/studio`);
      const scripts = await scriptsDuring(page, async () => {
        await page.reload();
        await expect(page.getByText('Signed in')).toBeVisible();
        // The state lines render once the adapter has loaded and read the store.
        await expect(page.locator('.studio-state__lines')).toBeVisible();
      });
      expect(found(scripts, OWNER_MARKERS)).toEqual(Object.keys(OWNER_MARKERS));
      // Nor Demo Studio's body or lib/demo.
      expect(found(scripts, DEMO_MARKERS)).toEqual([]);
    },
  );
});
