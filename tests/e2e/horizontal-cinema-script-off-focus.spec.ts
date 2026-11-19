import { readFileSync } from 'node:fs';
import path from 'node:path';
import type { Page } from '@playwright/test';
import { fixtureSiteSelecting } from '../../packages/variant-contract/src/contract-fixtures';
import { contractFixture } from '../../packages/variant-contract/src/node/fixtures';
import { optionalFaces, pinFaces } from '../harness/optional-faces';
import { expect, test } from '../harness/fixtures';
import { scriptlessSettle } from '../quality/lib/a11y/interaction';
import { inPage, type Active } from '../quality/lib/a11y/probe';
import { loadForPass } from '../quality/lib/run-cell';

// Horizontal Cinema's strip with no script, on a 1440 by 900 window with a mouse, walked by Tab as
// the quality cells' keyboard check walks it. Five walks judge each stop where the page comes to
// rest, as the check judges it, and five more 2 seconds after its Tab, so a glide that only finishes
// late tells apart from one that stops short. Each walk is a page of its own.

const FIXTURE = contractFixture('complete');
const DIR = path.dirname(FIXTURE.files.portfolio);
const WALKS = 5;
const LATE_MS = 2000;

test.use({
  appOptions: {
    portfolio: FIXTURE.files.portfolio,
    siteText: fixtureSiteSelecting(readFileSync(FIXTURE.files.site, 'utf8'), 'horizontal-cinema')
      .replace(/designLanguage: .*/, 'designLanguage: platform-neutral')
      .replace(/colorScheme: .*/, 'colorScheme: pastel-sorbet')
      .replace(/typography: .*/, 'typography: humanist-ui')
      .replace(/displayMode: .*/, 'displayMode: light'),
    sourceFiles: Object.fromEntries(
      FIXTURE.unitFiles.map((file) => [file, readFileSync(path.join(DIR, file), 'utf8')]),
    ),
  },
});

interface Stop {
  readonly path: string;
  /** Shown and in the viewport where the page came to rest after its Tab. */
  readonly atRest: boolean;
  /** Shown and in the viewport 2 seconds after its Tab. */
  readonly late: boolean;
  readonly restX: number;
  readonly lateX: number;
  /** The strip's scroll position every 100 ms over the 2 seconds, for a stop inside it. */
  readonly strip: readonly number[];
}

const inView = (active: Active) => active.shown && active.inView;

/** The home page as the cells load it with no script: script off from the first byte, the designed faces pinned. */
async function openScriptless(page: Page): Promise<void> {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.emulateMedia({
    media: null,
    reducedMotion: 'no-preference',
    forcedColors: 'none',
    contrast: 'no-preference',
  });
  await pinFaces(page, await optionalFaces(page, '/'), 'designed');
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Emulation.setScriptExecutionDisabled', { value: true });
  await loadForPass(page, '/');
}

/** Every Tab stop on the page, each judged at rest and, with `late`, 2 seconds after its Tab. */
async function walk(page: Page, late: boolean): Promise<Stop[]> {
  await page.mouse.move(0, 0);
  await page.evaluate(() => {
    (document.activeElement as HTMLElement | null)?.blur();
    window.scrollTo(0, 0);
  });
  const stops: Stop[] = [];
  const seen = new Set<string>();
  for (let press = 0; press < 400; press += 1) {
    await page.keyboard.press('Tab');
    const pressed = Date.now();
    await scriptlessSettle(page);
    const rest = await inPage<Active>(page, { kind: 'active' });
    if (rest.none || seen.has(rest.path)) break;
    seen.add(rest.path);
    const inStrip = await page.evaluate(
      () => document.activeElement?.closest('.hc-stage') !== null,
    );
    const strip: number[] = [];
    let after = rest;
    if (late && inStrip) {
      while (Date.now() - pressed < LATE_MS) {
        strip.push(
          await page.evaluate(() =>
            Math.round(document.querySelector('.hc-stage')?.scrollLeft ?? -1),
          ),
        );
        await page.waitForTimeout(100);
      }
      after = await inPage<Active>(page, { kind: 'active' });
    }
    stops.push({
      path: rest.path,
      atRest: inView(rest),
      late: inView(after),
      restX: Math.round(rest.box.x),
      lateX: Math.round(after.box.x),
      strip,
    });
  }
  return stops;
}

const described = (stops: readonly Stop[]) =>
  stops.map(
    (stop) =>
      `${stop.path} (x ${stop.restX} at rest, ${stop.lateX} at 2 s; strip ${stop.strip.join(' ')})`,
  );

for (let attempt = 1; attempt <= WALKS; attempt += 1) {
  test(`with no script, walk ${attempt}: each control Tab reaches in the strip is in view where the page comes to rest`, async ({
    page,
  }) => {
    test.setTimeout(180_000);
    await openScriptless(page);
    const stops = await walk(page, false);
    expect(stops.length, 'the walk reaches the strip').toBeGreaterThan(20);
    expect(described(stops.filter((stop) => !stop.atRest))).toEqual([]);
  });

  test(`with no script, walk ${attempt}: each control Tab reaches in the strip is in view 2 seconds after its Tab`, async ({
    page,
  }) => {
    test.setTimeout(300_000);
    await openScriptless(page);
    const stops = await walk(page, true);
    expect(stops.length, 'the walk reaches the strip').toBeGreaterThan(20);
    expect(described(stops.filter((stop) => !stop.late))).toEqual([]);
  });
}
