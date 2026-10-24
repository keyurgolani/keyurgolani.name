import { KIND_ANNOTATION } from './lib/checks';
import { testTag } from './lib/pr-shards';
import { runCell } from './lib/run-cell';
import { packCookie, SWEEP_ROWS } from './lib/sweep';
import { cellServer, serverTag } from './lib/server';
import { expect, test } from './fixtures';
import { loadPlan } from './plan';

// The quality cells (#11, Slice 1): each planned cell, in each viewport and
// preference row the plan gives it, on the project's engine. Each test
// carries its cell's server tag, so it runs only on that server's project
// (playwright.config.ts), and its own tag, so a shard can run some of a
// project's tests (lib/pr-shards.ts). A stand-in state's test, or an excluded one,
// skips with the reason the plan declares, before any server starts. A
// swept cell (lib/sweep.ts) is one changed pack on its variant's sweep
// server, in one test: it sets the pack's cookie in its own context before
// the page loads, so each pack starts clean, and runs the [37] rows.

const plan = await loadPlan();

for (const cell of plan.cells) {
  const server = serverTag(cellServer(cell));
  test.describe(cell.id, () => {
    for (const planned of plan.tests.filter((each) => each.cell === cell)) {
      const { viewport, row } = planned;
      test.describe(`${viewport.id} ${row.id}`, () => {
        test.use({
          cellAuth: cell.auth ?? 'none',
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
          `${cell.target} ${cell.state} ${cell.path} at ${viewport.id}, ${cell.sweep ? `the [37] sweep's ${SWEEP_ROWS.map((each) => each.id).join(', ')}` : row.id}`,
          {
            tag: [server, testTag(cell.id, viewport.id, row.id)],
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
          async ({ page, app }, testInfo) => {
            // A swept cell's own tuple, on its variant's sweep server, in this test's fresh context.
            if (cell.sweep) await page.context().addCookies([packCookie(cell, app.origin)]);
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
