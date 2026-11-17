// The createRoot half of render parity (#5, Slice 6): the variant rendered by the browser bundle in a
// test page of its own, from the input buildRenderInput() builds there.
import type { Frame, Page } from '@playwright/test';
import type { ParityNode } from '../../../packages/variant-contract/src/node/parity';
import type { RenderInputArgs } from '../../../packages/variant-contract/src/render-input';
import type { ParityBundles } from './bundles';

/** The test page: an empty document with the root the bundle renders into. */
const TEST_PAGE = '<!doctype html><html lang="en"><body><div id="root"></div></body></html>';

/** Playwright's error for a page whose document went while a call ran in it. */
const LOST = /Execution context was destroyed/;

/** How long a lost page's next document has to commit before the half reads where it is. */
const COMMIT_MS = 5_000;

/** One render in `page`: the test page, the bundle's script, and renderBoundary()'s answer. */
async function render(
  page: Page,
  bundles: Pick<ParityBundles, 'client'>,
  args: RenderInputArgs,
): Promise<ParityNode | null> {
  await page.setContent(TEST_PAGE);
  await page.addScriptTag({ content: bundles.client });
  return page.evaluate(
    (input) =>
      (
        window as unknown as { renderBoundary(i: unknown): Promise<ParityNode | null> }
      ).renderBoundary(input),
    args,
  );
}

/**
 * The boundary's snapshot at the createRoot render's first commit, rendered in `page`.
 * client-entry.tsx puts renderBoundary() on window, which snapshots the render's commit before an
 * enhancement can load into it.
 *
 * On CI Linux the test page now and then lost its document while the render ran, whichever
 * composition it was, with nothing in the render that navigates. A page that loses its document
 * once says nothing about the render, so the half renders once more, on a new page. A render that
 * sends its page to another address fails at once, naming it, and a page that loses its document
 * on the second try fails too.
 */
export async function clientSnapshot(
  page: Page,
  bundles: Pick<ParityBundles, 'client'>,
  args: RenderInputArgs,
): Promise<ParityNode | null> {
  let current = page;
  try {
    for (let attempt = 1; ; attempt += 1) {
      const went: string[] = [];
      const on = current;
      const navigated = (frame: Frame) => {
        if (frame === on.mainFrame()) went.push(frame.url());
      };
      on.on('framenavigated', navigated);
      try {
        return await render(on, bundles, args);
      } catch (error) {
        if (!LOST.test(String(error))) throw error;
        // Where the page went: its context can go before its next document commits.
        if (went.length === 0)
          await on
            .waitForEvent('framenavigated', {
              predicate: (frame) => frame === on.mainFrame(),
              timeout: COMMIT_MS,
            })
            .catch(() => undefined);
        const away = [...went, on.url()].find((url) => url !== 'about:blank');
        if (away) throw new Error(`The render moved its test page to ${away}`, { cause: error });
        if (attempt > 1) throw error;
      } finally {
        on.off('framenavigated', navigated);
      }
      current = await page.context().newPage();
    }
  } finally {
    if (current !== page) await current.close();
  }
}
