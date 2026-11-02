import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fixtureSiteSelecting } from '../../packages/variant-contract/src/contract-fixtures';
import { contractFixture } from '../../packages/variant-contract/src/node/fixtures';
import { startApp } from '../harness/app-server.mjs';
import { expect, test } from '../harness/fixtures';
import {
  brokenWords,
  groundedPseudos,
  pastPage,
  ringContrast,
  sidewaysCause,
  splitPhrases,
  thinCells,
} from './raw-grid-probes';

// Raw Grid's checks in a browser (variants-10 brief §5.3, step 10): the
// grid as geometry (no cell radius, whatever the language), the ticker's
// Pause (WCAG 2.2.2) and its stillness under reduced motion, red at most
// once a viewport, every sticker linking to a record on the page, the
// Index opening the foot's one index over the page and giving focus back,
// and no sideways scroll on a phone; and its own case page under the same
// rules, with no dead space. On the complete fixture, under read-only.

const FIXTURE = contractFixture('complete');
const DIR = path.dirname(FIXTURE.files.portfolio);
const annotation = [
  { type: 'route', description: '/' },
  { type: 'profile', description: 'read-only' },
];
/** The complete fixture's one case study. */
const CASE = '/work/project-name';
const CASE_ANNOTATION = [
  { type: 'route', description: '/work/[slug]' },
  { type: 'profile', description: 'read-only' },
];

const APP_OPTIONS = {
  portfolio: FIXTURE.files.portfolio,
  siteText: fixtureSiteSelecting(readFileSync(FIXTURE.files.site, 'utf8'), 'raw-grid'),
  sourceFiles: Object.fromEntries(
    FIXTURE.unitFiles.map((file) => [file, readFileSync(path.join(DIR, file), 'utf8')]),
  ),
};

test.use({ appOptions: APP_OPTIONS });

// The board's column lines are a box of their own behind the fields, never a pseudo-element of
// main or the foot: axe reads no text's ground through an absolutely placed ::before with a
// ground, so each text under one goes to the quality cell's screenshot sampler, and the board's
// sent 338 of them, past the cell's 240 s on CI (run 41510373684). Home and a work's page.
test(
  'no text sits under a pseudo-element with a ground, so a contrast check reads each text’s own',
  { annotation },
  async ({ page }) => {
    for (const route of ['/', CASE]) {
      await page.goto(route, { waitUntil: 'networkidle' });
      expect(await page.evaluate(groundedPseudos), route).toEqual([]);
    }
  },
);

test('no cell, field, card, button or label takes a radius', { annotation }, async ({ page }) => {
  await page.goto('/', { waitUntil: 'networkidle' });
  const rounded = await page
    .locator('.rg-cell, .rg-field, .rg-card, .rg-paste, .rg-act, .rg-btn, .rg-note, .rg-head__row')
    .evaluateAll(
      (elements) =>
        elements.filter((element) => {
          const style = getComputedStyle(element);
          return [
            style.borderStartStartRadius,
            style.borderStartEndRadius,
            style.borderEndStartRadius,
            style.borderEndEndRadius,
          ].some((radius) => parseFloat(radius) > 0);
        }).length,
    );
  expect(rounded).toBe(0);
});

for (const [width, height] of [
  [1440, 900],
  [390, 844],
] as const) {
  test(
    `at ${width}px the ink block's subtitles start at its content edge, not on its rule`,
    { annotation },
    async ({ page }) => {
      await page.setViewportSize({ width, height });
      await page.goto('/', { waitUntil: 'networkidle' });
      const edges = await page
        .locator('.rg-ink')
        .first()
        .evaluate((ink) => {
          // Where a box's words start: its box's start plus its inline-start rule and padding.
          const start = (el: Element) => {
            const style = getComputedStyle(el);
            return (
              el.getBoundingClientRect().left +
              parseFloat(style.borderInlineStartWidth) +
              parseFloat(style.paddingInlineStart)
            );
          };
          const msg = ink.querySelector('.rg-ink__msg');
          return {
            content: msg ? start(msg) : null,
            subs: [...ink.querySelectorAll('.rg-ink__head > :not(.rg-tab)')].map(start),
          };
        });
      expect(edges.content).not.toBeNull();
      expect(edges.subs.length).toBeGreaterThan(0);
      for (const sub of edges.subs) expect(Math.abs(sub - edges.content!)).toBeLessThanOrEqual(1);
    },
  );
}

test(
  'the loud fill is spent at most once in any viewport (S3)',
  { annotation },
  async ({ page }) => {
    await page.goto('/', { waitUntil: 'networkidle' });
    const worst = await page.evaluate(async () => {
      // Every element whose own ground is a loud fill, the accent or K-2's emphasis, by its
      // computed color, whatever its class: the primary action, a sticker, a badge.
      const root = document.querySelector('[data-variant]')!;
      const loud = ['var(--color-accent)', 'var(--color-emphasis)'].map((color) => {
        const probe = document.createElement('i');
        probe.style.backgroundColor = color;
        root.append(probe);
        const computed = getComputedStyle(probe).backgroundColor;
        probe.remove();
        return computed;
      });
      const filled = [...root.querySelectorAll('*')].filter((element) =>
        loud.includes(getComputedStyle(element).backgroundColor),
      );
      let most = { count: 0, at: 0, which: [] as string[] };
      for (let y = 0; y < document.documentElement.scrollHeight; y += innerHeight / 2) {
        scrollTo(0, y);
        await new Promise((resolve) => requestAnimationFrame(resolve));
        const seen = filled.filter((element) => {
          const box = element.getBoundingClientRect();
          return box.width > 0 && box.height > 0 && box.bottom > 0 && box.top < innerHeight;
        });
        if (seen.length > most.count)
          most = {
            count: seen.length,
            at: y,
            which: seen.map(
              (element) => `${element.className} ${element.textContent?.slice(0, 20)}`,
            ),
          };
      }
      return most;
    });
    expect(worst.count, JSON.stringify(worst)).toBeLessThanOrEqual(1);
  },
);

test(
  'no card holds more than a spacing step of blank under its content (S1)',
  { annotation },
  async ({ page }) => {
    await page.goto('/', { waitUntil: 'networkidle' });
    const blank = await page.evaluate(() => {
      const root = document.querySelector('[data-variant]')!;
      const probe = document.createElement('i');
      probe.style.display = 'block';
      probe.style.blockSize = 'var(--space-m)';
      root.append(probe);
      const step = probe.getBoundingClientRect().height;
      probe.remove();
      return [...root.querySelectorAll<HTMLElement>('.rg-card')].flatMap((card) => {
        const body = card.querySelector<HTMLElement>('.rg-card__body');
        if (!body || card.getBoundingClientRect().height === 0) return [];
        const last = Math.max(
          ...[...body.children].map((child) => child.getBoundingClientRect().bottom),
        );
        const padding = parseFloat(getComputedStyle(body).paddingBlockEnd);
        const gap = card.getBoundingClientRect().bottom - padding - last;
        return gap > step + 1
          ? [
              `${card.querySelector('.rg-card__title')?.textContent}: ${Math.round(gap)} px blank, step ${Math.round(step)}`,
            ]
          : [];
      });
    });
    expect(blank).toEqual([]);
  },
);

test(
  "a card the field's width fills it: its content spans 70% of its inner width or more",
  { annotation },
  async ({ page }) => {
    await page.goto('/', { waitUntil: 'networkidle' });
    const thin = await page.evaluate(() => {
      const root = document.querySelector('[data-variant]')!;
      return [...root.querySelectorAll<HTMLElement>('.rg-board .rg-card')].flatMap((card) => {
        const board = card.closest('.rg-board')!.getBoundingClientRect();
        const box = card.getBoundingClientRect();
        if (box.width === 0 || box.width < board.width * 0.9) return [];
        const style = getComputedStyle(card);
        const inner =
          box.width -
          parseFloat(style.borderInlineStartWidth) -
          parseFloat(style.borderInlineEndWidth);
        // What the card shows: its text, by the text's own line boxes, and its media.
        const rects: DOMRect[] = [];
        const walker = document.createTreeWalker(card, NodeFilter.SHOW_TEXT);
        for (let node = walker.nextNode(); node; node = walker.nextNode()) {
          if (!node.textContent?.trim()) continue;
          const range = document.createRange();
          range.selectNodeContents(node);
          rects.push(...[...range.getClientRects()].filter((rect) => rect.width > 0));
        }
        for (const media of card.querySelectorAll('img, .pf-media-box'))
          rects.push(media.getBoundingClientRect());
        if (rects.length === 0) return [];
        const span =
          Math.max(...rects.map((rect) => rect.right)) -
          Math.min(...rects.map((rect) => rect.left));
        return span < inner * 0.7
          ? [
              `${card.querySelector('.rg-card__title')?.textContent}: content ${Math.round(span)} of ${Math.round(inner)} px`,
            ]
          : [];
      });
    });
    expect(thin).toEqual([]);
  },
);

test(
  'every sticker and ticker fact is a record the page shows as text',
  { annotation },
  async ({ page }) => {
    await page.goto('/', { waitUntil: 'networkidle' });
    const missing = await page.locator('.rg-sticker a').evaluateAll((links) =>
      links
        .map((link) => decodeURIComponent(new URL((link as HTMLAnchorElement).href).hash.slice(1)))
        .filter((id) => {
          const target = document.getElementById(id);
          return !target || target.closest('[aria-hidden="true"]') || !target.textContent?.trim();
        }),
    );
    expect(missing).toEqual([]);
    await expect(page.locator('.rg-ticker__track')).toHaveAttribute('aria-hidden', 'true');
  },
);

// The home outline (design gate item 8): the full record's minor parts fold behind closed native
// disclosures, each summary its title, first item and count; a fragment or an Index link opens
// its fold and lands below the sticky header row; print opens every fold; with no script the
// folds still open, natively.
const FOLD = 'details[data-rg-fold]';
const foldIds = (page: import('@playwright/test').Page) =>
  page.locator(`${FOLD} > .rg-band[id]`).evaluateAll((bands) => bands.map((band) => band.id));

test.describe('the folds', () => {
  test.use({ contextOptions: { reducedMotion: 'reduce' } });

  test(
    'each fold is closed, its summary its title, first item and count',
    { annotation },
    async ({ page }) => {
      await page.goto('/', { waitUntil: 'networkidle' });
      const summaries = await page.locator(`${FOLD} > summary`).evaluateAll((all) =>
        all.map((summary) => ({
          open: (summary.parentElement as HTMLDetailsElement).open,
          title: summary.querySelector('h3')?.textContent?.trim() ?? '',
          first: summary.querySelector('.rg-fold__first')?.textContent?.trim() ?? '',
          count: summary.querySelector('.rg-band__count')?.textContent?.trim() ?? '',
        })),
      );
      expect(summaries.length).toBeGreaterThan(3);
      for (const summary of summaries) {
        expect(summary.open, summary.title).toBe(false);
        expect(summary.title).not.toBe('');
        expect(summary.first, summary.title).not.toBe('');
        expect(summary.count, summary.title).toMatch(/\d/);
      }
      // What stays open: Experience and Skills.
      for (const id of ['experience', 'skills'])
        expect(await page.locator(`${FOLD} #${id}`).count(), id).toBe(0);
    },
  );

  test(
    'a fragment, and an Index link, open the fold and land below the header row',
    { annotation },
    async ({ page }) => {
      await page.goto('/', { waitUntil: 'networkidle' });
      const [first, second] = await foldIds(page);
      const landed = async (id: string) => {
        const fold = page.locator(`${FOLD}:has(> #${id})`);
        await expect(fold).toHaveJSProperty('open', true);
        await expect
          .poll(() =>
            page.evaluate(
              (target) =>
                document.getElementById(target)!.getBoundingClientRect().top -
                document.querySelector('.rg-head')!.getBoundingClientRect().bottom,
              id,
            ),
          )
          .toBeGreaterThanOrEqual(-1);
      };
      await page.goto(`/#${first}`, { waitUntil: 'networkidle' });
      await landed(first!);
      await page.goto('/', { waitUntil: 'networkidle' });
      await page.locator('.rg-head__index a').click();
      await page.locator(`.rg-index a[href$="#${second}"]`).first().click();
      await landed(second!);
      // A sticker whose record is in a fold opens it too (r6 L5).
      await page.goto('/', { waitUntil: 'networkidle' });
      const into = await page
        .locator('.rg-sticker a')
        .evaluateAll((links) =>
          links
            .map((link) => link.getAttribute('href')!.slice(1))
            .find((id) => document.getElementById(id)?.closest('details[data-rg-fold]')),
        );
      if (into) {
        await page.locator(`.rg-sticker a[href="#${into}"]`).click();
        const fold = page.locator(`${FOLD}:has(#${into})`);
        await expect(fold).toHaveJSProperty('open', true);
        await expect
          .poll(() =>
            page.evaluate(
              (target) =>
                document.getElementById(target)!.getBoundingClientRect().top -
                document.querySelector('.rg-head')!.getBoundingClientRect().bottom,
              into,
            ),
          )
          .toBeGreaterThanOrEqual(-1);
      }
    },
  );

  test(
    'a malformed fragment is read as written, and the page runs (r6 M1)',
    { annotation },
    async ({ page }) => {
      const errors: string[] = [];
      page.on('pageerror', (error) => errors.push(error.message));
      await page.goto('/#100%', { waitUntil: 'networkidle' });
      await expect(page.locator('main')).toBeVisible();
      await expect(page.locator('[data-rg-index][aria-expanded]').first()).toBeAttached();
      expect(errors).toEqual([]);
    },
  );

  test('print opens every fold', { annotation }, async ({ page }) => {
    await page.goto('/', { waitUntil: 'networkidle' });
    await page.emulateMedia({ media: 'print' });
    const shut = await page
      .locator(`${FOLD} > .rg-band`)
      .evaluateAll((bands) =>
        bands.filter((band) => band.getBoundingClientRect().height === 0).map((band) => band.id),
      );
    expect(shut).toEqual([]);
  });

  test.describe('with no script', () => {
    test.use({ javaScriptEnabled: false });

    test('a fold opens from its summary, and from a fragment', { annotation }, async ({ page }) => {
      await page.goto('/', { waitUntil: 'load' });
      const [first, second] = await foldIds(page);
      const fold = page.locator(`${FOLD}:has(> #${first})`);
      await fold.locator('summary').click();
      await expect(fold).toHaveJSProperty('open', true);
      expect((await page.locator(`#${first}`).boundingBox())!.height).toBeGreaterThan(0);
      await page.goto(`/#${second}`, { waitUntil: 'load' });
      await expect(page.locator(`${FOLD}:has(> #${second})`)).toHaveJSProperty('open', true);
    });
  });
});

// The paste-up (r6 H1): once, on load, the poster's stickers slap on, starting the first time the
// kit runtime is active, and landing where they end once it pauses. The scene is lengthened so a
// slap is still under way when the test looks.
test.describe('the paste-up', () => {
  test.use({ contextOptions: { reducedMotion: 'no-preference' } });

  const slow = async (page: import('@playwright/test').Page) =>
    page.addInitScript(() => {
      addEventListener('DOMContentLoaded', () => {
        const style = document.createElement('style');
        style.textContent = "[data-variant='raw-grid'] { --motion-scene: 20s !important; }";
        document.head.append(style);
      });
    });
  const slaps = (page: import('@playwright/test').Page) =>
    page
      .locator('.rg-poster .rg-sticker')
      .evaluateAll((stickers) =>
        stickers.flatMap((sticker) =>
          sticker.getAnimations().map((animation) => animation.playState),
        ),
      );

  test('plays on load, and Pause lands it', { annotation }, async ({ page }) => {
    await slow(page);
    await page.goto('/', { waitUntil: 'load' });
    test.skip((await page.locator('.rg-poster .rg-sticker').count()) === 0, 'no stickers');
    await expect.poll(() => slaps(page)).toContain('running');
    await page.locator('.rg-ticker__toggle').getByRole('button', { name: 'Pause motion' }).click();
    await expect.poll(() => slaps(page)).not.toContain('running');
  });

  test('never plays when the tab already holds a pause', { annotation }, async ({ page }) => {
    await slow(page);
    await page.addInitScript(() => {
      sessionStorage.setItem('portfolio.motion.paused', '1');
      const animate = Element.prototype.animate;
      (window as unknown as { slapped: number }).slapped = 0;
      Element.prototype.animate = function (
        this: Element,
        ...args: Parameters<Element['animate']>
      ) {
        if (this.closest('.rg-sticker')) (window as unknown as { slapped: number }).slapped++;
        return animate.apply(this, args);
      };
    });
    await page.goto('/', { waitUntil: 'networkidle' });
    test.skip((await page.locator('.rg-poster .rg-sticker').count()) === 0, 'no stickers');
    await page.waitForTimeout(1_000);
    expect(await page.evaluate(() => (window as unknown as { slapped: number }).slapped)).toBe(0);
    expect(await slaps(page)).toEqual([]);
  });
});

test.describe('the ticker', () => {
  test.use({ contextOptions: { reducedMotion: 'no-preference' } });

  test(
    'runs with the kit MotionControl a pointer and a keyboard reach, and stops when pressed',
    { annotation },
    async ({ page }) => {
      await page.goto('/', { waitUntil: 'networkidle' });
      const ticker = page.locator('.rg-ticker');
      test.skip((await ticker.count()) === 0, 'the fixture has fewer than two facts');
      await expect(ticker).toHaveAttribute('data-ticker', 'running');
      const toggle = page
        .locator('.rg-ticker__toggle')
        .getByRole('button', { name: 'Pause motion' });
      await expect(toggle).toBeVisible();
      await expect(toggle).toBeEnabled();
      const box = (await toggle.boundingBox())!;
      expect(box.width).toBeGreaterThanOrEqual(24);
      expect(box.height).toBeGreaterThanOrEqual(24);
      await toggle.click();
      await expect(toggle).toHaveAttribute('aria-pressed', 'true');
      // The kit's pause reaches the belt through the runtime: the ticker is paused, not stilled.
      await expect(ticker).toHaveAttribute('data-activity', 'paused');
      await expect(ticker).toHaveAttribute('data-ticker', 'running');
      await expect(page.locator('.rg-ticker__toggle [role="status"]')).toHaveText(
        'Motion is paused.',
      );
      await expect
        .poll(() =>
          page
            .locator('.rg-ticker__belt')
            .evaluate((el) => getComputedStyle(el).animationPlayState),
        )
        .toBe('paused');
      // Nothing runs once paused, of any kind: not the belt, not a sticker's paste-up, not the
      // control's own feedback. Named, so a failure says what still moves.
      const running = () =>
        page.evaluate(() =>
          document
            .getAnimations()
            .filter((animation) => animation.playState === 'running')
            .map((animation) =>
              animation instanceof CSSAnimation
                ? animation.animationName
                : animation instanceof CSSTransition
                  ? `transition ${animation.transitionProperty}`
                  : `script on ${String((animation.effect as KeyframeEffect | null)?.target?.className)}`,
            ),
        );
      expect(await running()).toEqual([]);
      // Paused, a card's and a call to action's lift on hover moves nothing either (r6 M2).
      for (const target of ['.rg-card', '.rg-act']) {
        const one = page.locator(target).first();
        if (!(await one.count())) continue;
        await one.hover();
        expect(await running(), target).toEqual([]);
      }
      // The pointer goes back to the control it pressed, off the cards and off the facts: under
      // the pointer the facts hold, so a pointer parked on the track (the window's corner) would
      // hold the belt after the resume as well.
      await page.evaluate(() => scrollTo({ top: 0, behavior: 'instant' }));
      await toggle.hover();
      // Pressed again, with focus still on it, it resumes (2.2.2).
      await toggle.press('Enter');
      await expect(toggle).toHaveAttribute('aria-pressed', 'false');
      await expect(ticker).not.toHaveAttribute('data-activity', 'paused');
      await expect.poll(running).toEqual(['raw-grid-ticker']);
      // Under the pointer the facts hold, and they run on once it leaves.
      await page.locator('.rg-ticker__track').hover();
      await expect.poll(running).toEqual([]);
      await toggle.hover();
      await expect.poll(running).toEqual(['raw-grid-ticker']);
    },
  );

  test(
    'right to left, the belt travels right and the stickers tilt the other way',
    { annotation },
    async ({ page }) => {
      await page.goto('/', { waitUntil: 'networkidle' });
      const ticker = page.locator('.rg-ticker');
      test.skip((await ticker.count()) === 0, 'the fixture has fewer than two facts');
      const ltr = await page
        .locator('.rg-sticker')
        .first()
        .evaluate((el) => getComputedStyle(el).rotate);
      await page.evaluate(() => {
        document.querySelector('.rg-ticker')!.setAttribute('dir', 'rtl');
        document.querySelector('.rg-stickers')?.setAttribute('dir', 'rtl');
      });
      const belt = page.locator('.rg-ticker__belt');
      await expect
        .poll(() => belt.evaluate((el) => getComputedStyle(el).animationName))
        .toBe('raw-grid-ticker-rtl');
      // The belt moves to positive x: 0 to +50%, never starting blank.
      await expect
        .poll(() =>
          belt.evaluate((el) => new DOMMatrixReadOnly(getComputedStyle(el).transform).m41),
        )
        .toBeGreaterThan(0);
      const rtl = await page
        .locator('.rg-sticker')
        .first()
        .evaluate((el) => getComputedStyle(el).rotate);
      expect(parseFloat(rtl)).toBe(-parseFloat(ltr));
      // Paused, it holds still right to left too.
      await page.getByRole('button', { name: 'Pause motion' }).click();
      await expect
        .poll(() => belt.evaluate((el) => getComputedStyle(el).animationPlayState))
        .toBe('paused');
    },
  );
});

test.describe('under reduced motion', () => {
  test.use({ contextOptions: { reducedMotion: 'reduce' } });

  test(
    'the ticker is one still pass, the kit MotionControl disabled and saying why, and nothing runs',
    { annotation },
    async ({ page }) => {
      await page.goto('/', { waitUntil: 'networkidle' });
      const ticker = page.locator('.rg-ticker');
      test.skip((await ticker.count()) === 0, 'the fixture has fewer than two facts');
      await expect(ticker).toHaveAttribute('data-ticker', 'still');
      const control = page
        .locator('.rg-ticker__toggle')
        .getByRole('button', { name: 'Pause motion' });
      await expect(control).toBeVisible();
      await expect(control).toBeDisabled();
      const status = page.locator('.rg-ticker__toggle [role="status"]');
      await expect(status).toHaveText('Reduced by system');
      await expect(status).toBeVisible();
      await expect(page.locator('.rg-ticker__run[data-copy]')).toBeHidden();
      const running = await page.evaluate(
        () =>
          document.getAnimations().filter((animation) => animation.playState === 'running').length,
      );
      expect(running).toBe(0);
    },
  );

  // Why a disabled Pause meets WCAG 2.2.2 here: the belt has no animation at all, not a paused
  // one, and it stays where it is.
  test(
    'the belt has no animation and holds still for 2 s, so Pause has nothing to stop',
    { annotation },
    async ({ page }) => {
      await page.setViewportSize({ width: 1440, height: 900 });
      await page.goto('/', { waitUntil: 'networkidle' });
      const belt = page.locator('.rg-ticker__belt');
      test.skip((await belt.count()) === 0, 'the fixture has fewer than two facts');
      const animations = () =>
        belt.evaluate(
          (el) =>
            document.getAnimations().filter((animation) => {
              const target = (animation.effect as KeyframeEffect | null)?.target;
              return target instanceof Node && (target === el || el.contains(target));
            }).length,
        );
      const place = () =>
        belt.evaluate((el) => ({
          transform: getComputedStyle(el).transform,
          x: el.getBoundingClientRect().x,
        }));
      expect(await animations()).toBe(0);
      const before = await place();
      await page.waitForTimeout(2_000);
      expect(await place()).toEqual(before);
      expect(await animations()).toBe(0);
    },
  );
});

// Q3 (1.4.10): where a marquee would clip its facts (the reflow cell's 320 window, its 200% zoom
// as a 640 by 400 window, and 200% root text at 1024, set after load as the cell sets it), the
// belt is one still pass that wraps, so the track clips nothing.
test.describe('where the room is cramped', () => {
  test.use({ contextOptions: { reducedMotion: 'no-preference' } });

  for (const [width, height, text] of [
    [320, 568, 1],
    [640, 400, 1],
    [1024, 768, 2],
  ] as const) {
    test(
      `at ${width} by ${height}${text > 1 ? ' with 200% root text' : ''}, the belt is still and clips nothing`,
      { annotation },
      async ({ page }) => {
        await page.setViewportSize({ width, height });
        await page.goto('/', { waitUntil: 'networkidle' });
        const ticker = page.locator('.rg-ticker');
        test.skip((await ticker.count()) === 0, 'the fixture has fewer than two facts');
        if (text > 1) {
          await expect(ticker).toHaveAttribute('data-ticker', 'running');
          await page.evaluate(() =>
            document.documentElement.style.setProperty('font-size', '200%', 'important'),
          );
        }
        await expect(ticker).toHaveAttribute('data-ticker', 'still');
        await expect(page.locator('.rg-ticker__run[data-copy]')).toBeHidden();
        const clipped = await page.locator('.rg-ticker__track').evaluate((track) => {
          const box = track.getBoundingClientRect();
          return [...track.querySelectorAll('li')]
            .map((li) => li.getBoundingClientRect())
            .filter(
              (r) =>
                r.width > 0 &&
                (r.left < box.left - 1 || r.right > box.right + 1 || r.bottom > box.bottom + 1),
            ).length;
        });
        expect(clipped).toBe(0);
      },
    );
  }
});

test(
  'the Index opens the foot’s one index over the page, and Escape gives focus back',
  { annotation },
  async ({ page }) => {
    await page.goto('/', { waitUntil: 'networkidle' });
    const opener = page.locator('.rg-head__index a');
    await opener.focus();
    await page.keyboard.press('Enter');
    const index = page.locator('.rg-index');
    await expect(index).toHaveJSProperty('popover', 'auto');
    expect(await index.evaluate((element) => element.matches(':popover-open'))).toBe(true);
    await expect(opener).toHaveAttribute('aria-expanded', 'true');
    // One list: the index the foot holds, never a copy.
    expect(await page.locator('nav.rg-index').count()).toBe(1);
    await page.keyboard.press('Escape');
    expect(await index.evaluate((element) => element.matches(':popover-open'))).toBe(false);
    await expect(opener).toBeFocused();
    await expect(index).not.toHaveAttribute('popover');
  },
);

for (const width of [320, 390]) {
  test.describe(`at ${width}px`, () => {
    test.use({ viewport: { width, height: 844 }, hasTouch: true, isMobile: true });

    test(
      'nothing scrolls sideways, and the chrome is the name and the Index',
      { annotation },
      async ({ page }) => {
        await page.goto('/', { waitUntil: 'networkidle' });
        // Against the viewport's own width: under mobile emulation innerWidth grows
        // with content that overflows, so it could never fail.
        expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(width);
        const shown = await page
          .locator('.rg-head__row > *')
          .evaluateAll(
            (elements) =>
              elements.filter((element) => getComputedStyle(element).display !== 'none').length,
          );
        expect(shown).toBe(2);
      },
    );

    test(
      'a work’s own page scrolls nothing sideways either',
      { annotation: CASE_ANNOTATION },
      async ({ page }) => {
        await page.goto(CASE, { waitUntil: 'networkidle' });
        expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(width);
      },
    );
  });
}

// A work's own page, /work/<slug> (phase 2): its own field, under home's rules.
test.describe('a work’s own page', () => {
  test(
    'the grid holds: no radius, the loud fill once a viewport, Work current',
    { annotation: CASE_ANNOTATION },
    async ({ page }) => {
      await page.goto(CASE, { waitUntil: 'networkidle' });
      await expect(page.locator('h1')).toHaveCount(1);
      await expect(page.locator('.rg-head__dest[data-dest="work"]')).toHaveAttribute(
        'aria-current',
        'true',
      );
      const rounded = await page
        .locator('.rg-cell, .rg-field, .rg-paste, .rg-act, .rg-btn, .rg-note')
        .evaluateAll(
          (elements) =>
            elements.filter((element) => {
              const style = getComputedStyle(element);
              return [
                style.borderStartStartRadius,
                style.borderStartEndRadius,
                style.borderEndStartRadius,
                style.borderEndEndRadius,
              ].some((radius) => parseFloat(radius) > 0);
            }).length,
        );
      expect(rounded).toBe(0);
      const worst = await page.evaluate(async () => {
        const root = document.querySelector('[data-variant]')!;
        const loud = ['var(--color-accent)', 'var(--color-emphasis)'].map((color) => {
          const probe = document.createElement('i');
          probe.style.backgroundColor = color;
          root.append(probe);
          const computed = getComputedStyle(probe).backgroundColor;
          probe.remove();
          return computed;
        });
        const filled = [...root.querySelectorAll('*')].filter((element) =>
          loud.includes(getComputedStyle(element).backgroundColor),
        );
        let most = 0;
        for (let y = 0; y < document.documentElement.scrollHeight; y += innerHeight / 2) {
          scrollTo(0, y);
          await new Promise((resolve) => requestAnimationFrame(resolve));
          const seen = filled.filter((element) => {
            const box = element.getBoundingClientRect();
            return box.width > 0 && box.height > 0 && box.bottom > 0 && box.top < innerHeight;
          });
          most = Math.max(most, seen.length);
        }
        return most;
      });
      expect(worst).toBeLessThanOrEqual(1);
    },
  );

  test(
    'no dead space: a cell the field’s width fills it, and a part a link lands on clears the header',
    { annotation: CASE_ANNOTATION },
    async ({ page }) => {
      await page.goto(CASE, { waitUntil: 'networkidle' });
      const thin = await page.evaluate(thinCells);
      expect(thin).toEqual([]);
      const part = page.locator('section.rg-part').first();
      const id = await part.getAttribute('id');
      await page.goto(`${CASE}#${id}`, { waitUntil: 'networkidle' });
      const top = await part.evaluate((element) => element.getBoundingClientRect().top);
      const head = await page
        .locator('.rg-head')
        .evaluate((element) => element.getBoundingClientRect().bottom);
      expect(top).toBeGreaterThanOrEqual(head - 1);
    },
  );

  test(
    'every sticker and fact-sheet link lands on a record the page shows as text',
    { annotation: CASE_ANNOTATION },
    async ({ page }) => {
      await page.goto(CASE, { waitUntil: 'networkidle' });
      const missing = await page
        .locator('.rg-sticker a, .rg-dl a[href^="#"]')
        .evaluateAll((links) =>
          links
            .map((link) =>
              decodeURIComponent(new URL((link as HTMLAnchorElement).href).hash.slice(1)),
            )
            .filter((id) => !document.getElementById(id)?.textContent?.trim()),
        );
      expect(missing).toEqual([]);
    },
  );
});

test(
  'an Index column’s tab, focused, rings at 3:1 or more against the ground around it',
  { annotation },
  async ({ page }) => {
    await page.goto('/', { waitUntil: 'networkidle' });
    // A key first, so the focus that follows is the keyboard's and shows its ring.
    await page.keyboard.press('Tab');
    const tab = page.locator('a.rg-index__tab').first();
    await tab.focus();
    const ring = await tab.evaluate(ringContrast);
    expect(ring.visible).toBe(true);
    expect(ring.style).not.toBe('none');
    expect(ring.width).toBeGreaterThanOrEqual(2);
    expect(ring.ratio).toBeGreaterThanOrEqual(3);
  },
);

test(
  'focus moved by the keyboard never sits under the sticky header',
  { annotation: CASE_ANNOTATION },
  async ({ page }) => {
    await page.goto(CASE, { waitUntil: 'networkidle' });
    const covered: string[] = [];
    for (let step = 0; step < 60; step += 1) {
      await page.keyboard.press('Tab');
      const hit = await page.evaluate(() => {
        const focused = document.activeElement;
        if (!focused || focused === document.body || focused.closest('.rg-head')) return null;
        const head = document.querySelector('.rg-head')!.getBoundingClientRect();
        const box = focused.getBoundingClientRect();
        return box.top < head.bottom - 1 && box.bottom > head.top
          ? `${focused.textContent?.trim().slice(0, 30)} at ${Math.round(box.top)}`
          : null;
      });
      if (hit) covered.push(hit);
    }
    expect(covered).toEqual([]);
  },
);

test.describe('in a short window', () => {
  test.use({ viewport: { width: 844, height: 390 } });

  test(
    'the header scrolls away with the page, so it covers nothing',
    { annotation: CASE_ANNOTATION },
    async ({ page }) => {
      await page.goto(CASE, { waitUntil: 'networkidle' });
      const position = await page
        .locator('.rg-head')
        .evaluate((element) => getComputedStyle(element).position);
      expect(['static', 'relative']).toContain(position);
    },
  );
});

// 200% root text at 1024 x 768, set as the quality cell's root-text condition sets it
// (tests/quality/lib/a11y/conditions.ts): the device metrics through CDP, not mobile, the page
// loaded at that size, then the root's own font-size at 200%, important. The page's scroll width
// is what the cell reads; past it, the scan names the element whose removal ends the scroll.
test.describe('at 1024px with 200% root text, as the quality cell sets it', () => {
  test(
    'nothing scrolls sideways, and no word runs past its cell (WCAG 1.4.4, 1.4.10)',
    { annotation },
    async ({ page }) => {
      const cdp = await page.context().newCDPSession(page);
      await cdp.send('Emulation.setDeviceMetricsOverride', {
        width: 1024,
        height: 768,
        deviceScaleFactor: 1,
        mobile: false,
      });
      await page.goto('/', { waitUntil: 'networkidle' });
      await page.evaluate(() =>
        document.documentElement.style.setProperty('font-size', '200%', 'important'),
      );
      await page.evaluate(() => document.fonts.ready);
      await page.evaluate(
        () => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done))),
      );
      const sideways = await page.evaluate(sidewaysCause);
      expect(sideways, sideways.join(' > ')).toEqual([]);
      expect(await page.evaluate(pastPage)).toEqual([]);
      expect((await page.evaluate(brokenWords, { breaks: false })).found).toEqual([]);
      await cdp.send('Emulation.clearDeviceMetricsOverride');
      await cdp.detach();
    },
  );
});

// The guard on the complete fixture, as on the sample (raw-grid-sample.spec.ts): every display,
// label, title and link word on home and the case, at every width, in the fixture's own recipe.
for (const width of [1440, 1200, 1024, 768, 390, 320]) {
  test.describe(`the complete fixture at ${width}px`, () => {
    test.use({
      viewport: { width, height: 900 },
      contextOptions: { reducedMotion: 'reduce' },
      ...(width < 768 ? { hasTouch: true, isMobile: true } : {}),
    });

    test(
      'whole words: no word breaks inside itself or runs past its cell, no call to action takes two lines',
      { annotation },
      async ({ page }) => {
        for (const route of ['/', CASE]) {
          await page.goto(route, { waitUntil: 'networkidle' });
          await page.evaluate(() => document.fonts.ready);
          expect((await page.evaluate(brokenWords, { breaks: true })).found, route).toEqual([]);
          expect(await page.evaluate(splitPhrases), route).toEqual([]);
        }
      },
    );
  });
}

// A card whose title opens a page of the site, pressed on its cover and on its far corner. The
// fixture's one work with a page of its own is its signature, which the opening pins and its
// section only names (the sample's too), so no card on either opens one. This runs a second
// server on the fixture with its signature left out, where that work is a card with its cover,
// in a context of its own that reaches that server alone.
test.describe('at 1440px, a card whose title opens its case', () => {
  let other: { origin: string; stop: () => Promise<void> } | undefined;
  let dir: string | undefined;

  test.beforeAll(async () => {
    test.setTimeout(120_000);
    dir = mkdtempSync(path.join(tmpdir(), 'rg-card-'));
    const text = readFileSync(FIXTURE.files.portfolio, 'utf8');
    const unsigned = text.replace(/^signature: project-name\n/m, '');
    if (unsigned === text) throw new Error('The complete fixture no longer signs project-name');
    const portfolio = path.join(dir, 'portfolio.yml');
    writeFileSync(portfolio, unsigned);
    other = await startApp({ ...APP_OPTIONS, portfolio });
  });

  test.afterAll(async () => {
    await other?.stop();
    if (dir) rmSync(dir, { recursive: true, force: true });
  });

  test(
    'the whole card is its title link: a press on its cover, its corner or its links row opens the work, and a card link opens itself',
    { annotation },
    async ({ browser }) => {
      const origin = other!.origin;
      // Still, so the card's hover lift can't move it under the press.
      const context = await browser.newContext({
        viewport: { width: 1440, height: 900 },
        reducedMotion: 'reduce',
      });
      try {
        await context.route('**/*', (route) =>
          new URL(route.request().url()).origin === origin
            ? route.continue()
            : route.abort('blockedbyclient'),
        );
        const page = await context.newPage();
        await page.goto(`${origin}/`, { waitUntil: 'networkidle' });
        const card = page
          .locator('.rg-card:has(> .rg-card__media):has(a.rg-stretch[href^="/work/"])')
          .first();
        const href = (await card.locator('a.rg-stretch').getAttribute('href'))!;
        // A work's own page, never an anchor on this one.
        expect(href).toMatch(/^\/work\/[^#]+$/);
        const hit = ([px, py]: number[]) =>
          page.evaluate(
            ([x, y]) => document.elementFromPoint(x!, y!)?.closest('a')?.getAttribute('href'),
            [px, py],
          );
        for (const where of ['cover', 'corner', 'links row'] as const) {
          await card.scrollIntoViewIfNeeded();
          const box = (await card.boundingBox())!;
          const cover = (await card.locator('.rg-card__media').boundingBox())!;
          const row = (await card.locator('.rg-card__links').boundingBox())!;
          // The cover's middle; the card's far corner inside its rule, past the cover; and the
          // links row's empty end, at its middle (the row itself never takes the press).
          const [x, y] =
            where === 'cover'
              ? [cover.x + cover.width / 2, cover.y + cover.height / 2]
              : where === 'corner'
                ? [box.x + box.width - 8, box.y + box.height - 8]
                : [row.x + row.width - 8, row.y + row.height / 2];
          if (where === 'corner')
            expect(x > cover.x + cover.width || y > cover.y + cover.height, 'past the cover').toBe(
              true,
            );
          expect(await hit([x, y]), where).toBe(href);
          await page.mouse.click(x, y);
          await expect(page, where).toHaveURL((url) => url.pathname === href);
          await page.goBack({ waitUntil: 'networkidle' });
        }
        // A link in the row is over the title's overlay: a press on it is that link's.
        const link = card.locator('.rg-card__links a').first();
        if (await link.count()) {
          await card.scrollIntoViewIfNeeded();
          const own = (await link.getAttribute('href'))!;
          const at = (await link.boundingBox())!;
          expect(await hit([at.x + at.width / 2, at.y + at.height / 2]), 'card link').toBe(own);
          if (own.startsWith('/')) {
            await link.click();
            await expect(page).toHaveURL((url) => url.pathname + url.hash === own);
          }
        }
      } finally {
        await context.close();
      }
    },
  );
});
