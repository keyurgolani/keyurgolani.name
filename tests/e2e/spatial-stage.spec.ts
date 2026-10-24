import { readFileSync } from 'node:fs';
import path from 'node:path';
import type { Page, Response } from '@playwright/test';
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

/** The exit, disabled: the stage can't run again on this page. */
async function expectExitDisabled(page: Page) {
  const exit = page.getByRole('button', { name: 'Spatial stage' });
  await expect(exit).toBeDisabled();
  await expect(exit).toHaveAttribute('aria-pressed', 'false');
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
    // The exit, pressed while the stage runs.
    await expect(page.getByRole('button', { name: 'Spatial stage' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    // Decoration: the canvas is hidden from assistive technology, inside the hidden still.
    await expect(page.locator('canvas[data-spatial-canvas]')).toHaveAttribute(
      'aria-hidden',
      'true',
    );
    expect(await reading(page)).toEqual(before);
  },
);

test.describe('on a 2x screen', () => {
  test.use({ deviceScaleFactor: 2 });

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
    const exit = page.getByRole('button', { name: 'Spatial stage' });
    await exit.focus();
    await page.keyboard.press('Enter');
    await expect(exit).toHaveAttribute('aria-pressed', 'false');
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
    await page.getByRole('button', { name: 'Spatial stage' }).tap();
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
