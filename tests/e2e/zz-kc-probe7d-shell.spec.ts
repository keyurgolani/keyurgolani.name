import { test } from '../harness/fixtures';
import { CASES, check, optionsFor } from './zz-kc-probe7d';

test.use({ appOptions: optionsFor('shell') });

for (const c of CASES) {
  test(
    `probe7d shell ${c.route} ${c.scheme} ${c.width} ${c.candidate}`,
    {
      annotation: [
        { type: 'route', description: c.route },
        { type: 'profile', description: 'read-only' },
      ],
    },
    async ({ page }) => {
      test.setTimeout(300_000);
      await check(page, 'shell', c);
    },
  );
}
