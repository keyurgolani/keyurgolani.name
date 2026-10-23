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

/** The page's preview frame, once its document is a grant's. */
export async function grantFrame(page: Page): Promise<Frame> {
  await expect.poll(() => page.frames().some(isGrantFrame)).toBe(true);
  return page.frames().find(isGrantFrame)!;
}

/**
 * Seeds a draft whose portfolio names `name`, with `site`'s text when one is
 * given, signs in, and opens /studio/preview with its frame ready. Returns
 * the session's CSRF token and the frame.
 */
export async function openPreview(
  page: Page,
  app: App,
  password: string,
  name: string,
  site?: string,
): Promise<{ csrf: string; frame: Frame }> {
  await seedDraft(app, name, site);
  const csrf = await signIn(page, app, password);
  await page.goto(PREVIEW_PAGE);
  await expect(stage(page)).toHaveAttribute('data-phase', 'ready');
  return { csrf, frame: await grantFrame(page) };
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
