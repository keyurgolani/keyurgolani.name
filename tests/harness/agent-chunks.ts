// Where the preview agent's code loads (#7, Slice 3): the scripts a page or
// its frames load, with their bodies, and the strings that mark the agent's
// code and Studio's half of the channel in any build of them.
import type { Frame, Page, Response } from '@playwright/test';

/** The marker every build of the agent's code holds: the protocol's name. */
export const AGENT_MARKER = 'kgn-preview';

/** A string only Studio's half of the channel holds, which no preview document may load. */
export const STUDIO_HALF_MARKER = 'The frame is in no window.';

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
 * its body: those from a frame `from` takes, or all of them.
 */
export async function scriptsDuring(
  page: Page,
  load: () => Promise<unknown>,
  from: (frame: Frame) => boolean = () => true,
): Promise<Map<string, string>> {
  const scripts = new Map<string, Promise<string>>();
  const record = (response: Response) => {
    if (response.request().resourceType() === 'script' && from(response.frame())) {
      scripts.set(
        response.url(),
        response.text().catch(() => ''),
      );
    }
  };
  page.on('response', record);
  await load();
  await page.waitForLoadState('networkidle');
  page.off('response', record);
  return new Map(
    await Promise.all([...scripts].map(async ([url, body]) => [url, await body] as const)),
  );
}
