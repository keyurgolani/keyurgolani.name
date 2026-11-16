import { readFileSync } from 'node:fs';
import path from 'node:path';
import type { Locator, Page } from '@playwright/test';
import { fixtureSiteSelecting } from '../../packages/variant-contract/src/contract-fixtures';
import { contractFixture } from '../../packages/variant-contract/src/node/fixtures';
import { optionalFaces, pinFaces } from '../harness/optional-faces';
import { incompleteContrastFindings } from '../quality/lib/a11y/contrast';
import { focusFindings, type Finding } from '../quality/lib/a11y/interaction';
import { inPage, type Active } from '../quality/lib/a11y/probe';

// Kinetic Cosmos read as its quality cells read it, on the complete contract fixture: one design
// language, scheme, type pack and mode a spec file (each is a server of its own), a cell's row
// emulated as the cells emulate it, the pack's optional faces in their designed state (as the cells
// pin them), and each target judged by the cells' own checks: the contrast sampler, against the
// worst background pixel round its glyphs, and the focus check on a stop the keyboard focused.

const FIXTURE = contractFixture('complete');
const DIR = path.dirname(FIXTURE.files.portfolio);

export interface Pack {
  readonly language: string;
  readonly scheme: string;
  readonly typography: string;
  readonly mode: 'light' | 'dark' | 'system' | 'high-contrast';
}

/** The app options that serve the fixture's home in Kinetic Cosmos on `pack`. */
export function kineticOptions(pack: Pack) {
  return {
    portfolio: FIXTURE.files.portfolio,
    siteText: fixtureSiteSelecting(readFileSync(FIXTURE.files.site, 'utf8'), 'kinetic-cosmos')
      .replace(/designLanguage: .*/, `designLanguage: ${pack.language}`)
      .replace(/colorScheme: .*/, `colorScheme: ${pack.scheme}`)
      .replace(/typography: .*/, `typography: ${pack.typography}`)
      .replace(/displayMode: .*/, `displayMode: ${pack.mode}`),
    sourceFiles: Object.fromEntries(
      FIXTURE.unitFiles.map((file) => [file, readFileSync(path.join(DIR, file), 'utf8')]),
    ),
  };
}

export type Row = 'default' | 'contrast-more' | 'forced-colors' | 'no-javascript';

export const annotation = [
  { type: 'route', description: '/' },
  { type: 'profile', description: 'read-only' },
];

/**
 * Opens home at `width` by `height` in `row`: its media emulated before the load, its optional faces
 * pinned to their designed state, and with no script, the page loaded with script off and script
 * turned back on for the checks once it has (as a cell's audit reads a no-script page).
 */
export async function openHome(
  page: Page,
  { width, height, row }: { width: number; height: number; row: Row },
): Promise<void> {
  await page.setViewportSize({ width, height });
  await page.emulateMedia({
    media: null,
    reducedMotion: 'no-preference',
    forcedColors: row === 'forced-colors' ? 'active' : 'none',
    contrast: row === 'contrast-more' ? 'more' : 'no-preference',
  });
  await pinFaces(page, await optionalFaces(page), 'designed');
  const cdp = row === 'no-javascript' ? await page.context().newCDPSession(page) : null;
  await cdp?.send('Emulation.setScriptExecutionDisabled', { value: true });
  await page.goto('/', { waitUntil: 'networkidle' });
  await cdp?.send('Emulation.setScriptExecutionDisabled', { value: false });
  await page.evaluate(() => document.fonts.ready.then(() => true));
}

/** The contrast sampler's findings on `selectors`, each as the cells' audit hands it an element axe couldn't judge. */
export async function contrastFindings(
  page: Page,
  selectors: readonly string[],
): Promise<Finding[]> {
  const nodes = selectors.map((selector) => ({ target: [selector] }));
  return incompleteContrastFindings(page, {
    incomplete: [{ id: 'color-contrast', nodes }],
    violations: [],
    passes: [],
  } as unknown as Parameters<typeof incompleteContrastFindings>[1]);
}

/** Each finding as `<its element> <rule>: <what it read>`, for a failure message. */
export const described = (findings: readonly Finding[]): string[] =>
  findings.map((finding) => `${finding.path ?? ''} ${finding.rule}: ${finding.actual ?? ''}`);

/** The stats planet's figure and its unit, by the selectors the cells name them by. */
export const FIGURE = ['data[value="1200"]', '#stat-label > .kc-planet__body > .kc-planet__unit'];

/** One selector for each of a ring's orbit-line stops' links, in their order on the line. */
export async function arcStops(page: Page, ring: string): Promise<string[]> {
  const count = await page.locator(`#kc--ring-${ring} .kc-arc__stop > a`).count();
  return Array.from(
    { length: count },
    (_, index) => `#kc--ring-${ring} .kc-arc__stop:nth-child(${index + 1}) > a`,
  );
}

/**
 * The focus check's findings on `stop`, focused by the keyboard: onto it, back a stop and forward
 * again, so :focus-visible holds, then judged where the keyboard left the page.
 */
export async function ringFindingsOf(page: Page, stop: Locator): Promise<Finding[]> {
  await stop.scrollIntoViewIfNeeded();
  await stop.focus();
  await page.keyboard.press('Shift+Tab');
  await page.keyboard.press('Tab');
  const focused = await stop.evaluate((el) => el === document.activeElement);
  if (!focused) {
    return [{ gate: 'focus', rule: 'visible', actual: 'the keyboard did not come back to it' }];
  }
  const active = await inPage<Active>(page, { kind: 'active' });
  return focusFindings(page, active);
}

/**
 * Every planet: its body's box, and the size its figure's magnitude gives it, the body's space token
 * (--space-3xl, or --space-2xl for a set on a phone) times its --layout-size.
 */
export const planetBodies = (page: Page) =>
  page.evaluate(() =>
    [...document.querySelectorAll<HTMLElement>('.kc-planet')].map((planet, index) => {
      const body = planet.querySelector<HTMLElement>('.kc-planet__body')!;
      const size = parseFloat(getComputedStyle(planet).getPropertyValue('--layout-size'));
      const set = planet.closest('.kc-planets')!;
      const small = matchMedia('(max-width: 47.99rem)').matches && !set.matches('.kc-planets--row');
      const ruler = document.createElement('div');
      ruler.style.cssText = `position: absolute; visibility: hidden; inline-size: var(${small ? '--space-2xl' : '--space-3xl'});`;
      planet.append(ruler);
      const token = ruler.getBoundingClientRect().width;
      ruler.remove();
      const box = body.getBoundingClientRect();
      return {
        planet: planet.id || `planet ${index + 1}`,
        set: [...document.querySelectorAll('.kc-planets')].indexOf(set),
        size,
        width: box.width,
        height: box.height,
        expected: token * size,
      };
    }),
  );

/** Each body whose box isn't the size its magnitude gives, within 1 px, or isn't round. */
export function bodiesOffSize(bodies: Awaited<ReturnType<typeof planetBodies>>): string[] {
  const off = bodies
    .filter((b) => Math.abs(b.width - b.expected) > 1 || Math.abs(b.height - b.width) > 1)
    .map(
      (b) =>
        `${b.planet}: ${b.width.toFixed(1)} x ${b.height.toFixed(1)}, its magnitude's ${b.expected.toFixed(1)}`,
    );
  // No larger magnitude renders smaller than a smaller one in its set.
  for (const a of bodies)
    for (const b of bodies)
      if (a.set === b.set && a.size > b.size && a.width < b.width - 0.5)
        off.push(`${a.planet} (size ${a.size}) renders smaller than ${b.planet} (size ${b.size})`);
  return off;
}

/** Each ring's orbit line by its section id: 'absolute' while its stops ride it, 'static' while listed. */
export const lineStates = (page: Page) =>
  page.evaluate(() =>
    Object.fromEntries(
      [...document.querySelectorAll('.kc-ring')].map((ring) => {
        const stop = ring.querySelector('.kc-arc__stop');
        return [ring.id, stop ? getComputedStyle(stop).position : 'none'];
      }),
    ),
  );

/** The layout shift the page has had since its navigation, leaving out any with recent input. */
export const loadShift = (page: Page) =>
  page.evaluate(() => {
    const observer = new PerformanceObserver(() => undefined);
    observer.observe({ type: 'layout-shift', buffered: true });
    const entries = observer.takeRecords() as unknown as {
      value: number;
      hadRecentInput: boolean;
    }[];
    observer.disconnect();
    return entries
      .filter((entry) => !entry.hadRecentInput)
      .reduce((sum, entry) => sum + entry.value, 0);
  });
