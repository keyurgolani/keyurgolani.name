import { expect, test, type Locator, type Page } from '@playwright/test';
import { CONTRACT_FIXTURES } from '../../packages/variant-contract/src/node/fixtures';
import { startApp } from '../harness/app-server.mjs';
import { focusFindings } from '../quality/lib/a11y/interaction';
import { inPage, type Active } from '../quality/lib/a11y/probe';
import { fixtureApp } from '../variants/target';
import { load, ringContrast } from './horizontal-cinema-model';

// Horizontal Cinema's top line is a band of the matte, the scheme's scrim a breath toward the canvas,
// and the visitor's Appearance control sits on it. In the default row the platform leaves the
// control's ground to the composition, and its summary rang outside its box in the page's focus
// color, which is derived for the canvas: on the matte, under raw-brutalist, sepia-film, console-mono
// and light, the release run's focus check read "0 of 1176 changed pixels reach 3:1" on
// `#appearance > summary` at 390 and "0 of 1168" at 1440. The darkest light focus colors read 2.17:1
// to 2.95:1 on the matte, and some sit at 3.00:1. The band's ink alone won't do where the ring runs
// off the band (it did at 1024 in the default languages), so the ring is drawn inside the summary's
// own box, wholly on the band, in the band's ink. Focused from the keyboard, it is, and it rings at
// 3:1 on every side of its centre line and passes the quality walk's focus check, at 1440, 1024 and
// 390, in each scheme here. Under blueprint, iridescent-pearl, multilingual-system and
// high-contrast it read "0 of 896 changed pixels reach 3:1" at 390, and at 1440 a 2px ring had 222
// of its 336 pixels at 3:1; there too, at both, the ring is the band's ink and wholly on the band,
// and it passes the focus check. That ring is dashed, and the band shows between its dashes, so it
// is judged as the release judges it, by the walk's check, and not point by point along its centre
// line. Where the ring ran off the band the release run read it short in every mode alike:
// claymorphic, cool-color-safe, field-serif and high-contrast at 1024 counted 282 of the 384 pixels
// a 2px ring needs at 3:1, in the default row, under more contrast and in forced colors. There, in
// each of the three, the ring lies wholly on the band and passes the focus check. One server a
// tuple, on the complete contract fixture.

const FIXTURE = CONTRACT_FIXTURES.find((fixture) => fixture.name === 'complete')!;
const HC = { manifest: { id: 'horizontal-cinema' } };
const SCHEMES = [
  ['paper-ink', 'light'],
  ['ultramarine-ink', 'light'],
  ['jewel-twilight', 'light'],
  ['night-terminal', 'light'],
  ['sepia-film', 'light'],
  ['forest-moss', 'light'],
  ['drafting-blue', 'light'],
] as const;
const VIEWPORTS = [
  { width: 1440, height: 900, touch: false },
  { width: 1024, height: 768, touch: false },
  { width: 390, height: 844, touch: true },
] as const;
/** The tuples whose summary rings in the band's ink, each at its sizes. */
const INK_TUPLES = [
  ...SCHEMES.map(([scheme, mode]) => ({
    language: 'raw-brutalist',
    scheme,
    typography: 'console-mono',
    mode,
    viewports: VIEWPORTS,
    dashed: false,
  })),
  {
    language: 'blueprint',
    scheme: 'iridescent-pearl',
    typography: 'multilingual-system',
    mode: 'high-contrast',
    viewports: [VIEWPORTS[0], VIEWPORTS[2]],
    dashed: true,
  },
];
const SUMMARY = '#appearance > summary';
const annotation = [
  { type: 'route', description: '/' },
  { type: 'profile', description: 'read-only' },
];
const tag = '@interaction';

/** The fixture's site on a tuple: `language`, `scheme`, `typography`, `mode`. */
function onTuple(language: string, scheme: string, typography: string, mode: string) {
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

/** The rows the release run read the geometric case in, as each emulates them. */
const ROWS = {
  'the default row': { contrast: 'no-preference', forcedColors: 'none' },
  'more contrast': { contrast: 'more', forcedColors: 'none' },
  'forced colors': { contrast: 'no-preference', forcedColors: 'active' },
} as const;

async function focusSummary(page: Page): Promise<Locator> {
  const summary = page.locator(SUMMARY);
  await expect(summary).toBeVisible();
  await page.keyboard.press('Shift');
  await summary.focus();
  expect(await summary.evaluate((el) => el.matches(':focus-visible'))).toBe(true);
  return summary;
}

/** The focused summary's ring as computed, the band's ink, and the ring's outer box against the band's. */
const ringOnBand = (summary: Locator) =>
  summary.evaluate((element) => {
    const band = element.closest('.hc-chrome')!;
    const probe = document.createElement('span');
    probe.style.color = 'var(--color-on-scrim)';
    band.append(probe);
    const ink = getComputedStyle(probe).color;
    probe.remove();
    const style = getComputedStyle(element);
    const reach = (parseFloat(style.outlineOffset) || 0) + (parseFloat(style.outlineWidth) || 0);
    const box = element.getBoundingClientRect();
    const ring = [box.left - reach, box.top - reach, box.right + reach, box.bottom + reach];
    const b = band.getBoundingClientRect();
    return {
      color: style.outlineColor,
      style: style.outlineStyle,
      ink,
      ring: ring.map((v) => Math.round(v * 10) / 10),
      band: [b.left, b.top, b.right, b.bottom].map((v) => Math.round(v * 10) / 10),
      onBand:
        ring[0]! >= b.left - 0.5 &&
        ring[1]! >= b.top - 0.5 &&
        ring[2]! <= b.right + 0.5 &&
        ring[3]! <= b.bottom + 0.5,
    };
  });

for (const { language, scheme, typography, mode, viewports, dashed } of INK_TUPLES)
  test.describe(`Horizontal Cinema's Appearance summary on ${language}, ${scheme}, ${typography}, ${mode}`, () => {
    // One server for the scheme's tests, in order.
    test.describe.configure({ mode: 'default' });
    let app: Awaited<ReturnType<typeof startApp>>;
    test.beforeAll(async () => {
      test.setTimeout(120_000);
      app = await startApp({
        ...onTuple(language, scheme, typography, mode),
        logFile: test.info().outputPath('server.log'),
      });
    });
    test.afterAll(async () => {
      await app?.stop();
    });
    for (const viewport of viewports)
      test(
        `${scheme} ${mode} at ${viewport.width}x${viewport.height}: the Appearance summary focused from the keyboard rings wholly on the band in the band's ink, at 3:1 on every side, and passes the focus check`,
        { annotation, tag },
        async ({ browser }) => {
          const context = await browser.newContext({
            viewport: { width: viewport.width, height: viewport.height },
            isMobile: viewport.touch,
            hasTouch: viewport.touch,
            baseURL: app.origin,
          });
          try {
            const page = await context.newPage();
            await load(page);
            const boundary = page.locator('[data-variant]').first();
            await expect(boundary).toHaveAttribute('data-design-language', language);
            await expect(boundary).toHaveAttribute('data-color-scheme', scheme);
            await expect(boundary).toHaveAttribute('data-display-mode', mode);
            const summary = await focusSummary(page);
            const active = await inPage<Active>(page, { kind: 'active' });
            expect(active.path).toBe('#appearance > summary:nth-child(1)');
            const ring = await ringOnBand(summary);
            expect(ring.color, `its ring ${JSON.stringify(ring)}`).toBe(ring.ink);
            expect(ring.onBand, `its ring ${JSON.stringify(ring)}`).toBe(true);
            const measured = await ringContrast(page, summary);
            if (dashed) {
              // Between its dashes the band shows, so a measure of every point on a solid ring's
              // centre line can't read it; the walk's focus check judges it, as the release does.
              expect(ring.style, `its ring ${JSON.stringify(ring)}`).toBe('dashed');
            } else {
              const sides = (['top', 'right', 'bottom', 'left'] as const).map((side) => {
                const { points, strong } = measured.sides[side];
                return { side, inView: points > 0, atThreeToOne: strong === points };
              });
              expect(sides, `its ring's centre line ${JSON.stringify(measured)}`).toEqual(
                sides.map(({ side }) => ({ side, inView: true, atThreeToOne: true })),
              );
            }
            expect(
              await focusFindings(page, active),
              `its ring's centre line ${JSON.stringify(measured)}`,
            ).toEqual([]);
          } finally {
            await context.close();
          }
        },
      );
  });

test.describe("Horizontal Cinema's Appearance summary on claymorphic, cool-color-safe, field-serif, high-contrast at 1024", () => {
  test.describe.configure({ mode: 'default' });
  let app: Awaited<ReturnType<typeof startApp>>;
  test.beforeAll(async () => {
    test.setTimeout(120_000);
    app = await startApp({
      ...onTuple('claymorphic', 'cool-color-safe', 'field-serif', 'high-contrast'),
      logFile: test.info().outputPath('server.log'),
    });
  });
  test.afterAll(async () => {
    await app?.stop();
  });
  for (const [row, media] of Object.entries(ROWS))
    test(
      `in ${row} at 1024x768: the Appearance summary focused from the keyboard rings wholly on the band and passes the focus check`,
      { annotation, tag },
      async ({ browser }) => {
        const context = await browser.newContext({
          viewport: { width: 1024, height: 768 },
          baseURL: app.origin,
        });
        try {
          const page = await context.newPage();
          await page.emulateMedia(media);
          await load(page);
          const boundary = page.locator('[data-variant]').first();
          await expect(boundary).toHaveAttribute('data-design-language', 'claymorphic');
          await expect(boundary).toHaveAttribute('data-display-mode', 'high-contrast');
          const summary = await focusSummary(page);
          const active = await inPage<Active>(page, { kind: 'active' });
          expect(active.path).toBe('#appearance > summary:nth-child(1)');
          const ring = await ringOnBand(summary);
          expect(ring.onBand, `its ring ${JSON.stringify(ring)}`).toBe(true);
          const measured = await ringContrast(page, summary);
          expect(
            await focusFindings(page, active),
            `its ring's centre line ${JSON.stringify(measured)}`,
          ).toEqual([]);
        } finally {
          await context.close();
        }
      },
    );
});
