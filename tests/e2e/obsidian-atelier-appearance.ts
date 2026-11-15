import { readFileSync } from 'node:fs';
import path from 'node:path';
import type { Page } from '@playwright/test';
import { fixtureSiteSelecting } from '../../packages/variant-contract/src/contract-fixtures';
import { contractFixture } from '../../packages/variant-contract/src/node/fixtures';
import { expect, test } from '../harness/fixtures';
import { focusFindings } from '../quality/lib/a11y/interaction';
import { inPage, type Active } from '../quality/lib/a11y/probe';

type Findings = Awaited<ReturnType<typeof focusFindings>>;

// Obsidian Atelier's chrome holds the visitor's Appearance control in its top row's corner, over the
// entrance. Where the open control sits, and on what, is the composition's in every mode but more
// contrast and reduced transparency, where the platform sets it on its own plate. Shared by
// obsidian-atelier-appearance-panel.spec.ts and its guards, on the missing-media contract fixture's
// home in Warm Parchment, the visitor's mode set by the appearance cookie.

const FIXTURE = contractFixture('missing-media');
const DIR = path.dirname(FIXTURE.files.portfolio);
export const annotation = [
  { type: 'route', description: '/' },
  { type: 'profile', description: 'read-only' },
];
export const tag = '@interaction';

export function onMissingMediaHome() {
  test.use({
    appOptions: {
      portfolio: FIXTURE.files.portfolio,
      siteText: fixtureSiteSelecting(
        readFileSync(FIXTURE.files.site, 'utf8'),
        'obsidian-atelier',
      ).replace(/colorScheme: .*/, 'colorScheme: warm-parchment'),
      sourceFiles: Object.fromEntries(
        FIXTURE.unitFiles.map((file) => [file, readFileSync(path.join(DIR, file), 'utf8')]),
      ),
    },
  });
}

export const SUMMARY = '.oa-chrome__appearance summary';
export const PANEL = '.oa-chrome__appearance [data-ui-slot="disclosure.content"]';
export const CONTROL = '.oa-chrome__appearance [data-ui-slot="appearance-control"]';
const ROW = ['.oa-chrome__mark', '.oa-chrome__rooms', '.oa-chrome__here', '.oa-chrome__dock'];

export interface Setting {
  mode: 'light' | 'dark';
  contrast?: 'more' | 'no-preference';
  transparency?: 'reduce';
  rootText?: '200%';
}

/** Home in a mode, the mode guarded, fonts in and two frames drawn. */
export async function home(page: Page, origin: string, setting: Setting) {
  await page.context().addCookies([
    {
      name: 'portfolio_appearance',
      value: new URLSearchParams({ scheme: 'warm-parchment', mode: setting.mode }).toString(),
      url: origin,
    },
  ]);
  await page.emulateMedia({ contrast: setting.contrast ?? 'no-preference' });
  if (setting.transparency) {
    const cdp = await page.context().newCDPSession(page);
    await cdp.send('Emulation.setEmulatedMedia', {
      media: '',
      features: [{ name: 'prefers-reduced-transparency', value: 'reduce' }],
    });
  }
  await page.goto('/', { waitUntil: 'networkidle' });
  await expect(page.locator('[data-variant]').first()).toHaveAttribute(
    'data-variant',
    'obsidian-atelier',
  );
  // The mode asked is the one shown: the boundary carries it, and dark its own color-scheme.
  const boundary = page.locator('[data-display-mode]').first();
  await expect(boundary).toHaveAttribute('data-display-mode', setting.mode);
  if (setting.mode === 'dark')
    expect(await boundary.evaluate((el) => getComputedStyle(el).colorScheme)).toBe('dark');
  if (setting.transparency)
    expect(
      await page.evaluate(() => matchMedia('(prefers-reduced-transparency: reduce)').matches),
    ).toBe(true);
  if (setting.rootText)
    await page.evaluate(() =>
      document.documentElement.style.setProperty('font-size', '200%', 'important'),
    );
  await expect(page.locator(SUMMARY)).toHaveCount(1);
  await page.evaluate(() => document.fonts.ready);
  await frames(page);
}

export const frames = (page: Page) =>
  page.evaluate(
    () => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done))),
  );

/** The chrome's row parts' tops and the summary's height, as laid out now. */
export const rowNow = (page: Page) =>
  page.evaluate(
    ({ row, summary }) => {
      const tops: Record<string, number> = {};
      for (const selector of row) {
        const el = document.querySelector(selector);
        const box = el?.getBoundingClientRect();
        if (box && box.width > 0 && box.height > 0) tops[selector] = Math.round(box.top * 10) / 10;
      }
      const s = document.querySelector(summary)!.getBoundingClientRect();
      return { tops, summary: Math.round(s.height * 10) / 10 };
    },
    { row: ROW, summary: SUMMARY },
  );

/** Opens the control from the keyboard: the summary focused, then Enter. */
export async function openFromKeyboard(page: Page) {
  const summary = page.locator(SUMMARY);
  await page.keyboard.press('Shift');
  await summary.focus();
  await page.keyboard.press('Enter');
  await expect(page.locator('.oa-chrome__appearance details')).toHaveAttribute('open', '');
  await frames(page);
}

/**
 * The open panel's text, each part with a text of its own: its color, the ground it reads on (the
 * nearest box, itself or an ancestor, with an opaque background), whether that ground is the panel's
 * own (the panel or a box inside it), and their contrast. Colors go through a canvas, so any color
 * syntax the cascade computes reads as sRGB.
 */
export const panelText = (page: Page) =>
  page.evaluate(
    ({ panel, control }) => {
      const canvas = document.createElement('canvas');
      canvas.width = canvas.height = 1;
      const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
      const rgba = (c: string) => {
        ctx.clearRect(0, 0, 1, 1);
        ctx.fillStyle = '#000';
        ctx.fillStyle = c;
        ctx.fillRect(0, 0, 1, 1);
        const d = ctx.getImageData(0, 0, 1, 1).data;
        return [d[0]!, d[1]!, d[2]!, d[3]! / 255] as const;
      };
      const lin = (v: number) => {
        const s = v / 255;
        return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
      };
      const lum = (c: readonly number[]) =>
        0.2126 * lin(c[0]!) + 0.7152 * lin(c[1]!) + 0.0722 * lin(c[2]!);
      const ratio = (a: readonly number[], b: readonly number[]) => {
        const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p);
        return Math.round(((x! + 0.05) / (y! + 0.05)) * 100) / 100;
      };
      const root = document.querySelector(panel)!;
      const plate = document.querySelector(control)!;
      const ground = (el: Element) => {
        for (let at: Element | null = el; at; at = at.parentElement) {
          const bg = rgba(getComputedStyle(at).backgroundColor);
          if (bg[3] >= 0.999) return { at, bg };
        }
        return { at: null, bg: rgba('#fff') };
      };
      const parts = [...root.querySelectorAll('*')].filter(
        (el) =>
          !el.closest('select, option') &&
          [...el.childNodes].some(
            (n) => n.nodeType === Node.TEXT_NODE && n.textContent!.trim() !== '',
          ) &&
          el.getBoundingClientRect().width > 0,
      );
      const box = root.getBoundingClientRect();
      return {
        parts: parts.map((el) => {
          const { at, bg } = ground(el);
          const color = rgba(getComputedStyle(el).color);
          return {
            text: el.textContent!.trim().slice(0, 32),
            own: at !== null && root.contains(at),
            onPlate: at === plate,
            ratio: ratio(color, bg),
          };
        }),
        panelBackground: getComputedStyle(root).backgroundColor,
        plateBackground: getComputedStyle(plate).backgroundColor,
        box: [box.left, box.top, box.right, box.bottom].map((n) => Math.round(n * 10) / 10),
        overflowing:
          root.scrollWidth > root.clientWidth + 1 || root.scrollHeight > root.clientHeight + 1,
        controlsInside: [
          ...root.querySelectorAll('select, input:not([type="hidden"]), button'),
        ].every((el) => {
          const r = el.getBoundingClientRect();
          return (
            r.width === 0 ||
            (r.left >= box.left - 0.5 &&
              r.right <= box.right + 0.5 &&
              r.top >= box.top - 0.5 &&
              r.bottom <= box.bottom + 0.5)
          );
        }),
        viewport: window.innerWidth,
        pageWide: document.scrollingElement!.scrollWidth,
      };
    },
    { panel: PANEL, control: CONTROL },
  );

/** Tab from the summary through the panel: each stop's focus findings, until focus leaves it. */
export async function walkPanel(page: Page) {
  const stops: { name: string; findings: Findings }[] = [];
  for (let i = 0; i < 12; i += 1) {
    await page.keyboard.press('Tab');
    await frames(page);
    const inside = await page.evaluate(
      (panel) => document.querySelector(panel)!.contains(document.activeElement),
      PANEL,
    );
    if (!inside) break;
    const active = await inPage<Active>(page, { kind: 'active' });
    const name = await page.evaluate(() => {
      const el = document.activeElement as HTMLElement;
      return `${el.tagName.toLowerCase()} ${el.getAttribute('name') ?? ''} ${el.textContent?.trim().slice(0, 24) ?? ''}`.trim();
    });
    stops.push({ name, findings: await focusFindings(page, active) });
  }
  return stops;
}
