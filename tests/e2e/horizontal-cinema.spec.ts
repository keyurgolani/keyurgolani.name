import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fixtureSiteSelecting } from '../../packages/variant-contract/src/contract-fixtures';
import { contractFixture } from '../../packages/variant-contract/src/node/fixtures';
import { expect, test } from '../harness/fixtures';
import {
  anchor,
  announced,
  CHAPTERS,
  expectAt,
  expectCurrent,
  keys,
  LABELS,
  load,
  read,
  watchKeys,
} from './horizontal-cinema-model';

// Horizontal Cinema's chapter controller (#17), on the complete contract
// fixture: every input, the filmstrip, previous and next, the arrow keys,
// the wheel, a swipe, find, and a direct link, lands on the same five
// chapters, and each test checks the chapter it lands on against that
// five-state model, with the URL, history's length, focus, and the live
// region. The exit reaches the index from any chapter, a frame writes no
// history, rotation and resizing keep the chapter, and with reduced motion
// or no JavaScript the same chapters read in order.

const FIXTURE = contractFixture('complete');
const DIR = path.dirname(FIXTURE.files.portfolio);
const READ_ONLY = { type: 'profile', description: 'read-only' };
const annotation = [{ type: 'route', description: '/' }, READ_ONLY];
const tag = '@interaction';

test.use({
  appOptions: {
    portfolio: FIXTURE.files.portfolio,
    siteText: fixtureSiteSelecting(readFileSync(FIXTURE.files.site, 'utf8'), 'horizontal-cinema'),
    sourceFiles: Object.fromEntries(
      FIXTURE.unitFiles.map((file) => [file, readFileSync(path.join(DIR, file), 'utf8')]),
    ),
  },
  viewport: { width: 1440, height: 900 },
});

test(
  'the buttons and the arrow keys step through the five chapters, replace the URL, and stop at either end',
  { annotation, tag },
  async ({ page }) => {
    await load(page);
    const start = await read(page);
    expect(start).toMatchObject({ layout: 'horizontal', current: anchor('prologue'), hash: '' });
    await expectAt(page, 'prologue');
    const next = page.getByRole('button', { name: 'Next chapter' });
    const previous = page.getByRole('button', { name: 'Previous chapter' });
    // Previous at Prologue is no step: nothing moves, and nothing is written.
    await previous.click();
    await page.waitForTimeout(300);
    expect(await read(page)).toMatchObject({ current: anchor('prologue'), hash: '', live: '' });

    // Next, four times: Origins to Epilogue, each announced, none a history entry.
    for (const chapter of CHAPTERS.slice(1)) {
      await next.click();
      await expectAt(page, chapter);
      expect(await read(page)).toMatchObject({
        hash: anchor(chapter),
        history: start.history,
        live: announced(chapter),
      });
    }
    // Past the end Next is no step, and it keeps its focus: the visitor is never dropped on the page.
    await next.click();
    await page.waitForTimeout(300);
    await expectAt(page, 'epilogue');
    await expect(next).toBeFocused();

    // The arrows, with focus on the filmstrip: back to Prologue, and nothing past it.
    await watchKeys(page);
    await page.locator('.hc-filmstrip a').first().focus();
    for (const chapter of [...CHAPTERS].reverse().slice(1)) {
      await page.keyboard.press('ArrowLeft');
      await expectAt(page, chapter);
      expect(await read(page)).toMatchObject({ hash: anchor(chapter), live: announced(chapter) });
    }
    await page.keyboard.press('ArrowLeft');
    await expectAt(page, 'prologue');
    // Every step cancelled its key; the one past the end left it to the browser.
    expect(await keys(page)).toEqual([true, true, true, true, false]);
    expect((await read(page)).history).toBe(start.history);

    // ArrowRight steps forward, and a key with a modifier, or one in a field, is the browser's.
    await page.keyboard.press('ArrowRight');
    await expectAt(page, 'origins');
    await page.keyboard.press('Shift+ArrowRight');
    await page.keyboard.press('Control+ArrowRight');
    await page.waitForTimeout(400);
    await expectAt(page, 'origins');
    expect((await keys(page)).slice(-3)).toEqual([true, false, false]);
  },
);

test(
  'with focus in a chapter, an arrow moves focus to the next chapter’s title, and announces nothing',
  { annotation, tag },
  async ({ page }) => {
    await load(page);
    // A link inside Prologue's frame has focus.
    await page.locator('#chapter-prologue .hc-pager a').first().focus();
    await page.keyboard.press('ArrowRight');
    await expectAt(page, 'origins');
    expect(await read(page)).toMatchObject({ focus: 'hc--title-origins', live: '' });
  },
);

test(
  'a filmstrip link is one history entry and focuses its chapter; back and forward realign at once',
  { annotation, tag },
  async ({ page }) => {
    await load(page);
    const start = await read(page);
    await page.locator('.hc-filmstrip a', { hasText: 'Journey' }).click();
    await expectAt(page, 'journey');
    expect(await read(page)).toMatchObject({
      hash: anchor('journey'),
      history: start.history + 1,
      focus: 'hc--title-journey',
      // A link the visitor chose says where it went by moving focus, not the live region.
      live: '',
    });
    // An arrow from there replaces Journey's entry with Craft.
    await page.keyboard.press('ArrowRight');
    await expectAt(page, 'craft');
    expect(await read(page)).toMatchObject({ hash: anchor('craft'), history: start.history + 1 });

    await page.goBack();
    await expectAt(page, 'prologue');
    expect((await read(page)).hash).toBe('');
    await page.goForward();
    await expectAt(page, 'craft');
    // Each chapter's own previous and next are plain links too.
    await page.locator('#chapter-craft .hc-pager__next a').click();
    await expectAt(page, 'epilogue');
    expect((await read(page)).history).toBe(start.history + 2);
  },
);

test(
  'the wheel and a trackpad scroll the stage natively, and the chapter follows where it settles',
  { annotation, tag },
  async ({ page }) => {
    await load(page);
    const start = await read(page);
    const stage = (await page.locator('.hc-stage').boundingBox())!;
    await page.mouse.move(stage.x + stage.width / 2, stage.y + 200);
    // A short sideways swipe of the trackpad settles back on the chapter it left.
    await page.mouse.wheel(400, 0);
    await page.waitForTimeout(600);
    await expectAt(page, 'prologue');
    // A longer one, or Shift with the wheel, settles on the next.
    await page.mouse.wheel(1000, 0);
    await expectAt(page, 'origins');
    expect(await read(page)).toMatchObject({
      hash: anchor('origins'),
      history: start.history,
      live: announced('origins'),
    });
    await page.mouse.wheel(1000, 0);
    await expectAt(page, 'journey');
    // The wheel down scrolls the page, as it always does: the chapter stays.
    const before = await page.evaluate(() => scrollY);
    await page.mouse.wheel(0, 300);
    await expect.poll(() => page.evaluate(() => scrollY)).toBeGreaterThan(before);
    await page.waitForTimeout(400);
    await expectAt(page, 'journey');
    // Hard back to the start lands on Prologue.
    await page.mouse.wheel(-3000, 0);
    await expectAt(page, 'prologue');
    // Past the start the stage simply stops: no trap, nothing to undo.
    await page.mouse.wheel(-3000, 0);
    await page.waitForTimeout(400);
    await expectAt(page, 'prologue');
    expect((await read(page)).history).toBe(start.history);
  },
);

test(
  'find and Tab, which scroll the stage to what they reach, make its chapter current',
  { annotation, tag },
  async ({ page }) => {
    await load(page);
    const start = await read(page);
    // What find-in-page does: scroll the match just into view. The stage stays where find put
    // it, so the match stays in view, and the chapter it revealed is current.
    const match = page.locator('#chapter-craft [data-section-id]').first();
    await match.evaluate((element) =>
      element.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'instant' }),
    );
    await expectCurrent(page, 'craft');
    await page.waitForTimeout(400);
    await expect(match).toBeInViewport();
    expect(await read(page)).toMatchObject({ hash: anchor('craft'), history: start.history });
    // Tab, or a script, focusing a link in another chapter: that chapter, at once, the link in view.
    const link = page.locator('#chapter-journey .hc-pager a').first();
    await link.focus();
    await expect(link).toBeInViewport();
    await expectAt(page, 'journey');
    // And back the other way, to Prologue.
    const back = page.locator('#chapter-prologue [data-section-id]').first();
    await back.evaluate((element) =>
      element.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'instant' }),
    );
    await expectCurrent(page, 'prologue');
    await page.waitForTimeout(400);
    await expect(back).toBeInViewport();
    // The scrollbar: a direct write of the stage's scroll position.
    await page.evaluate(() => {
      const stage = document.querySelector<HTMLElement>('.hc-stage')!;
      stage.scrollTo({ left: stage.clientWidth * 4, behavior: 'instant' });
    });
    await expectAt(page, 'epilogue');
    // Text in every chapter stays selectable.
    expect(
      await page.evaluate(() =>
        [...document.querySelectorAll('.hc-chapter')].map(
          (chapter) => getComputedStyle(chapter).userSelect,
        ),
      ),
    ).not.toContain('none');
  },
);

test(
  'a direct link opens its chapter, and a refresh keeps it',
  { annotation, tag },
  async ({ page }) => {
    for (const chapter of CHAPTERS) {
      await load(page, `/${anchor(chapter)}`);
      await expectAt(page, chapter);
      await page.reload({ waitUntil: 'load' });
      await expect(page.locator('.hc-cinema')).toHaveAttribute('data-ready', '');
      await expectAt(page, chapter);
      // Opening a chapter announces nothing.
      expect((await read(page)).live).toBe('');
    }
  },
);

test(
  'the exit: the index is one link away from every chapter, and from the chrome',
  { annotation, tag },
  async ({ page }) => {
    await load(page, `/${anchor('journey')}`);
    await page.locator('.hc-chrome__index').click();
    await expect.poll(async () => (await read(page)).hash).toBe('#chapter-index');
    await expect(page.locator('#hc--index-heading')).toBeFocused();
    await expect(page.locator('#chapter-index')).toBeInViewport();
    // Epilogue's next is the index too.
    await load(page, `/${anchor('epilogue')}`);
    await page.locator('#chapter-epilogue .hc-pager__next a').click();
    await expect(page.locator('#hc--index-heading')).toBeFocused();
    // The chapter the visitor left stays the current one.
    expect((await read(page)).current).toBe(anchor('epilogue'));
  },
);

test(
  'resizing the window at every chapter keeps the chapter',
  { annotation, tag },
  async ({ page }) => {
    for (const chapter of CHAPTERS) {
      await page.setViewportSize({ width: 1440, height: 900 });
      await load(page, `/${anchor(chapter)}`);
      await expectAt(page, chapter);
      await page.setViewportSize({ width: 1024, height: 768 });
      await expectAt(page, chapter);
      expect((await read(page)).layout).toBe('horizontal');
      // Narrower than the horizontal layout: the vertical one, at the same chapter.
      await page.setViewportSize({ width: 900, height: 768 });
      await expectAt(page, chapter);
      expect((await read(page)).layout).toBe('vertical');
    }
  },
);

test.describe('touch', () => {
  test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });

  test(
    'on a phone Next scrolls the bar away, so focus goes to the chapter it lands on, in view',
    { annotation, tag },
    async ({ page }) => {
      await load(page);
      await page.getByRole('button', { name: 'Next chapter' }).click();
      await expectAt(page, 'origins');
      await expect(page.locator('#hc--title-origins')).toBeFocused();
      await expect(page.locator('#hc--title-origins')).toBeInViewport();
      expect((await read(page)).hash).toBe(anchor('origins'));
    },
  );

  // SCRATCH, not for merge: the same test five times, for #146's CI evidence.
  for (const run of [1, 2, 3, 4, 5]) {
    test(
      `on a phone the chapters stack in order, a swipe moves the page, and rotation keeps the chapter (scratch repeat ${run}/5)`,
      { annotation, tag },
      async ({ page }) => {
        await load(page);
        const start = await read(page);
        expect(start.layout).toBe('vertical');
        // The same five chapters, in order, with the same URLs.
        expect(
          await page
            .locator('.hc-filmstrip a')
            .evaluateAll((links) => links.map((link) => link.getAttribute('href'))),
        ).toEqual(CHAPTERS.map(anchor));
        // A swipe up the screen: the page scrolls, never cancelled, and the chapter follows.
        const cdp = await page.context().newCDPSession(page);
        // Swipe until the page is past Prologue: each swipe is a real touch scroll, never cancelled.
        for (let swipe = 0; swipe < 12; swipe++) {
          const before = await page.evaluate(() => window.scrollY);
          // A finger down, ten moves up the screen, and up: the browser's own touch scrolling.
          await cdp.send('Input.dispatchTouchEvent', {
            type: 'touchStart',
            touchPoints: [{ x: 195, y: 700 }],
          });
          for (let move = 1; move <= 10; move++) {
            await cdp.send('Input.dispatchTouchEvent', {
              type: 'touchMove',
              touchPoints: [{ x: 195, y: 700 - move * 50 }],
            });
          }
          await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
          await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(before);
          if ((await read(page)).onScreen !== anchor('prologue')) break;
        }
        await expect
          .poll(async () => {
            const { current, onScreen } = await read(page);
            return current === onScreen && current !== anchor('prologue');
          })
          .toBe(true);
        const swiped = await read(page);
        expect(swiped.current).not.toBe(anchor('prologue'));
        expect(swiped).toMatchObject({ hash: swiped.current, history: start.history });

        // Rotation at every chapter keeps the chapter.
        for (const chapter of CHAPTERS) {
          await page.setViewportSize({ width: 390, height: 844 });
          await load(page, `/${anchor(chapter)}`);
          await expectAt(page, chapter);
          await page.setViewportSize({ width: 844, height: 390 });
          await expectAt(page, chapter);
          await page.setViewportSize({ width: 390, height: 844 });
          await expectAt(page, chapter);
        }
      },
    );
  }
});

test.describe('reduced motion', () => {
  test.use({ contextOptions: { reducedMotion: 'reduce' } });

  test(
    'the vertical layout, and an arrow or a button jumps at once to the chapter',
    { annotation, tag },
    async ({ page }) => {
      await load(page);
      expect((await read(page)).layout).toBe('vertical');
      await page.locator('.hc-filmstrip a').first().focus();
      await page.keyboard.press('ArrowRight');
      await expectAt(page, 'origins');
      // At once: the chapter's top is at the window's top in the next frame.
      expect(
        Math.round(
          await page.evaluate(
            () => document.querySelector('#chapter-origins')!.getBoundingClientRect().top,
          ),
        ),
      ).toBe(0);
      // The bar is above the window now: Next, pressed from there, moves focus to the chapter.
      await page.getByRole('button', { name: 'Next chapter' }).dispatchEvent('click');
      await expectAt(page, 'journey');
      expect(await read(page)).toMatchObject({
        hash: anchor('journey'),
        focus: 'hc--title-journey',
      });
      await expect(page.locator('#hc--title-journey')).toBeInViewport();
    },
  );
});

test(
  'an arrow key in a form control or a widget is the control’s: no step, never cancelled',
  { annotation, tag },
  async ({ page }) => {
    await load(page);
    await watchKeys(page);
    await page.evaluate(() => {
      const prologue = document.querySelector('#chapter-prologue .hc-chapter__body')!;
      const field = document.createElement('input');
      field.id = 'probe-field';
      field.value = 'text';
      const slider = document.createElement('div');
      slider.id = 'probe-slider';
      slider.setAttribute('role', 'slider');
      slider.setAttribute('aria-label', 'Probe');
      slider.setAttribute('aria-valuenow', '1');
      slider.tabIndex = 0;
      prologue.prepend(field, slider);
    });
    for (const id of ['probe-field', 'probe-slider']) {
      await page.locator(`#${id}`).focus();
      await page.keyboard.press('ArrowRight');
      await page.keyboard.press('ArrowLeft');
    }
    await page.waitForTimeout(400);
    await expectAt(page, 'prologue');
    expect(await keys(page)).toEqual([false, false, false, false]);
  },
);

test.describe('without JavaScript', () => {
  test.use({ javaScriptEnabled: false });

  test(
    'every chapter is a plain link away, and nothing waits on a script',
    { annotation },
    async ({ page }) => {
      await page.goto('/', { waitUntil: 'load' });
      await expect(page.locator('.hc-chapter')).toHaveCount(5);
      await expect(page.locator('.hc-transport')).toBeHidden();
      for (const chapter of CHAPTERS) {
        await page
          .locator('.hc-filmstrip a', { hasText: LABELS[CHAPTERS.indexOf(chapter)]! })
          .click();
        await expect(page).toHaveURL(new RegExp(`${anchor(chapter)}$`));
        await expect(page.locator(anchor(chapter))).toBeInViewport();
      }
      await page.locator('.hc-chrome__index').click();
      await expect(page.locator('#chapter-index')).toBeInViewport();
    },
  );
});

test(
  'in a frame, no input writes the frame’s history or its hash',
  { annotation, tag },
  async ({ page, app }) => {
    // The public pages refuse every frame ancestor; this test lets its own host page frame it.
    await page.route(`${app.origin}/frame-host`, (route) =>
      route.fulfill({
        contentType: 'text/html',
        body: '<!doctype html><title>Host</title><iframe title="Cinema" src="/" style="width:1400px;height:860px;border:0"></iframe>',
      }),
    );
    await page.route(`${app.origin}/`, async (route) => {
      const response = await route.fetch();
      const headers = { ...response.headers() };
      headers['content-security-policy'] = (headers['content-security-policy'] ?? '').replace(
        /frame-ancestors[^;]*/,
        "frame-ancestors 'self'",
      );
      delete headers['x-frame-options'];
      await route.fulfill({ response, headers });
    });
    await page.goto('/frame-host', { waitUntil: 'load' });
    const frame = page.frames().find((each) => each !== page.mainFrame())!;
    await expect(frame.locator('.hc-cinema')).toHaveAttribute('data-ready', '');
    const entries = await page.evaluate(() => window.history.length);

    await frame.locator('.hc-filmstrip a').first().focus();
    await page.keyboard.press('ArrowRight');
    await page.keyboard.press('ArrowRight');
    await expectAt(frame, 'journey');
    await frame.getByRole('button', { name: 'Next chapter' }).click();
    await expectAt(frame, 'craft');
    await frame.locator('.hc-filmstrip a', { hasText: 'Origins' }).click();
    await expectAt(frame, 'origins');
    expect(await read(frame)).toMatchObject({ hash: '', focus: 'hc--title-origins' });
    expect(await page.evaluate(() => window.history.length)).toBe(entries);
    expect(await frame.evaluate(() => window.history.length)).toBe(entries);
  },
);
