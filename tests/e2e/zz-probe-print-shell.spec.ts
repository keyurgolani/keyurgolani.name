import { test } from '../harness/fixtures';
import { readPrint, served } from './zz-probe';

test.use({ appOptions: served('shell', 'complete') });

test(
  'probe print shell',
  {
    annotation: [
      { type: 'route', description: '/' },
      { type: 'profile', description: 'read-only' },
    ],
  },
  async ({ page }) => {
    test.setTimeout(120_000);
    await readPrint(page, 'shell');
  },
);
