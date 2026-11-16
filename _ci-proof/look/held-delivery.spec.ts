// A look spec, read once: does a composition's home shoot differently when its
// IntersectionObservers deliver late? For each first-party composition, at desktop and at mobile,
// the home (the contract's complete fixture) is shot twice as it is and twice with every
// observer's delivery held back HELD_MS, each on the variant shot's own settle (modes.ts: settle,
// the enhancement settle, the images). A composition that holds the page for its first delivery
// shoots the same both ways. One that doesn't is named only when its two shots as it is agree,
// its two held shots agree, and the two kinds differ, so a flake isn't named. Each result goes to
// PROOF_LOOK_OUT as <id>-<viewport>.json, with the PNGs of every pair that isn't the same.
import { createHash } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { expect, test, type Browser, type BrowserContextOptions } from '@playwright/test';
import { startApp } from '../harness/app-server.mjs';
import { optionalFaces, pinFaces } from '../harness/optional-faces';
import { SCREENSHOT_COMPARISON } from '../harness/screenshots.mjs';
import { watchEnhancements } from '../quality/lib/a11y/conditions';
import { RANDOM_SEED, seedRandomScript } from '../quality/lib/visual';
import { FIXTURE, ROUTE, VIEWPORTS } from '../variants/distinct-capture';
import { expectEnhancementsSettled, loadImages, settle } from '../variants/modes';
import { FALLBACK_ID, firstParty, fixtureApp, UNDER_TEST, WEB } from '../variants/target';

/** How long every observer's delivery is held back in the held shots. */
const HELD_MS = 800;

type Comparator = (
  actual: Buffer,
  expected: Buffer,
  options: typeof SCREENSHOT_COMPARISON,
) => { errorMessage?: string } | null;
// Playwright's own PNG comparator, as toHaveScreenshot compares, at the harness's thresholds.
const playwright = createRequire(import.meta.url).resolve('playwright/package.json');
const { getComparator } = createRequire(playwright)('playwright-core/lib/utils') as {
  getComparator: (mimeType: string) => Comparator;
};
const comparePng = getComparator('image/png');

/** Every IntersectionObserver's callback, run HELD_MS after the browser delivers. */
function holdDeliveries(ms: number): void {
  const Native = window.IntersectionObserver;
  if (!Native) return;
  window.IntersectionObserver = class extends Native {
    constructor(callback: IntersectionObserverCallback, options?: IntersectionObserverInit) {
      super((entries, observer) => {
        setTimeout(() => callback(entries, observer), ms);
      }, options);
    }
  };
}

const sha = (png: Buffer) => createHash('sha256').update(png).digest('hex').slice(0, 12);

/** The home as the variant shots take it: settled, its enhancements settled, its images in. */
async function shoot(
  browser: Browser,
  origin: string,
  emulation: BrowserContextOptions,
  held: boolean,
): Promise<Buffer> {
  const context = await browser.newContext({ ...emulation, baseURL: origin });
  try {
    await context.route('**/*', (route) =>
      new URL(route.request().url()).origin === origin
        ? route.continue()
        : route.abort('blockedbyclient'),
    );
    const page = await context.newPage();
    await page.addInitScript(seedRandomScript, RANDOM_SEED);
    if (held) await page.addInitScript(holdDeliveries, HELD_MS);
    await pinFaces(page, await optionalFaces(page, ROUTE), 'designed');
    const watch = watchEnhancements(page);
    try {
      const response = await page.goto(ROUTE);
      expect(response?.status(), `${ROUTE}'s status`).toBe(200);
      await settle(page, true);
      await expectEnhancementsSettled(watch);
      await loadImages(page);
      return await page.screenshot({ animations: 'disabled', caret: 'hide', fullPage: true });
    } finally {
      watch.stop();
    }
  } finally {
    await context.close();
  }
}

/** Null when two shots are the same, within the comparison; else why they differ. */
function differ(a: Buffer, b: Buffer): string | null {
  if (a.equals(b)) return null;
  const result = comparePng(a, b, { ...SCREENSHOT_COMPARISON });
  return result ? (result.errorMessage?.split('\n')[0] ?? 'differs') : null;
}

const COMPOSITIONS = UNDER_TEST.filter(
  (variant) => firstParty(variant) && variant.manifest.id !== FALLBACK_ID,
).map((variant) => variant.manifest.id);

for (const id of COMPOSITIONS) {
  for (const [viewport, emulation] of Object.entries(VIEWPORTS)) {
    test(`${id} at ${viewport}: home shoots the same with its observers' deliveries held back`, async ({
      playwright,
    }, testInfo) => {
      testInfo.setTimeout(5 * 60_000);
      const out = process.env.PROOF_LOOK_OUT ?? testInfo.outputPath();
      mkdirSync(out, { recursive: true });
      const name = `${id}-${viewport}`;
      // As the variants projects launch Chromium: no WebGL.
      const browser = await playwright.chromium.launch({ args: ['--disable-3d-apis'] });
      const app = await startApp({
        ...fixtureApp(FIXTURE, { manifest: { id } }),
        web: WEB,
        logFile: testInfo.outputPath(`${name}-server.log`),
      });
      const shots: Record<string, Buffer> = {};
      const errors: string[] = [];
      try {
        for (const [kind, held] of [
          ['as-is-1', false],
          ['held-1', true],
          ['as-is-2', false],
          ['held-2', true],
        ] as const) {
          try {
            shots[kind] = await shoot(browser, app.origin, emulation, held);
          } catch (error) {
            errors.push(`${kind}: ${(error as Error).message.split('\n')[0]}`);
          }
        }
      } finally {
        await app.stop();
        await browser.close();
      }
      const [a1, a2, h1, h2] = ['as-is-1', 'as-is-2', 'held-1', 'held-2'].map((k) => shots[k]);
      const asIs = a1 && a2 ? differ(a1, a2) : 'missing';
      const heldApart = h1 && h2 ? differ(h1, h2) : 'missing';
      const apart = a1 && h1 ? differ(a1, h1) : 'missing';
      const verdict =
        errors.length > 0 ? 'error' : asIs || heldApart ? 'unsteady' : apart ? 'named' : 'same';
      const result = {
        id,
        viewport,
        verdict,
        heldMs: HELD_MS,
        shots: Object.fromEntries(Object.entries(shots).map(([k, png]) => [k, sha(png)])),
        asIsApart: asIs,
        heldApart,
        asIsAgainstHeld: apart,
        errors,
      };
      writeFileSync(path.join(out, `${name}.json`), `${JSON.stringify(result, null, 2)}\n`);
      if (verdict !== 'same') {
        for (const [kind, png] of Object.entries(shots)) {
          writeFileSync(path.join(out, `${name}-${kind}.png`), png);
        }
      }
      console.log(`${name}: ${verdict}${apart && apart !== 'missing' ? ` (${apart})` : ''}`);
      // A read, not a gate: the test fails only when a shot couldn't be taken.
      expect(errors, `${name}: every shot taken`).toEqual([]);
    });
  }
}
