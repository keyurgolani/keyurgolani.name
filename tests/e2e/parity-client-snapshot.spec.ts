import { contractFixture } from '../../packages/variant-contract/src/node/fixtures';
import { expect, test } from '../harness/fixtures';
import { parityBundles } from '../variants/parity/bundles';
import { clientSnapshot } from '../variants/parity/client-snapshot';
import { FIXED_TIME } from '../variants/target';

// Render parity's createRoot half renders a composition with the browser bundle in a test page of its
// own. On CI Linux that page now and then lost its document while the render ran, whichever
// composition it was (Aurora Glass, Singular and Schematic each failed once with "Execution context
// was destroyed"), and the variants run has no retries. A page that loses its document once is no
// answer about the render: the half renders again on a new page. A render that sends its page to
// another address is one, and fails, naming it; so does a page that loses its document every time.

/** The bundle's renderBoundary() replaced by one that reloads the test page and never answers. */
const RELOADS =
  ';window.renderBoundary = () => { location.reload(); return new Promise(() => {}); };';

/** The bundle's renderBoundary() replaced by one that sends the test page to `url`. */
const MOVES = (url: string) =>
  `;window.renderBoundary = () => { location.assign(${JSON.stringify(url)}); return new Promise(() => {}); };`;

const target = async (origin: string) => {
  const bundles = await parityBundles();
  const args = bundles.renderArgs(contractFixture('rtl').files, 'schematic', origin, FIXED_TIME);
  return { bundles, args };
};

test('when its test page loses its document once during the render, the createRoot half renders again and answers', async ({
  page,
  app,
}) => {
  const { bundles, args } = await target(app.origin);
  let scripts = 0;
  const once = {
    get client() {
      scripts += 1;
      return scripts === 1 ? bundles.client + RELOADS : bundles.client;
    },
  };
  const snapshot = await clientSnapshot(page, once, args);
  expect(snapshot, 'the render answers').not.toBeNull();
  expect(scripts, 'the half ran twice').toBe(2);
});

test('when the render sends its test page to another address, the createRoot half fails, naming it', async ({
  page,
  app,
}) => {
  const { bundles, args } = await target(app.origin);
  const away = `${app.origin}/no-such-page`;
  await expect(
    clientSnapshot(page, { client: bundles.client + MOVES(away) }, args),
  ).rejects.toThrow(`The render moved its test page to ${away}`);
});

test('when its test page loses its document on every try, the createRoot half fails', async ({
  page,
  app,
}) => {
  const { bundles, args } = await target(app.origin);
  await expect(clientSnapshot(page, { client: bundles.client + RELOADS }, args)).rejects.toThrow(
    'Execution context was destroyed',
  );
});
