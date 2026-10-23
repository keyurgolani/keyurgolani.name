import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import type { Page } from '@playwright/test';
import { expect, test } from '../harness/fixtures';

// The focus ring and the skip link on every page a visitor can land on
// (#19, Slice 4; #11's 2.4.7 and 1.4.11, as #84 asks): the site's pages and
// its 404, in the site's document boundary, and the error page and the 503,
// in the platform's fallback packs' boundary, at 390 px wide. The first Tab
// is the boundary's skip link, and every focused control shows a ring at
// least 3:1 against what's behind it. The error page and the 503 render
// here from their own code, the component and unavailablePage(), inside the
// site's own stylesheets, since no route of a running app shows them on
// demand.

const WEB = fileURLToPath(new URL('../../apps/web/', import.meta.url));
const TSX = createRequire(import.meta.url).resolve('tsx/cli');

/**
 * The error page's and the 503's HTML, from apps/web/scripts/fallback-pages.ts,
 * run as the host's unit tests run: Playwright compiles the JSX it loads.
 */
function fallbackPages(): { readonly error: string; readonly unavailable: string } {
  const run = spawnSync(
    process.execPath,
    [TSX, '--import', './scripts/server-only.cjs', 'scripts/fallback-pages.ts'],
    { cwd: WEB, encoding: 'utf8', timeout: 60_000 },
  );
  if (run.status !== 0) throw new Error(`fallback-pages.ts: ${run.stderr}`);
  return JSON.parse(run.stdout) as { error: string; unavailable: string };
}

test.use({ viewport: { width: 390, height: 844 } });

/** The WCAG contrast ratio of two sRGB colors. */
function contrast(a: readonly number[], b: readonly number[]): number {
  const luminance = ([r, g, b]: readonly number[]) => {
    const [lr, lg, lb] = [r!, g!, b!].map((channel) => {
      const c = channel / 255;
      return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
    });
    return 0.2126 * lr! + 0.7152 * lg! + 0.0722 * lb!;
  };
  const [light, dark] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (light! + 0.05) / (dark! + 0.05);
}

/** What the focused element shows: its ring's style, width, and color, and the opaque color behind it. */
function focusedRing(page: Page) {
  return page.evaluate(() => {
    const element = document.activeElement as HTMLElement;
    const style = getComputedStyle(element);
    const rgb = (value: string) =>
      (value.match(/[\d.]+/g) ?? []).map(Number) as [number, number, number, number?];
    let behind: number[] | null = null;
    for (let node: Element | null = element.parentElement; node; node = node.parentElement) {
      const [r, g, b, a] = rgb(getComputedStyle(node).backgroundColor);
      if (a === undefined || a > 0.99) {
        behind = [r!, g!, b!];
        break;
      }
    }
    const box = element.getBoundingClientRect();
    return {
      slot: element.getAttribute('data-ui-slot'),
      text: element.textContent?.trim() ?? '',
      outlineStyle: style.outlineStyle,
      outlineWidth: parseFloat(style.outlineWidth),
      outline: rgb(style.outlineColor).slice(0, 3) as number[],
      behind:
        behind ??
        (rgb(getComputedStyle(document.documentElement).backgroundColor).slice(0, 3) as number[]),
      visible: box.width > 0 && box.height > 0 && box.bottom > 0 && box.top < innerHeight,
    };
  });
}

/** Tabs through the page: the skip link first, then each control, each with a ring at least 3:1. */
async function expectRings(page: Page, what: string, stops: number) {
  await page.keyboard.press('Tab');
  const first = await focusedRing(page);
  expect(first.slot, `${what}: the first Tab`).toBe('skip-link');
  expect(first.text, what).toBe('Skip to content');
  for (let stop = 0; stop <= stops; stop += 1) {
    const ring = stop === 0 ? first : (await page.keyboard.press('Tab'), await focusedRing(page));
    const at = `${what}, stop ${stop} (${ring.slot ?? ring.text})`;
    expect(ring.visible, at).toBe(true);
    expect(ring.outlineStyle, at).not.toBe('none');
    expect(ring.outlineWidth, at).toBeGreaterThanOrEqual(2);
    expect(contrast(ring.outline, ring.behind), at).toBeGreaterThanOrEqual(3);
  }
}

test(
  "the site's page and its 404 show a ring of at least 3:1 on every stop, the skip link first, at 390 px",
  {
    annotation: [
      { type: 'route', description: '/' },
      { type: 'route', description: '/[...view]' },
    ],
  },
  async ({ page }, testInfo) => {
    for (const [path, stops] of [
      ['/', 4],
      ['/no-such-page', 1],
    ] as const) {
      await page.goto(path);
      await page.waitForLoadState('networkidle');
      await expectRings(page, path, stops);
      await testInfo.attach(`ring${path.replace(/\//g, '-')}.png`, {
        body: await page.screenshot(),
        contentType: 'image/png',
      });
    }
  },
);

test(
  "the error page and the 503 render in the fallback packs' boundary, with the skip link first and a ring of at least 3:1, at 390 px",
  { annotation: { type: 'route', description: '/' } },
  async ({ page }, testInfo) => {
    // The site's own stylesheets, as its 404 loads them: the host's and the packs'.
    await page.goto('/no-such-page');
    const sheets = await page
      .locator('link[rel="stylesheet"]')
      .evaluateAll((links) => links.map((link) => link.getAttribute('href')!));
    const { error, unavailable } = fallbackPages();
    const head = sheets.map((href) => `<link rel="stylesheet" href="${href}">`).join('');
    for (const [name, html, stops] of [
      [
        'error',
        `<!doctype html><html lang="en"><head>${head}</head><body>${error}</body></html>`,
        1,
      ],
      ['503', unavailable, 0],
    ] as const) {
      await page.setContent(html, { waitUntil: 'load' });
      await expect(page.locator('[data-appearance-boundary="document"]'), name).toHaveAttribute(
        'data-variant',
        'fallback',
      );
      await expectRings(page, name, stops);
      await testInfo.attach(`ring-${name}.png`, {
        body: await page.screenshot(),
        contentType: 'image/png',
      });
    }
  },
);
