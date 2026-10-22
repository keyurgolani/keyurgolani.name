import type { Page } from '@playwright/test';
import { contractFixture } from '../../packages/variant-contract/src/node/fixtures';
import {
  compareSnapshots,
  snapshotBoundary,
  type ParityNode,
} from '../../packages/variant-contract/src/node/parity';
import { expect, test } from '../harness/fixtures';
import { parityBundles } from './parity/bundles';
import { FIXED_TIME, projectTarget, READ_ONLY } from './target';

// Render parity (#5, Slice 6): for a registered composition and a contract
// fixture, the boundary the host's server sends matches a react-dom/server
// render of the variant outside Next and a createRoot render of its .
// export in a test page, all from the input buildRenderInput() builds at the
// fixed clock's time. They compare as the tags, text, roles, links, and ids
// in the boundary.

/** The boundary in `html`, parsed in the page without running any of it. */
function snapshotHtml(page: Page, html: string): Promise<ParityNode | null> {
  return page.evaluate(
    ({ html, source }) => {
      const parsed = new DOMParser().parseFromString(html, 'text/html');
      // The comparator's own function, which reads nothing from outside itself.
      return (0, eval)(`(${source})`)(parsed);
    },
    { html, source: snapshotBoundary.toString() },
  );
}

test(
  'the server, react-dom/server, and createRoot render the same boundary',
  { annotation: [{ type: 'route', description: '/' }, READ_ONLY] },
  async ({ page, request, app }, testInfo) => {
    const { variant, fixture } = projectTarget(testInfo);
    // The host's page before the bundles. Importing the server half holds
    // the event loop, and a request sent straight after it can go out on a
    // keep-alive socket the server closed meanwhile, unseen. Node's server
    // closes one idle for 6 s, and Playwright's API requests keep theirs
    // until it does.
    const response = await request.get('/');
    expect(response.status()).toBe(200);
    const host = await snapshotHtml(page, await response.text());
    expect(host, 'the host renders a boundary').not.toBeNull();

    const bundles = await parityBundles();
    const args = bundles.renderArgs(
      contractFixture(fixture!).files,
      variant.manifest.id,
      app.origin,
      FIXED_TIME,
    );
    const server = await snapshotHtml(page, await bundles.renderBoundary(args));
    expect(compareSnapshots(host, server), 'react-dom/server').toEqual([]);

    await page.setContent(
      '<!doctype html><html lang="en"><body><div id="root"></div></body></html>',
    );
    await page.addScriptTag({ content: bundles.client });
    // client-entry.tsx puts renderBoundary() on window, which snapshots the
    // render's commit before an enhancement can load into it.
    const client = await page.evaluate(
      (input) =>
        (
          window as unknown as { renderBoundary(i: unknown): Promise<ParityNode | null> }
        ).renderBoundary(input),
      args,
    );
    expect(compareSnapshots(host, client), 'createRoot').toEqual([]);
  },
);
