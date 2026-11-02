import { readFileSync } from 'node:fs';
import path from 'node:path';
import type { Frame, Page, Response } from '@playwright/test';
import { fixtureSiteSelecting } from '../../packages/variant-contract/src/contract-fixtures';
import { contractFixture } from '../../packages/variant-contract/src/node/fixtures';
import { expect, test } from '../harness/fixtures';
import { frameLoops, loadHome } from '../harness/motion';

// Spatial Bento's stage (#16), each path of its capability policy and its
// teardown, on the complete fixture. The suite's Chromium has no WebGL, so
// the unsupported path is the default; the supported ones launch it with
// SwiftShader, software WebGL, which needs no GPU and no download. Faults
// come from the browser, never from a switch in the app: a lost context
// through WEBGL_lose_context, a shader that won't compile through the
// context's own answer, and the stage's chunk failing to load. After each,
// the page's words, links, and URL are what they were before the stage ran.

const FIXTURE = contractFixture('complete');
const DIR = path.dirname(FIXTURE.files.portfolio);
const READ_ONLY = { type: 'profile', description: 'read-only' };
const annotation = [{ type: 'route', description: '/' }, READ_ONLY];
/** Software WebGL for the supported paths. */
const SOFTWARE_WEBGL = ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'];

test.use({
  appOptions: {
    portfolio: FIXTURE.files.portfolio,
    siteText: fixtureSiteSelecting(readFileSync(FIXTURE.files.site, 'utf8'), 'spatial-bento'),
    sourceFiles: Object.fromEntries(
      FIXTURE.unitFiles.map((file) => [file, readFileSync(path.join(DIR, file), 'utf8')]),
    ),
  },
  viewport: { width: 1280, height: 800 },
  launchOptions: { args: SOFTWARE_WEBGL },
});

/** Why the stage does what it does, as its slot says. */
const reason = (page: Page) => page.locator('.sb-stage').getAttribute('data-stage-reason');

/**
 * The page as a reader and a keyboard meet it: its words, its links, and
 * every control a keyboard could reach, in order, the stage's exit among
 * them, which is there in every state, and its URL.
 */
async function reading(page: Page) {
  return {
    ...(await page.locator('main').evaluate((main) => {
      const reached = [
        ...main.querySelectorAll<HTMLElement>('a[href], button, summary, [tabindex]'),
      ].map((element) => `${element.localName} ${element.textContent?.trim() ?? ''}`);
      const words = [
        ...main.querySelectorAll<HTMLElement>('h1, h2, h3, h4, h5, h6, p, li, dt, dd'),
      ].map((element) => element.textContent?.trim() ?? '');
      return { reached, words };
    })),
    url: page.url(),
  };
}

/** Every script the page fetched, as text, from the moment this starts. */
function scripts(page: Page): () => Promise<string[]> {
  const responses: Response[] = [];
  page.on('response', (response) => {
    if (response.request().resourceType() === 'script') responses.push(response);
  });
  return () => Promise.all(responses.map((response) => response.text().catch(() => '')));
}

/** The stage is drawing: its canvas has rendered a frame, and the still's planes have given way. */
async function expectLive(page: Page) {
  await expect.poll(() => reason(page), { timeout: 20_000 }).toBe('running');
  await expect(page.locator('.sb-still[data-stage="live"]')).toHaveCount(1, { timeout: 20_000 });
  await expect(page.locator('.sb-still canvas[data-spatial-canvas]')).toHaveCount(1);
}

/** The frames the page asks for while `act` runs and for 600 ms after it. */
async function framesAfter(page: Page, act: () => Promise<unknown>): Promise<number> {
  await page.evaluate(() => {
    const own = window as Window & { __sbFrames?: number; __sbRaf?: typeof requestAnimationFrame };
    own.__sbFrames = 0;
    own.__sbRaf = window.requestAnimationFrame;
    window.requestAnimationFrame = (callback) => {
      own.__sbFrames! += 1;
      return own.__sbRaf!.call(window, callback);
    };
  });
  await act();
  await page.waitForTimeout(600);
  return page.evaluate(() => {
    const own = window as Window & { __sbFrames?: number; __sbRaf?: typeof requestAnimationFrame };
    window.requestAnimationFrame = own.__sbRaf!;
    return own.__sbFrames ?? 0;
  });
}

/** What a disabled exit is described by. */
const UNAVAILABLE = "The 3D stage isn't available here.";

/** The exit, disabled: the stage can't run again on this page. */
async function expectExitDisabled(page: Page) {
  const exit = page.getByRole('button', { name: 'Static view' });
  await expect(exit).toBeDisabled();
  await expect(exit).toHaveAttribute('aria-pressed', 'true');
  // A disabled exit says why.
  await expect(exit).toHaveAccessibleDescription(UNAVAILABLE);
}

/** The still, and nothing of the stage: no canvas, and the planes showing. */
async function expectStill(page: Page) {
  await expect(page.locator('canvas[data-spatial-canvas]')).toHaveCount(0);
  await expect(page.locator('.sb-still[data-stage="live"]')).toHaveCount(0);
  await expect(page.locator('.sb-still__plane--near')).toBeVisible();
}

test(
  'supported: the stage loads after the policy says, draws, and holds its pixel ratio',
  { annotation },
  async ({ page }) => {
    const fetched = scripts(page);
    await loadHome(page, '/');
    const before = await reading(page);
    await expectLive(page);
    // The stage's own chunk, with three.js, came once the policy let it run.
    expect((await fetched()).some((text) => text.includes('WebGLRenderer'))).toBe(true);
    // The exit, unpressed and enabled while the stage runs, with nothing to explain.
    const exit = page.getByRole('button', { name: 'Static view' });
    await expect(exit).toHaveAttribute('aria-pressed', 'false');
    await expect(exit).toBeEnabled();
    await expect(exit).not.toHaveAttribute('aria-describedby');
    // Decoration: the canvas is hidden from assistive technology, inside the hidden still.
    await expect(page.locator('canvas[data-spatial-canvas]')).toHaveAttribute(
      'aria-hidden',
      'true',
    );
    expect(await reading(page)).toEqual(before);
  },
);

test(
  'idle: once its picture is drawn the stage asks for no frame, and a lift, a focus or a resize draws and stops again',
  { annotation },
  async ({ page }) => {
    await loadHome(page, '/');
    await expectLive(page);
    await page.mouse.move(1, 1);
    // Renders on demand: nothing on the picture changes, so nothing is drawn.
    expect(await frameLoops(page)).toBe(0);
    // A lift is a new picture: it asks for a frame, then none.
    expect(
      await framesAfter(page, () => page.locator('.sb-contents__row').nth(2).locator('a').hover()),
    ).toBeGreaterThan(0);
    await expect.poll(() => frameLoops(page, 500)).toBe(0);
    await page.mouse.move(1, 1);
    await expect.poll(() => frameLoops(page, 500)).toBe(0);
    expect(
      await framesAfter(page, () => page.locator('.sb-contents__row').nth(3).locator('a').focus()),
    ).toBeGreaterThan(0);
    await expect.poll(() => frameLoops(page, 500)).toBe(0);
    // So is a resize of the canvas, which clears it. (The planes' column has a fixed width, so a
    // wider window alone changes nothing on it and rightly draws nothing.)
    expect(
      await framesAfter(page, () =>
        page.locator('.sb-still__canvas').evaluate((frame) => {
          (frame as HTMLElement).style.inlineSize = '90%';
        }),
      ),
    ).toBeGreaterThan(0);
    await expect.poll(() => frameLoops(page, 500)).toBe(0);
  },
);

test.describe('on a 2x screen', () => {
  // At 1440, where the Contents planes take their whole track: from 1280 to 1440 a board's name
  // keeps its line and the plane beside it gives way first (S8), so the stage is under 100 px there.
  test.use({ deviceScaleFactor: 2, viewport: { width: 1440, height: 900 } });

  test(
    "the pixel ratio is capped at 1.5, so the drawing buffer is never the screen's",
    { annotation },
    async ({ page }) => {
      await loadHome(page, '/');
      await expectLive(page);
      const size = await page.locator('canvas[data-spatial-canvas]').evaluate((canvas) => ({
        css: (canvas as HTMLCanvasElement).clientWidth,
        buffer: (canvas as HTMLCanvasElement).width,
      }));
      expect(size.css).toBeGreaterThan(100);
      expect(size.buffer).toBeLessThanOrEqual(Math.ceil(size.css * 1.5));
    },
  );
});

test(
  'keyboard: the exit turns the stage off and on, and nothing else on the page moves',
  { annotation },
  async ({ page }) => {
    await loadHome(page, '/');
    await expectLive(page);
    const before = await reading(page);
    const exit = page.getByRole('button', { name: 'Static view' });
    await exit.focus();
    await page.keyboard.press('Enter');
    await expect(exit).toHaveAttribute('aria-pressed', 'true');
    await expect.poll(() => reason(page)).toBe('exited');
    await expectStill(page);
    expect(await reading(page)).toEqual(before);
    await expect(exit).toBeFocused();
    await page.keyboard.press('Space');
    await expectLive(page);
  },
);

test.describe('touch', () => {
  test.use({ hasTouch: true });

  test('a tap on the exit turns the stage off', { annotation }, async ({ page }) => {
    await loadHome(page, '/');
    await expectLive(page);
    await page.getByRole('button', { name: 'Static view' }).tap();
    await expect.poll(() => reason(page)).toBe('exited');
    await expectStill(page);
  });
});

test.describe('reduced motion', () => {
  test.use({ contextOptions: { reducedMotion: 'reduce' } });

  test(
    'the OS reducing motion keeps it off, with no frames asked for',
    { annotation },
    async ({ page }) => {
      await loadHome(page, '/');
      await expect.poll(() => reason(page)).toBe('reduced');
      await expectStill(page);
      await expectExitDisabled(page);
      expect(await frameLoops(page)).toBeLessThan(5);
    },
  );
});

test.describe('forced colors', () => {
  test.use({ contextOptions: { forcedColors: 'active' } });

  test('forced colors keep it off', { annotation }, async ({ page }) => {
    await loadHome(page, '/');
    await expect.poll(() => reason(page)).toBe('forced-colors');
    await expectStill(page);
    await expectExitDisabled(page);
  });
});

test('low power: a device that says it has 2 GB keeps it off', { annotation }, async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(Navigator.prototype, 'deviceMemory', {
      configurable: true,
      get: () => 2,
    });
  });
  await loadHome(page, '/');
  await expect.poll(() => reason(page)).toBe('low-memory');
  await expectStill(page);
  await expectExitDisabled(page);
});

test(
  'static: a preview going static ends it, and nothing renders after',
  { annotation },
  async ({ page }) => {
    await loadHome(page, '/');
    await expectLive(page);
    await page.evaluate(() =>
      document.querySelector('[data-variant]')!.setAttribute('data-motion', 'static'),
    );
    await expect.poll(() => reason(page)).toBe('reduced');
    await expectStill(page);
    expect(await frameLoops(page)).toBeLessThan(5);
  },
);

test(
  "preview: a preview's message turns it off, and a later one can't turn it on again",
  { annotation },
  async ({ page }) => {
    await loadHome(page, '/');
    await expectLive(page);
    const before = await reading(page);
    // As the frame channel applies a studio's environment, on the boundary.
    const enhancement = (value: 'on' | 'off') =>
      page.evaluate(
        (next) => document.querySelector('[data-variant]')!.setAttribute('data-enhancement', next),
        value,
      );
    await enhancement('off');
    await expect.poll(() => reason(page)).toBe('preview-off');
    await expectStill(page);
    await enhancement('on');
    // Time for the slot to see the change and, if it would, mount the stage again.
    await page.evaluate(() => new Promise((resolve) => setTimeout(resolve, 1_000)));
    expect(await reason(page)).toBe('preview-off');
    await expectStill(page);
    await expectExitDisabled(page);
    expect(await reading(page)).toEqual(before);
  },
);

test(
  'hidden: a background tab pauses it, with no frames, and keeps the stage',
  { annotation },
  async ({ page }) => {
    await loadHome(page, '/');
    await expectLive(page);
    await page.evaluate(() => {
      Object.defineProperty(document, 'visibilityState', {
        configurable: true,
        get: () => 'hidden',
      });
      document.dispatchEvent(new Event('visibilitychange'));
    });
    await expect.poll(() => reason(page)).toBe('paused');
    expect(await frameLoops(page)).toBeLessThan(5);
    await expect(page.locator('canvas[data-spatial-canvas]')).toHaveCount(1);
  },
);

test(
  'offscreen: scrolled past, it pauses with no frames, and runs again in view',
  { annotation },
  async ({ page }) => {
    await loadHome(page, '/');
    await expectLive(page);
    await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
    await expect.poll(() => reason(page)).toBe('paused');
    expect(await frameLoops(page)).toBeLessThan(5);
    await page.evaluate(() => window.scrollTo(0, 0));
    await expect.poll(() => reason(page)).toBe('running');
  },
);

test(
  'context loss: the stage tears down to the still, and the page reads the same',
  { annotation },
  async ({ page }) => {
    await loadHome(page, '/');
    const before = await reading(page);
    await expectLive(page);
    await page.locator('canvas[data-spatial-canvas]').evaluate((canvas) => {
      const gl = (canvas as HTMLCanvasElement).getContext('webgl2');
      gl?.getExtension('WEBGL_lose_context')?.loseContext();
    });
    await expect.poll(() => reason(page)).toBe('failed');
    await expectStill(page);
    await expectExitDisabled(page);
    expect(await reading(page)).toEqual(before);
    expect(await frameLoops(page)).toBeLessThan(5);
  },
);

test(
  "shader failure: a program that won't compile tears it down to the still",
  { annotation },
  async ({ page }) => {
    await page.addInitScript(() => {
      const COMPILE_STATUS = 0x8b81;
      const LINK_STATUS = 0x8b82;
      const shader = WebGL2RenderingContext.prototype.getShaderParameter;
      WebGL2RenderingContext.prototype.getShaderParameter = function (target, name) {
        return name === COMPILE_STATUS ? false : shader.call(this, target, name);
      };
      const program = WebGL2RenderingContext.prototype.getProgramParameter;
      WebGL2RenderingContext.prototype.getProgramParameter = function (target, name) {
        return name === LINK_STATUS ? false : program.call(this, target, name);
      };
    });
    await loadHome(page, '/');
    const before = await reading(page);
    await expect.poll(() => reason(page), { timeout: 20_000 }).toBe('failed');
    await expectStill(page);
    await expectExitDisabled(page);
    expect(await reading(page)).toEqual(before);
  },
);

test(
  "asset failure: the stage's chunk failing to load leaves the still, and the page reads the same",
  { annotation },
  async ({ page, context }) => {
    // The chunk that holds three.js's renderer fails; every other passes as it came.
    const failed: string[] = [];
    await context.route('**/_next/static/chunks/**', async (route) => {
      if (route.request().resourceType() !== 'script') return route.fallback();
      const response = await route.fetch();
      if ((await response.text()).includes('WebGLRenderer')) {
        failed.push(route.request().url());
        return route.abort('failed');
      }
      return route.fulfill({ response });
    });
    await loadHome(page, '/');
    const before = await reading(page);
    await expect.poll(() => reason(page), { timeout: 20_000 }).toBe('failed');
    expect(failed.length, 'the stage chunk the route failed').toBeGreaterThan(0);
    await expectStill(page);
    await expectExitDisabled(page);
    expect(await reading(page)).toEqual(before);
  },
);

test(
  'a resize under 768px ends the stage and hides the exit, and back over it the stage runs again',
  { annotation },
  async ({ page }) => {
    await loadHome(page, '/');
    await expectLive(page);
    await page.setViewportSize({ width: 700, height: 800 });
    await expect.poll(() => reason(page)).toBe('narrow');
    await expect(page.locator('canvas[data-spatial-canvas]')).toHaveCount(0);
    await expect(page.locator('.sb-stage__exit')).toBeHidden();
    await page.setViewportSize({ width: 1280, height: 800 });
    await expectLive(page);
    await expect(page.locator('.sb-stage__exit')).toBeVisible();
  },
);

test(
  'with a 20px default font, a 900px window runs the stage with its exit showing',
  { annotation },
  async ({ page }) => {
    // The browser's own default font size, which rem media queries follow, as a visitor's setting would.
    const cdp = await page.context().newCDPSession(page);
    await cdp.send('Page.setFontSizes', { fontSizes: { standard: 20, fixed: 16 } });
    await page.setViewportSize({ width: 900, height: 800 });
    await loadHome(page, '/');
    // A rem query would read 900px as narrow: 47.99rem is 960px here.
    expect(await page.evaluate(() => matchMedia('(max-width: 47.99rem)').matches)).toBe(true);
    // The opening stacks at that size, so the stage sits below the words: in view, it runs.
    await page.locator('.sb-stage').scrollIntoViewIfNeeded();
    await expectLive(page);
    await expect(page.getByRole('button', { name: 'Static view' })).toBeVisible();
  },
);

test('focus stays on the exit when the stage fails under it', { annotation }, async ({ page }) => {
  await loadHome(page, '/');
  await expectLive(page);
  const exit = page.getByRole('button', { name: 'Static view' });
  await exit.focus();
  await page.locator('canvas[data-spatial-canvas]').evaluate((canvas) => {
    const gl = (canvas as HTMLCanvasElement).getContext('webgl2');
    gl?.getExtension('WEBGL_lose_context')?.loseContext();
  });
  await expect.poll(() => reason(page)).toBe('failed');
  await expectExitDisabled(page);
  await expect(exit).toBeFocused();
  // Disabled, a press does nothing.
  await page.keyboard.press('Enter');
  await expect(exit).toHaveAttribute('aria-pressed', 'true');
  expect(await reason(page)).toBe('failed');
});

test(
  'a null context: the renderer gets no WebGL2 context, and the stage tears down to the still',
  { annotation },
  async ({ page }) => {
    // The runtime's probe still finds WebGL2; the stage's own canvas gets none.
    await page.addInitScript(() => {
      const original = HTMLCanvasElement.prototype.getContext;
      HTMLCanvasElement.prototype.getContext = function (
        this: HTMLCanvasElement,
        ...args: Parameters<HTMLCanvasElement['getContext']>
      ) {
        if (this.hasAttribute('data-spatial-canvas')) return null;
        return (original as (...rest: unknown[]) => RenderingContext | null).apply(this, args);
      } as HTMLCanvasElement['getContext'];
    });
    await loadHome(page, '/');
    const before = await reading(page);
    await expect.poll(() => reason(page), { timeout: 20_000 }).toBe('failed');
    await expectStill(page);
    await expectExitDisabled(page);
    expect(await reading(page)).toEqual(before);
    expect(await frameLoops(page)).toBeLessThan(5);
  },
);

test(
  'a draw call that throws tears the stage down to the still',
  { annotation },
  async ({ page }) => {
    await page.addInitScript(() => {
      for (const name of ['drawArrays', 'drawElements'] as const) {
        WebGL2RenderingContext.prototype[name] = () => {
          throw new Error(`${name} fails, as a driver might`);
        };
      }
    });
    await loadHome(page, '/');
    const before = await reading(page);
    await expect.poll(() => reason(page), { timeout: 20_000 }).toBe('failed');
    await expectStill(page);
    await expectExitDisabled(page);
    expect(await reading(page)).toEqual(before);
    expect(await frameLoops(page)).toBeLessThan(5);
  },
);

/**
 * The page in a frame on its own origin, as a #7 preview frame holds it.
 * The public page refuses every frame (frame-ancestors 'none'), and a
 * preview's own route takes only Studio's, so the test serves a host page
 * at /__stage-frame and lets that one origin frame the page: the stage reads
 * only whether it's framed, #7's lifecycle, and the boundary's attributes.
 */
async function loadFramed(page: Page): Promise<Frame> {
  await page.route(
    (url) => url.pathname === '/',
    async (route) => {
      const response = await route.fetch();
      const headers = { ...response.headers() };
      delete headers['x-frame-options'];
      const policy = headers['content-security-policy'];
      if (policy) {
        headers['content-security-policy'] = policy.replace(
          "frame-ancestors 'none'",
          "frame-ancestors 'self'",
        );
      }
      await route.fulfill({ response, headers });
    },
  );
  await page.route('**/__stage-frame', (route) =>
    route.fulfill({
      contentType: 'text/html',
      body: '<!doctype html><title>frame</title><iframe src="/" style="border:0;width:1280px;height:800px"></iframe>',
    }),
  );
  await page.goto('/__stage-frame');
  await expect.poll(() => page.frames().length).toBe(2);
  const frame = page.frames().find((one) => one !== page.mainFrame())!;
  await frame.waitForLoadState('networkidle');
  await expect.poll(() => frameReason(frame)).not.toBe('pending');
  return frame;
}

/** #7's lifecycle, as its frame agent dispatches it. */
function lifecycle(frame: Frame, state: 'visible' | 'hidden', focused: boolean) {
  return frame.evaluate(
    ([state, focused]) => {
      (window as unknown as Record<symbol, unknown>)[Symbol.for('kgn-preview.lifecycle')] = {
        state,
        focused,
      };
      window.dispatchEvent(new Event('kgn-preview-lifecycle'));
    },
    [state, focused] as const,
  );
}

const frameReason = (frame: Frame) => frame.locator('.sb-stage').getAttribute('data-stage-reason');

test(
  "in a frame the stage waits for #7's lifecycle, and a lifecycle pause unmounts it",
  { annotation },
  async ({ page }) => {
    const frame = await loadFramed(page);
    const exit = frame.getByRole('button', { name: 'Static view' });
    // No lifecycle yet: inactive, with no canvas and so no WebGL context, and the exit,
    // offered, is pressed while nothing runs: the still shows.
    expect(await frameReason(frame)).toBe('lifecycle');
    await expect(frame.locator('canvas[data-spatial-canvas]')).toHaveCount(0);
    await expect(exit).toBeEnabled();
    await expect(exit).toHaveAttribute('aria-pressed', 'true');
    await lifecycle(frame, 'visible', true);
    await expect.poll(() => frameReason(frame), { timeout: 20_000 }).toBe('running');
    await expect(frame.locator('canvas[data-spatial-canvas]')).toHaveCount(1);
    await expect(exit).toHaveAttribute('aria-pressed', 'false');
    await lifecycle(frame, 'visible', false);
    await expect.poll(() => frameReason(frame)).toBe('lifecycle');
    await expect(frame.locator('canvas[data-spatial-canvas]')).toHaveCount(0);
    await expect(exit).toHaveAttribute('aria-pressed', 'true');
    await lifecycle(frame, 'visible', true);
    await expect.poll(() => frameReason(frame), { timeout: 20_000 }).toBe('running');
  },
);

test(
  "in a frame, pressing the pressed exit while the stage waits for #7's lifecycle asks for it, so it runs once the lifecycle says active",
  { annotation },
  async ({ page }) => {
    const frame = await loadFramed(page);
    const exit = frame.getByRole('button', { name: 'Static view' });
    expect(await frameReason(frame)).toBe('lifecycle');
    await expect(exit).toHaveAttribute('aria-pressed', 'true');
    await exit.click();
    // Still waiting, and never opted out.
    expect(await frameReason(frame)).toBe('lifecycle');
    await expect(exit).toHaveAttribute('aria-pressed', 'true');
    await lifecycle(frame, 'visible', true);
    await expect.poll(() => frameReason(frame), { timeout: 20_000 }).toBe('running');
    await expect(exit).toHaveAttribute('aria-pressed', 'false');
    await expect(frame.locator('canvas[data-spatial-canvas]')).toHaveCount(1);
  },
);

for (const [name, off] of [
  ['data-contrast', 'more'],
  ['data-display-mode', 'high-contrast'],
  ['data-motion', 'reduced'],
  ['data-motion', 'static'],
  ['data-enhancement', 'off'],
] as const) {
  test(
    `in a frame, a preview's ${name}="${off}" ends the stage, and setting it back can't bring it back`,
    { annotation },
    async ({ page }) => {
      const frame = await loadFramed(page);
      await lifecycle(frame, 'visible', true);
      await expect.poll(() => frameReason(frame), { timeout: 20_000 }).toBe('running');
      const boundary = frame.locator('[data-variant]').first();
      const was = await boundary.getAttribute(name);
      // As the frame channel applies a studio's environment, on the boundary.
      await boundary.evaluate(
        (element, [attribute, value]) => element.setAttribute(attribute, value),
        [name, off] as const,
      );
      await expect.poll(() => frameReason(frame)).not.toBe('running');
      await expect(frame.locator('canvas[data-spatial-canvas]')).toHaveCount(0);
      await boundary.evaluate(
        (element, [attribute, value]) =>
          value === null
            ? element.removeAttribute(attribute)
            : element.setAttribute(attribute, value),
        [name, was] as const,
      );
      // Time for the slot to see the change and, if it would, mount the stage again.
      await frame.evaluate(() => new Promise((resolve) => setTimeout(resolve, 1_000)));
      expect(await frameReason(frame)).toBe('preview-off');
      await expect(frame.locator('canvas[data-spatial-canvas]')).toHaveCount(0);
    },
  );
}
