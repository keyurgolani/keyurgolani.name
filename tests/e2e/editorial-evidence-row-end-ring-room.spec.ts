import { readdirSync } from 'node:fs';
import path from 'node:path';
import { expect, test } from '@playwright/test';
import { contractFixture } from '../../packages/variant-contract/src/node/fixtures';
import { startApp } from '../harness/app-server.mjs';
import { fixtureApp, UNDER_TEST } from '../variants/target';

// On a phone a row's end, a plate link or a date, goes under its title. Every row with an end keeps
// a focus ring's reach between the title's text, a link's underline with it, and the end's own box,
// so a focused end link's ring never lies on the title. In every typography, at 390 on a touch
// phone, on the complete contract fixture.

const FIXTURE = contractFixture('complete');
const VARIANT = UNDER_TEST.find(({ manifest }) => manifest.id === 'editorial-evidence')!;
const TYPOGRAPHIES = readdirSync(
  path.join(import.meta.dirname, '../../packages/appearance-typography/packs'),
).sort();

for (const typography of TYPOGRAPHIES) {
  test.describe(typography, () => {
    test.describe.configure({ mode: 'default' });
    let app: { origin: string; stop: () => Promise<void> } | undefined;
    test.beforeAll(async () => {
      const options = fixtureApp(FIXTURE, VARIANT);
      app = await startApp({
        ...options,
        siteText: (options.siteText ?? '').replace(/typography: .*/, `typography: ${typography}`),
      });
    });
    test.afterAll(async () => {
      await app?.stop();
    });
    test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });

    test(`in ${typography} at 390 on a touch phone, each row's end keeps a ring's reach below its title`, async ({
      page,
    }) => {
      await page.goto(`${app!.origin}/`, { waitUntil: 'networkidle' });
      await page.evaluate(() => document.fonts.ready);
      const read = await page.evaluate(() => {
        const root = document.querySelector('[data-variant]')!;
        const probe = document.createElement('span');
        probe.style.cssText = 'position: absolute; inline-size: var(--layout-ee-ring)';
        root.append(probe);
        const reach = probe.getBoundingClientRect().width;
        probe.remove();
        const rows = [...document.querySelectorAll('.ee-row__line')].flatMap((line) => {
          const end = line.querySelector(':scope > .ee-row__end');
          const title = line.querySelector(':scope > .ee-row__title');
          if (!end || !title) return [];
          const range = document.createRange();
          range.selectNodeContents(title);
          const text = [...range.getClientRects()].filter((r) => r.width > 0);
          if (text.length === 0) return [];
          const bottom = Math.max(...text.map((r) => r.bottom));
          const top = (end.querySelector('a') ?? end).getBoundingClientRect().top;
          return [
            {
              row: line.closest('.ee-row')?.id ?? '',
              gap: Math.round((top - bottom) * 100) / 100,
            },
          ];
        });
        return { reach, rows };
      });
      console.log(`${typography} at 390: ${JSON.stringify(read)}`);
      expect(read.rows.length, 'the home page has rows with an end').toBeGreaterThan(0);
      expect(
        read.rows.filter(({ gap }) => gap < read.reach - 0.01),
        `rows whose end comes within a ring's reach (${read.reach}px) of the title`,
      ).toEqual([]);
    });
  });
}
