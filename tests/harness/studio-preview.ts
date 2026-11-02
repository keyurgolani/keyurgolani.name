// The owner's /studio/preview in the browser (#7, Slice 4): the owner signs
// in through #2's form, a draft is seeded as the operator's CLI writes one,
// and the preview's frame is found by its path, below /preview/<grant>. The
// surface's stage says the frame's phase in data-phase, and its live region
// what a screen reader hears.
import { expect, type Frame, type Page, type Request } from '@playwright/test';
import type { App } from './fixtures';
import { seedDraft, signIn } from './preview-grants';

export const PREVIEW_PAGE = '/studio/preview';
export const LIFECYCLE = 'kgn-preview.lifecycle';

/** The surface's stage around the frame, whose data-phase says the frame's state. */
export const stage = (page: Page) => page.locator('.preview-surface__stage');
/** The preview frame's element. */
export const frameElement = (page: Page) => page.locator('iframe.preview-surface__frame');
/** The polite live region outside the frame. */
export const liveRegion = (page: Page) => page.locator('.preview-surface__live');

/** Whether `frame` shows a grant's document. */
function isGrantFrame(frame: Frame): boolean {
  try {
    return /^\/preview\/[A-Za-z0-9_-]{22}(?:\/|$)/.test(new URL(frame.url()).pathname);
  } catch {
    return false;
  }
}

/** The stage of the `index`th preview, in page order, for two compared frames (#7, item 7). */
export const stageAt = (page: Page, index: number) => stage(page).nth(index);
/** The `index`th preview frame's element, in page order. */
export const frameElementAt = (page: Page, index: number) => frameElement(page).nth(index);

/** The `index`th preview frame, once its document is a grant's. */
export async function grantFrameAt(page: Page, index: number): Promise<Frame> {
  const at = async () => (await frameElementAt(page, index).elementHandle())?.contentFrame();
  await expect
    .poll(async () => {
      const found = await at();
      return found ? isGrantFrame(found) : false;
    })
    .toBe(true);
  return (await at())!;
}

/** The page's preview frame, once its document is a grant's. */
export async function grantFrame(page: Page): Promise<Frame> {
  await expect.poll(() => page.frames().some(isGrantFrame)).toBe(true);
  return page.frames().find(isGrantFrame)!;
}

/**
 * Seeds a draft whose portfolio names `name`, or is `portfolio`'s text, with
 * `site`'s text when one is given, signs in, and opens /studio/preview with
 * its frame ready. Returns the session's CSRF token and the frame.
 */
export async function openPreview(
  page: Page,
  app: App,
  password: string,
  name: string,
  site?: string,
  portfolio?: string,
): Promise<{ csrf: string; frame: Frame }> {
  await seedDraft(app, name, site, portfolio);
  const csrf = await signIn(page, app, password);
  await page.goto(PREVIEW_PAGE);
  await expect(stage(page)).toHaveAttribute('data-phase', 'ready');
  return { csrf, frame: await grantFrame(page) };
}

/**
 * Signs in, opens /studio/preview on the working draft, already seeded with
 * media, and checks its frame on `origin` renders the work cover's image
 * from `file` below its grant's /preview-assets (#10): loaded, 200, and no
 * CSP refusal in the page or the frame.
 */
export async function expectFrameImage(
  page: Page,
  app: App,
  password: string,
  file: string,
  origin: string,
): Promise<void> {
  const refusals: string[] = [];
  page.on('console', (message) => {
    if (/Content Security Policy/i.test(message.text())) refusals.push(message.text());
  });
  const loaded: string[] = [];
  page.on('response', (response) => {
    const url = new URL(response.url());
    if (url.pathname.startsWith('/preview-assets/') && response.status() === 200) {
      loaded.push(`${url.origin}${url.pathname}`);
    }
  });
  await signIn(page, app, password);
  await page.goto(PREVIEW_PAGE);
  await expect(stage(page)).toHaveAttribute('data-phase', 'ready');
  const frame = await grantFrame(page);
  expect(new URL(frame.url()).origin).toBe(origin);
  const grant = new URL(frame.url()).pathname.split('/')[2]!;
  const image = frame.locator('img[alt="Rows of identical seedlings"]');
  await expect(image).toBeVisible();
  // It may load lazily: in view, it loads.
  await image.scrollIntoViewIfNeeded();
  await expect
    .poll(() =>
      image.evaluate((element: HTMLImageElement) => element.complete && element.naturalWidth),
    )
    .toBeGreaterThan(0);
  expect(await image.evaluate((element: HTMLImageElement) => element.currentSrc)).toBe(
    `${origin}/preview-assets/${grant}/${file}`,
  );
  expect(loaded).toContain(`${origin}/preview-assets/${grant}/${file}`);
  expect(refusals).toEqual([]);
}

/** Every grant command the page sends from now on, by name. */
export function recordGrantCommands(page: Page): string[] {
  const names: string[] = [];
  page.on('request', (request: Request) => {
    const match = /\/api\/studio\/(preview\.grant\.[a-z]+)$/.exec(new URL(request.url()).pathname);
    if (match && request.frame() === page.mainFrame()) names.push(match[1]!);
  });
  return names;
}

/** The lifecycle Studio last sent `frame`, or null. */
export const lifecycleIn = (frame: Frame) =>
  frame.evaluate(
    (key) => (window as unknown as Record<symbol, unknown>)[Symbol.for(key)] ?? null,
    LIFECYCLE,
  );

/** The environment attributes on `frame`'s presentation boundary. */
export const environmentIn = (frame: Frame) =>
  frame.evaluate(() => {
    const boundary = document.querySelector('[data-variant]');
    const read = (name: string) => boundary?.getAttribute(name) ?? null;
    return {
      displayMode: read('data-display-mode'),
      contrast: read('data-contrast'),
      motion: read('data-motion'),
      enhancement: read('data-enhancement'),
    };
  });
