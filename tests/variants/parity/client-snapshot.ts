// The createRoot half of render parity (#5, Slice 6): the variant rendered by the browser bundle in a
// test page of its own, from the input buildRenderInput() builds there.
import type { Page } from '@playwright/test';
import type { ParityNode } from '../../../packages/variant-contract/src/node/parity';
import type { RenderInputArgs } from '../../../packages/variant-contract/src/render-input';
import type { ParityBundles } from './bundles';

/** The test page: an empty document with the root the bundle renders into. */
const TEST_PAGE = '<!doctype html><html lang="en"><body><div id="root"></div></body></html>';

/**
 * The boundary's snapshot at the createRoot render's first commit, rendered in `page`.
 * client-entry.tsx puts renderBoundary() on window, which snapshots the render's commit before an
 * enhancement can load into it.
 */
export async function clientSnapshot(
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
