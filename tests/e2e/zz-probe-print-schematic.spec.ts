import { test } from '../harness/fixtures';
import { readPrint, served } from './zz-probe';

test.use({ appOptions: served('schematic', 'complete') });

test(
  'probe print schematic',
  {
    annotation: [
      { type: 'route', description: '/' },
      { type: 'profile', description: 'read-only' },
    ],
  },
  async ({ page }) => {
    test.setTimeout(120_000);
    await readPrint(page, 'schematic');
  },
);
