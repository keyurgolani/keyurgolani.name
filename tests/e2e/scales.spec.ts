import { expect, test, type Page } from '@playwright/test';
import { platformStylesheet } from '../../packages/appearance/src/node/platform';
import {
  BASE,
  ROLE_STEPS,
  SPACE_STEPS,
  TYPE_STEPS,
  spaceProperty,
  stepProperty,
} from '../../packages/appearance/src/scales';

// The shared scales as Chromium resolves them (redesign dossier G1, G3, G6,
// T3, T4, M2, M3): the platform stylesheet on a boundary, a stand-in for a
// composition's own stylesheet in the variant-layout layer, and each value
// read back as a computed length or duration. A static page, no server,
// and nothing leaves the browser.

test.beforeEach(async ({ context }) => {
  await context.route('**/*', (route) => route.abort('blockedbyclient'));
});

/**
 * A composition's own layout values, as its stylesheet declares them, and
 * one set on a descendant, which the source audit refuses: what the
 * platform works out on the boundary has to hold against it anyway.
 */
const COMPOSITION = `@layer variant-layout {
  [data-variant='probe'] {
    --layout-grid-gutter: var(--space-m);
    --layout-motion-feedback: 240ms;
    --layout-motion-scene: 900ms;
  }
  [data-variant='probe'] #probe {
    --layout-motion-scene: 5s;
  }
}`;

/** The pack values the scales read: a body measure in ch, as every profile has it, and the language's durations. */
const packs = (fast: string) => `@layer typography { [data-appearance-boundary] {
  --type-measure-body: 68ch; font-size: 16px;
} }
@layer language { [data-appearance-boundary] {
  --ui-motion-fast: ${fast}; --ui-motion-standard: 200ms; --ui-motion-slow: 400ms;
  --ui-motion-easing: cubic-bezier(0.2, 0, 0, 1);
} }`;

async function plant(page: Page, attributes = '', fast = '120ms'): Promise<void> {
  await page.setContent(`<!doctype html><html><head>
<style>${platformStylesheet()}</style><style>${packs(fast)}</style><style>${COMPOSITION}</style>
</head><body style="margin: 0">
<div data-appearance-boundary="document" data-variant="probe" ${attributes}><div id="probe"></div></div>
</body></html>`);
}

/** What `value` comes to on the probe, in CSS px, as a width would compute it. */
const length = (page: Page, value: string) =>
  page.evaluate((css) => {
    const probe = document.getElementById('probe')!;
    probe.style.width = css;
    return Number.parseFloat(getComputedStyle(probe).width);
  }, value);

/** What `value` comes to on the probe, in ms, as a transition duration would compute it. */
const duration = (page: Page, value: string) =>
  page.evaluate((css) => {
    const probe = document.getElementById('probe')!;
    probe.style.transitionDuration = css;
    const computed = getComputedStyle(probe).transitionDuration;
    return Number.parseFloat(computed) * (computed.endsWith('ms') ? 1 : 1000);
  }, value);

const near = (actual: number, expected: number) =>
  expect(Math.abs(actual - expected)).toBeLessThan(0.05);

test('the space steps resolve from 18 px at 360 px to 20 px at 1240 px, at least 25% apart', async ({
  page,
}) => {
  for (const [width, base] of [
    [360, BASE.min],
    [1240, BASE.max],
  ] as const) {
    await page.setViewportSize({ width, height: 800 });
    await plant(page);
    let last = 0;
    for (const [step, factor] of SPACE_STEPS) {
      const px = await length(page, `var(${spaceProperty(step)})`);
      near(px, base * factor);
      if (last > 0) expect(px / last).toBeGreaterThanOrEqual(1.25 - 1e-6);
      last = px;
    }
    near(await length(page, 'var(--space-s-l)'), width === 360 ? 18 : 40);
  }
});

test('the type steps resolve, and display stays under 6rem at any width', async ({ page }) => {
  for (const width of [320, 360, 768, 1240, 2560]) {
    await page.setViewportSize({ width, height: 800 });
    await plant(page);
    let last = 0;
    for (const step of TYPE_STEPS) {
      const px = await length(page, `var(${stepProperty(step)})`);
      expect(px).toBeGreaterThan(last);
      last = px;
    }
    expect(await length(page, `var(--type-display-fluid-size)`)).toBeLessThanOrEqual(96);
    expect(await length(page, 'var(--type-display-ceiling)')).toBe(96);
  }
});

test('zoom grows every step: a 1280 px window at 200%, 250%, and 400%', async ({ browser }) => {
  /** A step's size in device px, in a 1280 px window at `zoom`: the page is 1280/zoom CSS px wide, each CSS px `zoom` device px. */
  const rendered = async (zoom: number, value: string) => {
    const context = await browser.newContext({
      viewport: { width: Math.round(1280 / zoom), height: 800 },
      deviceScaleFactor: zoom,
    });
    await context.route('**/*', (route) => route.abort('blockedbyclient'));
    const page = await context.newPage();
    await plant(page);
    const px = await length(page, value);
    await context.close();
    return px * zoom;
  };
  const body = `var(${stepProperty(ROLE_STEPS.body)})`;
  const display = `var(${stepProperty(ROLE_STEPS.display)})`;
  const unzoomed = { body: await rendered(1, body), display: await rendered(1, display) };
  // 200%: the window is 640 CSS px wide, so a size that grows with the window is short of twice.
  expect((await rendered(2, body)) / unzoomed.body).toBeGreaterThanOrEqual(1.85);
  // Body doubles by 250%, display by 400%.
  expect((await rendered(2.5, body)) / unzoomed.body).toBeGreaterThanOrEqual(2);
  expect((await rendered(4, display)) / unzoomed.display).toBeGreaterThanOrEqual(2);
  for (const [step] of SPACE_STEPS) {
    const value = `var(${spaceProperty(step)})`;
    expect((await rendered(2.5, value)) / (await rendered(1, value))).toBeGreaterThanOrEqual(2);
  }
});

test("a composition's own grid and motion values win over the defaults, and the widths read the profile's measure in the boundary's text", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1240, height: 800 });
  await plant(page);
  near(await length(page, 'var(--layout-grid-gutter)'), 30);
  near(await length(page, 'var(--layout-grid-margin)'), 40);
  // 68ch of the boundary's 16 px text, however large the text that reads it.
  const text = await length(page, 'var(--layout-width-text)');
  const chars = await page.evaluate(() => {
    const ruler = document.createElement('span');
    ruler.style.cssText = 'position: absolute; font-size: 16px; width: 68ch';
    document.querySelector('[data-appearance-boundary]')!.append(ruler);
    return ruler.getBoundingClientRect().width;
  });
  near(text, chars);
  await page.evaluate(() => (document.getElementById('probe')!.style.fontSize = '40px'));
  near(await length(page, 'var(--layout-width-text)'), chars);
  near(await length(page, 'var(--layout-width-outset)'), chars + 2 * 80);
  near(await length(page, 'var(--layout-width-page)'), 1280);
  expect(await duration(page, 'var(--motion-feedback)')).toBe(240);
  // The descendant's 5 s scene reaches nothing: --motion-scene is the boundary's.
  expect(await duration(page, 'var(--motion-scene)')).toBe(900);
});

test('a still language keeps every composition still', async ({ page }) => {
  await plant(page, '', '0.01ms');
  expect(await duration(page, 'var(--motion-feedback)')).toBeLessThanOrEqual(1);
  expect(await duration(page, 'var(--motion-scene)')).toBeLessThanOrEqual(1);
});

test.describe('under reduced motion', () => {
  test.use({ contextOptions: { reducedMotion: 'reduce' } });

  test("both durations are the language's fast fade, whatever the composition's slots say (M2)", async ({
    page,
  }) => {
    await plant(page);
    expect(await duration(page, 'var(--motion-feedback)')).toBe(120);
    expect(await duration(page, 'var(--motion-scene)')).toBe(120);
  });
});

test("the site's reduce policy and a pause hold the durations the same way", async ({ page }) => {
  await plant(page, 'data-motion="reduced"');
  expect(await duration(page, 'var(--motion-scene)')).toBe(120);
  await plant(page, 'data-motion="static"');
  expect(await duration(page, 'var(--motion-feedback)')).toBe(0);
  expect(await duration(page, 'var(--motion-scene)')).toBe(0);
  await plant(page, 'data-motion="full"');
  expect(await duration(page, 'var(--motion-scene)')).toBe(900);
});
