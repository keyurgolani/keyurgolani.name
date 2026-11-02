import type { Page } from '@playwright/test';
import { expect, test } from '../harness/fixtures';
import { ownerSecret } from '../harness/owner-secret.mjs';
import { seedDraft, signIn } from '../harness/preview-grants';
import { ownerApp } from '../harness/profile-matrix';
import { frameElement, grantFrame, stage } from '../harness/studio-preview';
import { checkedIn, openTask, optionsIn, pick, picker, reveal } from '../harness/studio-tasks';

// The workspace's publish confirmation (round 4, P1-9), on a store of its own
// with SITE live as revision 1, so this publish moves no other spec's live site.
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
# the publish confirmation
`;
test.use({ appOptions: { ...ownerApp(secret.hash), siteText: SITE } });

/** Opens the Appearance workspace on a draft of SITE, with its frame ready. */
async function open(page: Page, app: Parameters<typeof seedDraft>[0], name: string) {
  const draft = await seedDraft(app, name, SITE);
  await signIn(page, app, secret.password);
  await openTask(page, 'Appearance');
  await grantFrame(page);
  await expect(stage(page)).toHaveAttribute('data-phase', 'ready');
  return draft;
}

test(
  "under Publish's dialog, ControlOrMeta+Z and \\ move nothing behind it: the frame's scheme, the rail and the dialog's Publish stay as they were (C-M2)",
  { annotation: [STUDIO] },
  async ({ page, app }) => {
    const draft = await open(page, app, 'Rowan Held Keys');
    // A pick and a pick back: the draft is as saved, so Publish is open, and undo has two steps.
    const schemes = picker(page, 'Color scheme the site shows');
    await reveal(schemes);
    const saved = (await checkedIn(schemes))!;
    const other = (await optionsIn(schemes)).find((value) => value !== saved)!;
    const scheme = async () => {
      const frame = await (await frameElement(page).elementHandle())?.contentFrame();
      return frame?.locator('[data-variant]').first().getAttribute('data-color-scheme');
    };
    await pick(schemes, other);
    await expect.poll(scheme).toBe(other);
    await pick(schemes, saved);
    // The frame has taken the pick back, the switch gate's last, before the dialog opens over it.
    await expect.poll(scheme).toBe(saved);
    const publish = page.getByRole('button', { name: 'Publish', exact: true });
    await expect(publish).not.toHaveAttribute('aria-disabled', 'true');
    await publish.click();
    const dialog = page.getByRole('dialog', { name: `Publish draft ${draft.version}?` });
    await expect(dialog).toBeVisible();
    expect(await scheme()).toBe(saved);
    await page.keyboard.press('ControlOrMeta+Z');
    await page.keyboard.press('Backslash');
    await page.waitForTimeout(600);
    expect(await scheme()).toBe(saved);
    await expect(page.locator('.studio-split')).toHaveAttribute('data-rail', 'open');
    await expect(dialog).toBeVisible();
    await expect(
      dialog.getByRole('button', { name: /^Publish (?:revision|draft) \d+$/ }),
    ).not.toHaveAttribute('aria-disabled', 'true');
    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();
    // And the rail's pick is the one the dialog was opened on.
    expect(await checkedIn(schemes)).toBe(saved);
  },
);

test(
  "a live revision the dialog can't read says so, rather than listing no changes as if there were none (C-L1)",
  { annotation: [STUDIO] },
  async ({ page, app }) => {
    const draft = await open(page, app, 'Rowan Unread');
    await page.route(/\/api\/studio\/revision\.get/, (route) =>
      route.fulfill({
        status: 503,
        contentType: 'application/json',
        body: JSON.stringify({
          error: {
            code: 'storage_unavailable',
            message: "The data directory can't be used right now.",
            requestId: 'req_e2e',
          },
        }),
      }),
    );
    await page.getByRole('button', { name: 'Publish', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: `Publish draft ${draft.version}?` });
    await expect(dialog.locator('.studio-publish__live')).toHaveText(
      "Couldn't read the live revision, so changes aren't listed.",
    );
    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();
  },
);

test(
  'Publish asks first, over the split, naming the draft, the live revision and its replacement, and the checks, then publishes from there',
  { annotation: [STUDIO] },
  async ({ page, app }) => {
    const draft = await open(page, app, 'Rowan Publish');
    const publish = page.getByRole('button', { name: 'Publish', exact: true });
    await expect(publish).not.toHaveAttribute('aria-disabled', 'true');
    await expect(page.getByRole('link', { name: 'Publish', exact: true })).toHaveCount(0);
    await publish.click();
    const dialog = page.getByRole('dialog', { name: `Publish draft ${draft.version}?` });
    await expect(dialog).toBeVisible();
    await expect(dialog).toContainText(
      /It becomes (?:revision \d+|a new revision) and replaces revision/,
    );
    await expect(dialog).toContainText(`All checks pass on draft ${draft.version}.`);
    // Keep editing is the default, and Escape closes it with nothing moved.
    await expect(dialog.getByRole('button', { name: 'Keep editing' })).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();
    await expect(page).toHaveURL(/\/studio#appearance$/);
    await publish.click();
    await dialog.getByRole('button', { name: /^Publish (?:revision|draft) \d+$/ }).click();
    await expect(page.getByRole('status').first()).toHaveText(
      /^Published: the store made revision rev_[0-9a-f]{12} live\./,
    );
    await expect(dialog).toBeHidden();
    // Still the split: the stage stays, now over the live revision the draft became.
    await expect(page.getByRole('region', { name: /^Preview of the / })).toBeVisible();
  },
);
