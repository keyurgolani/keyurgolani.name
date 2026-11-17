import { test } from '../harness/fixtures';
import { readPrint, served } from './zz-probe';

test.use({ appOptions: served('kinetic-cosmos', 'complete') });

test(
  'probe print kinetic-cosmos',
  {
    annotation: [
      { type: 'route', description: '/' },
      { type: 'profile', description: 'read-only' },
    ],
  },
  async ({ page }) => {
    test.setTimeout(120_000);
    await readPrint(page, 'kinetic-cosmos');
  },
);
