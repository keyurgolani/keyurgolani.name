import { test } from '../harness/fixtures';
import { readPrint, served } from './zz-probe';

test.use({ appOptions: served('swiss-signal', 'complete') });

test(
  'probe print swiss-signal',
  {
    annotation: [
      { type: 'route', description: '/' },
      { type: 'profile', description: 'read-only' },
    ],
  },
  async ({ page }) => {
    test.setTimeout(120_000);
    await readPrint(page, 'swiss-signal');
  },
);
