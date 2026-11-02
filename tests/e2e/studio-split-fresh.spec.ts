import type { Page, Request } from '@playwright/test';
import { expect, test } from '../harness/fixtures';
import { ownerSecret } from '../harness/owner-secret.mjs';
import { signIn } from '../harness/preview-grants';
import { ownerApp } from '../harness/profile-matrix';
import { frameElement, grantFrame, stage } from '../harness/studio-preview';
import { checkedIn, openTask, optionsIn, pick, picker } from '../harness/studio-tasks';

// Owner Studio's Appearance on a fresh store (owner direction, 2026-10-25):
// the live revision imported and no working draft. Opening the task writes
// nothing: the controls start from the live revision's site, and the frame
// previews that revision with each pending choice as its override. The first
// Apply starts the working draft through draft.create and applies the
// choices over the version it started at, as one action.
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
`;
// Its own server and data directory, seeded with this site as revision 1, and no draft.
test.use({ appOptions: { ...ownerApp(secret.hash), siteText: SITE } });

const workspace = (page: Page) => page.getByRole('form', { name: 'Appearance' });
const line = (page: Page, label: string) =>
  page
    .locator('.studio-state__line')
    .filter({ has: page.locator('dt', { hasText: new RegExp(`^${label}$`) }) })
    .locator('dd');

/** The composition the frame's document renders, or null while it loads. */
async function frameVariant(page: Page): Promise<string | null> {
  const frame = await (await frameElement(page).elementHandle())?.contentFrame();
  if (!frame) return null;
  return frame
    .locator('[data-variant]')
    .first()
    .getAttribute('data-variant', { timeout: 500 })
    .catch(() => null);
}

test(
  'on a fresh store, Appearance previews the live revision with each pick, writes nothing until Apply, and Apply starts the draft with the pick',
  { annotation: [STUDIO] },
  async ({ page, app }) => {
    const writes: string[] = [];
    const mints: Request[] = [];
    page.on('request', (request) => {
      const name = new URL(request.url()).pathname.split('/').pop() ?? '';
      if (/^draft\.(?:create|save|applyEdits)$/.test(name)) writes.push(name);
      if (name === 'preview.grant.mint') mints.push(request);
    });
    await signIn(page, app, secret.password);
    // A fresh tab lands on Appearance (OWN-3), its state line in the workspace's bottom bar.
    await expect(line(page, 'Draft')).toHaveText('No saved draft yet.');
    await openTask(page, 'Appearance');

    // It just works: the controls over the live revision's site, and its preview beside them.
    const preview = page.getByRole('region', { name: 'Preview of the live revision' });
    await expect(preview).toBeVisible();
    const composition = picker(workspace(page), 'Composition the site shows');
    await expect.poll(() => checkedIn(composition)).toBe('editorial-evidence');
    await grantFrame(page);
    await expect(stage(page)).toHaveAttribute('data-phase', 'ready');
    await expect.poll(() => frameVariant(page)).toBe('editorial-evidence');
    await expect(frameElement(page)).toHaveAttribute('title', /^Preview — live, /);
    expect(
      (mints[0]?.postDataJSON() as { subject?: Record<string, unknown> } | undefined)?.subject,
    ).toHaveProperty('revision');

    // A pick shows in the frame, through the override, and still nothing is written.
    const values = await optionsIn(composition);
    const target = values.find((value) => value !== 'editorial-evidence' && value !== '');
    expect(target, 'a second composition this build offers').toBeDefined();
    await pick(composition, target!);
    await expect.poll(() => frameVariant(page)).toBe(target);
    expect(writes).toEqual([]);
    await expect(page.locator('.studio-split__status')).toContainText(
      /Save draft starts the working draft with one change\./,
    );

    // The first Save draft: draft.create, then the edit over the version it started at.
    const applied = page.waitForRequest((request) =>
      request.url().endsWith('/api/studio/draft.applyEdits'),
    );
    await page.getByRole('button', { name: 'Save draft' }).click();
    const sent = (await applied).postDataJSON() as { expectedVersion: number; edits: unknown[] };
    expect(sent.edits).toEqual([
      { document: 'site', pointer: '/appearance/variant', op: 'set', value: target },
    ]);
    await expect(line(page, 'Draft')).toHaveText(
      `Saved draft, version ${sent.expectedVersion + 1}.`,
    );
    expect(writes).toEqual(['draft.create', 'draft.applyEdits']);
    await expect(page.getByRole('status').first()).toHaveText(
      `Started the draft and applied the appearance as version ${sent.expectedVersion + 1}.`,
    );
    // The draft exists with the change, and the workspace now previews it.
    await expect(page.getByRole('region', { name: 'Preview of the saved draft' })).toBeVisible();
    await expect.poll(() => checkedIn(composition)).toBe(target);
    await openTask(page, 'Content');
    await page.getByRole('button', { name: 'Source', exact: true }).click();
    await expect(page.getByLabel(/^site\.(?:yml|json)$/)).toHaveValue(
      SITE.replace('variant: editorial-evidence', `variant: ${target}`),
    );
  },
);
