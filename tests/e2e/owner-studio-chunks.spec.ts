import { expect, test } from '../harness/fixtures';
import { scriptsDuring } from '../harness/agent-chunks';
import { ownerSecret } from '../harness/owner-secret.mjs';
import { ownerApp } from '../harness/profile-matrix';
import { DEMO_MARKERS, found, OWNER_MARKERS } from '../harness/studio-chunk-markers';

// Which Studio code loads under owner (#9, design note section 2): /studio,
// signed in, loads Owner Studio's shell, its transport, its journal, and
// its adapter, and none of Demo Studio's body, storage, or backend, by
// strings only those modules hold. tests/e2e/demo-studio-chunks.spec.ts
// checks the other way, under demo.

const STUDIO = { type: 'route', description: '/studio' };

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
