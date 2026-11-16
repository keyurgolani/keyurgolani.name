import { readFileSync } from 'node:fs';
import path from 'node:path';
import type { Page } from '@playwright/test';
import { fixtureSiteSelecting } from '../../packages/variant-contract/src/contract-fixtures';
import { contractFixture } from '../../packages/variant-contract/src/node/fixtures';
import { expect, test } from '../harness/fixtures';
import { clearOfStuckCovers } from '../quality/lib/a11y/covers';
import { keyboardFindings, type Finding } from '../quality/lib/a11y/interaction';
import { sweepSiteText } from '../quality/lib/server';

// Horizontal Cinema's bars each end in a Next link, which rings inside its own box. In Bauhaus
// Geometric and Humanist UI, on the strip at 1440 and 1024, the quality cells' keyboard walk read
// every one of those rings short, by default as under forced colors and more contrast: no pixel
// changed when the link took focus, or too few of the changed pixels reached 3:1 for a 1px ring,
// or too little of its perimeter did. Walked from the keyboard as the cells walk it, every bar's
// Next link passes the focus check: in Low Stimulus Warm's dark at 1440 by default and under
// forced colors and at 1024 under more contrast, and in Warm Parchment on the system's light at
// 1024 under more contrast.
// On the complete contract fixture, the visitor's packs and mode by the appearance cookie, each
// guarded on the page's outermost boundary.

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

const NEXT = /\.hc-bar__next\b/;

interface Setting {
  scheme: 'low-stimulus-warm' | 'warm-parchment';
  mode: 'dark' | 'system';
  condition: 'default' | 'forced' | 'more';
}

const frames = (page: Page) =>
  page.evaluate(
    () => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done))),
  );

/** One Next link's ring where it rests focused: its box, its bar's, what the ring's line hits. */
function ringAt(page: Page, selector: string) {
  return page.evaluate((selector) => {
    const el = document.querySelector<HTMLElement>(selector);
    if (!el) return { selector, missing: true };
    const r = (n: number) => Math.round(n * 10) / 10;
    const box = (at: Element | null) => {
      if (!at) return null;
      const b = at.getBoundingClientRect();
      return [r(b.left), r(b.top), r(b.right), r(b.bottom)];
    };
    const name = (at: Element | null) =>
      at
        ? `${at.localName}${typeof at.className === 'string' && at.className ? `.${at.className.trim().split(/\s+/).join('.')}` : ''}`
        : 'nothing';
    const cs = getComputedStyle(el);
    const bar = el.closest('.hc-bar');
    const stage = document.querySelector('.hc-stage');
    const b = el.getBoundingClientRect();
    const w = Number.parseFloat(cs.outlineWidth) || 0;
    const o = Number.parseFloat(cs.outlineOffset) || 0;
    // The ring's centre line, from the box's edge out by the offset and half its width.
    const d = o + w / 2;
    const [x0, y0, x1, y1] = [b.left - d, b.top - d, b.right + d, b.bottom + d];
    const points: Record<string, [number, number]> = {
      top: [(x0 + x1) / 2, y0],
      bottom: [(x0 + x1) / 2, y1],
      start: [x0, (y0 + y1) / 2],
      end: [x1, (y0 + y1) / 2],
    };
    const hits = Object.fromEntries(
      Object.entries(points).map(([side, [x, y]]) => [
        side,
        x < 0 || y < 0 || x >= innerWidth || y >= innerHeight
          ? 'outside the viewport'
          : name(document.elementFromPoint(x, y)),
      ]),
    );
    const barStyle = bar ? getComputedStyle(bar) : null;
    const stageStyle = stage ? getComputedStyle(stage) : null;
    const sb = stage?.getBoundingClientRect();
    const scene = el.closest('.hc-scene')?.getBoundingClientRect();
    return {
      text: (el.textContent ?? '').trim(),
      focused: document.activeElement === el,
      focusVisible: el.matches(':focus-visible'),
      box: box(el),
      bar: box(bar),
      scene: box(el.closest('.hc-scene')),
      stage: box(stage),
      along: stage ? r(Math.abs(stage.scrollLeft)) : null,
      viewport: [innerWidth, innerHeight],
      outline: `${cs.outlineWidth} ${cs.outlineStyle} ${cs.outlineColor}, offset ${cs.outlineOffset}`,
      color: cs.color,
      background: cs.backgroundColor,
      forcedColorAdjust: cs.forcedColorAdjust,
      barBackground: barStyle?.backgroundColor ?? null,
      barBorder: barStyle ? `${barStyle.borderTop} | ${barStyle.borderBottom}` : null,
      // Where the strip rests: whether the link lies inside the stage's box, how far its end is
      // from the stage's, the scene's start from the stage's, and the stage's fade and snap.
      insideStage: sb ? b.left >= sb.left - 0.5 && b.right <= sb.right + 0.5 : null,
      endToStageEnd: sb ? r(sb.right - b.right) : null,
      sceneFromStageStart: sb && scene ? r(scene.left - sb.left) : null,
      stageMask: stageStyle?.maskImage ?? null,
      stageSnap: stageStyle
        ? `${stageStyle.scrollSnapType}, padding ${stageStyle.scrollPaddingInline}`
        : null,
      shell: (() => {
        const shell = document.querySelector('.hc-shell');
        return shell
          ? {
              pin: shell.hasAttribute('data-pin'),
              fit: shell.getAttribute('data-fit'),
              end: stage?.hasAttribute('data-end') ?? null,
            }
          : null;
      })(),
      hits,
    };
  }, selector);
}

async function walk(page: Page, origin: string, setting: Setting) {
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
  await page.goto('/', { waitUntil: 'networkidle' });
  await expect(page.locator('[data-variant]').first()).toHaveAttribute(
    'data-variant',
    'horizontal-cinema',
  );
  // The packs and mode asked are the ones shown, on the outermost boundary, and so are the
  // preferences the context emulates.
  const boundary = page.locator('[data-appearance-boundary]').first();
  await expect(boundary).toHaveAttribute('data-design-language', 'bauhaus-geometric');
  await expect(boundary).toHaveAttribute('data-color-scheme', setting.scheme);
  await expect(boundary).toHaveAttribute('data-typography', 'humanist-ui');
  // The system's mode stays the system's on the boundary, the context's light preference under
  // it; dark carries its own color-scheme, which forced colors sets to light dark on every element.
  await expect(boundary).toHaveAttribute('data-display-mode', setting.mode);
  const media = await page.evaluate(() => ({
    forced: matchMedia('(forced-colors: active)').matches,
    more: matchMedia('(prefers-contrast: more)').matches,
    light: matchMedia('(prefers-color-scheme: light)').matches,
  }));
  if (setting.mode === 'dark')
    expect(await boundary.evaluate((el) => getComputedStyle(el).colorScheme)).toBe(
      setting.condition === 'forced' ? 'light dark' : 'dark',
    );
  else expect(media.light, 'the system is light').toBe(true);
  expect({ forced: media.forced, more: media.more }, 'the emulated preferences').toEqual({
    forced: setting.condition === 'forced',
    more: setting.condition === 'more',
  });
  await page.evaluate(() => document.fonts.ready);
  const findings = await keyboardFindings(page, { focus: true, occlusion: true });
  const next = findings.filter((f: Finding) => f.gate === 'focus' && NEXT.test(f.path ?? ''));
  // The first few again as the walk left them: Tab from the page's top to the link, where it rests,
  // and then where the check's scroll clear of a fixed or sticky cover takes it, if one is found.
  const rings: unknown[] = [];
  for (const finding of next.slice(0, 4)) {
    const link = page.locator(finding.path!).first();
    await page.mouse.move(0, 0);
    await page.evaluate(() => {
      (document.activeElement as HTMLElement | null)?.blur();
      window.scrollTo(0, 0);
    });
    let presses = 0;
    while (presses < 600 && !(await link.evaluate((el) => el === document.activeElement))) {
      await page.keyboard.press('Tab');
      presses += 1;
    }
    await frames(page);
    const rest = await ringAt(page, finding.path!);
    const scroll = await page.evaluate(() => [scrollX, scrollY]);
    const cover = await clearOfStuckCovers(page, link, 4);
    rings.push({
      rule: finding.rule,
      actual: finding.actual,
      presses,
      scroll,
      rest,
      cover,
      ...(cover.scrolled ? { cleared: await ringAt(page, finding.path!) } : {}),
    });
  }
  const others = findings.filter((f) => !(f.gate === 'focus' && NEXT.test(f.path ?? '')));
  const why = JSON.stringify({
    next: next.map((f) => `${f.rule}: ${f.actual} (${f.path})`),
    rings,
    others: others.map((f) => `${f.gate} ${f.rule}: ${f.actual} (${f.path})`).slice(0, 12),
  });
  expect(
    next.map((f) => `${f.rule}: ${f.actual}`),
    `every bar's Next link passes the focus check: ${why}`,
  ).toEqual([]);
}

test.describe('1440 default', () => {
  test.use({ viewport: { width: 1440, height: 900 } });
  test(
    "at 1440 in Low Stimulus Warm's dark, every bar's Next link passes the focus check",
    { annotation, tag },
    async ({ page, app }) => {
      test.setTimeout(360_000);
      await walk(page, app.origin, {
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
    "at 1440 in Low Stimulus Warm's dark under forced colors, every bar's Next link passes the focus check",
    { annotation, tag },
    async ({ page, app }) => {
      test.setTimeout(360_000);
      await walk(page, app.origin, {
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
    "at 1024 in Low Stimulus Warm's dark under more contrast, every bar's Next link passes the focus check",
    { annotation, tag },
    async ({ page, app }) => {
      test.setTimeout(360_000);
      await walk(page, app.origin, {
        scheme: 'low-stimulus-warm',
        mode: 'dark',
        condition: 'more',
      });
    },
  );
  test(
    "at 1024 in Warm Parchment on the system's light under more contrast, every bar's Next link passes the focus check",
    { annotation, tag },
    async ({ page, app }) => {
      test.setTimeout(360_000);
      await walk(page, app.origin, { scheme: 'warm-parchment', mode: 'system', condition: 'more' });
    },
  );
});
