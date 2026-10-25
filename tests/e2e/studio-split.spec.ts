import type { Page, Request } from '@playwright/test';
import { expect, test } from '../harness/fixtures';
import { ownerSecret } from '../harness/owner-secret.mjs';
import { seedDraft, signIn } from '../harness/preview-grants';
import { ownerApp } from '../harness/profile-matrix';
import { frameElement, grantFrame, stage } from '../harness/studio-preview';
import { openTask } from '../harness/studio-tasks';
import { axeFor } from '../quality/lib/axe';

// Owner Studio's Appearance view as a split (owner direction, 2026-10-25;
// #8): the controls in a panel beside the live preview, which shows each
// pending choice as the frame's appearance override, through a new grant on
// #7's channel, with no navigation and no Preview tab, while the draft stays
// as it was until Apply to the draft. The device widths sit in the
// preview's toolbar; below 64rem a Controls and Preview switch shows one
// pane at a time, one press from the other.
const STUDIO = { type: 'route', description: '/studio' };

const secret = ownerSecret();
test.use({ appOptions: ownerApp(secret.hash) });
test.describe.configure({ mode: 'serial' });

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
`;

const workspace = (page: Page) => page.getByRole('form', { name: 'Appearance' });
const controlsPane = (page: Page) => page.getByRole('region', { name: 'Appearance controls' });
const previewPane = (page: Page) =>
  page.getByRole('region', { name: 'Preview of the saved draft' });
const line = (page: Page, label: string) =>
  page
    .locator('.studio-state__line')
    .filter({ has: page.locator('dt', { hasText: new RegExp(`^${label}$`) }) })
    .locator('dd');

/** The composition the frame's document renders, from its presentation boundary, or null while it loads. */
async function frameVariant(page: Page): Promise<string | null> {
  const frame = await (await frameElement(page).elementHandle())?.contentFrame();
  if (!frame) return null;
  return frame
    .locator('[data-variant]')
    .first()
    .getAttribute('data-variant', { timeout: 500 })
    .catch(() => null);
}

/** Another composition the panel offers than the one it shows. */
async function anotherComposition(page: Page): Promise<string> {
  const composition = workspace(page).getByRole('combobox', { name: 'Composition the site shows' });
  await expect(composition.locator('option').nth(1)).toBeAttached();
  const current = await composition.inputValue();
  const values = await composition
    .locator('option')
    .evaluateAll((options) => options.map((option) => (option as HTMLOptionElement).value));
  const other = values.find((value) => value !== current && value !== '');
  expect(other, 'a second composition this build offers').toBeDefined();
  return other!;
}

test(
  'a pick in the panel shows in the frame beside it, with no navigation, and the draft stays as it was until Apply',
  { annotation: [STUDIO] },
  async ({ page, app }) => {
    const draft = await seedDraft(app, 'Rowan Split', SITE);
    await signIn(page, app, secret.password);
    await openTask(page, 'Appearance');
    await grantFrame(page);
    await expect(stage(page)).toHaveAttribute('data-phase', 'ready');
    await expect.poll(() => frameVariant(page)).toBe('editorial-evidence');
    // Both panes show side by side, the controls first.
    const [panel, pane] = await Promise.all([
      controlsPane(page).boundingBox(),
      previewPane(page).boundingBox(),
    ]);
    expect(
      panel && pane && panel.x + panel.width <= pane.x,
      'the preview beside the controls',
    ).toBe(true);

    // From here on: no navigation of the page, and nothing written to the draft.
    let navigations = 0;
    page.on('framenavigated', (frame) => {
      if (frame === page.mainFrame()) navigations += 1;
    });
    const writes: string[] = [];
    const mints: Request[] = [];
    page.on('request', (request) => {
      const name = new URL(request.url()).pathname.split('/').pop() ?? '';
      if (/^draft\.(?:applyEdits|save)$/.test(name)) writes.push(name);
      if (name === 'preview.grant.mint') mints.push(request);
    });
    const url = page.url();

    const target = await anotherComposition(page);
    await workspace(page)
      .getByRole('combobox', { name: 'Composition the site shows' })
      .selectOption(target);
    // The frame's next grant carries the pending selection as its override.
    await expect
      .poll(() =>
        mints.some(
          (request) =>
            (request.postDataJSON() as { appearance?: { variant?: string } }).appearance
              ?.variant === target,
        ),
      )
      .toBe(true);
    await expect.poll(() => frameVariant(page)).toBe(target);
    // The frame is the same isolated frame: scripts alone, under /preview/<grant>.
    await expect(frameElement(page)).toHaveCount(1);
    await expect(frameElement(page)).toHaveAttribute(
      'sandbox',
      /^allow-scripts(?: allow-same-origin)?$/,
    );
    expect(new URL((await grantFrame(page)).url()).pathname).toMatch(
      /^\/preview\/[A-Za-z0-9_-]{22}(?:\/|$)/,
    );
    expect(page.url()).toBe(url);
    expect(navigations).toBe(0);
    expect(writes).toEqual([]);
    await expect(line(page, 'Draft')).toHaveText(`Saved draft, version ${draft.version}.`);

    // Apply is the one write, and the frame keeps showing what it applied.
    await workspace(page).getByRole('button', { name: 'Apply to the draft' }).click();
    await expect(line(page, 'Draft')).toHaveText(`Saved draft, version ${draft.version + 1}.`);
    expect(writes).toEqual(['draft.applyEdits']);
    await expect.poll(() => frameVariant(page)).toBe(target);
    expect(navigations).toBe(0);
  },
);

test(
  "the preview toolbar's device widths set the frame's layout width, scaled to fit the pane and never cropped",
  { annotation: [STUDIO] },
  async ({ page, app }) => {
    await seedDraft(app, 'Rowan Widths', SITE);
    await signIn(page, app, secret.password);
    await openTask(page, 'Appearance');
    await grantFrame(page);
    const widths = previewPane(page).getByRole('group', { name: 'Device width' });
    for (const [name, width] of [
      ['Mobile 390 by 844', 390],
      ['Tablet 1024 by 768', 1024],
      ['Desktop 1440 by 900', 1440],
    ] as const) {
      const button = widths.getByRole('button', { name, exact: true });
      await button.click();
      await expect(button).toHaveAttribute('aria-pressed', 'true');
      await expect(frameElement(page)).toHaveAttribute('title', new RegExp(`${name}$`));
      await expect(frameElement(page)).toHaveCSS('width', `${width}px`);
      // Scaled down to the stage, whole: its box inside the stage's.
      const [frame, room] = await Promise.all([
        frameElement(page).boundingBox(),
        stage(page).boundingBox(),
      ]);
      expect(frame && room, name).toBeTruthy();
      expect(frame!.width, name).toBeLessThanOrEqual(Math.min(width, room!.width) + 1);
      expect(frame!.x + frame!.width, name).toBeLessThanOrEqual(room!.x + room!.width + 1);
      expect(frame!.y + frame!.height, name).toBeLessThanOrEqual(room!.y + room!.height + 1);
    }
    // A width change applies in place: the frame keeps its grant.
    await expect(stage(page)).toHaveAttribute('data-phase', 'ready');
  },
);

test(
  'tab order runs the controls, then the preview toolbar, then the frame',
  { annotation: [STUDIO] },
  async ({ page, app }) => {
    await seedDraft(app, 'Rowan Order', SITE);
    await signIn(page, app, secret.password);
    await openTask(page, 'Appearance');
    await grantFrame(page);
    // The panel's last control, then the toolbar's first.
    await workspace(page).getByRole('button', { name: 'Apply to the draft' }).focus();
    await page.keyboard.press('Tab');
    await expect(
      previewPane(page).getByRole('button', { name: 'Desktop 1440 by 900', exact: true }),
    ).toBeFocused();
    // On through the toolbar, to the frame's skip link and the frame.
    const reached: string[] = [];
    for (let step = 0; step < 20; step += 1) {
      await page.keyboard.press('Tab');
      const now = await page.evaluate(() => {
        const element = document.activeElement;
        return element?.tagName === 'IFRAME'
          ? 'frame'
          : element?.classList.contains('preview-surface__skip')
            ? 'skip'
            : (element?.getAttribute('aria-label') ?? element?.textContent ?? '');
      });
      reached.push(now);
      if (now === 'frame') break;
    }
    expect(reached).toContain('skip');
    expect(reached.at(-1)).toBe('frame');
    expect(reached.indexOf('skip')).toBeLessThan(reached.indexOf('frame'));
  },
);

test(
  'below 1024px a Controls and Preview switch shows one pane, the preview one press away, and moves focus to it',
  { annotation: [STUDIO] },
  async ({ page, app }) => {
    await page.setViewportSize({ width: 800, height: 900 });
    await seedDraft(app, 'Rowan Narrow', SITE);
    await signIn(page, app, secret.password);
    await openTask(page, 'Appearance');
    const show = page.getByRole('group', { name: 'Show' });
    const controls = show.getByRole('button', { name: 'Controls', exact: true });
    const preview = show.getByRole('button', { name: 'Preview', exact: true });
    await expect(controls).toHaveAttribute('aria-pressed', 'true');
    await expect(controlsPane(page)).toBeVisible();
    await expect(previewPane(page)).toBeHidden();

    await preview.click();
    await expect(preview).toHaveAttribute('aria-pressed', 'true');
    await expect(previewPane(page)).toBeVisible();
    await expect(previewPane(page)).toBeFocused();
    await expect(controlsPane(page)).toBeHidden();
    await grantFrame(page);
    await expect(stage(page)).toHaveAttribute('data-phase', 'ready');
    expect((await axeFor(page).exclude('iframe').analyze()).violations).toEqual([]);

    await controls.click();
    await expect(controlsPane(page)).toBeVisible();
    await expect(controlsPane(page)).toBeFocused();
    await expect(previewPane(page)).toBeHidden();
    // The frame stayed: back on the preview, it shows with no new load.
    await preview.click();
    await expect(stage(page)).toHaveAttribute('data-phase', 'ready');
  },
);

test(
  "the split's Studio chrome passes axe, the frame's document left to its composition's own cells",
  { annotation: [STUDIO] },
  async ({ page, app }) => {
    await seedDraft(app, 'Rowan Axe', SITE);
    await signIn(page, app, secret.password);
    await openTask(page, 'Appearance');
    await grantFrame(page);
    await expect(stage(page)).toHaveAttribute('data-phase', 'ready');
    expect((await axeFor(page).exclude('iframe').analyze()).violations).toEqual([]);
    // Every control keeps its label, and the frame its name.
    await expect(frameElement(page)).toHaveAttribute('title', /^Preview — not live, /);
    for (const name of ['Display mode', 'Motion', 'Contrast', 'Show a section in the preview']) {
      await expect(previewPane(page).getByRole('combobox', { name, exact: true })).toBeVisible();
    }
  },
);
