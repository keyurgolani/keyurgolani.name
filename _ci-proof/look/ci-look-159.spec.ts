// Look shots for 159's CI proof (laid in at the base and at the head by the proof kit, never in the head's
// tree): Obsidian Atelier's missing-media home, the
// chrome's top row over the entrance with the visitor's Appearance control closed and then opened from the
// keyboard, at 390 on phone emulation and at 1440, in light and dark, default contrast, Warm Parchment; each
// mode read back from the boundary (dark by its color-scheme too). And at 390 in light with the root text at
// 200%, closed and open. At 390 each state also writes how wide the page is and what sets any width past the
// phone's 390: the boxes past it that no child of theirs reaches as far, and the text runs past it.
// Self-contained: the base has none of the head's specs or helpers, so what it needs of them is here.
// Out: $PROOF_LOOK_OUT/<width>-<mode>[-200]-<closed|open>.png and, at 390, .json beside it.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { Page } from '@playwright/test';
import { fixtureSiteSelecting } from '../../packages/variant-contract/src/contract-fixtures';
import { contractFixture } from '../../packages/variant-contract/src/node/fixtures';
import { expect, test } from '../harness/fixtures';

const FIXTURE = contractFixture('missing-media');
const DIR = path.dirname(FIXTURE.files.portfolio);
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

const SUMMARY = '.oa-chrome__appearance summary';

interface Setting {
  mode: 'light' | 'dark';
  rootText?: '200%';
}

const frames = (page: Page) =>
  page.evaluate(
    () => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done))),
  );

/** Home in a mode, the mode guarded, fonts in and two frames drawn. */
async function home(page: Page, origin: string, setting: Setting) {
  await page.context().addCookies([
    {
      name: 'portfolio_appearance',
      value: new URLSearchParams({ scheme: 'warm-parchment', mode: setting.mode }).toString(),
      url: origin,
    },
  ]);
  await page.emulateMedia({ contrast: 'no-preference' });
  await page.goto('/', { waitUntil: 'networkidle' });
  await expect(page.locator('[data-variant]').first()).toHaveAttribute(
    'data-variant',
    'obsidian-atelier',
  );
  const boundary = page.locator('[data-display-mode]').first();
  await expect(boundary).toHaveAttribute('data-display-mode', setting.mode);
  if (setting.mode === 'dark')
    expect(await boundary.evaluate((el) => getComputedStyle(el).colorScheme)).toBe('dark');
  if (setting.rootText)
    await page.evaluate(() =>
      document.documentElement.style.setProperty('font-size', '200%', 'important'),
    );
  await expect(page.locator(SUMMARY)).toHaveCount(1);
  await page.evaluate(() => document.fonts.ready);
  await frames(page);
}

/** Opens the control from the keyboard: the summary focused, then Enter. */
async function openFromKeyboard(page: Page) {
  await page.keyboard.press('Shift');
  await page.locator(SUMMARY).focus();
  await page.keyboard.press('Enter');
  await expect(page.locator('.oa-chrome__appearance details')).toHaveAttribute('open', '');
  await frames(page);
}

function outDir() {
  const out = process.env.PROOF_LOOK_OUT ?? '';
  expect(out, 'PROOF_LOOK_OUT').not.toBe('');
  mkdirSync(out, { recursive: true });
  return out;
}

function shot(page: Page, name: string, width: number, height: number) {
  return page.screenshot({
    path: path.join(outDir(), `${name}.png`),
    clip: { x: 0, y: 0, width, height },
    animations: 'disabled',
    caret: 'hide',
  });
}

/** How wide the page lays out against the phone's width, and what sets any width past it. */
async function widths(page: Page, name: string, phone: number) {
  const read = await page.evaluate((edge) => {
    const r = (n: number) => Math.round(n * 10) / 10;
    const label = (el: Element) => {
      const cls =
        typeof el.className === 'string' ? el.className.trim().split(/\s+/).filter(Boolean) : [];
      const slot = el.getAttribute('data-ui-slot');
      return `${el.localName}${el.id ? `#${el.id}` : ''}${cls.length ? `.${cls.slice(0, 3).join('.')}` : ''}${slot ? `[data-ui-slot="${slot}"]` : ''}`;
    };
    const trail = (el: Element) => {
      const parts: string[] = [];
      for (let at: Element | null = el; at && at !== document.body; at = at.parentElement)
        parts.unshift(label(at));
      return parts.slice(-5).join(' > ');
    };
    const style = (el: Element) => {
      const cs = getComputedStyle(el);
      return {
        width: cs.width,
        minWidth: cs.minWidth,
        position: cs.position,
        whiteSpace: cs.whiteSpace,
        overflowWrap: cs.overflowWrap,
        wordBreak: cs.wordBreak,
        fontSize: cs.fontSize,
        display: cs.display,
      };
    };
    const past = [...document.body.querySelectorAll('*')]
      .map((el) => ({ el, box: el.getBoundingClientRect() }))
      .filter(({ box }) => box.width > 0 && box.height > 0 && box.right > edge + 0.5);
    const setters = past
      .filter(
        ({ el, box }) =>
          ![...el.children].some((c) => c.getBoundingClientRect().right >= box.right - 0.5),
      )
      .sort((a, b) => b.box.right - a.box.right)
      .slice(0, 10)
      .map(({ el, box }) => ({
        trail: trail(el),
        left: r(box.left),
        right: r(box.right),
        boxWidth: r(box.width),
        text: (el.textContent ?? '').trim().replace(/\s+/g, ' ').slice(0, 60),
        style: style(el),
      }));
    const runs: { trail: string; right: number; text: string; style: ReturnType<typeof style> }[] =
      [];
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      if (!(node.textContent ?? '').trim() || !node.parentElement) continue;
      const range = document.createRange();
      range.selectNodeContents(node);
      const box = range.getBoundingClientRect();
      if (box.width > 0 && box.right > edge + 0.5)
        runs.push({
          trail: trail(node.parentElement),
          right: r(box.right),
          text: (node.textContent ?? '').trim().replace(/\s+/g, ' ').slice(0, 60),
          style: style(node.parentElement),
        });
    }
    runs.sort((a, b) => b.right - a.right);
    return {
      pageWide: document.scrollingElement!.scrollWidth,
      innerWidth,
      clientWidth: document.documentElement.clientWidth,
      visualWidth: visualViewport ? r(visualViewport.width) : null,
      rootFontSize: getComputedStyle(document.documentElement).fontSize,
      boxesPast: past.length,
      setters,
      textRunsPast: runs.length,
      runs: runs.slice(0, 10),
    };
  }, phone);
  writeFileSync(path.join(outDir(), `${name}.json`), `${JSON.stringify(read, null, 2)}\n`);
}

async function lookAt(page: Page, origin: string, width: number, phone: boolean, setting: Setting) {
  const name = `${width}-${setting.mode}${setting.rootText ? '-200' : ''}`;
  await home(page, origin, setting);
  if (phone) await widths(page, `${name}-closed`, width);
  await shot(page, `${name}-closed`, width, 560);
  await openFromKeyboard(page);
  await page.waitForTimeout(150);
  if (phone) await widths(page, `${name}-open`, width);
  await shot(page, `${name}-open`, width, 560);
}

for (const [width, height, phone] of [
  [390, 844, true],
  [1440, 900, false],
] as const) {
  test.describe(`${width}`, () => {
    test.use(
      phone
        ? { viewport: { width, height }, isMobile: true, hasTouch: true }
        : { viewport: { width, height } },
    );
    for (const mode of ['light', 'dark'] as const) {
      test(`look ${width} ${mode}`, async ({ page, app }) => {
        await lookAt(page, app.origin, width, phone, { mode });
      });
    }
    if (phone)
      test(`look ${width} light 200% root text`, async ({ page, app }) => {
        await lookAt(page, app.origin, width, phone, { mode: 'light', rootText: '200%' });
      });
  });
}
