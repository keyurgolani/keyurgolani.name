import { readFileSync } from 'node:fs';
import path from 'node:path';
import type { CDPSession, Page } from '@playwright/test';
import { fixtureSiteSelecting } from '../../packages/variant-contract/src/contract-fixtures';
import { contractFixture } from '../../packages/variant-contract/src/node/fixtures';
import { expect, test } from '../harness/fixtures';

// Aurora Glass loads without moving: on every type pack, with script on and off, at 1440, 1024, 768,
// 390 and 320, under reduced motion, a fresh page's load records no layout-shift entry. On Book Serif
// and Field Serif at 1440 the identity body and the signature sheet moved 101 px down at about 50 to
// 95 ms, as the page's text arrived. The entries are read from Chromium's performance timeline over
// the DevTools protocol, so a page without script is read the same way, each printed with its sources.

const FIXTURE = contractFixture('complete');
const DIR = path.dirname(FIXTURE.files.portfolio);
export type LoadPack =
  | 'accessible-reading'
  | 'book-serif'
  | 'console-mono'
  | 'drafting-grotesk'
  | 'editorial-serif'
  | 'field-serif'
  | 'geometric-display'
  | 'humanist-ui'
  | 'multilingual-system'
  | 'neutral-ui'
  | 'paste-up'
  | 'screen-grotesque'
  | 'shell-mono'
  | 'swiss-grotesque'
  | 'technical-sans-mono';
const WIDTHS = [1440, 1024, 768, 390, 320] as const;

const options = (pack: LoadPack) => ({
  portfolio: FIXTURE.files.portfolio,
  siteText: fixtureSiteSelecting(readFileSync(FIXTURE.files.site, 'utf8'), 'aurora-glass')
    .replace(/designLanguage: .*/, 'designLanguage: platform-neutral')
    .replace(/colorScheme: .*/, 'colorScheme: warm-parchment')
    .replace(/typography: .*/, `typography: ${pack}`)
    .replace(/displayMode: .*/, 'displayMode: dark'),
  sourceFiles: Object.fromEntries(
    FIXTURE.unitFiles.map((file) => [file, readFileSync(path.join(DIR, file), 'utf8')]),
  ),
});

interface Shift {
  readonly value: number;
  readonly input: boolean;
  readonly sources: { nodeId?: number; previousRect: { y: number }; currentRect: { y: number } }[];
}

/** The layout-shift entries of one fresh page's load of `/` at `width`, each with its sources named. */
async function loadShifts(page: Page, width: number) {
  const fresh = await page.context().newPage();
  try {
    await fresh.setViewportSize({ width, height: 900 });
    const cdp: CDPSession = await fresh.context().newCDPSession(fresh);
    const got: Shift[] = [];
    cdp.on('PerformanceTimeline.timelineEventAdded', (payload) => {
      const event = (
        payload as unknown as { event: { layoutShiftDetails?: Record<string, unknown> } }
      ).event;
      const d = event.layoutShiftDetails;
      if (d)
        got.push({
          value: d.value as number,
          input: d.hadRecentInput as boolean,
          sources: d.sources as Shift['sources'],
        });
    });
    await cdp.send('PerformanceTimeline.enable', { eventTypes: ['layout-shift'] });
    await fresh.goto('/', { waitUntil: 'networkidle' });
    await fresh.waitForTimeout(600);
    const name = async (id?: number) => {
      if (!id) return '(no node)';
      try {
        const { node } = (await cdp.send('DOM.describeNode', { backendNodeId: id })) as {
          node: { nodeName: string; attributes?: string[] };
        };
        const at = node.attributes ?? [];
        const attr = (key: string) => (at.indexOf(key) >= 0 ? at[at.indexOf(key) + 1]! : '');
        return `${node.nodeName.toLowerCase()}${attr('id') ? `#${attr('id')}` : ''}${attr('class') ? `.${attr('class').trim().split(/\s+/).join('.')}` : ''}`;
      } catch {
        return `(node ${id} gone)`;
      }
    };
    const out: { value: number; sources: string[] }[] = [];
    for (const shift of got.filter((each) => !each.input))
      out.push({
        value: Math.round(shift.value * 10000) / 10000,
        sources: await Promise.all(
          shift.sources.map(
            async (s) =>
              `${await name(s.nodeId)} y ${Math.round(s.previousRect.y)} -> ${Math.round(s.currentRect.y)}`,
          ),
        ),
      });
    return out;
  } finally {
    await fresh.close();
  }
}

/** The two load tests (script on and off) for one type pack; each pack's spec file calls it once. */
export function loadShift(pack: LoadPack) {
  test.use({ appOptions: options(pack), contextOptions: { reducedMotion: 'reduce' } });
  for (const scripting of ['on', 'off'] as const)
    test.describe(`with script ${scripting}`, () => {
      if (scripting === 'off') test.use({ javaScriptEnabled: false });
      test(
        `on ${pack} with script ${scripting}, loading the page shifts nothing at 1440, 1024, 768, 390 and 320`,
        { annotation: [{ type: 'route', description: '/' }] },
        async ({ page, browserName }) => {
          test.skip(browserName !== 'chromium', 'Chromium alone has layout-shift entries');
          test.setTimeout(180_000);
          const shifts: Record<number, { value: number; sources: string[] }[]> = {};
          for (const width of WIDTHS) {
            shifts[width] = await loadShifts(page, width);
            console.log(
              `aurora load ${pack} script ${scripting} ${width}: ${JSON.stringify(shifts[width])}`,
            );
          }
          expect(shifts, 'no layout-shift entry at any width').toEqual(
            Object.fromEntries(WIDTHS.map((width) => [width, []])),
          );
        },
      );
    });
}
