import { test } from '../harness/fixtures';
import { readTitles, served } from './zz-probe';

test.use({ appOptions: served('kinetic-cosmos', 'complete') });

test(
  'probe title complete',
  {
    annotation: [
      { type: 'route', description: '/work' },
      { type: 'profile', description: 'read-only' },
    ],
  },
  async ({ page }) => {
    test.setTimeout(600_000);
    await readTitles(page, 'complete');
  },
);
