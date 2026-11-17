import { test } from '../harness/fixtures';
import { readPrint, served } from './zz-probe';

test.use({ appOptions: served('raw-grid', 'complete') });

test(
  'probe print raw-grid',
  {
    annotation: [
      { type: 'route', description: '/' },
      { type: 'profile', description: 'read-only' },
    ],
  },
  async ({ page }) => {
    test.setTimeout(120_000);
    await readPrint(page, 'raw-grid');
  },
);
