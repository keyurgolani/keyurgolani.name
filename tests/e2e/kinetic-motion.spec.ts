import { readFileSync } from 'node:fs';
import path from 'node:path';
import type { Page } from '@playwright/test';
import { fixtureSiteSelecting } from '../../packages/variant-contract/src/contract-fixtures';
import { contractFixture } from '../../packages/variant-contract/src/node/fixtures';
import { expect, test } from '../harness/fixtures';
import { loadHome, runningAnimations } from '../harness/motion';
import { scriptingMediaFindings } from '../quality/lib/a11y/conditions';

// Kinetic Cosmos's orrery (redesign, stream E), on #6's runtime, on the
// complete contract fixture: while the runtime is active the two orbit
// planes turn and the far stars drift, exactly three endless animations;
// reduced motion and a static environment are the still the server drew; a
// background tab, the stage offscreen, the visitor's pause, and hovering
// the orrery each hold them. The index opens from either trigger and gives
// focus back on Escape, the plates are real links with one tab stop between
// them, and the dock steps aside while the stage is in view, marks the ring
// you're in once it's gone, and never covers what has focus.

const FIXTURE = contractFixture('complete');
const DIR = path.dirname(FIXTURE.files.portfolio);
const READ_ONLY = { type: 'profile', description: 'read-only' };
const annotation = [{ type: 'route', description: '/' }, READ_ONLY];

test.use({
  appOptions: {
    portfolio: FIXTURE.files.portfolio,
    siteText: fixtureSiteSelecting(readFileSync(FIXTURE.files.site, 'utf8'), 'kinetic-cosmos'),
    sourceFiles: Object.fromEntries(
      FIXTURE.unitFiles.map((file) => [file, readFileSync(path.join(DIR, file), 'utf8')]),
    ),
  },
  viewport: { width: 1280, height: 800 },
});

/** The animations that run forever and are running now. */
async function endless(page: Page) {
  return (await runningAnimations(page)).filter((animation) => animation.endless);
}

// Plain boxes around still SVGs, moved by transform alone, so the compositor turns them (code review M1).
const THE_THREE = [
  { kind: 'css kinetic-cosmos-spin-inner', target: 'span.kc-spin' },
  { kind: 'css kinetic-cosmos-spin', target: 'span.kc-spin' },
  { kind: 'css kinetic-cosmos-drift', target: 'span.kc-sky__drift' },
];

/** What the stage says of its runtime. */
function stage(page: Page) {
  return page.evaluate(() => ({
    runtime: document.querySelector('.kc-opening')?.getAttribute('data-runtime') ?? null,
    activity: document.querySelector('.kc-opening')?.getAttribute('data-activity') ?? null,
  }));
}

async function load(page: Page): Promise<void> {
  await loadHome(page, '/');
  await expect(page.locator('[data-variant]')).toHaveAttribute('data-variant', 'kinetic-cosmos');
}

test(
  'running, the two orbit planes turn and the far stars drift: three transforms',
  { annotation },
  async ({ page }) => {
    await load(page);
    await expect.poll(() => stage(page)).toMatchObject({ runtime: 'active', activity: null });
    await expect
      .poll(async () => (await endless(page)).map(({ kind, target }) => ({ kind, target })))
      .toEqual(expect.arrayContaining(THE_THREE));
    expect(await endless(page)).toHaveLength(3);
    // The orrery is decoration, and every ring it stands for is a link beside it.
    await expect(page.locator('.kc-map__frame')).toHaveAttribute('aria-hidden', 'true');
    await expect(page.locator('.kc-plate__link')).not.toHaveCount(0);
  },
);

test('hovering the orrery holds the orbits where they are', { annotation }, async ({ page }) => {
  await load(page);
  await expect.poll(async () => (await endless(page)).length).toBe(3);
  const map = (await page.locator('.kc-map').boundingBox())!;
  await page.mouse.move(map.x + map.width * 0.7, map.y + map.height * 0.5);
  await expect.poll(async () => (await endless(page)).length).toBe(0);
  await page.mouse.move(2, 2);
  await expect.poll(async () => (await endless(page)).length).toBe(3);
});

test.describe('reduced motion', () => {
  test.use({ contextOptions: { reducedMotion: 'reduce' } });

  test(
    'the complete still: nothing runs, and the pause says why',
    { annotation },
    async ({ page }) => {
      await load(page);
      // Held still, the control stays, disabled, beside the status that says why (12b).
      await expect(page.locator('[data-motion-control] button')).toBeDisabled();
      await expect(page.locator('[data-motion-control] button')).toBeVisible();
      await expect(page.locator('[data-motion-control] [role="status"]')).toHaveText(
        'Held still: your device asks for less motion',
      );
      expect(await stage(page)).toMatchObject({ runtime: null });
      await page.waitForTimeout(500);
      expect(await runningAnimations(page)).toEqual([]);
      // The still is complete: the orrery, its plates, and the headline all show.
      await expect(page.locator('.kc-orrery')).toBeVisible();
      await expect(page.locator('h1')).toBeVisible();
    },
  );
});

test(
  'static: a preview environment going static stops it where it runs',
  { annotation },
  async ({ page }) => {
    await load(page);
    await expect.poll(async () => (await endless(page)).length).toBe(3);
    await page.evaluate(() =>
      document.querySelector('[data-variant]')!.setAttribute('data-motion', 'static'),
    );
    await expect.poll(() => stage(page)).toMatchObject({ runtime: null });
    expect(await endless(page)).toEqual([]);
  },
);

test('a background tab: hidden, every animation holds', { annotation }, async ({ page }) => {
  await load(page);
  await expect.poll(async () => (await endless(page)).length).toBe(3);
  await page.evaluate(() => {
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' });
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await expect.poll(() => stage(page)).toMatchObject({ runtime: 'paused', activity: 'paused' });
  expect(await endless(page)).toEqual([]);
});

test(
  'offscreen: scrolled past the stage, every animation holds, and the dock marks the ring',
  { annotation },
  async ({ page }) => {
    await load(page);
    await expect.poll(async () => (await endless(page)).length).toBe(3);
    // While the stage is in view, the dock is out of view and out of the tab order.
    await expect(page.locator('.kc-dock')).toBeHidden();
    await page
      .locator('.kc-ring')
      .nth(1)
      .evaluate((ring) => ring.scrollIntoView({ block: 'start' }));
    await expect.poll(() => stage(page)).toMatchObject({ runtime: 'paused', activity: 'paused' });
    expect(await endless(page)).toEqual([]);
    await expect(page.locator('.kc-dock')).toBeVisible();
    await expect(page.locator('.kc-dock [aria-current="location"]')).toHaveCount(1);
    // Back in view, it runs again.
    await page.evaluate(() => window.scrollTo(0, 0));
    await expect.poll(async () => (await endless(page)).length).toBe(3);
  },
);

test(
  'the pause: one control stops the orbits, says so, and starts them again',
  { annotation },
  async ({ page }) => {
    await load(page);
    await expect.poll(async () => (await endless(page)).length).toBe(3);
    const control = page.locator('[data-motion-control] button');
    await control.click();
    await expect(control).toHaveAttribute('aria-pressed', 'true');
    await expect(page.locator('[data-motion-control] [role="status"]')).toHaveText('Orbits paused');
    await expect.poll(() => stage(page)).toMatchObject({ runtime: 'paused' });
    expect(await endless(page)).toEqual([]);
    await control.click();
    await expect(control).toHaveAttribute('aria-pressed', 'false');
    await expect.poll(async () => (await endless(page)).length).toBe(3);
  },
);

test(
  'the index opens from the masthead, Escape closes it, and focus comes back',
  { annotation },
  async ({ page }) => {
    await load(page);
    const trigger = page.locator('.kc-masthead .kc-index-trigger');
    await trigger.focus();
    await page.keyboard.press('Enter');
    const dialog = page.locator('dialog.kc-index');
    await expect(dialog).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();
    await expect(trigger).toBeFocused();
    // A link inside closes it, then goes.
    await trigger.click();
    const link = dialog.locator('.kc-index__link').first();
    const href = await link.getAttribute('href');
    await link.click();
    await expect(dialog).toBeHidden();
    await expect(page).toHaveURL(new RegExp(`${href}$`));
  },
);

/** What has focus, by its classes and text. */
function focused(page: Page) {
  return page.evaluate(() => {
    const element = document.activeElement as HTMLElement | null;
    return {
      className: element?.className ?? '',
      text: element?.textContent?.trim().replace(/\s+/g, ' ') ?? '',
    };
  });
}

test(
  'the plates are one tab stop: arrows, Home, and End move between them, and Tab leaves',
  { annotation, tag: '@interaction' },
  async ({ page }) => {
    await load(page);
    const plates = page.locator('.kc-plate__link');
    const count = await plates.count();
    expect(count).toBeGreaterThan(1);
    await page.locator('.kc-masthead .kc-index-trigger').focus();
    await page.keyboard.press('Tab');
    await expect(plates.first()).toBeFocused();
    // Only the stop is in the tab order.
    expect(
      await plates.evaluateAll((links) => links.filter((link) => link.tabIndex === 0).length),
    ).toBe(1);
    await page.keyboard.press('ArrowDown');
    await expect(plates.nth(1)).toBeFocused();
    await page.keyboard.press('End');
    await expect(plates.nth(count - 1)).toBeFocused();
    await page.keyboard.press('Home');
    await expect(plates.first()).toBeFocused();
    await page.keyboard.press('ArrowDown');
    // Tab leaves the plates for what follows them, and Shift+Tab comes back to the last one used.
    await page.keyboard.press('Tab');
    expect((await focused(page)).className).not.toContain('kc-plate__link');
    await page.keyboard.press('Shift+Tab');
    await expect(plates.nth(1)).toBeFocused();
  },
);

test(
  'the dock opens the index too, and Escape gives focus back to it',
  { annotation, tag: '@interaction' },
  async ({ page }) => {
    await load(page);
    await page
      .locator('.kc-ring')
      .nth(1)
      .evaluate((ring) => ring.scrollIntoView({ block: 'start' }));
    const trigger = page.locator('.kc-dock .kc-index-trigger');
    await expect(trigger).toBeVisible();
    await trigger.focus();
    await page.keyboard.press('Enter');
    const dialog = page.locator('dialog.kc-index');
    await expect(dialog).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();
    await expect(trigger).toBeFocused();
  },
);

test(
  "an index link lands on its target: the opening's own sections bring the stage back into view",
  { annotation, tag: '@interaction' },
  async ({ page }) => {
    await load(page);
    await page
      .locator('.kc-ring')
      .nth(2)
      .evaluate((ring) => ring.scrollIntoView({ block: 'start' }));
    await page.locator('.kc-dock .kc-index-trigger').click();
    const dialog = page.locator('dialog.kc-index');
    await expect(dialog).toBeVisible();
    // Every link's target has a box to scroll to.
    const boxless = await dialog.locator('.kc-index__link').evaluateAll((links) =>
      links
        .map((link) => decodeURIComponent((link as HTMLAnchorElement).hash.slice(1)))
        .filter((id) => {
          const target = document.getElementById(id);
          return !target || target.getClientRects().length === 0;
        }),
    );
    expect(boxless).toEqual([]);
    const main = await page.locator('main').getAttribute('id');
    const core = dialog.locator(`.kc-index__link[href="#${main}"]`).first();
    await expect(core).toHaveCount(1);
    await core.click();
    await expect(dialog).toBeHidden();
    await expect(page.locator('.kc-opening')).toBeInViewport();
    await expect(page.locator('main')).toBeFocused();
  },
);

test(
  'the dock never covers what has focus: every stop below the stage clears it',
  { annotation, tag: '@interaction' },
  async ({ page }) => {
    await load(page);
    // From the first link after the stage, tab on, and check each focused box against the dock's.
    await page
      .locator('.kc-orbitals a')
      .first()
      .evaluate((link) => (link as HTMLElement).focus());
    const covered: string[] = [];
    for (let stop = 0; stop < 60; stop++) {
      await page.keyboard.press('Tab');
      const overlap = await page.evaluate(() => {
        const element = document.activeElement as HTMLElement | null;
        const dock = document.querySelector<HTMLElement>('.kc-dock');
        if (!element || !dock || dock.hidden || element.closest('.kc-dock')) return null;
        const a = element.getBoundingClientRect();
        const b = dock.getBoundingClientRect();
        const hit = a.bottom > b.top && a.top < b.bottom && a.right > b.left && a.left < b.right;
        return hit ? (element.textContent?.trim().slice(0, 40) ?? element.tagName) : null;
      });
      if (overlap) covered.push(overlap);
    }
    expect(covered).toEqual([]);
  },
);

test(
  'the home outline: the rest of the record is closed, and a link that names it opens it',
  { annotation, tag: '@interaction' },
  async ({ page }) => {
    await load(page);
    const folds = page.locator(
      '.kc-ring[data-ring="record"] details.kc-fold:not(.kc-fold--inline):not([open])',
    );
    expect(await folds.count()).toBeGreaterThan(0);
    const id = await folds.first().evaluate((details) => details.closest('section')!.id);
    await page.evaluate((target) => {
      window.location.hash = target;
    }, id);
    await expect(page.locator(`[id="${id}"] > details.kc-fold`)).toHaveAttribute('open', '');
    await expect(page.locator(`[id="${id}"]`)).toBeInViewport();
  },
);

test(
  'the outline opens only what an address names: #main opens nothing, a section opens just itself',
  { annotation, tag: '@interaction' },
  async ({ page }) => {
    await load(page);
    const open = page.locator('details.kc-fold[open]');
    const before = await open.count();
    await page.evaluate(() => {
      window.location.hash = 'main';
    });
    // Give the hashchange its turn, then nothing more is open (code review r2, N1).
    await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => resolve(null))));
    await expect(open).toHaveCount(before);
    const id = await page
      .locator('.kc-ring[data-ring="record"] details.kc-fold:not(.kc-fold--inline):not([open])')
      .first()
      .evaluate((details) => details.closest('section')!.id);
    await page.evaluate((target) => {
      window.location.hash = target;
    }, id);
    await expect(page.locator(`[id="${id}"] > details.kc-fold`)).toHaveAttribute('open', '');
    await expect(open).toHaveCount(before + 1);
  },
);

test(
  'a click beside the dock lands where it was aimed: the lift is for keyboard focus only',
  { annotation, tag: '@interaction' },
  async ({ page }) => {
    await load(page);
    // Well past the stage, so the dock stays in after the small scroll below.
    await page.evaluate(() => {
      const stage = document.querySelector('.kc-opening')!.getBoundingClientRect();
      window.scrollTo({
        top: stage.bottom + window.scrollY + 2 * window.innerHeight,
        behavior: 'instant',
      });
    });
    await expect(page.locator('.kc-dock')).toBeVisible();
    // A short link in view, clear above the dock.
    await page.evaluate(() => {
      const dock = document.querySelector<HTMLElement>('.kc-dock')!.getBoundingClientRect();
      const link = [...document.querySelectorAll<HTMLElement>('.kc-orbitals a')].find((element) => {
        const box = element.getBoundingClientRect();
        return box.height > 0 && box.height < 60 && box.top > 80 && box.bottom < dock.top - 40;
      });
      link?.setAttribute('data-kc-aim', '');
    });
    const link = page.locator('[data-kc-aim]');
    await expect(link).toHaveCount(1);
    // Put the link's top half above the dock and its bottom half under it, then click the top half.
    const point = await link.evaluate((element) => {
      const dock = document.querySelector<HTMLElement>('.kc-dock')!.getBoundingClientRect();
      const box = element.getBoundingClientRect();
      window.scrollBy({ top: box.top + box.height / 2 - dock.top, behavior: 'instant' });
      const moved = element.getBoundingClientRect();
      return { x: moved.left + Math.min(moved.width / 2, 24), y: moved.top + moved.height / 4 };
    });
    await page.evaluate(() => {
      const record = window as unknown as { kcClick?: { scrolled: number; hit: boolean } };
      const at = window.scrollY;
      document.addEventListener(
        'click',
        (event) => {
          event.preventDefault();
          const hit = (event.target as Element).closest('a');
          record.kcClick = {
            scrolled: window.scrollY - at,
            hit: hit?.hasAttribute('data-kc-aim') ?? false,
          };
        },
        { capture: true, once: true },
      );
    });
    await page.mouse.click(point.x, point.y);
    const clicked = await page.evaluate(
      () => (window as unknown as { kcClick?: { scrolled: number; hit: boolean } }).kcClick,
    );
    expect(clicked?.scrolled).toBe(0);
    expect(clicked?.hit).toBe(true);
  },
);

// The no-script styles key on main's noscript mark, an element only the parser makes, and only
// when it reads the page with scripting off (NoScriptMark), never on a scripting query, which the
// quality runner's no-JavaScript rows flip by auditing with script on for axe (their
// media-emulation record). Read with no script the mark is there and the no-script styles apply;
// with script it never is, so they never do.
test(
  "the no-script styles apply only where main's noscript mark is, and no stylesheet reads a scripting query",
  { annotation },
  async ({ page, browser }) => {
    await page.goto('/', { waitUntil: 'networkidle' });
    // The no-JavaScript row's own check, on the live page's stylesheets.
    expect(await scriptingMediaFindings(page)).toEqual([]);
    await expect(page.locator('[data-kc-nojs]')).toHaveCount(0);
    await expect(page.locator('.kc-pause')).toBeVisible();
    const context = await browser.newContext({
      javaScriptEnabled: false,
      baseURL: page.url(),
      viewport: { width: 1280, height: 800 },
    });
    try {
      const still = await context.newPage();
      await still.goto('/', { waitUntil: 'load' });
      await expect(still.locator('main.kc-main > noscript > [data-kc-nojs]')).toHaveCount(1);
      // Nothing turns, so there's nothing to pause.
      await expect(still.locator('.kc-pause')).toBeHidden();
      // The mark is never a box: main's first block starts where it did with script.
      const top = async (target: typeof page) =>
        target
          .locator('main.kc-main > .kc-opening')
          .evaluate((el) => el.getBoundingClientRect().top);
      expect(await top(still)).toBe(await top(page));
    } finally {
      await context.close();
    }
  },
);

// Without script nothing moves the dock aside, so a dock held at the viewport's foot sat over the
// arc stops the first screen shows: at 1024 x 768 the Work ring's three stops ran under it (the
// quality row's target-size records). Without script the dock is in the flow instead, after the
// page, and every stop link on the first screen is the topmost thing at its own centre.
test(
  'with no script, at 1024 by 768, no arc stop on the first screen is under the dock',
  { annotation },
  async ({ browser, page }) => {
    await page.goto('/', { waitUntil: 'networkidle' });
    const context = await browser.newContext({
      javaScriptEnabled: false,
      baseURL: page.url(),
      viewport: { width: 1024, height: 768 },
    });
    try {
      const still = await context.newPage();
      await still.goto('/', { waitUntil: 'load' });
      await expect(still.locator('main.kc-main > noscript > [data-kc-nojs]')).toHaveCount(1);
      const stops = await still.evaluate(() =>
        [...document.querySelectorAll<HTMLElement>('.kc-arc__stop a')].flatMap((link) => {
          const box = link.getBoundingClientRect();
          if (box.width === 0 || box.height === 0 || box.bottom <= 0 || box.top >= innerHeight)
            return [];
          const x = box.left + box.width / 2;
          const y = box.top + box.height / 2;
          const top = document.elementFromPoint(x, y);
          return [
            {
              link: (link.textContent ?? '').trim(),
              topmost: !!top && link.contains(top),
              under: top?.closest('.kc-dock') ? 'the dock' : null,
            },
          ];
        }),
      );
      // The first screen shows some: a pin over none would pass on any page.
      expect(stops.length).toBeGreaterThan(0);
      expect(stops.filter((stop) => !stop.topmost)).toEqual([]);
    } finally {
      await context.close();
    }
  },
);

// The dock leaves the viewport's foot only under the mark: with script there's no mark, the dock
// stays sticky at the foot (the runtime moves it aside while the stage is in view), and the
// scripted page is what it was.
test(
  'with script there is no noscript mark and the dock stays sticky; without, it is in the flow',
  { annotation },
  async ({ browser, page }) => {
    await page.goto('/', { waitUntil: 'networkidle' });
    await expect(page.locator('[data-kc-nojs]')).toHaveCount(0);
    expect(await page.locator('.kc-dock').evaluate((dock) => getComputedStyle(dock).position)).toBe(
      'sticky',
    );
    const context = await browser.newContext({
      javaScriptEnabled: false,
      baseURL: page.url(),
      viewport: { width: 1280, height: 800 },
    });
    try {
      const still = await context.newPage();
      await still.goto('/', { waitUntil: 'load' });
      await expect(still.locator('[data-kc-nojs]')).toHaveCount(1);
      expect(
        await still.locator('.kc-dock').evaluate((dock) => getComputedStyle(dock).position),
      ).toBe('static');
    } finally {
      await context.close();
    }
  },
);
