// HC diagnosis only, not for merge (#220, row 90b's :234 fix): a retries-0 copy of horizontal-cinema-packs.spec.ts with
// its planted defects, its top-level test.use and the selectable site kept, for the fix's CI Linux proof.
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import type { Locator, Page } from '@playwright/test';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PLATFORM_DEFAULTS } from '../../packages/appearance/src/axes';
import { fixtureSiteSelecting } from '../../packages/variant-contract/src/contract-fixtures';
import { contractFixture } from '../../packages/variant-contract/src/node/fixtures';
import { expect, test } from '../harness/fixtures';
import { focusFindings } from '../quality/lib/a11y/interaction';
import { inPage, type Active } from '../quality/lib/a11y/probe';
import { contrast, type Rgb } from '../quality/lib/pixels';
import { packCookie } from '../quality/lib/sweep';
import { expectAt, frames, load, read, ringContrast } from './horizontal-cinema-model';

// Horizontal Cinema's focus rings in every stable design language, as the quality matrix runs it
// (row 53 r2, row 90b): the language the visitor's cookie picks, on the platform's default scheme,
// typography and mode, so a ring is measured where the pack sweep measures it. The complete
// contract fixture, its language and type left to the visitor so the cookie picks them.

/** The complete fixture through Horizontal Cinema, its language and type the visitor's to pick. */
function serving() {
  const fixture = contractFixture('complete');
  const dir = path.dirname(fixture.files.portfolio);
  const site = fixtureSiteSelecting(readFileSync(fixture.files.site, 'utf8'), 'horizontal-cinema')
    .replace('\n  designLanguage: locked\n', '\n  designLanguage: selectable\n')
    .replace('\n  typography: locked\n', '\n  typography: selectable\n');
  if (/\n {2}(designLanguage|typography): locked\n/.test(site)) {
    throw new Error("The complete fixture's visitor controls moved: update serving().");
  }
  return {
    portfolio: fixture.files.portfolio,
    siteText: site,
    sourceFiles: Object.fromEntries(
      fixture.unitFiles.map((file) => [file, readFileSync(path.join(dir, file), 'utf8')]),
    ),
  };
}

test.use({ appOptions: serving(), viewport: { width: 1440, height: 900 } });
test.describe.configure({ retries: 0 });

const annotation = [
  { type: 'route', description: '/' },
  { type: 'profile', description: 'read-only' },
];
const tag = '@interaction';

/**
 * The stable design languages, picked as the quality matrix picks them (tests/quality/cells.ts,
 * stablePacks): every design-language pack of a package that isn't a fixture, in the stable tier.
 */
function stableLanguages(): string[] {
  const packages = fileURLToPath(new URL('../../packages/', import.meta.url));
  const ids: string[] = [];
  for (const name of readdirSync(packages)) {
    const file = path.join(packages, name, 'package.json');
    if (!existsSync(file)) continue;
    const own = (
      JSON.parse(readFileSync(file, 'utf8')) as {
        portfolio?: { kind?: string; packs?: string; fixture?: boolean };
      }
    ).portfolio;
    if (own?.kind !== 'design-language' || own.fixture || !own.packs) continue;
    const packs = path.join(packages, name, own.packs);
    for (const pack of readdirSync(packs)) {
      const manifest = JSON.parse(
        readFileSync(path.join(packs, pack, 'manifest.json'), 'utf8'),
      ) as { id: string; tier?: string };
      if (manifest.tier === 'stable') ids.push(manifest.id);
    }
  }
  return ids.sort();
}
const LANGUAGES = stableLanguages();

/** Loads the strip in `language`, by the cookie the pack sweep sets, and checks the pack rendered. */
async function loadIn(page: Page, origin: string, language: string): Promise<void> {
  const tuple = { ...PLATFORM_DEFAULTS, variant: 'horizontal-cinema', designLanguage: language };
  await page.context().addCookies([packCookie({ tuple }, origin)]);
  await load(page);
  const boundary = page.locator('[data-variant]').first();
  await expect(boundary).toHaveAttribute('data-design-language', language);
  await expect(boundary).toHaveAttribute('data-typography', PLATFORM_DEFAULTS.typography);
}

/** Tab by Tab from where focus is, as a keyboard reaches it, until `stop` has focus. */
async function tabTo(page: Page, stop: Locator, name: string): Promise<void> {
  for (let presses = 0; ; presses++) {
    if (await stop.evaluate((element) => element === document.activeElement)) return;
    expect(presses, `Tab reaches ${name}`).toBeLessThan(300);
    await page.keyboard.press('Tab');
  }
}

/** The color `role` computes to in `stop`'s closest `holder`, read off a probe span there. */
const inkIn = (stop: Locator, holder: string, role: string) =>
  stop.evaluate(
    (element, [holder, role]) => {
      const probe = document.createElement('span');
      probe.style.color = `var(--color-${role})`;
      element.closest(holder)!.append(probe);
      const color = getComputedStyle(probe).color;
      probe.remove();
      return color;
    },
    [holder, role] as const,
  );

/** The focused stop's ring as computed: shown from the keyboard, its style and its color. */
const ringOf = (stop: Locator) =>
  stop.evaluate((element) => {
    const style = getComputedStyle(element);
    return {
      visible: element.matches(':focus-visible'),
      style: style.outlineStyle,
      color: style.outlineColor,
    };
  });

/** The focus check's own verdict on the stop that has focus, the CI bar, with its centre line side by side. */
async function expectNoFocusFinding(page: Page, stop: Locator, name: string): Promise<void> {
  const active = await inPage<Active>(page, { kind: 'active' });
  const measured = await ringContrast(page, stop);
  expect(
    await focusFindings(page, active),
    `${name}: its ring's centre line ${JSON.stringify(measured)}`,
  ).toEqual([]);
}

test('the rings run in every stable design language the quality matrix picks: twelve here', () => {
  expect(LANGUAGES).toHaveLength(12);
});

for (const language of LANGUAGES) {
  test(
    `in ${language}, the title card’s primary action focused from the keyboard rings in the canvas’s ink, text-primary, at 3:1 on the card`,
    { annotation, tag },
    async ({ page, app }) => {
      await loadIn(page, app.origin, language);
      const primary = page.locator(
        '.hc-scene[data-matte] .hc-card .hc-card__actions > li:first-child > a',
      );
      await expect(primary).toHaveCount(1);
      await tabTo(page, primary, 'the title card’s primary action');
      const ring = await ringOf(primary);
      const text = await inkIn(primary, '.hc-card', 'text-primary');
      const scrim = await inkIn(primary, '.hc-card', 'on-scrim');
      expect(ring.visible).toBe(true);
      expect(ring.style).toBe('solid');
      expect(ring.color).toBe(text);
      expect(ring.color).not.toBe(scrim);
      await expectNoFocusFinding(page, primary, 'the title card’s primary action');
    },
  );
}

/**
 * The quality cells' default widths for the foot bar's Next: the laptop's, where #213's keys fell,
 * and the desktop's, a guard, where the bar already holds an outward ring (C's probe at 1440: the
 * bar 782-818, the link 788-812, its ring 784-816, every side at 3:1).
 */
const SIZES = [
  { width: 1024, height: 768, guard: false },
  { width: 1440, height: 900, guard: true },
] as const;

/** The foot bars whose Next #213 keyed: a scene's (cluster A) and an intertitle's (cluster C). */
const FOOT_NEXT = ['scene-2', 'chapter-origins'] as const;

type Edges = { left: number; top: number; right: number; bottom: number };

/** Which of `inner`'s edges lie inside `outer`'s, each true when it does. */
const insideOf = (inner: Edges, outer: Edges) => ({
  left: inner.left >= outer.left,
  top: inner.top >= outer.top,
  right: inner.right <= outer.right,
  bottom: inner.bottom <= outer.bottom,
});
const INSIDE = { left: true, top: true, right: true, bottom: true };

/** Whether two boxes share any area. */
const overlap = (a: Edges, b: Edges) =>
  Math.min(a.right, b.right) > Math.max(a.left, b.left) &&
  Math.min(a.bottom, b.bottom) > Math.max(a.top, b.top);

/** A foot Next as laid out: its box, its ring's box (offset and width out from it), its bar's, and the bar's other children's. */
const footOf = (next: Locator) =>
  next.evaluate((link) => {
    const edges = (element: Element) => {
      const { left, top, right, bottom } = element.getBoundingClientRect();
      return { left, top, right, bottom };
    };
    const style = getComputedStyle(link);
    const reach =
      (Number.parseFloat(style.outlineOffset) || 0) + (Number.parseFloat(style.outlineWidth) || 0);
    const box = edges(link);
    const bar = link.closest('.hc-bar--bottom')!;
    return {
      box,
      ring: {
        left: box.left - reach,
        top: box.top - reach,
        right: box.right + reach,
        bottom: box.bottom + reach,
      },
      bar: edges(bar),
      others: [...bar.children].filter((child) => child !== link).map(edges),
    };
  });

/** What a link paints round its box: its background, outline, shadow and border, as computed. */
const paintOf = (stop: Locator) =>
  stop.evaluate((link) => {
    const style = getComputedStyle(link);
    return {
      background: `${style.backgroundColor} ${style.backgroundImage}`,
      outline: style.outlineStyle,
      shadow: style.boxShadow,
      border: [
        style.borderTopStyle,
        style.borderRightStyle,
        style.borderBottomStyle,
        style.borderLeftStyle,
      ].join(' '),
    };
  });
const PAINTS_NOTHING = {
  background: 'rgba(0, 0, 0, 0) none',
  outline: 'none',
  shadow: 'none',
  border: 'none none none none',
};

for (const language of LANGUAGES) {
  for (const size of SIZES) {
    test(
      `${size.guard ? 'a guard: ' : ''}in ${language} at ${size.width} by ${size.height}, a foot bar's Next focused from the keyboard rings inside its bar at 3:1 on every side, its box clear of the credit, and hover and press paint nothing round it`,
      { annotation, tag },
      async ({ page, app }) => {
        await page.setViewportSize({ width: size.width, height: size.height });
        await loadIn(page, app.origin, language);
        const { scenes } = await read(page);
        // In strip order, so Tab reaches each from the one before.
        const stops = [...FOOT_NEXT].sort((a, b) => scenes.indexOf(a) - scenes.indexOf(b));
        for (const id of stops) {
          const index = scenes.indexOf(id);
          expect(index, `${id} is a scene of the strip`).toBeGreaterThanOrEqual(0);
          const name = `${id}'s foot Next`;
          const next = page.locator(`#${id} .hc-bar--bottom > a.hc-bar__next`);
          await expect(next).toHaveCount(1);
          await tabTo(page, next, name);
          await expectAt(page, index);
          const ring = await ringOf(next);
          expect(ring.visible, name).toBe(true);
          expect(ring.style, name).toBe('solid');
          // (i) The ring lies inside its bar, where the bar's ink is its ground.
          const foot = await footOf(next);
          expect(insideOf(foot.ring, foot.bar), `${name}: ring ${JSON.stringify(foot)}`).toEqual(
            INSIDE,
          );
          // (ii) Every point of its centre line, on every side, at 3:1, and the focus check's verdict.
          const active = await inPage<Active>(page, { kind: 'active' });
          const measured = await ringContrast(page, next);
          for (const [side, { points, strong }] of Object.entries(measured.sides)) {
            expect(points, `${name}: the ${side} side's centre line in view`).toBeGreaterThan(0);
            expect(strong, `${name}: the ${side} side at 3:1 ${JSON.stringify(measured)}`).toBe(
              points,
            );
          }
          expect(
            await focusFindings(page, active),
            `${name}: its ring's centre line ${JSON.stringify(measured)}`,
          ).toEqual([]);
          // (iii) Its box, grown for the ring, stays inside the bar and clear of the bar's credit.
          expect(insideOf(foot.box, foot.bar), `${name}: box ${JSON.stringify(foot)}`).toEqual(
            INSIDE,
          );
          expect(
            foot.others.filter((other) => overlap(foot.box, other)),
            `${name}: box ${JSON.stringify(foot)}`,
          ).toEqual([]);
          // (iv) Under the pointer and pressed it paints nothing round its box; hover's underline is
          // the one change, on the text. The press is let go off the link, so it doesn't follow it.
          await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
          expect(await paintOf(next), `${name} at rest`).toEqual(PAINTS_NOTHING);
          const at = (await next.boundingBox())!;
          await page.mouse.move(at.x + at.width / 2, at.y + at.height / 2);
          expect(await next.evaluate((link) => link.matches(':hover')), name).toBe(true);
          expect(await paintOf(next), `${name} under the pointer`).toEqual(PAINTS_NOTHING);
          await page.mouse.down();
          expect(await next.evaluate((link) => link.matches(':active')), name).toBe(true);
          expect(await paintOf(next), `${name} pressed`).toEqual(PAINTS_NOTHING);
          await page.mouse.move(1, 1);
          await page.mouse.up();
          // Focus back on it, so the next Tab goes on from here.
          await next.evaluate((link: HTMLElement) => link.focus());
        }
      },
    );
  }
}

/**
 * The ring measure's own planted defects (row 90b's :234): ringContrast must find each one weak on every side, every point,
 * so its measuring where the paint put the ring can't pass a ring the check should fail. Planted through a constructed
 * style sheet (CSSOM, which the page's CSP lets in, and which no product file holds) over the bar's Next on scene-2, at
 * 1024 by 768 in the platform's default language: a 1 px ring, inset as the bar's own is; and the bar's own 2 px ring in
 * a mid grey read at about 2.5:1 on the bar's computed ground.
 */
async function plant(page: Page, css: string): Promise<void> {
  await page.evaluate((text) => {
    const sheet = new CSSStyleSheet();
    sheet.replaceSync(text);
    document.adoptedStyleSheets = [...document.adoptedStyleSheets, sheet];
  }, css);
  await frames(page);
  await frames(page);
}

/** The grey that reads nearest `ratio`:1 on `ground` (a computed rgb() colour), on its lighter side if there is one. */
function greyAt(ratio: number, ground: string): string {
  const [r, g, b] = (ground.match(/\d+(\.\d+)?/g) ?? []).map(Number) as [number, number, number];
  const base: Rgb = [r, g, b];
  let best = 0;
  for (let v = 0; v <= 255; v++) {
    const [now, was] = [contrast([v, v, v], base), contrast([best, best, best], base)];
    if (Math.abs(now - ratio) < Math.abs(was - ratio)) best = v;
  }
  return `rgb(${best}, ${best}, ${best})`;
}

const NEXT_FOCUSED = "[data-variant='horizontal-cinema'] .hc-bar__next:focus-visible";
/** The planted ring as computed. */
interface PlantedStyle {
  readonly width: string;
  readonly offset: string;
  readonly color: string;
}
/** A planted defect: its style sheet, from the bar's computed ground, and whether the computed ring shows it took. */
interface Plant {
  readonly name: string;
  readonly css: (ground: string) => string;
  readonly took: (style: PlantedStyle, ground: string) => boolean;
}
const PLANTS: readonly Plant[] = [
  {
    name: 'a 1 px ring, inset',
    css: () =>
      `${NEXT_FOCUSED} { outline-width: 1px !important; outline-offset: -1px !important; }`,
    took: (style) => style.width === '1px' && style.offset === '-1px',
  },
  {
    name: 'a ring at about 2.5:1 on the bar',
    css: (ground) => `${NEXT_FOCUSED} { outline-color: ${greyAt(2.5, ground)} !important; }`,
    took: (style, ground) => style.color === greyAt(2.5, ground),
  },
];

for (const planted of PLANTS) {
  test(
    `the ring measure finds a planted defect weak on every side, every point: ${planted.name}, on scene-2's foot Next at 1024 by 768`,
    { annotation, tag },
    async ({ page, app }) => {
      await page.setViewportSize({ width: 1024, height: 768 });
      await loadIn(page, app.origin, PLATFORM_DEFAULTS.designLanguage);
      const { scenes } = await read(page);
      const next = page.locator('#scene-2 .hc-bar--bottom > a.hc-bar__next');
      await expect(next).toHaveCount(1);
      await tabTo(page, next, "scene-2's foot Next");
      await expectAt(page, scenes.indexOf('scene-2'));
      const ground = await next.evaluate(
        (link) => getComputedStyle(link.closest('.hc-bar--bottom')!).backgroundColor,
      );
      await plant(page, planted.css(ground));
      const style = await next.evaluate((link) => {
        const computed = getComputedStyle(link);
        return {
          width: computed.outlineWidth,
          offset: computed.outlineOffset,
          color: computed.outlineColor,
        };
      });
      expect(planted.took(style, ground), `the plant took: ${JSON.stringify(style)}`).toBe(true);
      const measured = await ringContrast(page, next);
      for (const [side, { points, strong }] of Object.entries(measured.sides)) {
        expect(points, `${planted.name}: the ${side} side's centre line in view`).toBeGreaterThan(
          0,
        );
        expect(strong, `${planted.name}: the ${side} side ${JSON.stringify(measured)}`).toBe(0);
      }
    },
  );
}

for (const language of LANGUAGES) {
  test(
    `in ${language} at 1024 by 768, the top line's Appearance control focused from the keyboard keeps the page's focus color, not the band's ink, and passes the focus check`,
    { annotation, tag },
    async ({ page, app }) => {
      await page.setViewportSize({ width: 1024, height: 768 });
      await loadIn(page, app.origin, language);
      const summary = page.locator('.hc-chrome [data-visitor-control-slot] summary');
      await expect(summary).toHaveCount(1);
      await tabTo(page, summary, 'the Appearance control');
      const ring = await ringOf(summary);
      const scrim = await inkIn(summary, '.hc-chrome', 'on-scrim');
      expect(ring.visible).toBe(true);
      expect(ring.style).toBe('solid');
      expect(ring.color).not.toBe(scrim);
      await expectNoFocusFinding(page, summary, 'the Appearance control');
    },
  );

  test(
    `a guard: in ${language} at 1440 under more contrast, the top line's Strip, List and Get in touch still ring in the band's ink and pass the focus check`,
    { annotation, tag },
    async ({ page, app }) => {
      await page.emulateMedia({ contrast: 'more' });
      await loadIn(page, app.origin, language);
      const views = page.locator('.hc-chrome__views a');
      const stops = [
        { name: 'Strip', stop: views.nth(0) },
        { name: 'List', stop: views.nth(1) },
        { name: 'Get in touch', stop: page.locator('.hc-chrome__contact') },
      ];
      for (const { name, stop } of stops) {
        await expect(stop).toHaveCount(1);
        await tabTo(page, stop, name);
        const ring = await ringOf(stop);
        expect(ring.visible, name).toBe(true);
        expect(ring.color, name).toBe(await inkIn(stop, '.hc-chrome', 'on-scrim'));
        await expectNoFocusFinding(page, stop, name);
      }
    },
  );
}
