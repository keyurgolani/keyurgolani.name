import { readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Page } from '@playwright/test';
import { contractFixture } from '../../packages/variant-contract/src/node/fixtures';
import { expect, test } from '../harness/fixtures';
import { reflowConditions } from '../quality/lib/a11y/conditions';
import { frames } from '../quality/lib/a11y/interaction';
import { inPage } from '../quality/lib/a11y/probe';
import { sweepSiteText } from '../quality/lib/server';
import { appFor } from './flux-shared';

// Flux's bar on a phone, home and the case page. Docked at the foot, its one row keeps its phone
// layout under 200% root text, as the reflow check sets it (media queries read 16px), so its tools
// ran past the window at 320 and 390; wrapped into two rows it outgrew the reserve at the foot and
// lay over controls focus reached. Under 200% root text, on every typography, asked for by the
// visitor's appearance cookie on a site that lets the visitor choose it (the page's boundary must
// render the one asked for): the reflow check's probe finds nothing in the bar, the bar's box
// starts where the page's flow puts it, and no control Tab reaches from the top has its focus box,
// wholly or in part, under a bar fixed over the page. At default text, on the fixture's own, the
// bar stays docked at the foot in its one row, and the same holds.

const annotation = (route: string) => [
  { type: 'route', description: route },
  { type: 'profile', description: 'read-only' },
];

/** The visitor's preference cookie (apps/web/src/lib/document-appearance.ts). */
const APPEARANCE_COOKIE = 'portfolio_appearance';

/** The reflow check's root-text condition, from quality/thresholds.json. */
const ROOT_TEXT = reflowConditions().find((condition) => condition.rule === 'root-text')!;

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const TYPOGRAPHIES = readdirSync(path.join(ROOT, 'packages/appearance-typography/packs'), {
  withFileTypes: true,
})
  .filter((entry) => entry.isDirectory())
  .map((entry) => entry.name)
  .sort();

const ROUTES = ['/', '/work/project-name'];
const PHONES = [
  { width: 320, height: 568 },
  { width: 390, height: 844 },
];

// The visitor may choose the typography here, as the quality runner's sites let them.
const APP = appFor(contractFixture('complete'));
test.use({ appOptions: { ...APP, siteText: sweepSiteText(APP.siteText) } });

const open = async (page: Page, baseURL: string, route: string, typography: string | null) => {
  if (typography)
    await page
      .context()
      .addCookies([{ name: APPEARANCE_COOKIE, value: `type=${typography}`, url: baseURL }]);
  await page.goto(route, { waitUntil: 'networkidle' });
  await page.evaluate(() => document.fonts.ready.then(() => true));
  if (typography)
    await expect(page.locator('[data-appearance-boundary]').first()).toHaveAttribute(
      'data-typography',
      typography,
    );
};

/** What the reflow check's probe finds inside the bar, as it reads the page now. */
const reflowInBar = async (page: Page) => {
  const problems = await inPage<{ rule: string; path: string; detail: string }[]>(page, {
    kind: 'reflow',
  });
  return page.evaluate(
    (all) =>
      all
        .filter((problem) => document.querySelector(problem.path)?.closest('.fx-bar'))
        .map((problem) => `${problem.rule} ${problem.path}: ${problem.detail}`),
    problems,
  );
};

/** The bar: how it's placed, its box, the box its token gives, and its offset from its flow place. */
const bar = (page: Page) =>
  page.evaluate(() => {
    const el = document.querySelector<HTMLElement>('.fx-bar')!;
    const placed = el.getBoundingClientRect();
    const position = getComputedStyle(el).position;
    el.style.setProperty('position', 'static', 'important');
    const flow = el.getBoundingClientRect();
    el.style.removeProperty('position');
    const sizer = document.createElement('div');
    sizer.style.cssText =
      'position: absolute; visibility: hidden; block-size: var(--layout-fx-bar-box);';
    el.closest('.fx')!.append(sizer);
    const token = sizer.getBoundingClientRect().height;
    sizer.remove();
    return {
      position,
      top: placed.top,
      bottom: placed.bottom,
      height: placed.height,
      token,
      shift: Math.max(Math.abs(placed.top - flow.top), Math.abs(placed.left - flow.left)),
      window: window.innerHeight,
    };
  });

/** Every control Tab reaches from the top, outside the bar, whose focus box lies under a fixed bar. */
const underTheBar = async (page: Page) => {
  await page.evaluate(() => {
    window.scrollTo({ top: 0, behavior: 'instant' });
    (document.activeElement as HTMLElement | null)?.blur();
  });
  const seen = new Set<string>();
  const under: string[] = [];
  for (let presses = 0; presses < 300; presses += 1) {
    await page.keyboard.press('Tab');
    await page.evaluate(
      () => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done))),
    );
    const read = await page.evaluate(() => {
      const el = document.activeElement;
      if (!(el instanceof HTMLElement) || el === document.body) return null;
      const key: string[] = [];
      for (let node: Element | null = el; node && node !== document.body; node = node.parentElement)
        key.unshift(`${node.localName}:${[...(node.parentElement?.children ?? [])].indexOf(node)}`);
      const dock = document.querySelector<HTMLElement>('.fx-bar')!;
      if (el.closest('.fx-bar') || getComputedStyle(dock).position !== 'fixed')
        return { key: key.join('/'), hidden: null };
      const s = getComputedStyle(el);
      const reach = (parseFloat(s.outlineOffset) || 0) + (parseFloat(s.outlineWidth) || 0);
      const box = el.getBoundingClientRect();
      const top = dock.getBoundingClientRect().top;
      if (box.bottom + reach <= top) return { key: key.join('/'), hidden: null };
      const what = `${el.localName} "${(el.textContent ?? '').trim().slice(0, 30)}"`;
      const how = box.top - reach >= top ? 'wholly' : `${(box.bottom + reach - top).toFixed(1)}px`;
      return { key: key.join('/'), hidden: `${what} ${how} under the bar` };
    });
    if (read === null) continue;
    if (seen.has(read.key)) break;
    seen.add(read.key);
    if (read.hidden) under.push(read.hidden);
  }
  return under;
};

for (const route of ROUTES)
  for (const { width, height } of PHONES) {
    for (const typography of TYPOGRAPHIES)
      test(
        `on ${route} at ${width}x${height} under ${ROOT_TEXT.text * 100}% root text on ${typography}, the bar stays inside the window where the page's flow puts it, over no control focus reaches`,
        { annotation: annotation(route) },
        async ({ page, baseURL }) => {
          await page.setViewportSize({ width, height });
          await open(page, baseURL!, route, typography);
          // The root text as the reflow check sets it (conditions.ts, reflowFindings).
          await page.evaluate(
            (scale) =>
              document.documentElement.style.setProperty(
                'font-size',
                `${scale * 100}%`,
                'important',
              ),
            ROOT_TEXT.text,
          );
          await frames(page);
          await page.evaluate(() => document.fonts.ready.then(() => true));
          expect(await reflowInBar(page), "the reflow check's probe in the bar").toEqual([]);
          const placed = await bar(page);
          expect(placed.shift, "the bar's box off where the page's flow puts it (px)").toBeLessThan(
            0.5,
          );
          expect(await underTheBar(page), 'focus under the bar').toEqual([]);
        },
      );
    test(
      `on ${route} at ${width}x${height} at default text, the bar stays docked at the foot in its one row, over no control focus reaches`,
      { annotation: annotation(route) },
      async ({ page, baseURL }) => {
        await page.setViewportSize({ width, height });
        await open(page, baseURL!, route, null);
        await frames(page);
        expect(await reflowInBar(page), "the reflow check's probe in the bar").toEqual([]);
        const placed = await bar(page);
        expect(placed.position, 'the bar is docked').toBe('fixed');
        expect(Math.abs(placed.bottom - placed.window), 'at the foot (px)').toBeLessThan(0.5);
        expect(placed.height, 'its one row, inside its token (px)').toBeLessThanOrEqual(
          placed.token + 0.5,
        );
        expect(await underTheBar(page), 'focus under the bar').toEqual([]);
      },
    );
  }
