import { expect, test } from '../harness/fixtures';
import { scriptsDuring } from '../harness/agent-chunks';
import { DEMO_APP } from '../harness/profile-matrix';
import { DEMO_MARKERS, found, OWNER_MARKERS } from '../harness/studio-chunk-markers';

// Which Studio code loads under demo (#9, design note section 2): /studio
// loads Demo Studio and its browser backend and none of Owner Studio's
// shell, its transport, its journal, or its adapter, by strings only those
// modules hold, in every chunk the page and its frames load.
// tests/e2e/owner-studio-chunks.spec.ts checks the other way, under owner.

const STUDIO = { type: 'route', description: '/studio' };

test.use({ appOptions: DEMO_APP });

test(
  "Demo Studio loads its own code and none of Owner Studio's shell, transport, journal, or adapter",
  { annotation: [STUDIO, { type: 'profile', description: 'demo' }] },
  async ({ page }) => {
    const scripts = await scriptsDuring(page, async () => {
      const response = await page.goto('/studio');
      expect(response?.status()).toBe(200);
      // Appearance, Demo Studio's first task, renders once the backend has loaded.
      await expect(page.getByRole('button', { name: 'Reset demo' })).toBeVisible();
    });
    expect(scripts.size).toBeGreaterThan(0);
    expect(found(scripts, DEMO_MARKERS)).toEqual(Object.keys(DEMO_MARKERS));
    // Nor Owner Studio's shell, studioFetch, or its journal.
    expect(found(scripts, OWNER_MARKERS)).toEqual([]);
  },
);
