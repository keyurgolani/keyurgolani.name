import { readFileSync } from 'node:fs';
import path from 'node:path';
import type { Page } from '@playwright/test';
import { fixtureSiteSelecting } from '../../packages/variant-contract/src/contract-fixtures';
import { contractFixture } from '../../packages/variant-contract/src/node/fixtures';
import { expect, test } from '../harness/fixtures';
import { keyboardFindings } from '../quality/lib/a11y/interaction';
import { loadForPass } from '../quality/lib/run-cell';
import { sweepSiteText } from '../quality/lib/server';

// Horizontal Cinema rounds each scene by the packs' media radius and clips it. Bauhaus Geometric's
// media radius is 999px, which a scene's box cuts to half its shorter side, so every scene clipped
// to a stadium. The bars' ends and the chapter cards' numbers sit in a scene's corners: each bar's
// Next link rang only in part or not at all when it took focus, and a number painted little or
// nothing of itself. In Bauhaus Geometric and Humanist UI, loaded as the quality cells load it,
// settled with its enhancements mounted: every bar's Next link, its ring with it, and every chapter
// card's number lies inside its scene's rounded corners, and the keyboard walk's focus check passes
// at every Next link. In Low Stimulus Warm's dark at 1440 by default and under forced colors and at
// 1024 under more contrast, and in Warm Parchment on the system's light at 1024 under more
// contrast. On the complete contract fixture, the packs and mode by the appearance cookie, guarded
// on the page's outermost boundary.

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
});

interface Setting {
  scheme: 'low-stimulus-warm' | 'warm-parchment';
  mode: 'dark' | 'system';
  condition: 'default' | 'forced' | 'more';
}

async function load(page: Page, origin: string, setting: Setting) {
  await page.context().addCookies([
    {
      name: 'portfolio_appearance',
      value: new URLSearchParams({
        language: 'bauhaus-geometric',
        scheme: setting.scheme,
        type: 'humanist-ui',
        mode: setting.mode,
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
  await expect(boundary).toHaveAttribute('data-design-language', 'bauhaus-geometric');
  await expect(boundary).toHaveAttribute('data-color-scheme', setting.scheme);
  await expect(boundary).toHaveAttribute('data-typography', 'humanist-ui');
  await expect(boundary).toHaveAttribute('data-display-mode', setting.mode);
  const media = await page.evaluate(() => ({
    forced: matchMedia('(forced-colors: active)').matches,
    more: matchMedia('(prefers-contrast: more)').matches,
  }));
  expect(media, 'the emulated preferences').toEqual({
    forced: setting.condition === 'forced',
    more: setting.condition === 'more',
  });
  await page.evaluate(() => document.fonts.ready);
}

/**
 * Every bar's Next link and every chapter card's number whose box falls outside its scene's rounded
 * corners, with the scene's corner radii as drawn. The Next link rings inside its own box.
 */
function outsideTheCorners(page: Page) {
  return page.evaluate(() => {
    const r = (n: number) => Math.round(n * 10) / 10;
    const out: string[] = [];
    const radii = (scene: Element) => {
      const s = getComputedStyle(scene);
      const b = scene.getBoundingClientRect();
      const pair = (value: string): [number, number] => {
        const [x, y = x] = value.split(' ').map((part) => Number.parseFloat(part) || 0);
        return [x!, y!];
      };
      const corners = {
        topLeft: pair(s.borderTopLeftRadius),
        topRight: pair(s.borderTopRightRadius),
        bottomRight: pair(s.borderBottomRightRadius),
        bottomLeft: pair(s.borderBottomLeftRadius),
      };
      // Radii that overlap on a side scale down together, as the box draws them.
      const f = Math.min(
        1,
        b.width / (corners.topLeft[0] + corners.topRight[0] || 1),
        b.width / (corners.bottomLeft[0] + corners.bottomRight[0] || 1),
        b.height / (corners.topLeft[1] + corners.bottomLeft[1] || 1),
        b.height / (corners.topRight[1] + corners.bottomRight[1] || 1),
      );
      for (const key of Object.keys(corners) as (keyof typeof corners)[]) {
        corners[key] = [corners[key][0] * f, corners[key][1] * f];
      }
      return { b, corners };
    };
    const inside = (x: number, y: number, scene: ReturnType<typeof radii>) => {
      const { b, corners } = scene;
      const check = (
        [rx, ry]: [number, number],
        cx: number,
        cy: number,
        inX: boolean,
        inY: boolean,
      ) =>
        !(inX && inY) || rx === 0 || ry === 0 || ((x - cx) / rx) ** 2 + ((y - cy) / ry) ** 2 <= 1;
      const [tl, tr, br, bl] = [
        corners.topLeft,
        corners.topRight,
        corners.bottomRight,
        corners.bottomLeft,
      ];
      return (
        check(tl, b.left + tl[0], b.top + tl[1], x < b.left + tl[0], y < b.top + tl[1]) &&
        check(tr, b.right - tr[0], b.top + tr[1], x > b.right - tr[0], y < b.top + tr[1]) &&
        check(br, b.right - br[0], b.bottom - br[1], x > b.right - br[0], y > b.bottom - br[1]) &&
        check(bl, b.left + bl[0], b.bottom - bl[1], x < b.left + bl[0], y > b.bottom - bl[1])
      );
    };
    for (const el of document.querySelectorAll<HTMLElement>(
      '.hc-bar__next, .hc-intertitle__number',
    )) {
      const scene = el.closest('.hc-scene');
      if (!scene || el.getClientRects().length === 0) continue;
      const shape = radii(scene);
      const b = el.getBoundingClientRect();
      const [x0, y0, x1, y1] = [b.left, b.top, b.right, b.bottom];
      const cut = (
        [
          ['top start', x0, y0],
          ['top end', x1, y0],
          ['bottom end', x1, y1],
          ['bottom start', x0, y1],
        ] as const
      ).filter(([, x, y]) => !inside(x, y, shape));
      if (cut.length === 0) continue;
      const c = shape.corners;
      out.push(
        `${el.className} "${(el.textContent ?? '').trim().slice(0, 32)}" in #${scene.id}: ${cut
          .map(([corner]) => corner)
          .join(', ')} outside the corners (box ${[x0, y0, x1, y1].map(r).join(', ')}, scene ${[
          shape.b.left,
          shape.b.top,
          shape.b.right,
          shape.b.bottom,
        ]
          .map(r)
          .join(', ')}, radii ${[c.topLeft, c.topRight, c.bottomRight, c.bottomLeft]
          .map(([x, y]) => `${r(x)}/${r(y)}`)
          .join(' ')})`,
      );
    }
    return out;
  });
}

async function check(page: Page, origin: string, setting: Setting) {
  await load(page, origin, setting);
  const corners = await outsideTheCorners(page);
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
  expect({ corners, next }, 'every Next link and chapter number inside its scene').toEqual({
    corners: [],
    next: [],
  });
}

test.describe('1440 default', () => {
  test.use({ viewport: { width: 1440, height: 900 } });
  test(
    "at 1440 in Low Stimulus Warm's dark, every bar's Next link and chapter number lies inside its scene's corners and rings",
    { annotation, tag },
    async ({ page, app }) => {
      test.setTimeout(360_000);
      await check(page, app.origin, {
        scheme: 'low-stimulus-warm',
        mode: 'dark',
        condition: 'default',
      });
    },
  );
});

test.describe('1440 forced colors', () => {
  test.use({ viewport: { width: 1440, height: 900 }, contextOptions: { forcedColors: 'active' } });
  test(
    "at 1440 in Low Stimulus Warm's dark under forced colors, every bar's Next link and chapter number lies inside its scene's corners and rings",
    { annotation, tag },
    async ({ page, app }) => {
      test.setTimeout(360_000);
      await check(page, app.origin, {
        scheme: 'low-stimulus-warm',
        mode: 'dark',
        condition: 'forced',
      });
    },
  );
});

test.describe('1024 more contrast', () => {
  test.use({ viewport: { width: 1024, height: 768 }, contextOptions: { contrast: 'more' } });
  test(
    "at 1024 in Low Stimulus Warm's dark under more contrast, every bar's Next link and chapter number lies inside its scene's corners and rings",
    { annotation, tag },
    async ({ page, app }) => {
      test.setTimeout(360_000);
      await check(page, app.origin, {
        scheme: 'low-stimulus-warm',
        mode: 'dark',
        condition: 'more',
      });
    },
  );
  test(
    "at 1024 in Warm Parchment on the system's light under more contrast, every bar's Next link and chapter number lies inside its scene's corners and rings",
    { annotation, tag },
    async ({ page, app }) => {
      test.setTimeout(360_000);
      await check(page, app.origin, {
        scheme: 'warm-parchment',
        mode: 'system',
        condition: 'more',
      });
    },
  );
});
