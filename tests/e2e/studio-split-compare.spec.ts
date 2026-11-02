import { mkdirSync } from 'node:fs';
import path from 'node:path';
import type { Frame, Page } from '@playwright/test';
import { expect, test } from '../harness/fixtures';
import { ownerSecret } from '../harness/owner-secret.mjs';
import { seedDraft, signIn } from '../harness/preview-grants';
import { ownerApp } from '../harness/profile-matrix';
import { frameElement, grantFrame, stage } from '../harness/studio-preview';
import { checkedIn, openTask, optionsIn, pick, picker, reveal } from '../harness/studio-tasks';
import { axeFor } from '../quality/lib/axe';

// Owner Studio's Compare (OWN-2), Demo Studio's own, shared (split/compare.tsx,
// lib/studio/compare.ts): Compare pins the pending look as A and the rail keeps
// editing B. Side by side and the wipe are two frames, never more; the Grid of 4
// is A and three neighbours on the axis Vary picks, four frames at most. Each
// frame is a grant frame of its own, minted and revoked as the single frame's
// is: its own grant, nonce, and port, and nothing one holds reaches another
// (threat preview-19). Use this is a pending pick, with Undo, and nothing is
// written until Save draft. /studio/preview has no compare of its own.
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
features:
  feed: false
`;

const SHOTS = process.env.OWN2_SHOTS ?? null;

const bar = (page: Page) => page.getByRole('group', { name: 'Compare A and B' });
const notice = (page: Page) => page.locator('.studio-state__notice');
const compareButton = (page: Page) => page.getByRole('button', { name: 'Compare', exact: true });
const layout = (page: Page, mode: 'side' | 'wipe' | 'grid') =>
  page
    .getByRole('radiogroup', { name: 'Compare layout' })
    .locator(`label[data-option="${mode}"]`)
    .click();

/** Opens the Appearance workspace on a draft of SITE, with its frame ready. */
async function open(page: Page, app: Parameters<typeof seedDraft>[0], name: string) {
  await seedDraft(app, name, SITE);
  await signIn(page, app, secret.password);
  await openTask(page, 'Appearance');
  await grantFrame(page);
  await expect(stage(page)).toHaveAttribute('data-phase', 'ready');
}

/** Records the page's draft writes from now on: Compare makes none. */
function writes(page: Page): string[] {
  const seen: string[] = [];
  page.on('request', (request) => {
    const name = new URL(request.url()).pathname.split('/').pop() ?? '';
    if (/^draft\.(?:applyEdits|save|create)$/.test(name)) seen.push(name);
  });
  return seen;
}

/** The `index`th frame element's document, once it has one. */
async function frameAt(page: Page, index: number): Promise<Frame> {
  let found: Frame | null = null;
  await expect
    .poll(async () => {
      found = (await (await frameElement(page).nth(index).elementHandle())?.contentFrame()) ?? null;
      return found !== null && /^\/preview\/[A-Za-z0-9_-]{22}/.test(new URL(found.url()).pathname);
    })
    .toBe(true);
  return found!;
}

/** The grant a frame's document is under: its path's second part. */
const grantOf = (frame: Frame) => new URL(frame.url()).pathname.split('/')[2];

/** An option on `name`'s picker other than the checked one. */
async function other(page: Page, name: string): Promise<string> {
  const group = picker(page, name);
  await reveal(group);
  const current = await checkedIn(group);
  const value = (await optionsIn(group)).find((each) => each !== current);
  expect(value, name).toBeDefined();
  return value!;
}

async function shot(page: Page, name: string) {
  if (!SHOTS) return;
  // Each frame ready, so the shot shows the pages, not their loading.
  for (const each of await stage(page).all()) {
    await expect(each).toHaveAttribute('data-phase', 'ready', { timeout: 20_000 });
  }
  mkdirSync(SHOTS, { recursive: true });
  await page.screenshot({ path: path.join(SHOTS, `${name}.png`), animations: 'disabled' });
}

test(
  'Compare pins A, keeps editing B in the rail, opens as a wipe, then side by side, two grant frames of their own that keep their state apart, with Swap and Stop, and writes nothing',
  { annotation: [STUDIO] },
  async ({ page, app }) => {
    test.setTimeout(120_000);
    // Each hello the page hears, with the frame it came from.
    await page.addInitScript(() => {
      const hellos: Array<{ nonce: string; frame: number }> = [];
      (window as unknown as { hellos: typeof hellos }).hellos = hellos;
      addEventListener('message', (event) => {
        const data = event.data as { type?: string; payload?: { nonce?: string } } | null;
        if (data?.type !== 'hello' || !data.payload?.nonce) return;
        const frames = [...document.querySelectorAll('iframe')];
        hellos.push({
          nonce: data.payload.nonce,
          frame: frames.findIndex((each) => each.contentWindow === event.source),
        });
      });
    });
    await page.setViewportSize({ width: 1440, height: 900 });
    await open(page, app, 'Rowan Compare');
    const written = writes(page);
    await compareButton(page).click();
    await expect(compareButton(page)).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByText("You're editing B. A stays pinned as it was.")).toBeVisible();
    await expect(bar(page)).toContainText('No differences yet');
    await expect(frameElement(page)).toHaveCount(2);
    // A scheme for B: one difference, and the wipe, since the composition is the same.
    const scheme = await other(page, 'Color scheme the site shows');
    await pick(picker(page, 'Color scheme the site shows'), scheme);
    await expect(bar(page)).toContainText('1 difference');
    await expect(bar(page)).toContainText('Everything else matches.');
    // Compare, Undo, Save draft, Publish's reason, and Sign out share the top bar's one 48px row.
    const top = (await page.locator('.studio-split__top').boundingBox())!;
    expect(Math.round(top.height)).toBeLessThanOrEqual(49);
    // At 1024 too: Compare is its icon there, still named Compare and pressed, so the bar
    // keeps its one 48px row.
    await page.setViewportSize({ width: 1024, height: 768 });
    await expect(compareButton(page)).toBeVisible();
    await expect(compareButton(page)).toHaveAttribute('aria-pressed', 'true');
    await expect(page.locator('.studio-compare-toggle__text')).toHaveCSS('position', 'absolute');
    await expect
      .poll(async () =>
        Math.round((await page.locator('.studio-split__top').boundingBox())!.height),
      )
      .toBeLessThanOrEqual(49);
    await shot(page, 'owner-compare-1024');
    await page.setViewportSize({ width: 1440, height: 900 });
    await expect(page.locator('.studio-compare-toggle__text')).toHaveCSS('position', 'static');
    const slider = page.getByRole('slider', { name: 'Wipe between A and B' });
    await expect(slider).toHaveAttribute('aria-valuenow', '50');
    await slider.focus();
    await page.keyboard.press('ArrowLeft');
    await expect(slider).toHaveAttribute('aria-valuenow', '45');
    await page.keyboard.press('Home');
    await expect(slider).toHaveAttribute('aria-valuenow', '0');
    await expect(frameElement(page)).toHaveCount(2);
    const titles = await frameElement(page).evaluateAll((all) =>
      all.map((each) => each.getAttribute('title') ?? ''),
    );
    expect(titles.some((title) => title.startsWith('A, pinned: '))).toBe(true);
    expect(titles.some((title) => title.startsWith('B, editing: '))).toBe(true);
    await shot(page, 'owner-compare-wipe-1440');

    // Side by side: two frames, never more, one region each, at one scale.
    await layout(page, 'side');
    await expect(page.getByRole('region', { name: 'A, pinned' }).first()).toBeVisible();
    await expect(page.getByRole('region', { name: 'B, editing' }).first()).toBeVisible();
    await expect(frameElement(page)).toHaveCount(2);
    for (const index of [0, 1]) {
      await expect(stage(page).nth(index)).toHaveAttribute('data-phase', 'ready');
    }
    const [widthA, widthB] = await frameElement(page).evaluateAll((all) =>
      all.map((each) => each.getBoundingClientRect().width),
    );
    expect(Math.abs(widthA! - widthB!)).toBeLessThan(2);
    // Grants, nonces, and ports of their own, and what one document holds the other never sees.
    const first = await frameAt(page, 0);
    const second = await frameAt(page, 1);
    expect(grantOf(first)).not.toBe(grantOf(second));
    await expect
      .poll(() =>
        page.evaluate(
          () =>
            new Set(
              (window as unknown as { hellos: Array<{ frame: number }> }).hellos.map(
                ({ frame }) => frame,
              ),
            ).size >= 2,
        ),
      )
      .toBe(true);
    const hellos = await page.evaluate(
      () => (window as unknown as { hellos: Array<{ nonce: string; frame: number }> }).hellos,
    );
    const nonceOf = (frame: number) =>
      new Set(hellos.filter((each) => each.frame === frame).map(({ nonce }) => nonce));
    for (const nonce of nonceOf(0)) expect(nonceOf(1).has(nonce)).toBe(false);
    await first.evaluate(() => Object.assign(window, { marked: 'first' }));
    expect(await second.evaluate(() => (window as { marked?: string }).marked ?? null)).toBeNull();
    // Unlinked: a scroll in one never moves the other.
    await first.evaluate(() => scrollTo(0, 600));
    await page.waitForTimeout(500);
    expect(await second.evaluate(() => Math.round(scrollY))).toBe(0);
    await shot(page, 'owner-compare-side-1440');
    expect((await axeFor(page).exclude('iframe').analyze()).violations).toEqual([]);

    // A composition for B: two differences, still two frames.
    const composition = await other(page, 'Composition the site shows');
    await pick(picker(page, 'Composition the site shows'), composition);
    await expect(bar(page)).toContainText('2 differences');
    await expect(frameElement(page)).toHaveCount(2);

    // Swap: B takes A's look, and A B's.
    await page.getByRole('button', { name: 'Swap A and B' }).click();
    await expect
      .poll(() => checkedIn(picker(page, 'Composition the site shows')))
      .not.toBe(composition);
    await expect(notice(page)).toContainText('Swapped A and B.');
    // Stop: one frame again.
    await page.getByRole('button', { name: 'Stop comparing' }).click();
    await expect(frameElement(page)).toHaveCount(1);
    await expect(bar(page)).toHaveCount(0);
    await expect(compareButton(page)).toHaveAttribute('aria-pressed', 'false');
    expect(written).toEqual([]);
  },
);

test(
  'Grid of 4 varying the scheme is A and three schemes, four plates and four frames at most, with only plate 1 lettered A, the held line, Next 3, and Use this as a pending pick that Undo takes back',
  { annotation: [STUDIO] },
  async ({ page, app }) => {
    test.setTimeout(120_000);
    await page.setViewportSize({ width: 1440, height: 900 });
    await open(page, app, 'Rowan Grid');
    const written = writes(page);
    const schemes = picker(page, 'Color scheme the site shows');
    await reveal(schemes);
    const before = await checkedIn(schemes);
    await compareButton(page).click();
    await layout(page, 'grid');
    await page
      .getByRole('radiogroup', { name: 'Vary' })
      .locator('label[data-option="colorScheme"]')
      .click();
    const plates = page.locator('.studio-plate');
    await expect(plates).toHaveCount(4);
    // The bar says what every plate keeps of A, in place of A against B.
    await expect(bar(page).locator('.studio-compare__held')).toContainText(
      /^Varying the color scheme\. Every plate keeps A's /,
    );
    // Only plate 1 wears A; the others are named by their scheme.
    await expect(page.locator('.studio-plate[data-pinned="true"]')).toHaveCount(1);
    await expect(plates.first()).toHaveAttribute('aria-label', /^A, pinned: /);
    await expect(plates.locator('.studio-compare__tag')).toHaveCount(1);
    // Every frame on the stage is a plate's, four at most, and they go live.
    await expect
      .poll(() => page.locator('.studio-plate iframe.preview-surface__frame').count(), {
        timeout: 20_000,
      })
      .toBeGreaterThan(0);
    expect(
      await frameElement(page).evaluateAll((all) =>
        all.every((frame) => frame.closest('.studio-plate') !== null),
      ),
    ).toBe(true);
    expect(await frameElement(page).count()).toBeLessThanOrEqual(4);
    await page.waitForTimeout(1_000);
    expect(await frameElement(page).count()).toBeLessThanOrEqual(4);
    // Each live plate's frame fills its view to the plate's foot: no empty band under it.
    const first = plates.first();
    await expect(first.locator('iframe.preview-surface__frame')).toBeVisible({ timeout: 20_000 });
    await expect(first.locator('.preview-surface__stage')).toHaveAttribute('data-phase', 'ready');
    await expect
      .poll(async () => {
        const view = (await first.locator('.studio-plate__view').boundingBox())!;
        const frame = (await first.locator('iframe.preview-surface__frame').boundingBox())!;
        return Math.round(view.y + view.height - (frame.y + frame.height));
      })
      .toBeLessThanOrEqual(2);
    await shot(page, 'owner-compare-grid-schemes-1440');
    expect((await axeFor(page).exclude('iframe').analyze()).violations).toEqual([]);

    // Next 3: still four plates, A first, and never a fifth frame.
    const next = page.getByRole('button', { name: 'Next 3', exact: true });
    await expect(next).toBeVisible();
    await next.click();
    await expect(plates).toHaveCount(4);
    await expect(plates.first()).toHaveAttribute('aria-label', /^A, pinned: /);
    expect(await frameElement(page).count()).toBeLessThanOrEqual(4);

    // Use this: B takes the plate's scheme, a pending pick, said, and nothing written.
    const use = page.getByRole('button', { name: /^Use this: make B / }).first();
    await expect(use).toHaveText('Use this');
    const moved = (await use.getAttribute('aria-label'))!.replace(/^Use this: make B /, '');
    await use.click();
    await expect.poll(() => checkedIn(schemes)).not.toBe(before);
    await expect(notice(page)).toContainText(`B is now ${moved}.`);
    await expect(page.locator('.studio-states__item[data-state="appearance"]')).toBeVisible();
    // Undo takes it back.
    await page.getByRole('button', { name: 'Undo', exact: true }).click();
    await expect.poll(() => checkedIn(schemes)).toBe(before);

    // Pin as A: the plate is A now.
    const pin = page.getByRole('button', { name: /^Pin as A: / }).first();
    const pinned = (await pin.getAttribute('aria-label'))!.replace(/^Pin as A: /, '');
    await pin.click();
    await expect(plates.first()).toHaveAttribute('aria-label', `A, pinned: ${pinned}`);

    await page.getByRole('button', { name: 'Stop comparing' }).click();
    await expect(plates).toHaveCount(0);
    await expect(frameElement(page)).toHaveCount(1);
    expect(written).toEqual([]);
  },
);

test(
  'at a phone width Compare is in the More menu and Compare compositions under the composition, one frame at a time, and the full-window preview has no compare of its own',
  { annotation: [STUDIO] },
  async ({ page, app }) => {
    test.setTimeout(90_000);
    await page.setViewportSize({ width: 390, height: 844 });
    await open(page, app, 'Rowan Phone');
    const compositions = picker(page, 'Composition the site shows');
    const sheet = page.locator('.studio-split__rail');
    await expect(sheet).toBeAttached();
    await page.getByRole('button', { name: 'More: tasks and sign out' }).click();
    await expect(page.getByRole('button', { name: 'Compare A and B' })).toBeVisible();
    await page.keyboard.press('Escape');
    await reveal(compositions);
    await page.getByRole('button', { name: 'Compare compositions' }).click();
    await expect(bar(page)).toBeVisible();
    // One frame, A or B by a toggle.
    const toggle = page.getByRole('radiogroup', { name: 'Show A or B' });
    await expect(toggle).toBeVisible();
    await expect(frameElement(page)).toHaveCount(1);
    // No plates show on the phone, so the bar says what the flip compares, not what plates keep.
    await expect(bar(page)).not.toContainText('Varying the');
    await expect(bar(page)).toContainText('No differences yet');
    await expect(bar(page)).toContainText('Flip between A and B below.');
    await shot(page, 'owner-compare-phone-390');
    await toggle.locator('label[data-option="a"]').click();
    await expect(frameElement(page)).toHaveCount(1);
    await expect(frameElement(page)).toHaveAttribute('title', /^A, pinned: /);
    expect((await axeFor(page).exclude('iframe').analyze()).violations).toEqual([]);
    await page.getByRole('button', { name: 'Stop comparing' }).click();
    await expect(bar(page)).toHaveCount(0);

    // The full-window preview: one frame, and no Compare two frames.
    await page.goto('/studio/preview');
    await expect(frameElement(page)).toHaveCount(1);
    await expect(page.getByRole('checkbox', { name: 'Compare two frames' })).toHaveCount(0);
    await expect(page.getByRole('checkbox', { name: 'Link scrolling and navigation' })).toHaveCount(
      0,
    );
  },
);
