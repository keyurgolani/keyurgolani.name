import { KIND_ANNOTATION } from './lib/checks';
import { runCell } from './lib/run-cell';
import { cellServer, serverTag } from './lib/server';
import { expect, test } from './fixtures';
import { loadPlan } from './plan';

// The quality cells (#11, Slice 1): each planned cell, in each viewport and
// preference row the plan gives it, on the project's engine. Each test
// carries its cell's server tag, so it runs only on that server's project
// (playwright.config.ts). A stand-in state's test, or an excluded one,
// skips with the reason the plan declares, before any server starts.

const plan = await loadPlan();

for (const cell of plan.cells) {
  const tag = serverTag(cellServer(cell));
  test.describe(cell.id, () => {
    for (const planned of plan.tests.filter((each) => each.cell === cell)) {
      const { viewport, row } = planned;
      test.describe(`${viewport.id} ${row.id}`, () => {
        test.use({
          viewport: { width: viewport.width, height: viewport.height },
          isMobile: viewport.isMobile ?? false,
          hasTouch: viewport.hasTouch ?? false,
          colorScheme: 'light',
          contextOptions: {
            ...(row.context.reducedMotion ? { reducedMotion: row.context.reducedMotion } : {}),
            ...(row.context.forcedColors ? { forcedColors: row.context.forcedColors } : {}),
            ...(row.context.contrast ? { contrast: row.context.contrast } : {}),
          },
        });
        if (planned.skip !== undefined) test.skip(true, planned.skip);
        for (const [engine, reason] of Object.entries(planned.engineSkips)) {
          test.skip(({ browserName }) => browserName === engine, reason);
        }
        test(
          `${cell.target} ${cell.state} ${cell.path} at ${viewport.id}, ${row.id}`,
          {
            tag,
            annotation: [
              { type: KIND_ANNOTATION, description: 'cell' },
              { type: 'route', description: cell.route },
              { type: 'profile', description: cell.profile },
              { type: 'cell', description: cell.id },
              { type: 'target', description: `${cell.kind}:${cell.target}` },
              { type: 'viewport', description: viewport.id },
              { type: 'row', description: row.id },
            ],
          },
          async ({ page }, testInfo) => {
            await runCell({
              page,
              cell,
              viewport,
              row,
              conditions: planned.conditions,
              testInfo,
              expect,
            });
          },
        );
      });
    }
  });
}
