import type { Page, Request } from '@playwright/test';
import { expect, test } from '../harness/fixtures';
import { ownerSecret } from '../harness/owner-secret.mjs';
import { portfolioNamed, seedDraft, signIn } from '../harness/preview-grants';
import { ownerApp } from '../harness/profile-matrix';
import { frameElement, grantFrame, stage } from '../harness/studio-preview';
import {
  checkedIn,
  openTask,
  optionsIn,
  pick,
  picker,
  readyIn,
  reveal,
  showAllFamilies,
} from '../harness/studio-tasks';
import { COMPOSITION_STATUS } from '../../packages/variant-contract/src/status';
import { UPCOMING_COMPOSITIONS } from '../../packages/variant-contract/src/studio-catalog';
import { axeFor } from '../quality/lib/axe';
import { decodePng, deltaEOk, pixel } from '../quality/lib/pixels';

// Owner Studio's Appearance workspace (owner direction, 2026-10-25; #8; the
// design dossier's part 3 and the Studio mockup): a 48px top bar, the pickers
// in a rail beside the live preview on its grey stage, which fills the rest
// of the viewport above a 40px bottom bar with the state line. A color scheme, typography,
// design language, or display mode goes to the frame in place over #7's
// channel, with no load, so its document, scroll, and section stay; a new
// composition loads it once under a grant whose override renders the
// pending selection, and it comes back to its section. The draft stays as
// it was until Save draft. Below 48rem the preview keeps the top of
// the screen and the rail is a bottom sheet.
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

const workspace = (page: Page) => page.getByRole('form', { name: 'Appearance' });
const previewPane = (page: Page) =>
  page.getByRole('region', { name: 'Preview of the saved draft' });
const line = (page: Page, label: string) =>
  page
    .locator('.studio-state__line')
    .filter({ has: page.locator('dt', { hasText: new RegExp(`^${label}$`) }) })
    .locator('dd');

/** The frame's document's presentation boundary attribute, or null while it loads. */
async function inFrame(page: Page, attribute: string): Promise<string | null> {
  const frame = await (await frameElement(page).elementHandle())?.contentFrame();
  if (!frame) return null;
  return frame
    .locator('[data-variant]')
    .first()
    .getAttribute(attribute, { timeout: 500 })
    .catch(() => null);
}

/** The pack stylesheets the frame's document links, by their paths. */
async function frameSheets(page: Page): Promise<string[]> {
  const frame = await (await frameElement(page).elementHandle())?.contentFrame();
  if (!frame) return [];
  return frame.evaluate(() =>
    [
      ...document.querySelectorAll<HTMLLinkElement>(
        'link[rel="stylesheet"][href*="/_portfolio/pack/"]',
      ),
    ].map((link) => new URL(link.href).pathname),
  );
}

/** Opens the Appearance workspace on a draft of SITE, with its frame ready. */
async function open(
  page: Page,
  app: Parameters<typeof seedDraft>[0],
  name: string,
  portfolio?: string,
) {
  const draft = await seedDraft(app, name, SITE, portfolio);
  await signIn(page, app, secret.password);
  await openTask(page, 'Appearance');
  await grantFrame(page);
  await expect(stage(page)).toHaveAttribute('data-phase', 'ready');
  return draft;
}

/** Records the page's draft writes and grant mints from now on. */
function record(page: Page) {
  const writes: string[] = [];
  const mints: Request[] = [];
  page.on('request', (request) => {
    const name = new URL(request.url()).pathname.split('/').pop() ?? '';
    if (/^draft\.(?:applyEdits|save|create)$/.test(name)) writes.push(name);
    if (name === 'preview.grant.mint') mints.push(request);
  });
  return { writes, mints };
}

/** Marks the frame's document, so a reload of it would show as the mark gone. */
async function markFrame(page: Page) {
  const frame = await (await frameElement(page).elementHandle())!.contentFrame();
  await frame!.evaluate(() => Object.assign(window, { kgnSame: true }));
  return () =>
    frame!.evaluate(() => (window as { kgnSame?: boolean }).kgnSame === true).catch(() => false);
}

test(
  "at 1440x900 the split starts under the 48px bar, the preview fills the rest above the 40px bottom bar, and the rail scrolls as one for Composition's drawings, while a taller rail keeps its index pinned and only the open axis's panel scrolls",
  { annotation: [STUDIO] },
  async ({ page, app }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await open(page, app, 'Rowan Layout');
    const rail = page.locator('.studio-split__rail');
    const pane = previewPane(page);
    const [railBox, paneBox, frameBox] = await Promise.all([
      rail.boundingBox(),
      pane.boundingBox(),
      frameElement(page).boundingBox(),
    ]);
    expect(railBox!.y).toBe(48);
    expect(Math.round(railBox!.width)).toBe(320);
    expect(paneBox!.x).toBeGreaterThanOrEqual(railBox!.x + railBox!.width - 1);
    expect(Math.round(paneBox!.y + paneBox!.height)).toBe(860);
    const bottom = (await page.locator('.studio-split__bottom').boundingBox())!;
    expect([Math.round(bottom.y), Math.round(bottom.height)]).toEqual([860, 40]);
    // The frame at its true 1440 width, scaled to fit, whole, with its scale in the bar over it.
    expect(frameBox!.width).toBeLessThan(1440);
    expect(frameBox!.y + frameBox!.height).toBeLessThanOrEqual(860);
    await expect(pane.locator('.studio-split__scale')).toHaveText(
      `Shown at ${Math.round((frameBox!.width / 1440) * 100)}%`,
    );
    // The page itself doesn't scroll. Composition opens first, and its drawing, whole under its
    // head with its ring's room, needs more than Owner's pinned body leaves at 1440x900, so the
    // rail scrolls as one there (panelRoom()); its rows and the pinned foot move with it.
    expect(await page.evaluate(() => document.scrollingElement!.scrollHeight)).toBeLessThanOrEqual(
      900,
    );
    // Said with the rail's fit and its overflow, so a failure names its cause.
    const fitOf = () =>
      rail.evaluate((element) => ({
        over: element.scrollHeight - element.clientHeight,
        fit: element.dataset.fit,
        room: Number(element.dataset.fitBody),
        need: Number(element.dataset.fitNeed),
      }));
    const composed = await fitOf();
    expect(composed.need, JSON.stringify(composed)).toBeGreaterThan(composed.room);
    expect(composed.fit, JSON.stringify(composed)).toBe('scroll');
    expect(composed.over, JSON.stringify(composed)).toBeGreaterThan(1);
    // The lead's terms for that trade: on open, with no scroll of the rail or the page, the
    // checked drawing is whole in view, its name and line too; and as the rail scrolls, to its
    // foot and back, the stage stays where it is beside it, whole in the viewport.
    const shown = await rail.evaluate((element) => {
      const label = element
        .querySelector('.studio-split__fold[open] label input:checked')!
        .closest('label')!
        .getBoundingClientRect();
      const box = element.getBoundingClientRect();
      return {
        rail: element.scrollTop,
        page: document.scrollingElement!.scrollTop,
        whole:
          label.top >= box.top - 0.5 &&
          label.bottom <= box.bottom + 0.5 &&
          label.bottom <= innerHeight + 0.5 &&
          label.height > 0,
        label: [Math.round(label.top), Math.round(label.bottom)],
        box: [Math.round(box.top), Math.round(box.bottom)],
      };
    });
    expect(shown, JSON.stringify(shown)).toMatchObject({ rail: 0, page: 0, whole: true });
    const stageIn = async () => {
      const [frame, side] = await Promise.all([
        frameElement(page).boundingBox(),
        rail.boundingBox(),
      ]);
      return {
        x: frame!.x,
        y: frame!.y,
        beside: frame!.x >= side!.x + side!.width - 1,
        whole: frame!.y >= 0 && frame!.y + frame!.height <= 860 && frame!.x + frame!.width <= 1440,
      };
    };
    const stageAt = await stageIn();
    expect(stageAt, JSON.stringify(stageAt)).toMatchObject({ beside: true, whole: true });
    for (const to of ['end', 'start'] as const) {
      await rail.evaluate(
        (element, end) =>
          element.scrollTo({ top: end ? element.scrollHeight : 0, behavior: 'instant' }),
        to === 'end',
      );
      expect(await page.evaluate(() => document.scrollingElement!.scrollTop)).toBe(0);
      expect(await stageIn(), `the stage with the rail at its ${to}`).toEqual(stageAt);
    }
    // A rail tall enough for that drawing keeps its index pinned, and only the open axis's panel
    // body scrolls, on its own (the round 5b index): the rail's rows and its pinned Display
    // mode stay where they are.
    await page.setViewportSize({ width: 1440, height: 1080 });
    await expect(rail).toHaveAttribute('data-fit', 'pinned');
    const fit = await fitOf();
    expect(fit.room, JSON.stringify(fit)).toBeGreaterThanOrEqual(fit.need);
    expect(fit.over, JSON.stringify(fit)).toBeLessThanOrEqual(1);
    const body = rail.locator('.studio-split__fold[open] .studio-split__fold-body');
    expect(await body.evaluate((element) => element.scrollHeight > element.clientHeight)).toBe(
      true,
    );
    const pinned = (await rail.locator('.studio-split__pinned').boundingBox())!;
    const frameAt = (await frameElement(page).boundingBox())!.y;
    await body.evaluate((element) => element.scrollBy(0, 400));
    expect(await body.evaluate((element) => element.scrollTop)).toBeGreaterThan(0);
    expect((await frameElement(page).boundingBox())!.y).toBe(frameAt);
    expect((await rail.locator('.studio-split__pinned').boundingBox())!.y).toBe(pinned.y);
    // The state is the bottom bar's line, and no status cards or prose between the owner and the preview.
    await expect(page.locator('.studio-states')).toContainText(/Draft\s*version \d/);
    await expect(page.locator('.studio-state--quiet')).toHaveCSS('clip-path', 'inset(50%)');
    await expect(page.locator('select[id^="studio-appearance-"]')).toHaveCount(0);
  },
);

test(
  "the wide rail stays pinned while it holds its rows, its foot and a panel body that shows its checked option whole with its ring, as at 1440x1080, and scrolls as one when it can't, as Owner's Composition at 1440x900 and Owner's at 1280x720, where every option still takes its click and keeps its ring",
  { annotation: [STUDIO] },
  async ({ page, app }) => {
    await page.setViewportSize({ width: 1440, height: 1080 });
    await open(page, app, 'Rowan Fit');
    const rail = page.locator('.studio-split__rail');
    await expect(rail).toHaveAttribute('data-fit', 'pinned');
    const room = Number(await rail.getAttribute('data-fit-body'));
    const need = Number(await rail.getAttribute('data-fit-need'));
    expect(need).toBeGreaterThanOrEqual(96);
    expect(room).toBeGreaterThanOrEqual(need);
    const body = rail.locator('.studio-split__fold[open] .studio-split__fold-body');
    expect((await body.boundingBox())!.height).toBeGreaterThanOrEqual(need);
    expect(await rail.evaluate((element) => element.scrollHeight <= element.clientHeight + 1)).toBe(
      true,
    );
    // The checked drawing, focused from the keyboard, shows its whole ring inside the body.
    const checked = body.locator('label input:checked');
    await checked.focus();
    const ring = await checked.evaluate((input) => {
      const box = input.getBoundingClientRect();
      const band = input.closest('.studio-split__fold-body')!.getBoundingClientRect();
      // Its ring: 2px wide, 6px out (studio.css's .studio-choice__input:focus-visible).
      const reach = 8;
      return { top: box.top - reach - band.top, bottom: band.bottom - (box.bottom + reach) };
    });
    expect(ring.top, JSON.stringify(ring)).toBeGreaterThanOrEqual(0);
    expect(ring.bottom, JSON.stringify(ring)).toBeGreaterThanOrEqual(0);
    // Owner at 1440x900: the same drawing needs more than the pinned body leaves.
    await page.setViewportSize({ width: 1440, height: 900 });
    await expect(rail).toHaveAttribute('data-fit', 'scroll');
    expect(Number(await rail.getAttribute('data-fit-body'))).toBeLessThan(
      Number(await rail.getAttribute('data-fit-need')),
    );
    await page.setViewportSize({ width: 1280, height: 720 });
    await expect(rail).toHaveAttribute('data-fit', 'scroll');
    expect(Number(await rail.getAttribute('data-fit-body'))).toBeLessThan(96);
    expect(await rail.evaluate((element) => element.scrollHeight > element.clientHeight)).toBe(
      true,
    );
    // Nothing pinned lies over an option: a plain click picks one.
    const composition = picker(workspace(page), 'Composition the site shows');
    const target = (await readyIn(composition)).find((id) => id !== 'editorial-evidence')!;
    await pick(composition, target);
    await expect.poll(() => inFrame(page, 'data-variant')).toBe(target);
  },
);

test(
  'a scheme, a typography, a design language, and a display mode show in the same frame document, with no load and no write',
  { annotation: [STUDIO] },
  async ({ page, app }) => {
    const draft = await open(page, app, 'Rowan In Place');
    const { writes, mints } = record(page);
    const same = await markFrame(page);
    const form = workspace(page);
    const shown: string[] = [];
    for (const [name, attribute] of [
      ['Color scheme the site shows', 'data-color-scheme'],
      ['Typography the site shows', 'data-typography'],
      ['Design language the site shows', 'data-design-language'],
    ] as const) {
      const group = picker(form, name);
      const current = await checkedIn(group);
      const other = (await optionsIn(group)).find((value) => value !== current);
      expect(other, name).toBeDefined();
      await pick(group, other!);
      await expect.poll(() => inFrame(page, attribute), name).toBe(other);
      shown.push(other!);
    }
    // Each later switch keeps the sheets of the ones before it: the scheme picked first
    // is still linked once the typography and the design language have changed.
    const sheets = await frameSheets(page);
    for (const pack of shown) {
      expect(
        sheets.some((path) => path.startsWith(`/_portfolio/pack/${pack}.`)),
        `the frame links ${pack}`,
      ).toBe(true);
    }
    await pick(picker(form, 'Display mode the site shows'), 'dark');
    await expect.poll(() => inFrame(page, 'data-display-mode')).toBe('dark');
    // The same document all along: no new grant, no load, and the draft untouched.
    expect(await same()).toBe(true);
    expect(mints).toEqual([]);
    expect(writes).toEqual([]);
    await expect(line(page, 'Draft')).toHaveText(`Saved draft, version ${draft.version}.`);
  },
);

test(
  'Content opens in the same split: its fields in the rail over the same frame document, no tiles or side stripe, and a section field outlines its section',
  { annotation: [STUDIO] },
  async ({ page, app }) => {
    await open(page, app, 'Rowan Content');
    const { writes, mints } = record(page);
    const same = await markFrame(page);
    await openTask(page, 'Content');
    const rail = page.getByRole('region', { name: 'Content fields' });
    await expect(rail).toBeVisible();
    await expect(rail.getByRole('button', { name: 'Fields', exact: true })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    // The stage stayed: the same frame document, with no new grant.
    await expect(page.getByRole('region', { name: 'Preview of the saved draft' })).toBeVisible();
    expect(await same()).toBe(true);
    expect(mints).toEqual([]);
    // One Save draft, the top bar's; no old nav with its stripe, and the state is the bottom bar's.
    await expect(page.getByRole('button', { name: 'Save draft', exact: true })).toHaveCount(1);
    await expect(page.locator('.studio-shell__nav')).toHaveCount(0);
    await expect(page.locator('.studio-state--quiet')).toHaveCSS('clip-path', 'inset(50%)');
    await expect(page.locator('.studio-states [data-state="draft"]')).toBeVisible();
    // A field of the portfolio's first section outlines that section in the frame.
    await rail.locator('[data-pointer^="/sections/0/"] :is(input, textarea)').first().focus();
    await expect(page.getByTestId('preview-focus')).toBeVisible();
    // Back to Appearance: still the same document.
    await openTask(page, 'Appearance');
    await expect(workspace(page)).toBeVisible();
    expect(await same()).toBe(true);
    expect(writes).toEqual([]);
  },
);

test(
  "a fresh tab lands on Appearance and a reload on the tab's last task; Content's findings are one line that opens their list in plain words (OWN-3)",
  { annotation: [STUDIO] },
  async ({ page, app }) => {
    // Two unknown keys at the portfolio's root: findings no field holds, which once stacked
    // their notes over the rail's first view.
    const name = 'Rowan Landing';
    await seedDraft(app, name, SITE, `${portfolioNamed(name)}noSuchKey: 1\notherKey: 2\n`);
    await signIn(page, app, secret.password);
    const current = page.locator('nav[aria-label="Studio tasks"] a[aria-current="page"]').first();
    // No task named: Appearance, its pickers beside the preview.
    await expect(current).toHaveAttribute('href', '#appearance');
    await expect(workspace(page)).toBeVisible();
    await openTask(page, 'Content');
    const rail = page.getByRole('region', { name: 'Content fields' });
    const summary = rail.locator('.studio-findings__line');
    await expect(summary).toHaveCount(1);
    await expect(summary).toHaveText('2 findings block publishing. Show them', {
      useInnerText: true,
    });
    // Closed, so the first view is the fields: no notice shows, and the document's
    // explanation waits behind its own disclosure.
    await expect(rail.locator('.studio-fields__finding:visible')).toHaveCount(0);
    await expect(rail.getByText(/^Fields edit the portfolio/)).toBeHidden();
    await expect(rail.getByText(/^How the fields edit portfolio\.yml$/)).toBeVisible();
    await summary.click();
    const items = rail.locator('.studio-findings__list > li');
    await expect(items).toHaveCount(2);
    for (const item of await items.all()) {
      await expect(item).toBeVisible();
      // In words, never a pointer; a solid, tinted notice, never a dashed box.
      await expect(item).not.toContainText('/noSuchKey');
      await expect(item).not.toContainText('/otherKey');
      await expect(item).toHaveCSS('border-top-style', 'solid');
      // One 1px border all round, no side stripe; the label says the severity.
      await expect(item).toHaveCSS('border-left-width', '1px');
      await expect(item).toContainText(/\((?:Blocks preview and publishing|Blocks publishing)\)/);
      // The unknown key set off as code, and the fix line the one thing to do and where,
      // never the pointer, never the message again.
      await expect(item.locator('code.studio-fields__key')).toHaveCount(1);
      const next = item.locator('.studio-fields__next');
      await expect(next).not.toContainText('pointer');
      await expect(next).toHaveText(/Change it in source mode, portfolio\.yml, line \d+\.$/);
      expect(await item.evaluate((node) => getComputedStyle(node).backgroundColor)).not.toBe(
        'rgba(0, 0, 0, 0)',
      );
    }
    await expect(summary).toHaveText('2 findings block publishing. Hide them', {
      useInnerText: true,
    });
    // The tab keeps its last task: a reload is back in Content.
    await page.reload();
    await expect(page.locator('.studio-state__lines')).toBeAttached();
    await expect(current).toHaveAttribute('href', '#content');
    await expect(page.getByRole('region', { name: 'Content fields' })).toBeVisible();
  },
);

test(
  "Content's blocked preview says what to do next: Show the problems opens the findings and puts focus on the first, by key, at 1440 and 390",
  { annotation: [STUDIO] },
  async ({ page, app }) => {
    // An unknown key in the site document, a finding that blocks the preview.
    const blocked = SITE.replace(
      'motionPolicy: respect-os',
      'motionPolicy: respect-os\nnoSuchKey: 1',
    );
    expect(blocked).not.toBe(SITE);
    await seedDraft(app, 'Rowan Blocked', blocked);
    await signIn(page, app, secret.password);
    await page.setViewportSize({ width: 1440, height: 900 });
    await openTask(page, 'Content');
    for (const [width, height] of [
      [1440, 900],
      [390, 844],
    ] as const) {
      await page.setViewportSize({ width, height });
      // A reload starts the findings closed, and the tab keeps Content.
      await page.reload();
      const rail = page.getByRole('region', { name: 'Content fields' });
      await expect(rail).toBeVisible();
      await expect(stage(page)).toHaveAttribute('data-phase', 'blocked');
      const findings = rail.locator('details.studio-findings');
      await expect(findings).not.toHaveAttribute('open', '');
      const show = previewPane(page).getByRole('button', { name: /^Show the problems?$/ });
      await expect(show).toBeVisible();
      // Nothing kept, so the notice is the frame's one content: centred in it at 1440, over
      // its top at 390, where the frame is short.
      const [notice, frame] = await Promise.all([
        previewPane(page).locator('.preview-surface__state').boundingBox(),
        stage(page).boundingBox(),
      ]);
      if (width === 1440) {
        const middle = (box: { y: number; height: number }) => box.y + box.height / 2;
        expect(Math.abs(middle(notice!) - middle(frame!))).toBeLessThan(4);
      } else {
        expect(notice!.y - frame!.y).toBeLessThan(24);
      }
      await show.focus();
      await page.keyboard.press('Enter');
      await expect(findings).toHaveAttribute('open', '');
      const first = rail.locator('.studio-findings__list > li').first();
      await expect(first).toBeFocused();
      await expect(first).toBeInViewport();
      expect(await first.evaluate((item) => item.matches(':focus-visible')), `${width}`).toBe(true);
      // Focusable for the move alone: once focus leaves, it's text again, so a click on it
      // never takes focus (nor resets the frame's outline).
      await expect(first).toHaveAttribute('tabindex', '-1');
      await page.keyboard.press('Shift+Tab');
      await expect(first).not.toHaveAttribute('tabindex');
      await first.click();
      await expect(first).not.toBeFocused();
    }
    // At 1440 with the rail collapsed, the step shows the rail first, then lands there.
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.reload();
    const rail = page.locator('.studio-split__rail');
    await page.getByRole('button', { name: 'Hide controls' }).click();
    await expect(rail).toBeHidden();
    await expect(stage(page)).toHaveAttribute('data-phase', 'blocked');
    await previewPane(page)
      .getByRole('button', { name: /^Show the problems?$/ })
      .focus();
    await page.keyboard.press('Enter');
    await expect(rail).toBeVisible();
    await expect(rail.locator('details.studio-findings')).toHaveAttribute('open', '');
    const first = rail.locator('.studio-findings__list > li').first();
    await expect(first).toBeFocused();
    await expect(first).toBeInViewport();
    expect(await first.evaluate((item) => item.matches(':focus-visible'))).toBe(true);
    // From Appearance, the step goes to Content and shows the findings there.
    for (const [width, height] of [
      [1440, 900],
      [390, 844],
    ] as const) {
      await page.setViewportSize({ width, height });
      await page.goto('/studio#appearance');
      await expect(workspace(page)).toBeVisible();
      await expect(stage(page)).toHaveAttribute('data-phase', 'blocked');
      const there = previewPane(page).getByRole('button', {
        name: /^Show the problems? in Content$/,
      });
      await there.focus();
      await page.keyboard.press('Enter');
      await expect(page).toHaveURL(/#content$/);
      const content = page.getByRole('region', { name: 'Content fields' });
      await expect(content.locator('details.studio-findings')).toHaveAttribute('open', '');
      const item = content.locator('.studio-findings__list > li').first();
      await expect(item).toBeFocused();
      await expect(item).toBeInViewport();
      expect(await item.evaluate((node) => node.matches(':focus-visible')), `${width}`).toBe(true);
    }
  },
);

/** SITE with an unknown key, a finding that blocks the preview. */
const BLOCKED = SITE.replace('motionPolicy: respect-os', 'motionPolicy: respect-os\nnoSuchKey: 1');

/**
 * What the browser sends as its window loses focus and gets it back, in Chromium's order:
 * blur and focusout on the focused element, which stays the document's active element, then
 * the window's blur; on return the window's focus, then the element's focus and focusin.
 * Headless Chromium emulates focus for every page, so a second page brought to the front
 * blurs nothing: these are the events a real switch dispatches, at the page's own handlers.
 */
async function switchWindowAndBack(page: Page) {
  await page.evaluate(() => {
    const held = document.activeElement;
    if (!held || held === document.body) throw new Error('nothing has focus to switch away from');
    held.dispatchEvent(new FocusEvent('blur', { relatedTarget: null }));
    held.dispatchEvent(new FocusEvent('focusout', { bubbles: true, relatedTarget: null }));
    window.dispatchEvent(new FocusEvent('blur'));
    window.dispatchEvent(new FocusEvent('focus'));
    held.dispatchEvent(new FocusEvent('focus'));
    held.dispatchEvent(new FocusEvent('focusin', { bubbles: true }));
  });
}

test(
  "Appearance's Show the problems in Content is the task links' own switch: Back returns to Appearance, and nothing is sent or replayed",
  { annotation: [STUDIO] },
  async ({ page, app }) => {
    await seedDraft(app, 'Rowan Back', BLOCKED);
    await signIn(page, app, secret.password);
    await page.setViewportSize({ width: 1440, height: 900 });
    await openTask(page, 'Appearance');
    await expect(workspace(page)).toBeVisible();
    await expect(stage(page)).toHaveAttribute('data-phase', 'blocked');
    const { writes, mints } = record(page);
    await previewPane(page)
      .getByRole('button', { name: /^Show the problems? in Content$/ })
      .click();
    await expect(page).toHaveURL(/\/studio#content$/);
    const findings = page
      .getByRole('region', { name: 'Content fields' })
      .locator('details.studio-findings');
    await expect(findings).toHaveAttribute('open', '');
    const first = findings.locator('.studio-findings__list > li').first();
    await expect(first).toBeFocused();
    // From here on: the page's own document and every Studio call, read or write.
    const minted = mints.length;
    const sent: string[] = [];
    page.on('request', (request) => {
      const path = new URL(request.url()).pathname;
      if (request.frame() !== page.mainFrame()) return;
      if (request.isNavigationRequest() || path.startsWith('/api/studio/'))
        sent.push(`${request.method()} ${path}`);
    });
    // Back is the fragment's history entry: Appearance again, its blocked notice and its step.
    await page.goBack();
    await expect(page).toHaveURL(/\/studio#appearance$/);
    await expect(workspace(page)).toBeVisible();
    await expect(
      page
        .locator('nav[aria-label="Studio tasks"] a.studio-shell__task[href="#appearance"]')
        .first(),
    ).toHaveAttribute('aria-current', 'page');
    await expect(stage(page)).toHaveAttribute('data-phase', 'blocked');
    await expect(
      previewPane(page).getByRole('button', { name: /^Show the problems? in Content$/ }),
    ).toBeVisible();
    // And Forward is Content as a link reaches it: the ask isn't replayed, so the list stays
    // closed and focus stays where it was.
    await page.goForward();
    await expect(page).toHaveURL(/\/studio#content$/);
    await expect(page.getByRole('region', { name: 'Content fields' })).toBeVisible();
    await expect(findings).not.toHaveAttribute('open', '');
    await expect(first).not.toBeFocused();
    // Neither step reloaded the page or called Studio: no request, no new grant, and no save
    // from the first switch on.
    expect(sent).toEqual([]);
    expect(mints).toHaveLength(minted);
    expect(writes).toEqual([]);
  },
);

test(
  "a window switch leaves focus where it was, on the finding Show the problems moved it to or on a rail field, and a finding focus couldn't reach is text again",
  { annotation: [STUDIO] },
  async ({ page, app }) => {
    await seedDraft(app, 'Rowan Away', BLOCKED);
    await signIn(page, app, secret.password);
    await page.setViewportSize({ width: 1440, height: 900 });
    await openTask(page, 'Content');
    const rail = page.getByRole('region', { name: 'Content fields' });
    await expect(rail).toBeVisible();
    await expect(stage(page)).toHaveAttribute('data-phase', 'blocked');
    const show = previewPane(page).getByRole('button', { name: /^Show the problems?$/ });
    // By its class in the rail, not the region's role: the last part hides the rail, and a
    // hidden region leaves the accessibility tree, so a role query no longer finds it.
    const findings = page.locator('.studio-split__rail details.studio-findings');
    const first = findings.locator('.studio-findings__list > li').first();
    await expect(rail.locator('details.studio-findings')).toHaveCount(1);
    await expect(findings).toHaveCount(1);
    await show.focus();
    await page.keyboard.press('Enter');
    await expect(first).toBeFocused();
    await expect(first).toHaveAttribute('tabindex', '-1');
    // Away and back: the finding keeps focus, and stays focusable to hold it.
    await switchWindowAndBack(page);
    await expect(first).toBeFocused();
    await expect(first).toHaveAttribute('tabindex', '-1');
    // Focus moving on for real makes it text again.
    await page.keyboard.press('Shift+Tab');
    await expect(first).not.toBeFocused();
    await expect(first).not.toHaveAttribute('tabindex');
    // A rail field keeps focus across a switch too.
    const field = rail.locator('[data-pointer^="/sections/0/"] :is(input, textarea)').first();
    await field.focus();
    await switchWindowAndBack(page);
    await expect(field).toBeFocused();
    // With the rail out of reach, focus can't take: no finding is left focusable.
    await findings.evaluate((details) => {
      (details as HTMLDetailsElement).open = false;
    });
    await page.addStyleTag({ content: '.studio-split__rail { display: none !important; }' });
    await show.focus();
    await page.keyboard.press('Enter');
    await expect(findings).toHaveAttribute('open', '');
    await expect(first).not.toBeFocused();
    await expect(first).not.toHaveAttribute('tabindex');
    await expect(show).toBeFocused();
  },
);

test(
  'a draft that holds a composition in progress shows its card checked, and a long name stays clear of the tick, at 1440 and 390 (A2)',
  { annotation: [STUDIO] },
  async ({ page, app }) => {
    // The composition held: the registry's first one in progress that a package registers, so
    // it has a card, read from the registry rather than named, as a flip moves it.
    const pending = Object.entries(COMPOSITION_STATUS)
      .filter(([, status]) => status === 'pending')
      .map(([id]) => id)
      .filter((id) => !UPCOMING_COMPOSITIONS.some((upcoming) => upcoming.id === id));
    if (pending.length === 0) {
      // Nothing is in progress (Flux, the last first-party
      // composition, flipped), and no fixture or opt-in can hold one without product code: the
      // ledger, COMPOSITION_STATUS, is the platform's own table, which no site, manifest or env sets.
      // So the empty case is asserted outright, never a pass for having nothing to check, and the A2
      // path itself stays held by the units, each with a ledger of its own (sample.test.ts,
      // catalog.test.ts, pickers.test.tsx). A draft's composition shows checked and ready, no card in the picker
      // is held, and there's no In-progress disclosure.
      await seedDraft(app, 'Rowan Held', SITE);
      await signIn(page, app, secret.password);
      await page.setViewportSize({ width: 1440, height: 900 });
      await page.goto('/studio#appearance');
      await openTask(page, 'Appearance');
      const group = picker(page, 'Composition the site shows');
      await reveal(group);
      await showAllFamilies(group);
      const box = page.locator('.studio-compositions').filter({ has: group });
      expect(await box.locator('label[data-option]').count()).toBeGreaterThan(1);
      await expect(box.locator('label[data-option="editorial-evidence"] input')).toBeChecked();
      await expect(box.locator('.studio-pending')).toHaveCount(0);
      await expect(box.locator('details.studio-later')).toHaveCount(0);
      await expect(box.locator('label[data-option] input:disabled')).toHaveCount(0);
      return;
    }
    const id = pending[0]!;
    const held = SITE.replace('variant: editorial-evidence', `variant: ${id}`);
    expect(held).not.toBe(SITE);
    await seedDraft(app, 'Rowan Held', held);
    await signIn(page, app, secret.password);
    for (const [width, height] of [
      [1440, 900],
      [390, 844],
    ] as const) {
      await page.setViewportSize({ width, height });
      await page.goto('/studio#appearance');
      await openTask(page, 'Appearance');
      const card = picker(page, 'Composition the site shows').locator(`label[data-option="${id}"]`);
      await expect(card.locator('input')).toBeChecked();
      await expect(card.locator('.studio-pending')).toBeAttached();
      // A name that fills the card: it wraps inside the card's padding, short of the tick.
      const label = card.locator('.studio-choice__label');
      const long = `${id
        .split('-')
        .map((word) => word[0]!.toUpperCase() + word.slice(1))
        .join(' ')} Composition Long Name`;
      await label.evaluate((node, long) => {
        node.textContent = long;
      }, long);
      const [text, tick] = await Promise.all([
        label.boundingBox(),
        card.locator('.studio-tick').boundingBox(),
      ]);
      expect(text!.x + text!.width, `${width}`).toBeLessThanOrEqual(tick!.x);
    }
  },
);

test(
  "Appearance's unsaved pick goes to Content openly, and Content's Save draft keeps it with the text in one write, under one version check (C-M1, OWN-5)",
  { annotation: [STUDIO] },
  async ({ page, app }) => {
    const draft = await open(page, app, 'Rowan Carried');
    const { writes } = record(page);
    const sent: { expectedVersion: number; documents: { site: { sourceText: string } } }[] = [];
    page.on('request', (request) => {
      if (new URL(request.url()).pathname.endsWith('/draft.save'))
        sent.push(request.postDataJSON());
    });
    const schemes = picker(page, 'Color scheme the site shows');
    await reveal(schemes);
    const saved = await checkedIn(schemes);
    const picked = (await optionsIn(schemes)).find((value) => value !== saved)!;
    await pick(schemes, picked);
    await openTask(page, 'Content');
    await expect(page.locator('.studio-split__unsaved')).toHaveText('Unsaved changes');
    // Undo stays in the top bar, so the pick can be taken back from here.
    await expect(page.getByRole('button', { name: 'Undo', exact: true })).toBeVisible();
    // The hint names the ways out that work: Save draft keeps the picks, Undo takes them back.
    const status = page.locator('.studio-split__status');
    await expect(status).toContainText(
      `The preview shows your unsaved appearance picks. Save draft keeps them as draft version ${draft.version + 1}, or Undo takes them back.`,
    );
    await expect(status).not.toContainText('saved draft');
    // An edit too: Save draft saves both, never a version that drops the pick.
    const rail = page.getByRole('region', { name: 'Content fields' });
    const field = rail.locator('[data-pointer^="/sections/0/"] :is(input, textarea)').first();
    await field.fill(`${await field.inputValue()} carried`);
    await expect(status).toContainText(
      `Save draft keeps your changes and your appearance picks as draft version ${draft.version + 1}.`,
    );
    const save = page.getByRole('button', { name: 'Save draft', exact: true });
    await expect(save).not.toHaveAttribute('aria-disabled', 'true');
    await expect(save).not.toHaveAttribute('title');
    await save.click();
    await expect(page.locator('.studio-states [data-state="draft"]')).toContainText(
      String(draft.version + 1),
    );
    await expect(page.locator('.studio-split__unsaved')).toHaveCount(0);
    // One write, draft.save, with the version read, the text and the pick in it.
    expect(writes).toEqual(['draft.save']);
    expect(sent).toHaveLength(1);
    expect(sent[0]!.expectedVersion).toBe(draft.version);
    expect(sent[0]!.documents.site.sourceText).toContain(`colorScheme: ${picked}`);
    // Back in Appearance the pick is the saved draft's, with nothing unsaved.
    await openTask(page, 'Appearance');
    await reveal(schemes);
    expect(await checkedIn(schemes)).toBe(picked);
    await expect(page.locator('.studio-split__marker')).toHaveCount(0);
  },
);

test(
  "one finding that blocks publishing, in the portfolio and not the appearance, holds Publish with the Checks chip's count",
  { annotation: [STUDIO] },
  async ({ page, app }) => {
    // An unknown key at the portfolio's root: the appearance itself is clean.
    await seedDraft(app, 'Rowan Blocked', SITE, `${portfolioNamed('Rowan Blocked')}noSuchKey: 1\n`);
    await signIn(page, app, secret.password);
    await openTask(page, 'Appearance');
    await expect(page.locator('.studio-states [data-state="checks"]')).toContainText('need fixing');
    const publish = page.getByRole('button', { name: 'Publish', exact: true });
    await expect(publish).toHaveAttribute('aria-disabled', 'true');
    await expect(publish).toHaveAccessibleDescription(/^Fix 1 check/);
    await expect(page.locator('.studio-split__reason-long')).toHaveText('Fix 1 check to publish');
    await expect(page.getByRole('link', { name: 'Publish', exact: true })).toHaveCount(0);
  },
);

test(
  'a pick by click leaves focus on its radio, and ControlOrMeta+Z there undoes it, with Shift redoing it',
  { annotation: [STUDIO] },
  async ({ page, app }) => {
    await open(page, app, 'Rowan Undo');
    const { writes } = record(page);
    const schemes = picker(workspace(page), 'Color scheme the site shows');
    const chosen = await checkedIn(schemes);
    const other = (await optionsIn(schemes)).find((value) => value !== chosen)!;
    await pick(schemes, other);
    await expect.poll(() => inFrame(page, 'data-color-scheme')).toBe(other);
    // The pointer leaves, so what shows is the pick, not a hover preview of it.
    await page.mouse.move(0, 0);
    // Focus is on the radio the click picked, not in a text field.
    expect(
      await page.evaluate(() => (document.activeElement as HTMLInputElement | null)?.type),
    ).toBe('radio');
    await page.keyboard.press('ControlOrMeta+Z');
    await expect.poll(() => checkedIn(schemes)).toBe(chosen);
    await expect.poll(() => inFrame(page, 'data-color-scheme')).toBe(chosen);
    await page.keyboard.press('ControlOrMeta+Shift+Z');
    await expect.poll(() => checkedIn(schemes)).toBe(other);
    await expect.poll(() => inFrame(page, 'data-color-scheme')).toBe(other);
    expect(writes).toEqual([]);
  },
);

test(
  'pointing at a scheme previews it in the same frame document, leaving or Escape reverts it, and nothing is chosen or written',
  { annotation: [STUDIO] },
  async ({ page, app }) => {
    await open(page, app, 'Rowan Intent');
    const { writes, mints } = record(page);
    const same = await markFrame(page);
    const schemes = picker(workspace(page), 'Color scheme the site shows');
    await reveal(schemes);
    const chosen = await checkedIn(schemes);
    const other = (await optionsIn(schemes)).find((value) => value !== chosen)!;
    const option = schemes.locator(`label[data-option="${other}"]`);
    await option.scrollIntoViewIfNeeded();
    // Where the page is, and its history: a preview by pointing moves neither.
    const url = page.url();
    const entries = await page.evaluate(() => history.length);
    await option.hover();
    await expect.poll(() => inFrame(page, 'data-color-scheme')).toBe(other);
    await expect(page.locator('.studio-split__intent')).toContainText('Previewing');
    expect(page.url()).toBe(url);
    expect(await page.evaluate(() => history.length)).toBe(entries);
    // Pointing chooses nothing.
    expect(await checkedIn(schemes)).toBe(chosen);
    await page.mouse.move(0, 0);
    await expect.poll(() => inFrame(page, 'data-color-scheme')).toBe(chosen);
    await expect(page.locator('.studio-split__intent')).toHaveCount(0);
    // Pointing at the one already chosen previews nothing, so no "Previewing" line shows that
    // focusing it wouldn't (the quality cells' hover parity, Display mode's System at its foot).
    const current = schemes.locator(`label[data-option="${chosen}"]`);
    await current.scrollIntoViewIfNeeded();
    await current.hover();
    await page.waitForTimeout(200);
    await expect(page.locator('.studio-split__intent')).toHaveCount(0);
    expect(await inFrame(page, 'data-color-scheme')).toBe(chosen);
    const system = picker(workspace(page), 'Display mode the site shows').locator(
      'label:has(> input:checked)',
    );
    await system.hover();
    await page.waitForTimeout(200);
    await expect(page.locator('.studio-split__intent')).toHaveCount(0);
    await page.mouse.move(0, 0);
    await option.scrollIntoViewIfNeeded();
    // Escape reverts too.
    await option.hover();
    await expect.poll(() => inFrame(page, 'data-color-scheme')).toBe(other);
    await page.keyboard.press('Escape');
    await expect.poll(() => inFrame(page, 'data-color-scheme')).toBe(chosen);
    // And closing its panel by keyboard, with the pointer still where it was, ends it too:
    // the pointer leaves and comes back, as Escape left it over the option.
    await page.mouse.move(0, 0);
    await option.hover();
    await expect.poll(() => inFrame(page, 'data-color-scheme')).toBe(other);
    const fold = page.locator('section[data-section="colorScheme"] > details');
    await fold.locator('> summary').focus();
    await page.keyboard.press('Enter');
    await expect(fold).not.toHaveAttribute('open', '');
    await expect.poll(() => inFrame(page, 'data-color-scheme')).toBe(chosen);
    await expect(page.locator('.studio-split__intent')).toHaveCount(0);
    expect(page.url()).toBe(url);
    expect(await page.evaluate(() => history.length)).toBe(entries);
    expect(await same()).toBe(true);
    expect(mints).toEqual([]);
    expect(writes).toEqual([]);
  },
);

test(
  'pointing at a typography or a design language previews nothing and fetches no font, in the frame or in Studio; a click commits it (the lead ruling, P-5)',
  { annotation: [STUDIO] },
  async ({ page, app }) => {
    await open(page, app, 'Rowan Type Hover');
    const same = await markFrame(page);
    const fonts: string[] = [];
    page.context().on('request', (request) => {
      if (request.resourceType() === 'font' || /\.woff2?(?:$|\?)/.test(request.url())) {
        fonts.push(request.url());
      }
    });
    const types = picker(workspace(page), 'Typography the site shows');
    await reveal(types);
    const chosen = await checkedIn(types);
    // A self-hosted pack, whose web fonts a preview by pointing would have fetched.
    const web = types.locator('label[data-option]:has(img.studio-still)');
    const target = await web
      .evaluateAll(
        (labels, current) =>
          labels.map((label) => label.getAttribute('data-option')).find((id) => id !== current),
        chosen,
      )
      .then((id) => id!);
    const option = types.locator(`label[data-option="${target}"]`);
    await option.scrollIntoViewIfNeeded();
    await option.hover();
    // Longer than the 50ms settle a scheme's preview waits.
    await page.waitForTimeout(400);
    await expect(page.locator('.studio-split__intent')).toHaveCount(0);
    expect(await inFrame(page, 'data-typography')).toBe(chosen);
    expect(fonts).toEqual([]);
    const languages = picker(workspace(page), 'Design language the site shows');
    await reveal(languages);
    const language = languages.locator('label[data-option]:not(:has(> input:checked))').first();
    await language.scrollIntoViewIfNeeded();
    await language.hover();
    await page.waitForTimeout(400);
    await expect(page.locator('.studio-split__intent')).toHaveCount(0);
    expect(await same()).toBe(true);
    // A click commits the pack in place, and only then does the frame load its files.
    await reveal(types);
    await pick(types, target);
    await expect.poll(() => inFrame(page, 'data-typography')).toBe(target);
    await expect.poll(() => fonts.length).toBeGreaterThan(0);
    expect(await same()).toBe(true);
  },
);

/**
 * The palette check (P-5 item 6; A P2-A, C P1-3): the checked composition tile's ground, sampled
 * from the screen in its canvas margin rather than its slice's dominant colour (an ink hero board
 * there read as the ground), against the frame's ground, as an Oklab ΔE.
 */
async function groundsApart(page: Page): Promise<number> {
  const tile = workspace(page).locator(
    '.studio-picker--compositions label:has(> input:checked) svg.studio-thumb',
  );
  await expect(tile).toBeVisible();
  const [t, f] = await Promise.all([tile.boundingBox(), frameElement(page).boundingBox()]);
  const shot = decodePng(await page.screenshot());
  const at = (x: number, y: number) => pixel(shot, Math.round(y) * shot.width + Math.round(x));
  // 1.6 of the drawing's 136 units in from its left edge, past the 1px frame line: the margin
  // every thumbnail keeps as canvas. The frame's left margin, half way down, is its canvas too.
  const ground = at(t!.x + (1.6 * t!.width) / 136, t!.y + t!.height / 2);
  const frame = at(f!.x + 6, f!.y + f!.height / 2);
  return deltaEOk(ground, frame);
}

test(
  "the composition tiles are drawn in the frame's palette, by Oklab on their sampled grounds, in light and on a dark system, and the check fails on a real mismatch: the frame previewing a scheme the tiles aren't in",
  { annotation: [STUDIO] },
  async ({ page, app }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await open(page, app, 'Rowan Palette');
    const compositions = picker(workspace(page), 'Composition the site shows');
    await reveal(compositions);
    expect(await groundsApart(page)).toBeLessThanOrEqual(2);
    // A dark system, with the display mode at System: the frame turns dark, and so do the tiles.
    await page.emulateMedia({ colorScheme: 'dark' });
    await expect.poll(() => groundsApart(page)).toBeLessThanOrEqual(2);
    await page.emulateMedia({ colorScheme: 'light' });
    await expect.poll(() => groundsApart(page)).toBeLessThanOrEqual(2);
    // The proof: the frame previews a scheme by pointing while the tiles keep the chosen one. To
    // show both at once, the accordion's folds lose their shared name, so two stay open, on a
    // screen tall enough to hold both with no scroll between the pointer and the tile.
    await page.setViewportSize({ width: 1440, height: 2400 });
    await page.evaluate(() => {
      for (const fold of document.querySelectorAll('details.studio-split__fold')) {
        fold.removeAttribute('name');
      }
    });
    const schemes = picker(workspace(page), 'Color scheme the site shows');
    await workspace(page)
      .locator('section[data-section="colorScheme"] details.studio-split__fold')
      .evaluate((fold) => {
        (fold as HTMLDetailsElement).open = true;
      });
    // Under All, every character's chips are in the group.
    await workspace(page)
      .getByRole('group', { name: 'Scheme character' })
      .getByRole('button', { name: /^All/ })
      .click();
    const chosen = await checkedIn(schemes);
    // A dark-only scheme, as far from the light chosen one as the catalog goes.
    const target = (await optionsIn(schemes)).find((id) => id !== chosen && /oled|night/.test(id))!;
    const option = schemes.locator(`label[data-option="${target}"]`);
    await option.hover();
    await expect.poll(() => inFrame(page, 'data-color-scheme')).toBe(target);
    expect(await groundsApart(page)).toBeGreaterThan(2);
    await page.mouse.move(0, 0);
    await expect.poll(() => inFrame(page, 'data-color-scheme')).toBe(chosen);
    await expect.poll(() => groundsApart(page)).toBeLessThanOrEqual(2);
  },
);

test(
  'a new composition loads the frame once, with the override, comes back to its section, and Save draft is the one write',
  { annotation: [STUDIO] },
  async ({ page, app }) => {
    const draft = await open(page, app, 'Rowan Composition');
    const { writes, mints } = record(page);
    await page.evaluate(() => Object.assign(window, { kgnStayed: true }));
    const composition = picker(workspace(page), 'Composition the site shows');
    const target = (await optionsIn(composition)).find((value) => value !== 'editorial-evidence')!;
    await pick(composition, target);
    await expect
      .poll(() =>
        mints.some(
          (request) =>
            (request.postDataJSON() as { appearance?: { variant?: string } }).appearance
              ?.variant === target,
        ),
      )
      .toBe(true);
    await expect.poll(() => inFrame(page, 'data-variant')).toBe(target);
    await expect(frameElement(page)).toHaveAttribute(
      'sandbox',
      /^allow-scripts(?: allow-same-origin)?$/,
    );
    expect(await page.evaluate(() => (window as { kgnStayed?: boolean }).kgnStayed)).toBe(true);
    expect(writes).toEqual([]);
    await expect(line(page, 'Draft')).toHaveText(`Saved draft, version ${draft.version}.`);
    await page.getByRole('button', { name: 'Save draft' }).click();
    await expect(line(page, 'Draft')).toHaveText(`Saved draft, version ${draft.version + 1}.`);
    expect(writes).toEqual(['draft.applyEdits']);
  },
);

test(
  "the page switch takes the frame to the draft's case study and back home over #7's navigate, keeping the selection",
  { annotation: [STUDIO] },
  async ({ page, app }) => {
    await open(page, app, 'Rowan Pages');
    const pages = picker(previewPane(page), 'Page');
    await expect(optionsIn(pages)).resolves.toEqual(['home', 'work', 'case']);
    const route = async () => {
      const frame = await (await frameElement(page).elementHandle())?.contentFrame();
      return frame ? new URL(frame.url()).pathname : null;
    };
    const scheme = await inFrame(page, 'data-color-scheme');
    const caseStudy = pages.locator('label[data-option="case"] input');
    if (await caseStudy.isEnabled()) {
      await pick(pages, 'case');
      await expect.poll(route).toMatch(/\/work\/[a-z0-9-]+$/);
      await expect.poll(() => inFrame(page, 'data-color-scheme')).toBe(scheme);
      await pick(pages, 'home');
      await expect.poll(route).not.toMatch(/\/work\//);
    }
  },
);

test(
  "the bar's device widths set the frame's true width, scaled to fit and never cropped, and the rail resizes and collapses",
  { annotation: [STUDIO] },
  async ({ page, app }) => {
    await open(page, app, 'Rowan Widths');
    const widths = picker(previewPane(page), 'Device width');
    for (const [id, width] of [
      ['mobile', 390],
      ['tablet', 1024],
      ['desktop', 1440],
    ] as const) {
      await pick(widths, id);
      await expect(frameElement(page)).toHaveCSS('width', `${width}px`);
      const [frame, room] = await Promise.all([
        frameElement(page).boundingBox(),
        page.locator('.studio-split__stage').boundingBox(),
      ]);
      expect(frame!.x + frame!.width, id).toBeLessThanOrEqual(room!.x + room!.width + 1);
      expect(frame!.y + frame!.height, id).toBeLessThanOrEqual(room!.y + room!.height + 1);
    }
    // The rail's separator, by keyboard: wider, then remembered across a reload.
    const separator = page.getByRole('separator', { name: 'Controls width' });
    await separator.focus();
    await page.keyboard.press('End');
    await expect(separator).toHaveAttribute('aria-valuenow', '440');
    await page.reload();
    await openTask(page, 'Appearance');
    await expect(page.getByRole('separator', { name: 'Controls width' })).toHaveAttribute(
      'aria-valuenow',
      '440',
    );
    // Collapsed by its button, the preview takes the room.
    await page.getByRole('button', { name: 'Hide controls' }).click();
    await expect(page.locator('.studio-split__rail')).toBeHidden();
    await page.getByRole('button', { name: 'Show controls' }).click();
    await expect(page.locator('.studio-split__rail')).toBeVisible();
    await page.getByRole('separator', { name: 'Controls width' }).dblclick();
  },
);

test(
  'pickers are radio groups: one Tab stop each, arrows select and wrap, and Tab runs the rail, the bar, then the frame',
  { annotation: [STUDIO] },
  async ({ page, app }) => {
    await open(page, app, 'Rowan Keys');
    const composition = picker(workspace(page), 'Composition the site shows');
    // The arrows go round the ones the owner may pick, never a composition in progress.
    const values = await readyIn(composition);
    await composition.locator('input:checked').focus();
    await page.keyboard.press('ArrowLeft');
    // From the first option, the arrow wraps to the last.
    await expect.poll(() => checkedIn(composition)).toBe(values.at(-1));
    await page.keyboard.press('ArrowRight');
    await expect.poll(() => checkedIn(composition)).toBe(values[0]);
    // Tab leaves the group in one press.
    await page.keyboard.press('Tab');
    expect(await composition.evaluate((group) => group.contains(document.activeElement))).toBe(
      false,
    );
    // From the rail's last control, the separator, then the bar's device widths, then on to the frame.
    await page.getByRole('combobox', { name: 'Show a section in the preview' }).focus();
    const reached: string[] = [];
    for (let step = 0; step < 40; step += 1) {
      await page.keyboard.press('Tab');
      const now = await page.evaluate(() => {
        const element = document.activeElement;
        if (element?.tagName === 'IFRAME') return 'frame';
        if (element?.getAttribute('role') === 'separator') return 'separator';
        if (element?.closest('[aria-label="Device width"]')) return 'widths';
        return element?.tagName.toLowerCase() ?? '';
      });
      reached.push(now);
      if (now === 'frame') break;
    }
    const at = (what: string) => reached.indexOf(what);
    expect(at('separator')).toBeGreaterThanOrEqual(0);
    expect(at('separator')).toBeLessThan(at('widths'));
    expect(at('widths')).toBeLessThan(at('frame'));
    // Under every family chip, its own or another's, the checked one stays in the group,
    // checked, so it's still the Tab stop and no arrow press starts from nothing (M1).
    const chips = workspace(page)
      .getByRole('group', { name: 'Layout families, ready ones' })
      .getByRole('button');
    expect(await chips.count()).toBeGreaterThan(2);
    for (const chip of await chips.all()) {
      await chip.click();
      await expect(composition.locator('input:checked')).toHaveCount(1);
      expect(await checkedIn(composition)).toBe(values[0]);
    }
  },
);

test(
  'below 48rem the preview keeps the top of the screen and the rail is a bottom sheet of axis tabs, snapping at 25, 50 and 90%',
  { annotation: [STUDIO] },
  async ({ page, app }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await open(page, app, 'Rowan Sheet');
    const sheet = page.locator('.studio-split__rail');
    const tabs = page.getByRole('tablist', { name: 'Axes' });
    // Short tabs that all fit at 390 (the design director's ST-S5).
    await expect(tabs.getByRole('tab')).toHaveText(['Layout', 'Color', 'Type', 'Style', 'Mode']);
    // Opened from Content, whose split has no tabs, the sheet is on Layout with its controls.
    await expect(tabs.getByRole('tab', { name: 'Layout' })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    await expect(picker(page, 'Composition the site shows')).toBeVisible();
    // One 44px stage row, the device icons then the page switch; the scale is the menu's line (P1-1).
    const tools = (await page.locator('.studio-split__tools').boundingBox())!;
    expect(tools.height).toBeLessThanOrEqual(46);
    await expect(page.locator('.studio-split__tools .studio-split__scale')).toBeHidden();
    await page.getByRole('button', { name: 'More: tasks and sign out' }).click();
    await expect(page.locator('.studio-menu__note')).toHaveText(/^Shown at \d+%$/);
    await page.keyboard.press('Escape');
    await expect(page.getByRole('button', { name: 'Preview', exact: true })).toHaveCount(0);
    const frame = (await frameElement(page).boundingBox())!;
    expect(frame.y + frame.height).toBeLessThanOrEqual(48 + 44 + 844 * 0.55 + 2);
    const height = async () => Math.round((await sheet.boundingBox())!.height);
    await expect.poll(height).toBe(Math.round(844 * 0.45));
    const handle = page.getByRole('button', { name: /^Controls height/ });
    await handle.click();
    await expect.poll(height).toBe(Math.round(844 * 0.9));
    await handle.click();
    await expect.poll(height).toBe(Math.round(844 * 0.25));
    // A tab shows its axis, whose options scroll across; a tap commits.
    await tabs.getByRole('tab', { name: 'Color' }).click();
    await expect.poll(height).toBe(Math.round(844 * 0.45));
    const schemes = picker(page, 'Color scheme the site shows');
    await expect(schemes).toBeVisible();
    expect(await schemes.evaluate((group) => getComputedStyle(group).overflowX)).toBe('auto');
    const current = await checkedIn(schemes);
    const other = (await optionsIn(schemes)).find((value) => value !== current)!;
    await pick(schemes, other);
    await expect.poll(() => inFrame(page, 'data-color-scheme')).toBe(other);
    expect(await sheet.evaluate((element) => getComputedStyle(element).overscrollBehaviorY)).toBe(
      'contain',
    );
    expect((await axeFor(page).exclude('iframe').analyze()).violations).toEqual([]);
  },
);

test(
  'a phone on its side, at 844x390, has the phone layout: the frame on top over one stage row with no Motion, and the rail a sheet below (P1-3)',
  { annotation: [STUDIO] },
  async ({ page, app }) => {
    await page.setViewportSize({ width: 844, height: 390 });
    await open(page, app, 'Rowan Landscape');
    // Under 30rem of height the split is the phone's, whatever the width.
    await expect(page.locator('.studio-split')).toHaveAttribute('data-sheet', /^\d+$/);
    await expect(page.getByRole('tablist', { name: 'Axes' })).toBeVisible();
    await expect(page.locator('.studio-split__look')).toHaveCount(0);
    await expect(page.locator('.studio-split__motion')).toBeHidden();
    const tools = (await page.locator('.studio-split__tools').boundingBox())!;
    expect(tools.height).toBeLessThanOrEqual(46);
    // The frame on the phone preset, at its true width, above the sheet.
    const frame = (await frameElement(page).boundingBox())!;
    const sheet = (await page.locator('.studio-split__rail').boundingBox())!;
    expect(frame.width).toBeGreaterThanOrEqual(380);
    expect(frame.y).toBeLessThan(sheet.y);
  },
);

test(
  "at 200% text the look bar's names wrap whole rather than cut, and the open axis keeps its title",
  { annotation: [STUDIO] },
  async ({ page, app }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await open(page, app, 'Rowan Large');
    await page.addStyleTag({ content: 'html { font-size: 200% !important; }' });
    const names = page.locator('.studio-split__look-name');
    await expect(names.first()).toBeVisible();
    for (const name of await names.all()) {
      const text = await name.textContent();
      expect(
        await name.evaluate((element) => element.scrollWidth <= element.clientWidth + 1),
        `${text} is whole`,
      ).toBe(true);
    }
    // The head, which cuts what it can't hold: its room, not its title's own width.
    const head = page.locator('.studio-split__fold[open] .studio-split__section-head').first();
    expect((await head.boundingBox())!.width).toBeGreaterThan(80);
  },
);

test(
  "the workspace's Studio chrome passes axe, every control keeps its label, and the frame its name",
  { annotation: [STUDIO] },
  async ({ page, app }) => {
    await open(page, app, 'Rowan Axe');
    expect((await axeFor(page).exclude('iframe').analyze()).violations).toEqual([]);
    await expect(frameElement(page)).toHaveAttribute('title', /^Preview — not live, /);
    for (const name of [
      'Composition the site shows',
      'Color scheme the site shows',
      'Typography the site shows',
      'Design language the site shows',
      'Display mode the site shows',
      'Device width',
      'Preview motion',
    ]) {
      // Every picker is in the page; on wide screens the open axis shows, the rest behind their heads.
      await expect(picker(page, name)).toBeAttached();
    }
    await expect(page.getByRole('group', { name: 'The current look' })).toBeVisible();
    // At 1024 the rail narrows and the bars drop their labels: every target keeps its size.
    await page.setViewportSize({ width: 1024, height: 768 });
    expect((await axeFor(page).exclude('iframe').analyze()).violations).toEqual([]);
  },
);

/** A portfolio named `name` that opens on a hero, as the owner's does. */
const WITH_HERO = (name: string) =>
  `schemaVersion: 3\nlocale: en\ndirection: ltr\nidentity:\n  name: ${name}\n  tagline: Draws calm maps.\nsections:\n  - kind: hero\n    id: top\n    tagline: I build calm software.\n  - kind: lede\n    id: about\n    body: Hi from ${name}.\n`;

/**
 * Horizontal Cinema's title card in the frame: the card's clip-path and the
 * name's opacity as computed, the card's and the name's animations still to
 * finish, and the shell's runtime activity.
 */
async function titleCard(page: Page) {
  const frame = await (await frameElement(page).elementHandle())?.contentFrame();
  if (!frame) return null;
  return frame
    .evaluate(() => {
      const card = document.querySelector('.hc-card');
      const name = document.querySelector('.hc-card__name');
      if (!card || !name) return null;
      const unfinished = [card, name].flatMap((element) =>
        element.getAnimations().filter((animation) => animation.playState !== 'finished'),
      );
      return {
        activity: document.querySelector('.hc-shell')?.getAttribute('data-activity') ?? null,
        clipPath: getComputedStyle(card).clipPath,
        opacity: getComputedStyle(name).opacity,
        nameHeight: name.getBoundingClientRect().height,
        unfinished: unfinished.map((animation) => (animation as CSSAnimation).animationName),
      };
    })
    .catch(() => null);
}

for (const [width, height] of [
  [1440, 900],
  [390, 844],
] as const) {
  test(
    `at ${width}, Horizontal Cinema picked in a frame that isn't focused opens its title card whole, its name shown, while the runtime is paused (OWN-1)`,
    { annotation: [STUDIO] },
    async ({ page, app }) => {
      await page.setViewportSize({ width, height });
      // A hero, so the title card is the picture that opens from a slit with the name over it.
      const name = `Rowan Cinema ${width}`;
      await open(page, app, name, WITH_HERO(name));
      const composition = picker(page, 'Composition the site shows');
      // Every family: past 8 ready the picker opens on the checked one's (Print, here).
      await reveal(composition);
      await showAllFamilies(composition);
      expect(await readyIn(composition)).toContain('horizontal-cinema');
      // Picked in the rail, never a click into the stage, so the frame is visible and not focused.
      await pick(composition, 'horizontal-cinema');
      await expect.poll(() => inFrame(page, 'data-variant')).toBe('horizontal-cinema');
      await expect.poll(async () => (await titleCard(page)) !== null).toBe(true);
      await page.waitForTimeout(1_500);
      const card = await titleCard(page);
      // The paused context the defect needed: the shell's runtime holds, as #7's lifecycle says.
      expect(card?.activity).toBe('paused');
      // The one-shot opening still ran to its end: the card whole, the name at full opacity.
      expect(card?.unfinished).toEqual([]);
      expect(['none', 'inset(0px)']).toContain(card?.clipPath);
      expect(card?.opacity).toBe('1');
      expect(card?.nameHeight).toBeGreaterThan(0);
    },
  );
}

test(
  "in a frame that isn't focused, Kinetic Cosmos's ambient loops stay paused where they are (OWN-1)",
  { annotation: [STUDIO] },
  async ({ page, app }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await open(page, app, 'Rowan Orbits');
    const composition = picker(page, 'Composition the site shows');
    // Every family: past 8 ready the picker opens on the checked one's (Print, here).
    await reveal(composition);
    await showAllFamilies(composition);
    expect(await readyIn(composition)).toContain('kinetic-cosmos');
    await pick(composition, 'kinetic-cosmos');
    await expect.poll(() => inFrame(page, 'data-variant')).toBe('kinetic-cosmos');
    const loops = async () => {
      const frame = await (await frameElement(page).elementHandle())?.contentFrame();
      if (!frame) return null;
      return frame
        .evaluate(() => ({
          activity: document.querySelector('.kc-opening')?.getAttribute('data-activity') ?? null,
          loops: document
            .getAnimations()
            .filter(
              (animation) =>
                animation instanceof CSSAnimation &&
                animation.animationName.startsWith('kinetic-cosmos-') &&
                animation.effect?.getComputedTiming().endTime === Infinity,
            )
            .map((animation) => animation.playState),
        }))
        .catch(() => null);
    };
    // The loops this portfolio's orrery has are there under the kit's gate, and each one is held.
    const held = (state: Awaited<ReturnType<typeof loops>>) =>
      state?.activity === 'paused' &&
      state.loops.length > 0 &&
      state.loops.every((playState) => playState === 'paused');
    await expect.poll(async () => held(await loops())).toBe(true);
    await page.waitForTimeout(500);
    expect(await loops()).toMatchObject({ activity: 'paused' });
    expect(held(await loops())).toBe(true);
  },
);
