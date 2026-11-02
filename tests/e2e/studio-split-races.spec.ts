import type { Page } from '@playwright/test';
import { expect, test } from '../harness/fixtures';
import { ownerSecret } from '../harness/owner-secret.mjs';
import type { Draft } from '../../packages/core/src/owner';
import { command, publish, signIn } from '../harness/preview-grants';
import { ownerApp } from '../harness/profile-matrix';
import { checkedIn, openTask, optionsIn, pick, picker } from '../harness/studio-tasks';

// The first Save draft's two races on a fresh store (round 4, M-3), with no
// working draft and the live revision imported: another tab starts the draft
// first, or another save lands between starting it and applying the picks.
// One store of their own; the first test's draft is published from the store
// as it ends, so the second starts with no draft again.
const STUDIO = { type: 'route', description: '/studio' };

const secret = ownerSecret();
const SITE = `schemaVersion: 2
appearance:
  variant: editorial-evidence
  designLanguage: platform-neutral
  colorScheme: warm-parchment
  typography: humanist-ui
  displayMode: system
visitorControls:
  variant: locked
  designLanguage: locked
  colorScheme: selectable
  typography: locked
  displayMode: selectable
motionPolicy: respect-os
features:
  feed: false
# the first Save draft's races
`;
test.use({ appOptions: { ...ownerApp(secret.hash), siteText: SITE } });
test.describe.configure({ mode: 'serial' });

const workspace = (page: Page) => page.getByRole('form', { name: 'Appearance' });
const line = (page: Page, label: string) =>
  page
    .locator('.studio-state__line')
    .filter({ has: page.locator('dt', { hasText: new RegExp(`^${label}$`) }) })
    .locator('dd');

/** Opens Appearance on the fresh store, picks a second composition, and returns it with the session's CSRF token. */
async function pickFresh(page: Page, app: Parameters<typeof signIn>[1]) {
  const csrf = await signIn(page, app, secret.password);
  await openTask(page, 'Appearance');
  const composition = picker(workspace(page), 'Composition the site shows');
  await expect.poll(() => checkedIn(composition)).toBe('editorial-evidence');
  const target = (await optionsIn(composition)).find(
    (value) => value !== 'editorial-evidence' && value !== '',
  );
  expect(target, 'a second composition this build offers').toBeDefined();
  await pick(composition, target!);
  return { csrf, composition, target: target! };
}

/**
 * Lets the page's first request to `name` go only once `before` has run, from
 * the page as another tab would; the requests `before` makes go straight through.
 */
async function holdFirst(page: Page, name: string, before: (body: unknown) => Promise<void>) {
  let first = true;
  await page.route(`**/api/studio/${name}`, async (route) => {
    if (!first) return route.continue();
    first = false;
    await before(route.request().postDataJSON());
    await route.continue();
  });
}

test(
  'the first Save draft applies nothing, says so, and shows the draft the other tab started',
  { annotation: [STUDIO] },
  async ({ page, app }) => {
    const { csrf } = await pickFresh(page, app);
    let started: Draft | null = null;
    await holdFirst(page, 'draft.create', async () => {
      const other = await command(page, csrf, 'draft.create', {});
      expect(other.status, JSON.stringify(other.body)).toBe(200);
      started = (other.body.data as unknown as { draft: Draft }).draft;
    });
    const applies: string[] = [];
    page.on('request', (request) => {
      if (request.url().endsWith('/api/studio/draft.applyEdits')) applies.push(request.url());
    });
    await page.getByRole('button', { name: 'Save draft' }).click();
    await expect(page.getByRole('status').first()).toHaveText(
      'Not applied: a draft was started in another tab first. It shows now.',
    );
    expect(applies).toEqual([]);
    await expect(page.getByRole('region', { name: 'Preview of the saved draft' })).toBeVisible();
    await expect(line(page, 'Draft')).toHaveText(/^Saved draft, version \d+\.$/);
    // The next test starts with no draft: this one's goes live from the store.
    await publish(app, started!);
  },
);

test(
  'the first Save draft starts the draft, applies nothing, says so, and shows the newer version',
  { annotation: [STUDIO] },
  async ({ page, app }) => {
    const { csrf } = await pickFresh(page, app);
    let started = 0;
    await holdFirst(page, 'draft.applyEdits', async (body) => {
      const { draftId, expectedVersion } = body as { draftId: string; expectedVersion: number };
      started = expectedVersion;
      const other = await command(page, csrf, 'draft.applyEdits', {
        draftId,
        expectedVersion,
        edits: [{ document: 'site', pointer: '/appearance/displayMode', op: 'set', value: 'dark' }],
      });
      expect(other.status, JSON.stringify(other.body)).toBe(200);
    });
    await page.getByRole('button', { name: 'Save draft' }).click();
    await expect(page.getByRole('status').first()).toHaveText(
      /^Started the draft, but not applied: version \d+ was saved first\. It shows now\.$/,
    );
    expect(await page.getByRole('status').first().textContent()).toContain(
      `version ${started + 1} was saved first`,
    );
    await expect(line(page, 'Draft')).toHaveText(`Saved draft, version ${started + 1}.`);
    await expect(page.getByRole('region', { name: 'Preview of the saved draft' })).toBeVisible();
  },
);
