import type { Page } from '@playwright/test';
import { expect, test } from '../harness/fixtures';
import { ownerSecret } from '../harness/owner-secret.mjs';
import { seedDraft, signIn } from '../harness/preview-grants';
import { ownerApp } from '../harness/profile-matrix';
import { frameElement, grantFrame, recordGrantCommands, stage } from '../harness/studio-preview';
import {
  checkedIn,
  openTask,
  optionsIn,
  pick,
  picker,
  reveal,
  shows,
} from '../harness/studio-tasks';

// Studio's Appearance workspace (#8, Slice 5) and its preview (Slice 4),
// against the built server with the password provider: five selectors and
// their visitor controls over the saved draft's site document, what each
// means before publish, an edit per changed axis that keeps the rest of the
// document as it was, and #7's preview of the saved draft under a grant,
// whose own controls change the frame alone, with item focus.
const STUDIO = { type: 'route', description: '/studio' };

const secret = ownerSecret();
test.use({ appOptions: ownerApp(secret.hash) });
test.describe.configure({ mode: 'serial' });

/** A site whose composition this build doesn't register, with a comment and a feature to keep. */
const SITE = `schemaVersion: 2
# The owner's note, which an edit keeps.
appearance:
  variant: missing-variant
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

const workspace = (page: Page) => page.getByRole('form', { name: 'Appearance' });
const line = (page: Page, label: string) =>
  page
    .locator('.studio-state__line')
    .filter({ has: page.locator('dt', { hasText: new RegExp(`^${label}$`) }) })
    .locator('dd');

test(
  'five selectors with visitor controls over the saved draft, each saying what it means before publish',
  { annotation: [STUDIO] },
  async ({ page, app }) => {
    await seedDraft(app, 'Rowan Appearance', SITE);
    await signIn(page, app, secret.password);
    await openTask(page, 'Appearance');
    const form = workspace(page);
    await expect(form.locator('fieldset')).toHaveCount(5);
    for (const legend of [
      'Composition',
      'Design language',
      'Color scheme',
      'Typography',
      'Display mode',
    ]) {
      // Each axis in the page; the open one shows, the rest behind their heads.
      await expect(form.getByRole('group', { name: legend, includeHidden: true })).toBeAttached();
      await expect(
        form.getByRole('switch', {
          name: `Let visitors choose ${legend.toLowerCase()}`,
          includeHidden: true,
        }),
      ).toBeAttached();
    }
    // The draft's own composition, which this build doesn't offer, as itself and what shows instead.
    const composition = picker(form, 'Composition the site shows');
    await expect.poll(() => checkedIn(composition)).toBe('missing-variant');
    await expect(
      form.getByText('so the fallback composition shows in its place, and it blocks publishing'),
    ).toBeVisible();
    // The validator's own finding, before publish, once Studio has saved the draft and the server checked it.
    await openTask(page, 'Content');
    // The content task opens on its fields (#8's second pull request): this edits the text.
    await page.getByRole('button', { name: 'Source', exact: true }).click();
    const portfolio = page.getByLabel(/^portfolio\.(?:yml|json)$/);
    await portfolio.fill(`${await portfolio.inputValue()}# saved from Studio\n`);
    await page.getByRole('button', { name: 'Save draft' }).click();
    await expect(line(page, 'This browser')).toHaveText('No unsaved changes.');
    await openTask(page, 'Appearance');
    // The findings before publish, in the rail's one summary.
    await form.getByText(/^Before publish:/).click();
    await expect(form.getByRole('region', { name: 'Before publish' })).toContainText(
      'Blocks publishing',
    );
    // Only what a site may select: never the fallback composition.
    await expect(
      composition.locator('label[data-option]:not([data-option="missing-variant"])').first(),
    ).toBeAttached();
    const offered = await optionsIn(composition);
    expect(offered).not.toContain('fallback');
    // Each offered option says what it is.
    const scheme = form.getByRole('group', { name: 'Color scheme', includeHidden: true });
    await expect(scheme.locator('dt')).toContainText([
      'About',
      'Tier',
      'Provenance',
      'Performance',
      'Access',
    ]);
    await expect(page.getByRole('button', { name: 'Save draft' })).toHaveAttribute(
      'aria-disabled',
      'true',
    );
  },
);

test(
  'applying changes one axis and one visitor control, and leaves the rest of the site document as it was',
  { annotation: [STUDIO] },
  async ({ page, app }) => {
    const draft = await seedDraft(app, 'Rowan Appearance', SITE);
    await signIn(page, app, secret.password);
    await openTask(page, 'Appearance');
    const form = workspace(page);
    const composition = picker(form, 'Composition the site shows');
    await expect(
      composition.locator('label[data-option]:not([data-option="missing-variant"])').first(),
    ).toBeAttached();
    const target = (await optionsIn(composition)).find((value) => value !== 'missing-variant');
    expect(target, 'a composition this build offers').toBeTruthy();
    await pick(composition, target!);
    await reveal(picker(form, 'Display mode the site shows'));
    const visitors = form.getByRole('switch', { name: 'Let visitors choose display mode' });
    await expect(visitors).toHaveAttribute('aria-checked', 'true');
    await visitors.click();
    await expect(visitors).toHaveAttribute('aria-checked', 'false');
    const applied = page.waitForRequest((request) =>
      request.url().endsWith('/api/studio/draft.applyEdits'),
    );
    await page.getByRole('button', { name: 'Save draft' }).click();
    const sent = (await applied).postDataJSON() as { expectedVersion: number; edits: unknown[] };
    expect(sent.expectedVersion).toBe(draft.version);
    expect(sent.edits).toEqual([
      { document: 'site', pointer: '/appearance/variant', op: 'set', value: target },
      { document: 'site', pointer: '/visitorControls/displayMode', op: 'set', value: 'locked' },
    ]);
    await expect(line(page, 'Draft')).toHaveText(`Saved draft, version ${draft.version + 1}.`);
    await expect(page.getByRole('status').first()).toHaveText(
      `Applied the appearance as draft version ${draft.version + 1}.`,
    );
    // The source shows the same document with those two values changed, and nothing else.
    await openTask(page, 'Content');
    await page.getByRole('button', { name: 'Source', exact: true }).click();
    await expect(page.getByLabel(/^site\.(?:yml|json)$/)).toHaveValue(
      SITE.replace('variant: missing-variant', `variant: ${target}`).replace(
        '  displayMode: selectable\nmotionPolicy',
        '  displayMode: locked\nmotionPolicy',
      ),
    );
  },
);

test(
  "the workspace's preview is the saved draft under a grant; its controls change the frame, never the draft, and a section can be shown",
  { annotation: [STUDIO] },
  async ({ page, app }) => {
    const draft = await seedDraft(app, 'Rowan Appearance', SITE);
    const commands = recordGrantCommands(page);
    await signIn(page, app, secret.password);
    await openTask(page, 'Appearance');
    const preview = page.getByRole('region', { name: 'Preview of the saved draft' });
    await shows(page, preview, 'the preview region renders');
    await grantFrame(page);
    await expect(frameElement(page)).toHaveAttribute('sandbox', /allow-scripts/);
    await expect.poll(() => commands).toContain('preview.grant.mint');
    // A preview control changes the frame alone: the draft stays at its version.
    await pick(picker(preview, 'Preview motion'), 'reduce');
    await expect(line(page, 'Draft')).toHaveText(`Saved draft, version ${draft.version}.`);
    // Item focus: the section scrolls into the frame and is outlined over it, outside its document.
    const sections = page.getByRole('combobox', { name: 'Show a section in the preview' });
    await expect(sections.locator('option:not([value=""])').first()).toBeAttached();
    const first = await sections
      .locator('option')
      .evaluateAll((options) => (options[1] as HTMLOptionElement | undefined)?.value ?? '');
    expect(first, 'the draft has a section').not.toBe('');
    await sections.selectOption(first);
    await expect(stage(page).getByTestId('preview-focus')).toBeVisible();
    // A full-window preview is a Studio page around a frame.
    await expect(
      preview.getByRole('link', { name: 'Open the full-window preview' }),
    ).toHaveAttribute('href', '/studio/preview');
  },
);

test(
  "a sign-out in another tab drops the workspace's preview frame with the draft, and the page goes to sign-in",
  { annotation: [STUDIO] },
  async ({ context, app }) => {
    await seedDraft(app, 'Rowan Appearance', SITE);
    const page = await context.newPage();
    await signIn(page, app, secret.password);
    await openTask(page, 'Appearance');
    await grantFrame(page);
    // What the page showed as it left, recorded by the document itself, so it's the page's own doing.
    await page.evaluate(() => {
      // Capturing, so it reads the page before Studio's own pagehide handlers touch it.
      addEventListener(
        'pagehide',
        () => {
          sessionStorage.setItem(
            'kgn-e2e:left',
            JSON.stringify({
              at: `${location.pathname}${location.hash}`,
              frames: document.querySelectorAll('iframe.preview-surface__frame').length,
              draftShown: document.body.innerText.includes('Rowan Appearance'),
            }),
          );
        },
        { capture: true },
      );
    });
    // Hold its way to sign-in until the page has asked for it.
    let release = () => {};
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    let asked = () => {};
    const navigating = new Promise<void>((resolve) => {
      asked = resolve;
    });
    await page.route(
      (url) => url.pathname === '/studio/sign-in',
      async (route) => {
        asked();
        await held;
        await route.continue();
      },
    );
    const other = await context.newPage();
    await other.goto('/studio');
    await other.getByRole('button', { name: 'Sign out' }).click();
    await expect(other).toHaveURL(`${app.origin}/studio/sign-in?state=signed_out`);
    await navigating;
    release();
    await expect(page).toHaveURL(/\/studio\/sign-in\?state=signed_out/);
    // Before it went, the frame and the draft were gone already.
    expect(
      JSON.parse((await page.evaluate(() => sessionStorage.getItem('kgn-e2e:left'))) ?? 'null'),
    ).toEqual({ at: '/studio#appearance', frames: 0, draftShown: false });
    await expect(frameElement(page)).toHaveCount(0);
    await expect(page.locator('body')).not.toContainText('Rowan Appearance');
  },
);
