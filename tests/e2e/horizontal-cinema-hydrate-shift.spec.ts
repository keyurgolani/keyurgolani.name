import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fixtureSiteSelecting } from '../../packages/variant-contract/src/contract-fixtures';
import { contractFixture } from '../../packages/variant-contract/src/node/fixtures';
import { expect, test } from '../harness/fixtures';

// Horizontal Cinema's strip as it hydrates in a short desktop window: with no script, an
// intertitle authored four columns wide opens to six there (the scrubber not yet live), so with script
// those cards render at six until hydration and go back to four, the controller opening any whose
// picture overflows. That reflow must stay off the screen: on a hydrating load at 1024 by 768 in light,
// every layout shift from navigation to two seconds after the scrubber goes live has no source in the
// strip's stage whose rect, before or after, meets the viewport, the peek included. (The scrubber's own
// columns change as it goes live, under the stage; that's its own, and every shift is printed.) On the
// complete contract fixture.

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
    siteText: fixtureSiteSelecting(readFileSync(FIXTURE.files.site, 'utf8'), 'horizontal-cinema'),
    sourceFiles: Object.fromEntries(
      FIXTURE.unitFiles.map((file) => [file, readFileSync(path.join(DIR, file), 'utf8')]),
    ),
  },
  viewport: { width: 1024, height: 768 },
});

interface Shift {
  readonly value: number;
  readonly time: number;
  readonly sources: readonly {
    readonly node: string;
    readonly inStage: boolean;
    readonly previous: { x: number; y: number; width: number; height: number };
    readonly current: { x: number; y: number; width: number; height: number };
  }[];
}

test(
  "in light at 1024 by 768, the strip's hydration moves no scene on the screen: no layout shift's source in the stage meets the viewport",
  { annotation, tag },
  async ({ page, app }) => {
    await page.context().addCookies([
      {
        name: 'portfolio_appearance',
        value: new URLSearchParams({ scheme: 'warm-parchment', mode: 'light' }).toString(),
        url: app.origin,
      },
    ]);
    // Every layout shift from the first paint, its sources' rects as the browser reports them.
    await page.addInitScript(() => {
      const shifts: unknown[] = [];
      (window as unknown as { __kgnShifts: unknown[] }).__kgnShifts = shifts;
      const rect = (r: DOMRectReadOnly) => ({ x: r.x, y: r.y, width: r.width, height: r.height });
      new PerformanceObserver((list) => {
        for (const entry of list.getEntries() as unknown as {
          value: number;
          startTime: number;
          sources?: {
            node?: Node | null;
            previousRect: DOMRectReadOnly;
            currentRect: DOMRectReadOnly;
          }[];
        }[]) {
          shifts.push({
            value: entry.value,
            time: entry.startTime,
            sources: (entry.sources ?? []).map((source) => ({
              node:
                source.node instanceof Element
                  ? `${source.node.localName}${source.node.id ? `#${source.node.id}` : ''}.${[...source.node.classList].join('.')}`
                  : String(source.node?.nodeName ?? 'none'),
              inStage:
                source.node instanceof Element
                  ? source.node.closest('.hc-stage') !== null
                  : source.node?.parentElement?.closest('.hc-stage') != null,
              previous: rect(source.previousRect),
              current: rect(source.currentRect),
            })),
          });
        }
      }).observe({ type: 'layout-shift', buffered: true });
    });
    await page.goto('/', { waitUntil: 'load' });
    await expect(page.locator('.hc[data-view="strip"]')).toHaveCount(1);
    await expect(page.locator('.hc-scrub[data-live]')).toHaveCount(1);
    await page.waitForTimeout(2000);
    const shifts = await page.evaluate(
      () => (window as unknown as { __kgnShifts: Shift[] }).__kgnShifts,
    );
    const viewport = page.viewportSize()!;
    const meets = (r: { x: number; y: number; width: number; height: number }) =>
      r.width > 0 &&
      r.height > 0 &&
      r.x < viewport.width &&
      r.x + r.width > 0 &&
      r.y < viewport.height &&
      r.y + r.height > 0;
    // The shifts outside the stage (the scrubber going live, its own), logged so base and head read alike.
    const offStage = shifts.filter((shift) => shift.sources.some((source) => !source.inStage));
    console.log(
      `[hydrate shift] off the stage: ${offStage.length} shift(s), value ${offStage.reduce((sum, shift) => sum + shift.value, 0).toFixed(5)}; in the stage: ${shifts.length - offStage.length}; ${JSON.stringify(offStage.map((shift) => ({ value: shift.value, nodes: shift.sources.filter((source) => !source.inStage).map((source) => source.node) })))}`,
    );
    const onScreen = shifts.flatMap((shift) =>
      shift.sources
        .filter((source) => source.inStage && (meets(source.previous) || meets(source.current)))
        .map((source) => ({ value: shift.value, time: Math.round(shift.time), ...source })),
    );
    expect(
      onScreen,
      `layout shifts in the stage on the screen; all of them: ${JSON.stringify(shifts)}`,
    ).toEqual([]);
  },
);
