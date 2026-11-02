import { contractFixture } from '../../packages/variant-contract/src/node/fixtures';
import type { Page } from '@playwright/test';
import { expect, test } from '../harness/fixtures';
import { appFor } from './flux-shared';

// Flux's wipe between home and a work's own page (FX-M5), the first browser
// proof of K-4 (a)'s cross-document view transitions: following a link from
// one to the other runs a view transition, and under no-preference Flux's
// curtain, flux-wipe, pours its ink across the window (a clip-path
// animation on its new image), both ways; following the link, the first ink
// has covered the page being left before it goes, and the old curtain holds
// that ink over the host's crossfade, so the two pages never show at once. Under reduced motion the host
// stills it: nothing on the curtain animates, and every view-transition
// animation that runs changes opacity alone. On the complete fixture, under
// read-only.

const annotation = [
  { type: 'route', description: '/' },
  { type: 'route', description: '/work/[slug]' },
  { type: 'profile', description: 'read-only' },
];

test.use({
  viewport: { width: 1440, height: 900 },
  appOptions: appFor(contractFixture('complete')),
});

interface Seen {
  readonly has: boolean;
  /** Whether the page left was under the first ink when it went (data-fx-wipe, at pageswap). */
  readonly covered?: string | null;
  /** Whether the transition that revealed this page has finished. */
  readonly done?: boolean;
  readonly anims?: readonly {
    readonly pseudo: string;
    readonly name: string;
    readonly props: readonly string[];
  }[];
}

/** Records, on each page the tab reveals, its view transition and the animations it runs. */
async function watch(page: Page) {
  await page.addInitScript(() => {
    const seen: { has: boolean; covered?: string | null; done?: boolean; anims?: unknown[] } = {
      has: false,
      covered: sessionStorage.getItem('fx-covered'),
    };
    (window as unknown as { __fxSeen: typeof seen }).__fxSeen = seen;
    // Each page's swap and reveal, for a failure to say what the browser did.
    const note = (what: string) =>
      sessionStorage.setItem(
        'fx-log',
        `${sessionStorage.getItem('fx-log') ?? ''}${Date.now() % 100_000} ${location.pathname} ${what}; `,
      );
    addEventListener('click', () => note('press'), true);
    (
      window as unknown as {
        navigation: {
          addEventListener(
            type: 'navigate',
            listener: (
              event: Event & { navigationType: string; destination: { sameDocument: boolean } },
            ) => void,
          ): void;
        };
      }
    ).navigation.addEventListener('navigate', (event) => {
      if (!event.destination.sameDocument) note(`navigate ${event.navigationType}`);
    });
    // Whether this document has opted in to cross-document transitions yet.
    const optedIn = () =>
      [...document.styleSheets].some((sheet) => {
        try {
          return [...sheet.cssRules].some((rule) => rule.cssText.startsWith('@view-transition'));
        } catch {
          return false;
        }
      });
    addEventListener('pageswap', (event) => {
      const swap = event as Event & {
        viewTransition?: ViewTransition | null;
        activation?: { navigationType?: string } | null;
      };
      note(
        `pageswap ${swap.activation === null ? 'null' : (swap.activation?.navigationType ?? 'undefined')} vt=${Boolean(swap.viewTransition)} wipe=${document.querySelector<HTMLElement>('.fx')?.dataset.fxWipe ?? 'none'}`,
      );
      swap.viewTransition?.ready.catch((error: Error) =>
        note(`old ready rejected ${error.name}: ${error.message}`),
      );
      const curtain = document.querySelector('.fx-wipe');
      const covered =
        document.querySelector<HTMLElement>('.fx')?.dataset.fxWipe === 'pour' &&
        curtain !== null &&
        getComputedStyle(curtain).clipPath === 'ellipse(140% 140% at 50% 100%)';
      sessionStorage.setItem('fx-covered', String(covered));
    });
    addEventListener('pagereveal', (event) => {
      const transition = (event as Event & { viewTransition?: ViewTransition | null })
        .viewTransition;
      note(
        `pagereveal vt=${Boolean(transition)} optin=${optedIn()} hash=${location.hash} ready=${document.readyState}`,
      );
      if (!transition) return;
      seen.has = true;
      const end = () => {
        seen.done = true;
        note('finished');
      };
      transition.finished.then(end, end);
      transition.ready.then(
        () => {
          seen.anims = document
            .getAnimations()
            .filter((animation) =>
              (animation.effect as KeyframeEffect | null)?.pseudoElement?.startsWith(
                '::view-transition',
              ),
            )
            .map((animation) => {
              const effect = animation.effect as KeyframeEffect;
              const props = new Set(
                effect
                  .getKeyframes()
                  .flatMap((frame) => Object.keys(frame))
                  .filter(
                    (key) => !['offset', 'computedOffset', 'easing', 'composite'].includes(key),
                  ),
              );
              return {
                pseudo: effect.pseudoElement,
                name: (animation as CSSAnimation).animationName ?? '',
                props: [...props],
              };
            });
        },
        () => (seen.anims = []),
      );
    });
  });
}

const seen = (page: Page) =>
  page.evaluate(() => (window as unknown as { __fxSeen: Seen }).__fxSeen);

/** Home, then a work's own page by the first link to one. */
async function there(page: Page) {
  await page.goto('/', { waitUntil: 'networkidle' });
  await page.locator('main a[href*="/work/"]').first().click();
  await page.waitForURL((url) => url.pathname.startsWith('/work/'));
}

test(
  'under no-preference the curtain pours its ink between home and a work, both ways',
  { annotation },
  async ({ page }) => {
    await watch(page);
    await there(page);
    await expect.poll(() => seen(page).then((s) => s.anims?.length ?? -1)).toBeGreaterThan(0);
    let state = await seen(page);
    expect(state.has).toBe(true);
    const pour = (s: Seen) =>
      s.anims?.find((each) => each.pseudo === '::view-transition-new(flux-wipe)');
    const hold = (s: Seen) =>
      s.anims?.find((each) => each.pseudo === '::view-transition-old(flux-wipe)');
    expect(pour(state)?.name).toBe('flux-wipe-pour');
    expect(pour(state)?.props).toContain('clipPath');
    expect(hold(state)?.name).toBe('flux-wipe-hold');
    // The link went at once (pour-first is off, POUR_FIRST): the page left was never under the
    // ink before it went, and the ink plays and clears on the new page.
    expect(state.covered).toBe('false');
    // And back: the way on returns to the sheet that lists the work. Pressed once the arrival's
    // transition is done: a press while it still runs gets no transition (the browser drops it),
    // which isn't what this checks.
    await expect.poll(() => seen(page).then((s) => s.done === true)).toBe(true);
    await page.locator('.fx-case__back a').click();
    await page.waitForURL((url) => url.pathname === '/');
    await expect
      .poll(() => seen(page).then((s) => s.anims?.length ?? -1))
      .toBeGreaterThan(0)
      .catch(async (error: Error) => {
        const log = await page.evaluate(() => sessionStorage.getItem('fx-log'));
        throw new Error(`${error.message}\nswaps and reveals: ${log}`);
      });
    state = await seen(page);
    expect(pour(state)?.name).toBe('flux-wipe-pour');
    expect(state.covered).toBe('false');
  },
);

test(
  'under reduced motion the transition is an opacity crossfade alone, the curtain still',
  { annotation },
  async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await watch(page);
    await there(page);
    await expect.poll(() => seen(page).then((s) => s.anims !== undefined)).toBe(true);
    const state = await seen(page);
    expect(state.has).toBe(true);
    expect(state.anims!.length).toBeGreaterThan(0);
    expect(state.anims!.filter((each) => each.name === 'flux-wipe-pour')).toEqual([]);
    for (const each of state.anims!)
      expect(each.props, `${each.pseudo} ${each.name}`).toEqual(['opacity']);
  },
);

// The lead's limits on the pour before the page goes (2026-11-01), each held here.

/** Records, across the navigation, when the link was pressed and when the navigation started, and whether the page was under the ink then. */
async function timing(page: Page) {
  await page.addInitScript(() => {
    const w = window as unknown as { __fxTask?: string };
    const count = (key: string) =>
      sessionStorage.setItem(key, String(Number(sessionStorage.getItem(key) ?? 0) + 1));
    const press = () => {
      sessionStorage.setItem('fx-click-at', String(Date.now()));
      // The press's own task: a navigation that starts before this timer runs had no wait at all.
      w.__fxTask = 'press';
      setTimeout(() => (w.__fxTask = 'later'), 0);
    };
    document.addEventListener('click', press, true);
    // On window, bubbling: after every handler on the page, so it reads whether one prevented it.
    addEventListener('click', (event) =>
      sessionStorage.setItem(
        'fx-prevented',
        `${sessionStorage.getItem('fx-prevented') ?? ''}${String(event.defaultPrevented)},`,
      ),
    );
    // When a navigation to another document starts (the Navigation API's navigate event), not
    // when the next page answers: a slow answer is after the pour, and may keep the ink. The
    // same-document ones (the host's replaceState on every page) aren't leavings.
    (
      window as unknown as {
        navigation: {
          addEventListener(
            type: 'navigate',
            listener: (event: Event & { destination: { sameDocument: boolean } }) => void,
          ): void;
        };
      }
    ).navigation.addEventListener('navigate', (event) => {
      if (event.destination.sameDocument) return;
      count('fx-navs');
      sessionStorage.setItem('fx-swap-at', String(Date.now()));
      sessionStorage.setItem('fx-nav-sync', String(w.__fxTask === 'press'));
      sessionStorage.setItem(
        'fx-swap-wipe',
        document.querySelector<HTMLElement>('.fx')?.dataset.fxWipe ?? 'none',
      );
    });
    // How many times the page was marked for the pour, and the name the ink showed, if any.
    addEventListener('DOMContentLoaded', () => {
      const fx = document.querySelector<HTMLElement>('.fx');
      const curtain = document.querySelector<HTMLElement>('.fx-wipe');
      if (!fx || !curtain) return;
      let marked = fx.hasAttribute('data-fx-wipe');
      new MutationObserver(() => {
        const now = fx.hasAttribute('data-fx-wipe');
        if (now && !marked) count('fx-marks');
        marked = now;
        if (curtain.dataset.fxTo) {
          sessionStorage.setItem('fx-to', curtain.dataset.fxTo);
          sessionStorage.setItem(
            'fx-to-shown',
            getComputedStyle(curtain, '::after').content.replace(/^"|"$/g, ''),
          );
        }
      }).observe(fx, {
        attributes: true,
        subtree: true,
        attributeFilter: ['data-fx-wipe', 'data-fx-to'],
      });
    });
  });
}

const went = (page: Page) =>
  page.evaluate(() => ({
    held:
      Number(sessionStorage.getItem('fx-swap-at')) - Number(sessionStorage.getItem('fx-click-at')),
    wipe: sessionStorage.getItem('fx-swap-wipe'),
    marks: Number(sessionStorage.getItem('fx-marks') ?? 0),
    navs: Number(sessionStorage.getItem('fx-navs') ?? 0),
    sync: sessionStorage.getItem('fx-nav-sync'),
    // The first press's: a second one, while the page goes, is held (prevented) on purpose.
    prevented: (sessionStorage.getItem('fx-prevented') ?? '').split(',')[0] ?? '',
    to: sessionStorage.getItem('fx-to'),
    shown: sessionStorage.getItem('fx-to-shown'),
  }));

const wiped = (page: Page) =>
  page.locator('.fx').evaluate((el) => (el as HTMLElement).dataset.fxWipe ?? null);

const firstWork = (page: Page) => page.locator('main a[href*="/work/"]').first();

/** The first press went at once: not prevented, its navigation started in the press's own task. */
function atOnce(state: { prevented: string; sync: string | null }) {
  expect(state.prevented, 'the press was prevented').toBe('false');
  expect(state.sync, 'the navigation waited').toBe('true');
}

// Pour-first is off (POUR_FIRST, the lead's fallback 2026-11-01): it's on post-surge.md under E,
// with its open cause: from a page a transition revealed, the browser dropped the next transition
// two times in three. Its own tests wait here as fixme: the cap on the hold, and the title on it.
test.fixme(
  'the pour holds the page 250ms at most, whatever its animation does',
  {
    annotation: [
      ...annotation,
      { type: 'fixme', description: 'pour-first is off (POUR_FIRST): post-surge.md 16b' },
    ],
  },
  async ({ page }) => {
    await timing(page);
    await page.goto('/', { waitUntil: 'networkidle' });
    // A pour that would take five seconds: the page goes at the cap.
    await page.addStyleTag({ content: '.fx-wipe { animation-duration: 5s !important; }' });
    await firstWork(page).click();
    await page.waitForURL((url) => url.pathname.startsWith('/work/'));
    const { held, wipe } = await went(page);
    expect(wipe).toBe('pour');
    expect(held).toBeLessThanOrEqual(250 + 150);
  },
);

test.fixme(
  'on a slow answer, after a moment the ink says where it is going (R2)',
  {
    annotation: [
      ...annotation,
      { type: 'fixme', description: 'pour-first is off (POUR_FIRST): post-surge.md 16b' },
    ],
  },
  async ({ page }) => {
    await timing(page);
    await page.goto('/', { waitUntil: 'networkidle' });
    const link = firstWork(page);
    const href = (await link.getAttribute('href'))!;
    const title = ((await link.textContent()) ?? '').replace(/\s+/g, ' ').trim().slice(0, 80);
    await page.route(`**${href}`, async (route) => {
      await new Promise((resolve) => setTimeout(resolve, 2500));
      await route.continue();
    });
    await link.click({ noWaitAfter: true });
    // Read on the next page, from what the page being left recorded: nothing is evaluated in it
    // while it waits on the answer.
    await page.waitForURL((url) => url.pathname.startsWith('/work/'), { timeout: 15_000 });
    const { to, shown } = await went(page);
    expect(to).toBe(title);
    expect(shown).toBe(title);
  },
);

test(
  'under reduced motion the page goes with no wait at all: the click not prevented, the page never marked',
  { annotation },
  async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await timing(page);
    await page.goto('/', { waitUntil: 'networkidle' });
    await firstWork(page).click();
    await page.waitForURL((url) => url.pathname.startsWith('/work/'));
    const state = await went(page);
    // The owner's promise: no delay. The click isn't prevented or deferred, the navigation starts
    // in the press's own task, and the page is never marked.
    atOnce(state);
    expect(state.wipe).toBe('none');
    expect(state.marks).toBe(0);
    expect(state.navs).toBe(1);
  },
);

test(
  'a click on a link goes at once, with no delay, at full motion too',
  { annotation },
  async ({ page }) => {
    await timing(page);
    await page.goto('/', { waitUntil: 'networkidle' });
    await firstWork(page).click();
    await page.waitForURL((url) => url.pathname.startsWith('/work/'));
    const state = await went(page);
    atOnce(state);
    expect(state.marks).toBe(0);
    expect(state.navs).toBe(1);
  },
);

test('Enter on a link goes as a click does, at once', { annotation }, async ({ page }) => {
  await timing(page);
  await page.goto('/', { waitUntil: 'networkidle' });
  await firstWork(page).focus();
  await page.keyboard.press('Enter');
  await page.waitForURL((url) => url.pathname.startsWith('/work/'));
  const state = await went(page);
  atOnce(state);
  expect(state.marks).toBe(0);
  expect(state.navs).toBe(1);
});

test(
  "a modifier click, a middle click and a link to another window stay the browser's own, with no wipe",
  { annotation },
  async ({ page, context }) => {
    await page.goto('/', { waitUntil: 'networkidle' });
    const link = firstWork(page);
    const unwiped = async (what: string) => {
      await page.waitForTimeout(400);
      expect(new URL(page.url()).pathname, what).toBe('/');
      expect(
        await page.locator('.fx').evaluate((el) => (el as HTMLElement).dataset.fxWipe ?? null),
        what,
      ).toBeNull();
      for (const other of context.pages()) if (other !== page) await other.close();
    };
    for (const modifier of ['ControlOrMeta', 'Shift', 'Alt'] as const) {
      await link.click({ modifiers: [modifier], noWaitAfter: true });
      await unwiped(modifier);
    }
    await link.click({ button: 'middle', noWaitAfter: true });
    await unwiped('a middle click');
    await link.evaluate((a) => a.setAttribute('target', '_blank'));
    await link.click({ noWaitAfter: true });
    await unwiped('target=_blank');
  },
);

test('a second press while the page goes goes once', { annotation }, async ({ page }) => {
  await timing(page);
  await page.goto('/', { waitUntil: 'networkidle' });
  // Both presses on this page, the second once the first's navigation has started (its navigate
  // event is in the first press's own task): a second press can't land on the next page.
  await firstWork(page).evaluate((a) => {
    (a as HTMLAnchorElement).click();
    (a as HTMLAnchorElement).click();
  });
  await page.waitForURL((url) => url.pathname.startsWith('/work/'));
  const state = await went(page);
  atOnce(state);
  // The second press was held (prevented), so no second navigation started.
  expect((await page.evaluate(() => sessionStorage.getItem('fx-prevented'))) ?? '').toBe(
    'false,true,',
  );
  expect(state.navs).toBe(1);
  expect(state.marks).toBe(0);
});

test(
  'a second Enter while the next page loads goes once, with no new navigation',
  { annotation },
  async ({ page }) => {
    await timing(page);
    await page.goto('/', { waitUntil: 'networkidle' });
    const link = firstWork(page);
    const href = (await link.getAttribute('href'))!;
    // The next page answers slowly, so the second Enter lands while it loads.
    await page.route(`**${href}`, async (route) => {
      await new Promise((resolve) => setTimeout(resolve, 1500));
      await route.continue();
    });
    await link.focus();
    await page.keyboard.press('Enter');
    await page.waitForTimeout(600);
    await page.keyboard.press('Enter').catch(() => undefined);
    await page.waitForURL((url) => url.pathname.startsWith('/work/'), { timeout: 15_000 });
    const state = await went(page);
    atOnce(state);
    expect(state.navs).toBe(1);
    expect(state.marks).toBe(0);
  },
);

test(
  'a 204 answer leaves the page where it is, with no ink, and the same link pressed again past the window goes',
  { annotation },
  async ({ page }) => {
    await timing(page);
    await page.goto('/', { waitUntil: 'networkidle' });
    const link = firstWork(page);
    const href = (await link.getAttribute('href'))!;
    await page.route(`**${href}`, (route) => route.fulfill({ status: 204 }));
    await link.click({ noWaitAfter: true });
    await page.waitForTimeout(400);
    expect(new URL(page.url()).pathname).toBe('/');
    expect(await wiped(page)).toBeNull();
    // A retry past the double-press window (REPEAT_MS, 1s) isn't held: it starts again.
    await page.waitForTimeout(800);
    await link.click({ noWaitAfter: true });
    await page.waitForTimeout(400);
    const state = await went(page);
    expect(state.navs).toBe(2);
    expect((await page.evaluate(() => sessionStorage.getItem('fx-prevented'))) ?? '').toBe(
      'false,false,',
    );
    expect(state.marks).toBe(0);
    expect(new URL(page.url()).pathname).toBe('/');
  },
);

test(
  'a press on another link while a slow answer loads goes there: the latest press wins',
  { annotation },
  async ({ page }) => {
    await timing(page);
    await page.goto('/', { waitUntil: 'networkidle' });
    await firstWork(page).click();
    await page.waitForURL((url) => url.pathname.startsWith('/work/'));
    await expect(page.locator('.fx[data-fx-live]')).toHaveCount(1);
    await page.evaluate(() => sessionStorage.setItem('fx-prevented', ''));
    // Home answers slowly: the name tab goes, and while home loads, the Writing tab is pressed.
    await page.route(
      (url) => url.pathname === '/',
      async (route) => {
        if (route.request().resourceType() !== 'document') return route.continue();
        await new Promise((resolve) => setTimeout(resolve, 2000));
        await route.continue();
      },
    );
    const name = page.locator('.fx-tab--name').first();
    const writing = page.locator('.fx-tabs a[href$="#fx--sheet-writing"]').first();
    const there = (await writing.getAttribute('href'))!;
    expect(there).not.toBe(await name.getAttribute('href'));
    await name.click({ noWaitAfter: true });
    await page.waitForTimeout(400);
    await writing.click({ noWaitAfter: true });
    await page.waitForURL((url) => url.pathname === '/' && url.hash === '#fx--sheet-writing', {
      timeout: 15_000,
    });
    // Neither press was held: the guard holds only a repeat of the same link. (Both go to home's
    // document, so the browser folds the second into the first's pending request: one navigate
    // event and one request, landing where the latest press asked.)
    expect((await page.evaluate(() => sessionStorage.getItem('fx-prevented'))) ?? '').toBe(
      'false,false,',
    );
    expect((await went(page)).marks).toBe(0);
  },
);

test(
  'after an aborted request, there and Back finds the page with no ink on it, and Back cuts',
  { annotation },
  async ({ page }) => {
    await watch(page);
    await page.goto('/', { waitUntil: 'networkidle' });
    const link = firstWork(page);
    const href = (await link.getAttribute('href'))!;
    await page.route(`**${href}`, (route) => route.abort('aborted'));
    await link.click({ noWaitAfter: true });
    await page.waitForTimeout(400);
    expect(await wiped(page)).toBeNull();
    expect(new URL(page.url()).pathname).toBe('/');
    await page.unroute(`**${href}`);
    // A retry past the double-press window (REPEAT_MS, 1s) goes: the page can't see an abort.
    await page.waitForTimeout(800);
    await link.click();
    await page.waitForURL((url) => url.pathname.startsWith('/work/'));
    // Back once the page's enhancement is on it (its mark): a Back before then is the browser's
    // alone, with nothing of Flux's to cut it.
    await expect(page.locator('.fx[data-fx-live]')).toHaveCount(1);
    await page.goBack();
    await page.waitForURL((url) => url.pathname === '/');
    expect(await wiped(page)).toBeNull();
    // Back is a cut (R3): no transition revealed the page again.
    expect(
      (await seen(page)).has,
      `swaps and reveals: ${await page.evaluate(() => sessionStorage.getItem('fx-log'))}`,
    ).toBe(false);
  },
);
