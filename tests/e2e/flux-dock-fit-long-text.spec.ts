import { contractFixture } from '../../packages/variant-contract/src/node/fixtures';
import { test } from '../harness/fixtures';
import { appFor, expectDockHoldsItsName } from './flux-shared';

// Flux's phone dock on the long-text fixture's name, longer than two lines of the tab, so clamped
// on its second: at 320x568 and 390x844, at default and 200% root text, with script on and off, the
// name tab never cuts the name on a line, takes a second line only where one line doesn't fit,
// shows at most two at the label role's type and leading, keeps the whole name as the link's
// accessible name, and the root reserves the dock's height and a focus ring at the window's foot.
// Its own file, since a worker-scoped appOptions can't be set in a describe.

const annotation = [
  { type: 'route', description: '/' },
  { type: 'profile', description: 'read-only' },
];

test.use({ appOptions: appFor(contractFixture('long-text')) });

const windows = [
  [320, 568],
  [390, 844],
] as const;

for (const [width, height] of windows)
  for (const text of [1, 2])
    test(
      `at ${width}x${height}, root text ${text * 100}%: the dock holds its name and the root reserves it`,
      { annotation },
      async ({ page }) => {
        await expectDockHoldsItsName(page, { width, height, text });
      },
    );

test.describe('with JavaScript off', () => {
  test.use({ javaScriptEnabled: false });
  for (const [width, height] of windows)
    for (const text of [1, 2])
      test(
        `at ${width}x${height}, root text ${text * 100}%, no script: the dock holds its name and the root reserves it`,
        { annotation },
        async ({ page }) => {
          await expectDockHoldsItsName(page, { width, height, text });
        },
      );
});
