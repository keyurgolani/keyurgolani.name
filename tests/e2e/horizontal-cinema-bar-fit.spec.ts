import { readFileSync } from 'node:fs';
import path from 'node:path';
import type { Page } from '@playwright/test';
import { fixtureSiteSelecting } from '../../packages/variant-contract/src/contract-fixtures';
import { contractFixture } from '../../packages/variant-contract/src/node/fixtures';
import { expect, test } from '../harness/fixtures';
import { reflowFindings } from '../quality/lib/a11y/conditions';
import { keyboardFindings } from '../quality/lib/a11y/interaction';
import { loadForPass } from '../quality/lib/run-cell';
import { sweepSiteText } from '../quality/lib/server';
import { creditsGone, pastTheirScene } from './horizontal-cinema-bars';

// Horizontal Cinema's scene is a grid of one column, and it clips. Its column was sized by what its
// rows hold, so a bottom bar whose credit and Next link set wider than the scene widened the column
// past the scene's own edge: the bars ran on under the clip, and their ends were cut off. At 1024 by
// 768 a monospace label face sets "1 testimonial" and "Next: Services title" wide enough for that:
// under Primer Inspired, Sunset Ember and Book Serif on the system's light, the release run's focus
// check read the Next link's ring at 337 of its 380 centre line points at 3:1, and under Terminal
// Chrome, Blue Orange Color Safe and Shell Mono in the dark, 340 of 378, alike by default, under
// more contrast and in forced colors: the ring's end side and the ends of its long sides lay past
// the scene's edge. Here, loaded as the quality cells load it and settled with its enhancements
// mounted, each scene's bars and everything in them lie inside the scene, a bottom bar's credit keeps
// some of its width, and the keyboard walk's focus check passes at every Next link. On the complete
// contract fixture, the packs and mode by the appearance cookie, guarded on the page's outermost
// boundary. The long-text fixture's own pin is horizontal-cinema-bar-fit-long-text.spec.ts.
//
// A bar keeps inside its scene by wrapping, never by cutting its words short: below, the cells'
// reflow check finds nothing in a bar clipped by its own box.

const FIXTURE = contractFixture('complete');
const DIR = path.dirname(FIXTURE.files.portfolio);
const annotation = [
  { type: 'route', description: '/' },
  { type: 'profile', description: 'read-only' },
];
const tag = '@interaction';

test.use({
  appOptions: {
    portfolio: FIXTURE.files.portfolio,
    siteText: sweepSiteText(
      fixtureSiteSelecting(readFileSync(FIXTURE.files.site, 'utf8'), 'horizontal-cinema'),
    ),
    sourceFiles: Object.fromEntries(
      FIXTURE.unitFiles.map((file) => [file, readFileSync(path.join(DIR, file), 'utf8')]),
    ),
  },
  colorScheme: 'light',
  viewport: { width: 1024, height: 768 },
});

interface Tuple {
  readonly name: string;
  readonly language: string;
  readonly scheme: string;
  readonly type: string;
  readonly mode: string;
}

const TUPLES: readonly Tuple[] = [
  {
    name: "Primer Inspired, Sunset Ember and Book Serif on the system's light",
    language: 'primer-inspired',
    scheme: 'sunset-ember',
    type: 'book-serif',
    mode: 'system',
  },
  {
    name: 'Terminal Chrome, Blue Orange Color Safe and Shell Mono in the dark',
    language: 'terminal-chrome',
    scheme: 'blue-orange-color-safe',
    type: 'shell-mono',
    mode: 'dark',
  },
];

const CONDITIONS = {
  'by default': { condition: 'default', contextOptions: {} },
  'under more contrast': { condition: 'more', contextOptions: { contrast: 'more' } },
  'in forced colors': { condition: 'forced', contextOptions: { forcedColors: 'active' } },
} as const;

async function load(page: Page, origin: string, tuple: Tuple, condition: string) {
  await page.context().addCookies([
    {
      name: 'portfolio_appearance',
      value: new URLSearchParams({
        language: tuple.language,
        scheme: tuple.scheme,
        type: tuple.type,
        mode: tuple.mode,
      }).toString(),
      url: origin,
    },
  ]);
  const loaded = await loadForPass(page, '/');
  expect(
    { settled: loaded.settled, enhanced: loaded.enhanced },
    `the page settles with its enhancements: ${loaded.held ?? ''}`,
  ).toEqual({ settled: true, enhanced: true });
  const boundary = page.locator('[data-appearance-boundary]').first();
  await expect(boundary).toHaveAttribute('data-design-language', tuple.language);
  await expect(boundary).toHaveAttribute('data-color-scheme', tuple.scheme);
  await expect(boundary).toHaveAttribute('data-typography', tuple.type);
  await expect(boundary).toHaveAttribute('data-display-mode', tuple.mode);
  const media = await page.evaluate(() => ({
    forced: matchMedia('(forced-colors: active)').matches,
    more: matchMedia('(prefers-contrast: more)').matches,
  }));
  expect(media, 'the emulated preferences').toEqual({
    forced: condition === 'forced',
    more: condition === 'more',
  });
  await page.evaluate(() => document.fonts.ready);
}

for (const tuple of TUPLES)
  for (const [named, { condition, contextOptions }] of Object.entries(CONDITIONS))
    test.describe(`${tuple.name} ${named}`, () => {
      test.use({ contextOptions });
      test(
        `at 1024 in ${tuple.name} ${named}, each scene's bars lie inside the scene and every Next link rings whole`,
        { annotation, tag },
        async ({ page, app }) => {
          test.setTimeout(360_000);
          await load(page, app.origin, tuple, condition);
          const past = await pastTheirScene(page);
          const gone = await creditsGone(page);
          // The quality cells' own keyboard walk: each focus finding at a bar's Next link, by its element.
          const findings = await keyboardFindings(page, { focus: true, occlusion: true });
          const next: string[] = [];
          for (const finding of findings) {
            if (finding.gate !== 'focus' || !finding.path) continue;
            const isNext = await page
              .locator(finding.path)
              .first()
              .evaluate((el) => el.matches('.hc-bar__next'))
              .catch(() => false);
            if (isNext) next.push(`${finding.rule}: ${finding.actual} (${finding.path})`);
          }
          expect(
            { past, gone, next },
            "every bar inside its scene, its credit there, and every Next link's ring",
          ).toEqual({ past: [], gone: [], next: [] });
        },
      );
    });

// With the root text at 200%, the cells' reflow check at 1024 by 768 reads a box whose content runs
// past it as clipped: a bar's words cut short to fit, on one line under an ellipsis, are words the
// visitor loses. In these two, where the bars' words run long at that size, no bar item is clipped
// by its own box under any of the reflow check's conditions: they wrap instead.
const REFLOW: readonly Tuple[] = [
  {
    name: 'Raw Brutalist, Sepia Film and Console Mono in the light',
    language: 'raw-brutalist',
    scheme: 'sepia-film',
    type: 'console-mono',
    mode: 'light',
  },
  {
    name: "Platform Neutral, Jewel Twilight and Humanist UI on the system's light",
    language: 'platform-neutral',
    scheme: 'jewel-twilight',
    type: 'humanist-ui',
    mode: 'system',
  },
];

for (const tuple of REFLOW)
  test(
    `in ${tuple.name}, the cells' reflow check, its 200% root text at 1024 among them, finds no bar item clipped by its own box`,
    { annotation, tag },
    async ({ page, app }) => {
      test.setTimeout(360_000);
      await load(page, app.origin, tuple, 'default');
      const findings = await reflowFindings(page, '/');
      const inBars: string[] = [];
      for (const finding of findings) {
        if (!finding.path) continue;
        const inBar = await page
          .locator(finding.path)
          .first()
          .evaluate((el) => el.closest('.hc-bar') !== null)
          .catch(() => false);
        if (inBar)
          inBars.push(
            `${finding.rule} at ${finding.viewport}: ${finding.actual} (${finding.path})`,
          );
      }
      expect(inBars, 'no bar item clipped by its own box').toEqual([]);
    },
  );
