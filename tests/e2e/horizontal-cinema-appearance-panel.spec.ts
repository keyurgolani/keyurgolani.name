import { AxeBuilder } from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { CONTRACT_FIXTURES } from '../../packages/variant-contract/src/node/fixtures';
import { startApp } from '../harness/app-server.mjs';
import { fixtureApp } from '../variants/target';
import { load } from './horizontal-cinema-model';

// Horizontal Cinema's strip holds its top line to one line of the module's height, whatever the
// visitor's Appearance control holds, and the control sits on it centred. Opened there, at 1024 and
// 1440 with a mouse, the control's panel grew about its centre: its first half ran above the window,
// its selects at y -96 to -47 where nothing reaches them, and its radios and Reset lay over the scene
// in the band's ink, near-invisible on the canvas. Opened from the keyboard there, every control in
// the panel lies wholly inside the window, on the panel's own opaque ground, and Tab reaches each of
// them, a select, the display mode's radios and Reset, with its ring inside the window, in the default
// row and under more contrast. At 390 the band grows to hold the open control, which stays in its
// flow. Closed on the pinned strip, the panel's content stays folded away in the band's flow, as a
// closed disclosure's is: placed off the band while closed, its rows were laid out over the strip's
// pinned frame, where the release run's contrast check read a closed label as text the frame covers
// (platform-neutral, sepia-film, humanist-ui and light at 1024 and 1440). There axe's contrast rule
// reads nothing in the closed panel. One server a tuple, on the complete contract fixture.

const FIXTURE = CONTRACT_FIXTURES.find((fixture) => fixture.name === 'complete')!;
const HC = { manifest: { id: 'horizontal-cinema' } };
const TUPLES = [
  ['raw-brutalist', 'sepia-film', 'console-mono', 'light'],
  ['claymorphic', 'cool-color-safe', 'field-serif', 'high-contrast'],
] as const;
const ROWS = {
  'the default row': { contrast: 'no-preference' },
  'more contrast': { contrast: 'more' },
} as const;
const STRIP = [
  { width: 1440, height: 900 },
  { width: 1024, height: 768 },
] as const;
const annotation = [
  { type: 'route', description: '/' },
  { type: 'profile', description: 'read-only' },
];
const tag = '@interaction';

function onTuple([language, scheme, typography, mode]: readonly [string, string, string, string]) {
  const app = fixtureApp(FIXTURE, HC);
  return {
    ...app,
    siteText: app
      .siteText!.replace(/designLanguage: .*/, `designLanguage: ${language}`)
      .replace(/colorScheme: .*/, `colorScheme: ${scheme}`)
      .replace(/typography: .*/, `typography: ${typography}`)
      .replace(/displayMode: .*/, `displayMode: ${mode}`),
  };
}

/** Opens the Appearance control from the keyboard and waits for two frames. */
async function openFromKeyboard(page: Page): Promise<void> {
  const summary = page.locator('#appearance > summary');
  await expect(summary).toBeVisible();
  await page.keyboard.press('Shift');
  await summary.focus();
  await page.keyboard.press('Enter');
  await expect(page.locator('#appearance')).toHaveAttribute('open', '');
  await page.evaluate(
    () => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done))),
  );
}

/** The open panel and each control the reader sees in it: boxes, the window, and the panel's ground. */
const readPanel = () => {
  const panel = document.querySelector<HTMLElement>(
    '#appearance > [data-ui-slot="disclosure.content"]',
  )!;
  const band = panel.closest('.hc-chrome')!;
  const box = (el: Element) => {
    const b = el.getBoundingClientRect();
    return [b.left, b.top, b.right, b.bottom].map((v) => Math.round(v * 10) / 10);
  };
  const shown = [...panel.querySelectorAll<HTMLElement>('select, input, button')].filter(
    (el) => el.getClientRects().length > 0 && !el.closest('[hidden]'),
  );
  const bg = getComputedStyle(panel).backgroundColor;
  const alpha = /rgba?\(([^)]+)\)/.exec(bg)?.[1]?.split(',')[3];
  return {
    window: [innerWidth, innerHeight],
    panel: { box: box(panel), position: getComputedStyle(panel).position, bg },
    opaque: alpha === undefined || parseFloat(alpha) === 1,
    band: box(band),
    controls: shown.map((el) => ({
      name: `${el.localName}${el.getAttribute('name') ? `[name=${el.getAttribute('name')}]` : ''}${el.getAttribute('value') ? `[value=${el.getAttribute('value')}]` : ''}`,
      box: box(el),
    })),
  };
};

/** Tab from the summary through the open panel: each stop's name and its ring's outer box. */
async function tabThrough(page: Page) {
  const stops: { name: string; ring: number[] }[] = [];
  for (let presses = 0; presses < 30; presses++) {
    await page.keyboard.press('Tab');
    const stop = await page.evaluate(() => {
      const el = document.activeElement as HTMLElement | null;
      if (!el || !el.closest('#appearance > [data-ui-slot="disclosure.content"]')) return null;
      const s = getComputedStyle(el);
      const reach = (parseFloat(s.outlineOffset) || 0) + (parseFloat(s.outlineWidth) || 0);
      const b = el.getBoundingClientRect();
      return {
        name: `${el.localName}${el.getAttribute('name') ? `[name=${el.getAttribute('name')}]` : ''}${el.localName === 'button' ? `[${(el.textContent ?? '').trim()}]` : ''}`,
        ring: [b.left - reach, b.top - reach, b.right + reach, b.bottom + reach].map(
          (v) => Math.round(v * 10) / 10,
        ),
      };
    });
    if (!stop) break;
    stops.push(stop);
  }
  return stops;
}

const inside = (b: readonly number[], [w, h]: readonly number[]) =>
  b[0]! >= -0.5 && b[1]! >= -0.5 && b[2]! <= w! + 0.5 && b[3]! <= h! + 0.5;
const within = (b: readonly number[], o: readonly number[]) =>
  b[0]! >= o[0]! - 0.5 && b[1]! >= o[1]! - 0.5 && b[2]! <= o[2]! + 0.5 && b[3]! <= o[3]! + 0.5;

for (const tuple of TUPLES)
  test.describe(`Horizontal Cinema's open Appearance panel on ${tuple.join('/')}`, () => {
    // One server for the tuple's tests, in order.
    test.describe.configure({ mode: 'default' });
    let app: Awaited<ReturnType<typeof startApp>>;
    test.beforeAll(async () => {
      test.setTimeout(120_000);
      app = await startApp({ ...onTuple(tuple), logFile: test.info().outputPath('server.log') });
    });
    test.afterAll(async () => {
      await app?.stop();
    });
    for (const viewport of STRIP)
      for (const [row, media] of Object.entries(ROWS))
        test(
          `${tuple[1]} at ${viewport.width}x${viewport.height} in ${row}: opened on the strip from the keyboard, every control in the Appearance panel lies inside the window on the panel's own ground, and Tab reaches each with its ring inside the window`,
          { annotation, tag },
          async ({ browser }) => {
            const context = await browser.newContext({ viewport, baseURL: app.origin });
            try {
              const page = await context.newPage();
              await page.emulateMedia(media);
              await load(page);
              await expect(page.locator('.hc')).toHaveAttribute('data-view', 'strip');
              await openFromKeyboard(page);
              const read = await page.evaluate(readPanel);
              expect(read.controls.length, JSON.stringify(read)).toBeGreaterThan(2);
              expect(read.opaque, `the panel's ground ${JSON.stringify(read.panel)}`).toBe(true);
              for (const control of read.controls) {
                expect(
                  inside(control.box, read.window),
                  `${control.name} ${JSON.stringify(control.box)} inside the window ${JSON.stringify(read.window)}`,
                ).toBe(true);
                expect(
                  within(control.box, read.panel.box),
                  `${control.name} ${JSON.stringify(control.box)} on the panel ${JSON.stringify(read.panel.box)}`,
                ).toBe(true);
              }
              const stops = await tabThrough(page);
              const names = stops.map((stop) => stop.name);
              expect(
                names.filter((name) => name.startsWith('select')).length,
                names.join(', '),
              ).toBe(read.controls.filter((c) => c.name.startsWith('select')).length);
              expect(
                names.some((name) => name.startsWith('input')),
                names.join(', '),
              ).toBe(true);
              expect(
                names.some((name) => name.startsWith('button')),
                names.join(', '),
              ).toBe(true);
              for (const stop of stops)
                expect(
                  inside(stop.ring, read.window),
                  `${stop.name}'s ring ${JSON.stringify(stop.ring)} inside the window`,
                ).toBe(true);
            } finally {
              await context.close();
            }
          },
        );
    test(
      `a guard: ${tuple[1]} at 390x844 opened from the keyboard, the Appearance panel stays in the band's flow, inside the band`,
      { annotation, tag },
      async ({ browser }) => {
        const context = await browser.newContext({
          viewport: { width: 390, height: 844 },
          isMobile: true,
          hasTouch: true,
          baseURL: app.origin,
        });
        try {
          const page = await context.newPage();
          await load(page);
          await openFromKeyboard(page);
          const read = await page.evaluate(readPanel);
          expect(read.panel.position, JSON.stringify(read.panel)).toBe('static');
          expect(within(read.panel.box, read.band), JSON.stringify(read)).toBe(true);
        } finally {
          await context.close();
        }
      },
    );
  });

/** The tuple whose closed panel the release run read over the pinned frame. */
const FOLDED = ['platform-neutral', 'sepia-film', 'humanist-ui', 'light'] as const;

test.describe(`Horizontal Cinema's closed Appearance panel on ${FOLDED.join('/')}`, () => {
  test.describe.configure({ mode: 'default' });
  let app: Awaited<ReturnType<typeof startApp>>;
  test.beforeAll(async () => {
    test.setTimeout(120_000);
    app = await startApp({ ...onTuple(FOLDED), logFile: test.info().outputPath('server.log') });
  });
  test.afterAll(async () => {
    await app?.stop();
  });
  for (const viewport of STRIP)
    test(
      `${FOLDED[1]} at ${viewport.width}x${viewport.height}: closed on the pinned strip, the Appearance panel's content stays folded away, and axe's contrast rule reads nothing in it`,
      { annotation, tag },
      async ({ browser }) => {
        const context = await browser.newContext({ viewport, baseURL: app.origin });
        try {
          const page = await context.newPage();
          await load(page);
          await expect(page.locator('.hc')).toHaveAttribute('data-view', 'strip');
          await expect(page.locator('.hc-shell')).toHaveAttribute('data-pin', '');
          await expect(page.locator('#appearance')).not.toHaveAttribute('open');
          const results = await new AxeBuilder({ page })
            .withRules(['color-contrast'])
            .include('#appearance > [data-ui-slot="disclosure.content"]')
            .analyze();
          const read = [...results.passes, ...results.violations, ...results.incomplete].flatMap(
            (rule) => rule.nodes.map((node) => `${rule.id}: ${node.target.join(' ')}`),
          );
          expect(read, 'what axe read in the closed panel').toEqual([]);
        } finally {
          await context.close();
        }
      },
    );
});
