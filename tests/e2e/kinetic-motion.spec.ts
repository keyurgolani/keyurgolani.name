import { readFileSync } from 'node:fs';
import path from 'node:path';
import type { Page } from '@playwright/test';
import { fixtureSiteSelecting } from '../../packages/variant-contract/src/contract-fixtures';
import { contractFixture } from '../../packages/variant-contract/src/node/fixtures';
import { expect, test } from '../harness/fixtures';
import { loadHome, runningAnimations } from '../harness/motion';

// Kinetic Cosmos's motion layer (#14), on #6's runtime, on the complete
// contract fixture: the orbit turns and the glyph field falls while the
// runtime is active, and each of the scope's inputs is tested on its own.
// Mouse: pointer movement brings back the receding chrome, and a drag turns
// the orbit and shows nothing new. Keyboard and touch: the chrome is there
// before any pointer moves. Reduced motion and a static environment: the
// still composition. A background tab, the opening offscreen, and the
// visitor's pause: every continuous source pauses. And on a large screen a
// fork or a join reaches the lane it names.

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

const THE_THREE = [
  { kind: 'css kinetic-cosmos-fall', target: 'div.kc-glyphs__layer.kc-glyphs__layer--far' },
  { kind: 'css kinetic-cosmos-fall', target: 'div.kc-glyphs__layer.kc-glyphs__layer--near' },
  { kind: 'css kinetic-cosmos-spin', target: 'div.kc-orbit__spin' },
];

/** What the stage and the chrome say of their runtimes. */
function stage(page: Page) {
  return page.evaluate(() => ({
    runtime: document.querySelector('.kc-opening')?.getAttribute('data-runtime') ?? null,
    activity: document.querySelector('.kc-opening')?.getAttribute('data-activity') ?? null,
    recede: document.querySelector('.kc-chrome')?.getAttribute('data-recede') ?? null,
  }));
}

/** The first section link's color, as it reads now. */
function linkColor(page: Page) {
  return page
    .locator('.kc-chrome__links [data-ui-slot="navigation.link"]')
    .first()
    .evaluate((link) => getComputedStyle(link).color);
}

/** Ends the wait and the easing of the chrome's recession, as passive viewing would. */
async function recede(page: Page): Promise<void> {
  const finished = await page.evaluate(() => {
    const running = document
      .getAnimations()
      .filter((animation) =>
        (animation as CSSAnimation).animationName?.startsWith('kinetic-cosmos-recede'),
      );
    for (const animation of running) animation.finish();
    return running.length;
  });
  expect(finished, 'the section links receding').toBeGreaterThan(0);
}

async function load(page: Page): Promise<void> {
  await loadHome(page, '/');
  await expect(page.locator('[data-variant]')).toHaveAttribute('data-variant', 'kinetic-cosmos');
}

test(
  'running, the orbit turns and the glyphs fall, three transforms on the runtime',
  { annotation },
  async ({ page }) => {
    await load(page);
    await expect.poll(() => stage(page)).toMatchObject({ runtime: 'active', activity: null });
    await expect
      .poll(async () => (await endless(page)).map(({ kind, target }) => ({ kind, target })))
      .toEqual(expect.arrayContaining(THE_THREE));
    expect(await endless(page)).toHaveLength(3);
    // A fixed number of glyphs, whatever the window, and none of them text.
    await expect(page.locator('.kc-glyph')).toHaveCount(48);
    expect(await page.locator('.kc-glyphs').evaluate((field) => field.textContent)).toBe('');
    await expect(page.locator('.kc-glyphs')).toHaveAttribute('aria-hidden', 'true');
  },
);

test(
  'keyboard: before any pointer moves, Tab reaches every section link, shown in full',
  { annotation },
  async ({ page }) => {
    await load(page);
    await expect.poll(() => stage(page)).toMatchObject({ recede: 'a' });
    const full = await linkColor(page);
    await recede(page);
    expect(await linkColor(page), 'receded').not.toBe(full);
    // Skip link, then the first section link: focus in the chrome brings it back.
    await page.keyboard.press('Tab');
    await page.keyboard.press('Tab');
    const first = page.locator('.kc-chrome__links [data-ui-slot="navigation.link"]').first();
    await expect(first).toBeFocused();
    await expect(first).toBeVisible();
    await expect.poll(() => linkColor(page)).toBe(full);
    // Every one of them is in the tab order.
    const links = await page.locator('.kc-chrome__links [data-ui-slot="navigation.link"]').count();
    for (let index = 1; index < links; index++) await page.keyboard.press('Tab');
    await expect(
      page.locator('.kc-chrome__links [data-ui-slot="navigation.link"]').last(),
    ).toBeFocused();
  },
);

test(
  'mouse: pointer movement brings the chrome back, and a drag turns the orbit and shows nothing new',
  { annotation },
  async ({ page }) => {
    await load(page);
    await expect.poll(() => stage(page)).toMatchObject({ runtime: 'active', recede: 'a' });
    const full = await linkColor(page);
    await recede(page);
    await page.mouse.move(640, 600);
    await expect.poll(() => linkColor(page)).toBe(full);

    const words = await page.locator('main').innerText();
    const orbit = (await page.locator('.kc-orbit').boundingBox())!;
    const center = { x: orbit.x + orbit.width / 2, y: orbit.y + orbit.height / 2 };
    // A quarter turn, from below the core to its inline start, both points the orbit's.
    const from = { x: center.x, y: center.y + orbit.height * 0.3 };
    const to = { x: center.x - orbit.width * 0.3, y: center.y };
    for (const point of [from, to]) {
      expect(
        await page.evaluate(
          ({ x, y }) => Boolean(document.elementFromPoint(x, y)?.closest('.kc-orbit')),
          point,
        ),
        `the orbit at ${point.x}, ${point.y}`,
      ).toBe(true);
    }
    await page.mouse.move(from.x, from.y);
    await page.mouse.down();
    await page.mouse.move(to.x, to.y, { steps: 8 });
    await page.mouse.up();
    const turned = await page.locator('.kc-orbit__turn').evaluate((turn) => turn.style.transform);
    expect(turned).toMatch(/^rotate\(-?\d/);
    expect(turned).not.toBe('rotate(0.00deg)');
    // Decoration only: every word is where it was.
    expect(await page.locator('main').innerText()).toBe(words);
  },
);

test.describe('touch', () => {
  test.use({ hasTouch: true, viewport: { width: 1024, height: 768 } });

  test(
    'a touch brings the chrome back, and its links work with no pointer',
    { annotation },
    async ({ page }) => {
      await load(page);
      await expect.poll(() => stage(page)).toMatchObject({ recede: 'a' });
      const full = await linkColor(page);
      await recede(page);
      await page.touchscreen.tap(900, 700);
      await expect.poll(() => linkColor(page)).toBe(full);
      const link = page.locator('.kc-chrome__links [data-ui-slot="navigation.link"]').first();
      const href = await link.getAttribute('href');
      await link.tap();
      await expect(page).toHaveURL(new RegExp(`${href}$`));
    },
  );
});

test.describe('reduced motion', () => {
  test.use({ contextOptions: { reducedMotion: 'reduce' } });

  test(
    'the still composition: nothing runs, nothing recedes, and the pause says why',
    { annotation },
    async ({ page }) => {
      await load(page);
      await expect(page.locator('[data-motion-control] button')).toBeDisabled();
      await expect(page.locator('[data-motion-control] [role="status"]')).toHaveText(
        'Reduced by system',
      );
      expect(await stage(page)).toMatchObject({ runtime: null, recede: null });
      await expect(page.locator('.kc-glyphs')).toBeHidden();
      await page.waitForTimeout(500);
      expect(await runningAnimations(page)).toEqual([]);
    },
  );
});

test(
  'static: a preview environment going static stops it where it runs, and the orbit goes back',
  { annotation },
  async ({ page }) => {
    await load(page);
    await expect.poll(async () => (await endless(page)).length).toBe(3);
    await page.locator('.kc-orbit__turn').evaluate((turn) => {
      (turn as HTMLElement).style.transform = 'rotate(40deg)';
    });
    await page.evaluate(() =>
      document.querySelector('[data-variant]')!.setAttribute('data-motion', 'static'),
    );
    await expect.poll(() => stage(page)).toMatchObject({ runtime: null, recede: null });
    await expect(page.locator('.kc-glyphs')).toBeHidden();
    expect(await endless(page)).toEqual([]);
    expect(
      await page
        .locator('.kc-orbit__turn')
        .evaluate((turn) => (turn as HTMLElement).style.transform),
    ).toBe('');
  },
);

test(
  'a background tab: hidden, every animation holds and the chrome stays',
  { annotation },
  async ({ page }) => {
    await load(page);
    await expect.poll(async () => (await endless(page)).length).toBe(3);
    await page.evaluate(() => {
      Object.defineProperty(document, 'visibilityState', {
        configurable: true,
        get: () => 'hidden',
      });
      document.dispatchEvent(new Event('visibilitychange'));
    });
    await expect
      .poll(() => stage(page))
      .toMatchObject({ runtime: 'paused', activity: 'paused', recede: null });
    expect(await endless(page)).toEqual([]);
  },
);

test(
  'offscreen: scrolled past the opening, every animation holds',
  { annotation },
  async ({ page }) => {
    await load(page);
    await expect.poll(async () => (await endless(page)).length).toBe(3);
    await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
    await expect.poll(() => stage(page)).toMatchObject({ runtime: 'paused', activity: 'paused' });
    expect(await endless(page)).toEqual([]);
    // Back in view, it runs again.
    await page.evaluate(() => window.scrollTo(0, 0));
    await expect.poll(async () => (await endless(page)).length).toBe(3);
  },
);

test(
  'the pause: one control stops every continuous source, says so, and keeps the chrome back',
  { annotation },
  async ({ page }) => {
    await load(page);
    await expect.poll(async () => (await endless(page)).length).toBe(3);
    const control = page.locator('[data-motion-control] button');
    await control.click();
    await expect(control).toHaveAttribute('aria-pressed', 'true');
    await expect(page.locator('[data-motion-control] [role="status"]')).toHaveText(
      'Motion is paused.',
    );
    await expect.poll(() => stage(page)).toMatchObject({ runtime: 'paused', recede: null });
    expect(await endless(page)).toEqual([]);
    await control.click();
    await expect(control).toHaveAttribute('aria-pressed', 'false');
    await expect.poll(async () => (await endless(page)).length).toBe(3);
  },
);

test(
  'on a large screen, a fork or a join reaches the rail of the lane it names',
  { annotation },
  async ({ page }) => {
    await load(page);
    const reaches = await page.evaluate(() =>
      [...document.querySelectorAll<HTMLElement>('.kc-chronology > li[data-lane]')].flatMap(
        (entry) => {
          const list = entry.parentElement!;
          const rail = (lane: string) => {
            const other = list.querySelector<HTMLElement>(`:scope > li[data-lane='${lane}']`);
            return other ? other.getBoundingClientRect().left : null;
          };
          const box = entry.getBoundingClientRect();
          const border = parseFloat(getComputedStyle(entry).borderInlineStartWidth);
          return (
            [
              ['::before', entry.dataset.branchesFromLane],
              ['::after', entry.dataset.mergesIntoLane],
            ] as const
          ).flatMap(([pseudo, lane]) => {
            if (lane === undefined || lane === entry.dataset.lane) return [];
            const style = getComputedStyle(entry, pseudo);
            const start = box.left + border + parseFloat(style.left);
            const end = start + parseFloat(style.width);
            const target = rail(lane);
            const line = parseFloat(style.borderBlockStartWidth);
            return [{ lane: entry.dataset.lane, to: lane, start, end, target, border, line }];
          });
        },
      ),
    );
    expect(reaches.length, 'forks and joins on the complete fixture').toBeGreaterThan(0);
    for (const reach of reaches) {
      expect(reach.target, `lane ${reach.to} has an entry`).not.toBeNull();
      // Toward the start it ends at the entry's own rail and starts at the other's;
      // toward the end it starts at the entry's far edge and ends at the other's rail.
      const [near, far] =
        Number(reach.to) < Number(reach.lane)
          ? [reach.start, reach.target!]
          : [reach.end, reach.target!];
      // A border token is a whole border, so the rails' width is its own: each lane
      // crossed, and the entry's own, can put the end that far from the rail.
      const lanes = Math.abs(Number(reach.to) - Number(reach.lane));
      expect(Math.abs(near - far), JSON.stringify(reach)).toBeLessThanOrEqual(
        (lanes + 1) * reach.border + 1,
      );
      // And it shows: a line the design language's card border draws.
      expect(reach.line, JSON.stringify(reach)).toBeGreaterThan(0);
      expect(reach.end - reach.start, JSON.stringify(reach)).toBeGreaterThan(reach.border);
    }
  },
);
