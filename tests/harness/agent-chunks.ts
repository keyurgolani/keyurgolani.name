// Where the preview agent's code loads (#7, Slice 3): the scripts a page or
// its frames load, with their bodies, and the strings that mark the agent's
// code and Studio's half of the channel in any build of them.
import type { Frame, Page, Request, Response } from '@playwright/test';

/** The marker every build of the agent's code holds: the protocol's name. */
export const AGENT_MARKER = 'kgn-preview';

/** A string only Studio's half of the channel holds, which no preview document may load. */
export const STUDIO_HALF_MARKER = 'The frame is in no window.';

/** How long the page goes with no request open, after `load`, before what it loaded counts as all. */
export const QUIET_MS = 500;

/** Whether `frame` shows a preview document. */
export function isPreviewFrame(frame: Frame): boolean {
  try {
    return new URL(frame.url()).pathname.startsWith('/preview/');
  } catch {
    return false;
  }
}

/**
 * Every script the page or its frames loaded while `load` ran, by URL, with
 * its body: those from a frame `from` takes, or all of them. Once `load`
 * resolves it waits until every request from those frames has finished, of
 * any kind, since a document or a fetch can start the next script, and
 * until QUIET_MS have passed since `load` resolved and since the last of them
 * started or finished, which it times itself. Playwright's networkidle marks
 * a page once and never again, so a page that went quiet before its frame
 * mounted would have it wait out the test's timeout.
 */
export async function scriptsDuring(
  page: Page,
  load: () => Promise<unknown>,
  from: (frame: Frame) => boolean = () => true,
  { quietMs = QUIET_MS, timeoutMs = 20_000 } = {},
): Promise<Map<string, string>> {
  const scripts = new Map<string, Promise<string>>();
  const open = new Set<Request>();
  let changed = Date.now();
  const counted = (request: Request) => {
    try {
      return from(request.frame());
    } catch {
      return false;
    }
  };
  const started = (request: Request) => {
    if (!counted(request)) return;
    open.add(request);
    changed = Date.now();
  };
  const ended = (request: Request) => {
    if (!open.delete(request)) return;
    changed = Date.now();
  };
  const record = (response: Response) => {
    const request = response.request();
    if (request.resourceType() === 'script' && counted(request)) {
      scripts.set(
        response.url(),
        response.text().catch(() => ''),
      );
    }
  };
  page.on('request', started);
  page.on('requestfinished', ended);
  page.on('requestfailed', ended);
  page.on('response', record);
  try {
    await load();
    changed = Date.now();
    const deadline = Date.now() + timeoutMs;
    while (open.size > 0 || Date.now() - changed < quietMs) {
      if (Date.now() > deadline) {
        throw new Error(
          `scriptsDuring: ${open.size} request(s) still open after ${timeoutMs} ms: ${[...open]
            .map((request) => request.url())
            .join(', ')}`,
        );
      }
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
  } finally {
    page.off('request', started);
    page.off('requestfinished', ended);
    page.off('requestfailed', ended);
    page.off('response', record);
  }
  return new Map(
    await Promise.all([...scripts].map(async ([url, body]) => [url, await body] as const)),
  );
}
