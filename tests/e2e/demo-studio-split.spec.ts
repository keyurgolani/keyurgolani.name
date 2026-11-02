import { fileURLToPath } from 'node:url';
import type { Page } from '@playwright/test';
import { expect, test } from '../harness/fixtures';
import { UPCOMING_COMPOSITIONS } from '../../packages/variant-contract/src/studio-catalog';
import { COMPOSITION_IDS } from '../../packages/variant-contract/src/ids';
import { COMPOSITION_STATUS } from '../../packages/variant-contract/src/status';
import { DEMO_APP } from '../harness/profile-matrix';
import {
  checkedIn,
  DEMO_FRAME,
  heldIn,
  openTask,
  optionsIn,
  pick,
  picker,
  reveal,
  showAllFamilies,
} from '../harness/studio-tasks';
import { axeFor } from '../quality/lib/axe';

// Demo Studio's Appearance workspace (owner direction, 2026-10-25; #9; the
// design dossier's part 3 and the Studio mockup): recipes and the pickers in
// a rail beside the frame, which follows each pick with no navigation and no
// Preview task, on a grey stage under a bar with the device widths, the
// scale, and motion, between a 48px top bar and a 40px bottom bar. The
// /sample frame takes a scheme, a typography, a design language, or a display
// mode over its channel, in the same document (DEM-2), and loads a new
// composition once a run of picks settles; /preview/local takes each over its
// channel, in the same document. Below
// 48rem the preview keeps the top of the screen and the rail is a sheet.

const DEMO = { type: 'profile', description: 'demo' };
const STUDIO = { type: 'route', description: '/studio' };

test.use({ appOptions: DEMO_APP });

const previewPane = (page: Page) => page.getByRole('region', { name: 'Preview', exact: true });
const composition = (page: Page) => picker(page, 'Composition');

async function open(page: Page): Promise<void> {
  const response = await page.goto('/studio');
  expect(response?.status()).toBe(200);
  await openTask(page, 'Appearance');
  await expect(
    page.getByRole('button', { name: 'Reset demo', includeHidden: true }).first(),
  ).toBeAttached();
}

/** A composition other than the one checked. */
async function another(page: Page): Promise<string> {
  const current = await checkedIn(composition(page));
  const other = (await optionsIn(composition(page))).find((value) => value !== current);
  expect(other, 'the build offers a second composition').toBeDefined();
  return other!;
}

test(
  'a composition still in progress is listed after the ready ones, held off as In progress, and no click, key, URL or recipe picks it (A2)',
  { annotation: [STUDIO, DEMO] },
  async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await open(page);
    const group = composition(page);
    // Under All, every family: with more than 8 ready the picker opens on the checked one's
    // family, where that family's ones in progress follow its drawings in the group.
    await reveal(group);
    await showAllFamilies(group);
    // The picker: its radio group, which holds the ready ones alone, so its checked radio is its
    // one Tab stop, then the ones in progress, behind their own disclosure after it.
    const box = page.locator('.studio-compositions').filter({ has: group });
    const listed = await optionsIn(box);
    const held = await heldIn(box);
    const ready = listed.filter((id) => !held.includes(id));
    expect(await optionsIn(group)).toEqual(ready);
    // Held: every composition the registry's status marks pending, and each of the program's
    // upcoming ones no package registers yet (P-5), read from the registry, so a registration
    // that moves one from upcoming to pending changes no line here. The program's whole list,
    // every first-party id and every upcoming one, is listed, so a new one adds no line either.
    const pending = Object.entries(COMPOSITION_STATUS)
      .filter(([, status]) => status === 'pending')
      .map(([id]) => id);
    const upcoming = UPCOMING_COMPOSITIONS.map(({ id }) => id).filter(
      (id) => !(id in COMPOSITION_STATUS),
    );
    const expected = [...new Set([...pending, ...upcoming])].sort();
    // Empty since Flux, the last first-party composition, flipped; a pending one fills it again.
    expect([...held].sort()).toEqual(expected);
    expect(listed).toHaveLength(
      new Set([...COMPOSITION_IDS, ...UPCOMING_COMPOSITIONS.map(({ id }) => id)]).size,
    );
    expect(listed).toEqual([...ready, ...held]);
    // The rail counts the ones that can be picked, by their status, not every one listed (S2).
    await expect(
      page
        .locator('.studio-split__section-head', { hasText: /^Composition/ })
        .locator('.studio-split__count'),
    ).toHaveText(String(ready.length));
    for (const id of held) {
      const card = box.locator(`label[data-option="${id}"]`);
      await expect(card.locator('input')).toBeDisabled();
      await expect(card.locator('.studio-choice__sub')).toHaveText('In progress');
      await expect(card.locator('svg')).toHaveCount(0);
    }
    const start = await checkedIn(group);
    // Under All, the ones in progress are behind one disclosure after the ready grid (A P1-1), and
    // with none in progress there's no disclosure at all.
    const later = box.locator('details.studio-later');
    // A registered one in progress, the one a click, a key or a URL tries to pick (none, once every
    // composition is ready).
    const tried = held.find((id) =>
      COMPOSITION_IDS.includes(id as (typeof COMPOSITION_IDS)[number]),
    );
    if (held.length === 0) {
      // Nothing is in progress (Flux, the last first-party composition, flipped), and no fixture or
      // opt-in can hold one without product code (COMPOSITION_STATUS is the platform's own table),
      // so the empty case is asserted outright: no In-progress disclosure, and every card ready.
      await expect(later).toHaveCount(0);
      await expect(box.locator('.studio-pending')).toHaveCount(0);
      await expect(box.locator('label[data-option] input:disabled')).toHaveCount(0);
      expect(listed).toEqual(ready);
    } else {
      await expect(later).not.toHaveAttribute('open', '');
      await expect(later.locator('summary')).toContainText(`In progress ${expected.length}`);
      await later.locator('summary').click();
      // A click, even one that goes through, leaves the checked one as it was.
      if (tried) {
        await box.locator(`label[data-option="${tried}"]`).click({ force: true });
        expect(await checkedIn(group)).toBe(start);
      }
    }
    // The arrows go round the ready ones alone.
    await group.locator('label:has(> input:checked) input').focus();
    for (let step = 0; step < listed.length; step += 1) {
      await page.keyboard.press('ArrowRight');
      expect(ready).toContain(await checkedIn(group));
    }
    // Neither do the recipes offer one: every recipe's composition is ready now (Shell's and
    // Neon Maker's Kinetic Cosmos), so all 9 of the file's 9.
    await expect(
      page
        .locator('.studio-split__section-head', { hasText: /recipe/i })
        .locator('.studio-split__count'),
    ).toHaveText('9');
    // A URL that names one in progress gets the sample's own composition.
    if (tried) {
      await page.goto(`/studio?variant=${tried}`);
      await openTask(page, 'Appearance');
      expect(await checkedIn(composition(page))).not.toBe(tried);
      await expect(previewPane(page).locator(DEMO_FRAME)).not.toHaveAttribute(
        'src',
        new RegExp(`[?&]variant=${tried}(?:&|$)`),
      );
    }
  },
);

test(
  'at 1440x900 the split starts under the 48px bar, the frame fills the rest above the bottom bar, and each pick shows in it with no navigation',
  { annotation: [STUDIO, DEMO] },
  async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await open(page);
    // The source menu's task links, behind its button in the top bar: no Preview task.
    await expect(page.locator('nav[aria-label="Studio tasks"] a')).toHaveText([
      'Appearance',
      'Content',
    ]);
    const rail = page.locator('.studio-split__rail');
    const [railBox, paneBox] = await Promise.all([
      rail.boundingBox(),
      previewPane(page).boundingBox(),
    ]);
    expect(railBox!.y).toBe(48);
    expect(paneBox!.x).toBeGreaterThanOrEqual(railBox!.x + railBox!.width - 1);
    expect(Math.round(paneBox!.y + paneBox!.height)).toBe(860);
    await expect(page.locator('.studio-split__bottom')).toContainText(
      'Demo sandbox. Only you can see these changes.',
    );
    expect(await page.evaluate(() => document.scrollingElement!.scrollHeight)).toBeLessThanOrEqual(
      900,
    );
    await expect(page.locator('select')).toHaveCount(0);
    const iframe = previewPane(page).locator(DEMO_FRAME);
    await expect(iframe).toHaveAttribute('src', /^\/sample\?/);
    await expect(previewPane(page).locator('.studio-split__scale')).toHaveText(/^Shown at \d+%$/);
    await page.evaluate(() => Object.assign(window, { kgnStayed: true }));
    for (let round = 0; round < 2; round += 1) {
      const next = await another(page);
      await pick(composition(page), next);
      await expect(iframe).toHaveAttribute('src', new RegExp(`[?&]variant=${next}(?:&|$)`));
      const frame = await (await iframe.elementHandle())?.contentFrame();
      await expect(frame!.locator('[data-variant]').first()).toHaveAttribute('data-variant', next);
    }
    expect(await page.evaluate(() => (window as { kgnStayed?: boolean }).kgnStayed)).toBe(true);
    expect(new URL(page.url()).pathname).toBe('/studio');
  },
);

test(
  'an imported pair in /preview/local follows each pick over its channel, in the same frame document',
  { annotation: [STUDIO, DEMO, { type: 'route', description: '/preview/local' }] },
  async ({ page }) => {
    await page.goto('/studio?task=content');
    await page
      .locator('#studio-demo-import')
      .setInputFiles([
        fileURLToPath(new URL('../../portfolio.example.yml', import.meta.url)),
        fileURLToPath(new URL('../../site.example.yml', import.meta.url)),
      ]);
    await expect(page.locator('[data-source="local"]')).toHaveCount(1);
    await openTask(page, 'Appearance');
    const stage = previewPane(page).locator('[data-source="local"]');
    await expect(stage).toHaveAttribute('data-phase', 'ready');
    const iframe = stage.locator(DEMO_FRAME);
    const element = await iframe.elementHandle();
    const src = await iframe.getAttribute('src');
    const documents: string[] = [];
    page.on('request', (request) => {
      if (request.resourceType() === 'document') documents.push(new URL(request.url()).pathname);
    });
    const next = await another(page);
    await pick(composition(page), next);
    const frame = await element!.contentFrame();
    await expect(frame!.locator('[data-variant]').first()).toHaveAttribute('data-variant', next);
    expect(await element!.evaluate((node) => node.isConnected)).toBe(true);
    expect(await iframe.getAttribute('src')).toBe(src);
    expect(documents).toEqual([]);
  },
);

/** Every request the page and its frames make for a /sample document, by path and query. */
function sampleDocuments(page: Page): string[] {
  const seen: string[] = [];
  page.on('request', (request) => {
    const url = new URL(request.url());
    if (request.resourceType() === 'document' && url.pathname.startsWith('/sample')) {
      seen.push(`${url.pathname}${url.search}`);
    }
  });
  return seen;
}

test(
  "on /sample a scheme, a typography and a display mode each show in the same document, its src, window and scroll kept and Cinema's opening not played again, and a composition loads a new one (DEM-2)",
  { annotation: [STUDIO, DEMO, { type: 'route', description: '/sample' }] },
  async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await open(page);
    const stage = previewPane(page).locator('.preview-surface__stage');
    const iframe = stage.locator(DEMO_FRAME);
    const boundary = previewPane(page).frameLocator(DEMO_FRAME).locator('[data-variant]').first();
    // Editorial Evidence, the owner's own look, which scrolls.
    if ((await checkedIn(composition(page))) !== 'editorial-evidence') {
      await pick(composition(page), 'editorial-evidence');
    }
    await expect(boundary).toHaveAttribute('data-variant', 'editorial-evidence');
    await expect(stage).toHaveAttribute('data-phase', 'ready');
    await expect(stage).toHaveAttribute('data-channel', 'open');
    // Each frame document has a nonce of its own in its fragment, which its agent takes out of
    // the URL as it reads it.
    const src = (await iframe.getAttribute('src'))!;
    expect(src).toMatch(/^\/sample\?[^#]*#nonce=[A-Za-z0-9_-]{22}$/);
    const element = (await iframe.elementHandle())!;
    const frame = (await element.contentFrame())!;
    expect(await frame.evaluate(() => location.hash)).toBe('');
    await frame.evaluate(() => {
      Object.assign(window, { kgnSameDocument: true });
      window.scrollTo({ top: 1400, behavior: 'instant' });
    });
    const scrolled = await frame.evaluate(() => window.scrollY);
    expect(scrolled).toBeGreaterThan(1000);
    const documents = sampleDocuments(page);

    const schemes = picker(page, 'Color scheme');
    const current = await checkedIn(schemes);
    const target = (await optionsIn(schemes)).find((id) => id !== current)!;
    await pick(schemes, target);
    await expect(boundary).toHaveAttribute('data-color-scheme', target);
    // A scheme moves no layout: the reader stays exactly where they were.
    expect(Math.abs((await frame.evaluate(() => window.scrollY)) - scrolled)).toBeLessThanOrEqual(
      2,
    );
    const top = () =>
      frame.evaluate(() => {
        const at = [...document.querySelectorAll('[data-section-id]')].find(
          (each) => each.getBoundingClientRect().bottom > 0,
        );
        return at?.getAttribute('data-section-id') ?? null;
      });
    const section = await top();
    expect(section).not.toBeNull();
    const types = picker(page, 'Typography');
    const typeNow = await checkedIn(types);
    const typeNext = (await optionsIn(types)).find((id) => id !== typeNow)!;
    await pick(types, typeNext);
    await expect(boundary).toHaveAttribute('data-typography', typeNext);
    // High contrast, which every scheme takes, so the pick is never refused.
    await pick(picker(page, 'Display mode'), 'high-contrast');
    await expect(boundary).toHaveAttribute('data-display-mode', 'high-contrast');
    // Past the settle a run of picks waits for: still the same document.
    await page.waitForTimeout(1500);
    expect(await element.evaluate((node) => node.isConnected)).toBe(true);
    expect(await iframe.getAttribute('src')).toBe(src);
    expect(
      await frame.evaluate(() => (window as { kgnSameDocument?: boolean }).kgnSameDocument),
    ).toBe(true);
    // A typography reflows the text, and the browser's scroll anchoring keeps the reader's
    // section in view: never back at the top.
    expect(await frame.evaluate(() => window.scrollY)).toBeGreaterThan(scrolled / 2);
    expect(await top()).toBe(section);
    // The scheme's own sheet, and no other, came in beside the document's.
    expect(
      await frame.evaluate(
        (id) =>
          [...document.querySelectorAll('link[rel~="stylesheet"]')].filter((link) =>
            new URL((link as HTMLLinkElement).href).pathname.startsWith(`/_portfolio/pack/${id}.`),
          ).length,
        target,
      ),
    ).toBe(1);
    expect(documents).toEqual([]);

    // Horizontal Cinema: its opening plays once, when it loads, and not again for a scheme.
    await pick(composition(page), 'horizontal-cinema');
    await expect(boundary).toHaveAttribute('data-variant', 'horizontal-cinema');
    await expect(stage).toHaveAttribute('data-channel', 'open');
    const cinema = (await (await iframe.elementHandle())!.contentFrame())!;
    expect(documents.length, 'a composition loads a new document').toBeGreaterThan(0);
    expect(
      await cinema.evaluate(() => (window as { kgnSameDocument?: boolean }).kgnSameDocument),
    ).toBeUndefined();
    // Once the opening has finished, the card is still, and its name shows.
    await expect
      .poll(() =>
        cinema.evaluate(
          () =>
            document
              .querySelector('.hc-card')
              ?.getAnimations({ subtree: true })
              .filter((animation) => animation.playState === 'running').length ?? -1,
        ),
      )
      .toBe(0);
    const loads = documents.length;
    const cinemaSrc = await iframe.getAttribute('src');
    const schemeNow = await checkedIn(schemes);
    const another = (await optionsIn(schemes)).find((id) => id !== schemeNow)!;
    await pick(schemes, another);
    await expect(boundary).toHaveAttribute('data-color-scheme', another);
    // Nothing on the card starts again: no animation runs there, and the name stays shown.
    const card = await cinema.evaluate(() => {
      const name = document.querySelector('.hc-card__name');
      return {
        running:
          document
            .querySelector('.hc-card')
            ?.getAnimations({ subtree: true })
            .filter((animation) => animation.playState === 'running').length ?? -1,
        opacity: name ? Number(getComputedStyle(name).opacity) : null,
      };
    });
    expect(card).toEqual({ running: 0, opacity: 1 });
    await page.waitForTimeout(1500);
    expect(await iframe.getAttribute('src')).toBe(cinemaSrc);
    expect(documents.length).toBe(loads);
  },
);

test(
  "the bar's device widths set the frame's true width, scaled to fit and never cropped, the rail's display mode and the bar's motion are segmented controls",
  { annotation: [STUDIO, DEMO] },
  async ({ page }) => {
    await open(page);
    const iframe = previewPane(page).locator(DEMO_FRAME);
    await expect(iframe).toHaveAttribute('src', /^\/sample\?/);
    const widths = picker(previewPane(page), 'Device width');
    for (const [id, width] of [
      ['tablet', 1024],
      ['mobile', 390],
      ['desktop', 1440],
    ] as const) {
      await pick(widths, id);
      await expect(iframe).toHaveCSS('width', `${width}px`);
      const [frame, room] = await Promise.all([
        iframe.boundingBox(),
        page.locator('.studio-split__stage').boundingBox(),
      ]);
      expect(frame!.x + frame!.width, id).toBeLessThanOrEqual(room!.x + room!.width + 1);
      expect(frame!.y + frame!.height, id).toBeLessThanOrEqual(room!.y + room!.height + 1);
    }
    await pick(picker(page, 'Display mode'), 'dark');
    // In place over the channel, or by a load where none is open yet (DEM-2): the frame shows it.
    await expect(
      previewPane(page).frameLocator(DEMO_FRAME).locator('[data-variant]').first(),
    ).toHaveAttribute('data-display-mode', 'dark');
    await expect(picker(previewPane(page), 'Motion')).toBeVisible();
  },
);

test(
  'at 390px the preview keeps the top of the screen, the sheet below has a tab per axis, and Show preview loads it in one press',
  { annotation: [STUDIO, DEMO] },
  async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await open(page);
    const tabs = page.getByRole('tablist', { name: 'Axes' });
    // Recipes first, as the wide index has them (the round 5b mockups); the sheet still opens on Layout.
    await expect(tabs.getByRole('tab')).toHaveText([
      'Recipes',
      'Layout',
      'Color',
      'Type',
      'Style',
      'Mode',
    ]);
    await expect(tabs.getByRole('tab', { name: 'Layout' })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    await expect(page.getByRole('button', { name: 'Preview', exact: true })).toHaveCount(0);
    // The frame waits to be asked for at a phone's width (#11's TBT budget), in the top of the screen.
    const ask = page.getByRole('button', { name: 'Show preview' });
    await expect(ask).toBeVisible();
    expect((await ask.boundingBox())!.y).toBeLessThan(844 * 0.6);
    await ask.click();
    await expect(previewPane(page).locator(DEMO_FRAME)).toHaveAttribute('src', /^\/sample\?/);
    await expect(previewPane(page).locator(DEMO_FRAME)).toBeVisible();
    expect((await axeFor(page).exclude('iframe').analyze()).violations).toEqual([]);
    // No sideways scroll at 390, around the sheet or the bar.
    expect(await page.evaluate(() => document.scrollingElement!.scrollWidth)).toBeLessThanOrEqual(
      390,
    );
  },
);

test(
  "the workspace's Studio chrome passes axe, every control keeps its label, and the frame its name",
  { annotation: [STUDIO, DEMO] },
  async ({ page }) => {
    await open(page);
    await expect(previewPane(page).locator(DEMO_FRAME)).toHaveAttribute('src', /^\/sample\?/);
    expect((await axeFor(page).exclude('iframe').analyze()).violations).toEqual([]);
    await expect(previewPane(page).locator(DEMO_FRAME)).toHaveAttribute('title', /^Demo sample, /);
    for (const name of [
      'Composition',
      'Color scheme',
      'Typography',
      'Design language',
      'Display mode',
    ]) {
      await expect(picker(page, name)).toBeAttached();
    }
  },
);
