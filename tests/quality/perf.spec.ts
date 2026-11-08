import { writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { reportsDir } from '../../ci/lib/reports.mjs';
import { CPU_THROTTLING_RATE } from '../harness/trace/report.mjs';
import { loadThresholds } from '../../quality/thresholds';
import type * as PreviewScheduler from '../../apps/web/src/lib/studio/preview-scheduler';
import { CHECKS_ANNOTATION, KIND_ANNOTATION, PERF_INTERACTION_KIND } from './lib/checks';
import type { CellFailure } from './lib/failure-records';
import {
  defaultLoad,
  LAB_DEVICE,
  LAB_VIEWPORT,
  PERF_PROBE,
  staticLoad,
  startLab,
  totalBlockingTime,
} from './lib/perf/measure';
import { PERF_KIND, perfCells } from './lib/perf/plan';
import { compareGridVerdict } from './lib/perf/compare-grid';
import { ceilingFor, perfFindings, timingResult, type PerfRun } from './lib/perf/samples';
import { RECORDS_ATTACHMENT, recordTuple } from './lib/records';
import { PERF_TAG } from './lib/pr-shards';
import { cellServer, serverTag } from './lib/server';
import { expect, test } from './fixtures';
import { loadPlan } from './plan';

// The performance cells (#11, 11-3): each target's representative cell
// (lib/perf/plan.ts), on the lab profile (lib/perf/measure.ts), on its
// cell's server. One static load under OS reduced motion, then
// timing.runs loads at default motion. The deterministic rules
// (lib/perf/samples.ts) fail the test: an LCP entry on every load, a
// canvas-led cell's LCP element, and no frame callback or layout in static
// mode. The timing medians go to perf.json and summary.json, which pull
// requests only report and the release run gates (lib/perf/timing.ts).
// #6's budgets gate in the trace job's pnpm check:budgets.

// apps/web has no "type": "module", so its modules are CommonJS to Node and load through
// require(), as tests/harness/registry.ts loads the registry. SETTLE_MS is the app's own.
const { SETTLE_MS } = createRequire(import.meta.url)(
  '../../apps/web/src/lib/studio/preview-scheduler.ts',
) as typeof PreviewScheduler;

const plan = await loadPlan();
const thresholds = loadThresholds();

// No Playwright trace: its snapshots would be main-thread work the
// measurement counts. A failure keeps perf.json and its records.
test.use({ trace: 'off', screenshot: 'off', ...LAB_DEVICE });

for (const cell of perfCells(plan)) {
  test(
    `${cell.target} ${cell.state} ${cell.path}, performance at ${LAB_VIEWPORT} (${cell.performanceTier})`,
    {
      // @perf keeps it in its project when a shard runs only some of the project's cells.
      tag: [serverTag(cellServer(cell)), PERF_TAG],
      annotation: [
        { type: KIND_ANNOTATION, description: PERF_KIND },
        { type: 'route', description: cell.route },
        { type: 'profile', description: cell.profile },
        { type: 'cell', description: cell.id },
        { type: 'target', description: `${cell.kind}:${cell.target}` },
        { type: 'viewport', description: LAB_VIEWPORT },
      ],
    },
    async ({ page, browserName }, testInfo) => {
      // Each load runs up to memory.growthWindowMs[1] after its load event, throttled.
      const perLoad = thresholds.memory.growthWindowMs[1] + 30_000;
      test.setTimeout(60_000 + perLoad * (thresholds.timing.runs + 1));
      expect(browserName, "the perf cells measure through Chromium's CDP").toBe('chromium');
      await page.addInitScript(PERF_PROBE);
      const cdp = await startLab(page);
      const ran: string[] = [];

      const staticRun = await staticLoad(page, cdp, cell.path, thresholds);
      const runs: PerfRun[] = [];
      for (let index = 0; index < thresholds.timing.runs; index += 1) {
        runs.push(await defaultLoad(page, cdp, cell.path, thresholds));
      }
      const statuses = [staticRun.status, ...runs.map((run) => run.status)];
      ran.push('status');
      const sample = { tier: cell.performanceTier, static: staticRun, runs };
      const findings = perfFindings(sample, thresholds);
      ran.push('lcp', 'static');
      const timing = timingResult(runs, cell.performanceTier, thresholds);
      ran.push('timing');

      const file = testInfo.outputPath('perf.json');
      const artifacts = [path.relative(reportsDir(), file)];
      const perf = {
        cell: cell.id,
        target: `${cell.kind}:${cell.target}`,
        route: cell.route,
        tier: cell.performanceTier,
        lab: { ...LAB_DEVICE, cpuThrottling: 4, network: '150 ms RTT, 1.6 Mbps down, 750 kbps up' },
        sample,
        findings,
        timing,
      };
      writeFileSync(file, `${JSON.stringify(perf, null, 2)}\n`);
      await testInfo.attach('perf.json', { path: file, contentType: 'application/json' });

      const shared = {
        check: 'perf',
        surface: cell.target,
        composition: cell.kind === 'composition',
        route: cell.route,
        tuple: recordTuple(cell),
        viewport: LAB_VIEWPORT,
        inputMode: 'touch' as const,
        profile: cell.profile,
        artifacts,
      };
      const failures: CellFailure[] = [
        ...findings.map((finding): CellFailure => ({
          ...shared,
          rule: finding.rule,
          preferenceMode: finding.preferenceMode,
          expected: finding.expected,
          actual: finding.actual,
          element: finding.selector ? { selector: finding.selector } : undefined,
        })),
        ...(statuses.every((status) => status === cell.expectedStatus)
          ? []
          : [
              {
                ...shared,
                check: 'runner',
                rule: 'status',
                preferenceMode: 'default' as const,
                expected: cell.expectedStatus,
                actual: statuses.join(', '),
              },
            ]),
      ];
      const records = testInfo.outputPath(RECORDS_ATTACHMENT);
      writeFileSync(records, `${JSON.stringify(failures, null, 2)}\n`);
      await testInfo.attach(RECORDS_ATTACHMENT, { path: records, contentType: 'application/json' });
      testInfo.annotations.push({ type: CHECKS_ANNOTATION, description: ran.join(' ') });

      expect
        .soft(statuses, `${cell.path} answers ${cell.expectedStatus} on every load`)
        .toEqual(statuses.map(() => cell.expectedStatus));
      expect
        .soft(
          findings.map(
            (finding) => `${finding.rule}: ${finding.actual}, expected ${finding.expected}`,
          ),
          'the deterministic performance rules',
        )
        .toEqual([]);
    },
  );
}

// Demo Studio's Compare grid with Vary: Scheme, A and three schemes, every plate live (round 5,
// P0-2b): the one place Studio holds more than two live previews, so it's measured on its own
// at 1440, on Demo Studio's perf cell's server and tier. It's an interaction on a loaded page,
// not a page load, so it's a perf-interaction test, with that kind's checks
// (lib/checks.ts's PERF_INTERACTION_CHECKS), which the verdict holds it to: /studio answers
// 200, the grid holds four frames at most, the page's heap after a collection at
// memory.sampleMs is within memory.heapMiB for the tier, and a pointer sweep across the four
// plates and back blocks the main thread for at most vitals.tbtMs (the code review's C5-L2:
// each plate's frame loads again as it takes the heavy slot and gives it up). The sweep runs
// under the lab profile's CPU, throttled CPU_THROTTLING_RATE times as the page-load cells'
// loads are, so it's judged on a slow phone's CPU, not on the runner's: unthrottled, the same
// work measured 0 ms here and 285 ms on CI's runner (run 41433352108). Its values go in its
// perf.json, which the reporter keeps in summary.json.
const demoStudio = perfCells(plan).find((cell) => cell.target === 'demo-studio');
/** The plates a sweep points at, in order: across the four and back. */
const SWEEP_ORDER = [0, 1, 2, 3, 2, 1, 0] as const;
/**
 * How long the pointer rests on each plate: past SETTLE_MS, the pause a plate's frame waits
 * before it loads the document the heavy slot asks for, with room for the load to start, so
 * each rest really hands the slot on. A rest under SETTLE_MS moves the marker and loads nothing.
 */
const SWEEP_DWELL_MS = SETTLE_MS + 400;
if (demoStudio) {
  test.describe('the Compare grid', () => {
    test.use({
      viewport: { width: 1440, height: 900 },
      deviceScaleFactor: 1,
      isMobile: false,
      hasTouch: false,
    });
    test(
      `demo-studio compare grid /studio, Vary: Scheme with A and three schemes live, performance at 1440x900 (${demoStudio.performanceTier})`,
      {
        tag: [serverTag(cellServer(demoStudio)), PERF_TAG],
        annotation: [
          { type: KIND_ANNOTATION, description: PERF_INTERACTION_KIND },
          { type: 'route', description: demoStudio.route },
          { type: 'profile', description: demoStudio.profile },
          { type: 'target', description: `${demoStudio.kind}:${demoStudio.target}` },
          { type: 'viewport', description: '1440x900' },
        ],
      },
      async ({ page, browserName }, testInfo) => {
        test.setTimeout(120_000);
        expect(browserName, "the perf cells measure through Chromium's CDP").toBe('chromium');
        const ran: string[] = [];
        await page.addInitScript(PERF_PROBE);
        const cdp = await page.context().newCDPSession(page);
        await cdp.send('Performance.enable', { timeDomain: 'timeTicks' });
        const response = await page.goto('/studio');
        const status = response?.status() ?? 0;
        ran.push('status');
        await page.getByRole('button', { name: 'Compare compositions' }).click();
        await page
          .getByRole('radiogroup', { name: 'Vary' })
          .locator('label[data-option="colorScheme"]')
          .click();
        const live = page.locator('.studio-plate iframe');
        await expect(live).toHaveCount(4, { timeout: 30_000 });
        const opened = Date.now();
        await page.waitForTimeout(Math.max(0, thresholds.memory.sampleMs - (Date.now() - opened)));
        await cdp.send('HeapProfiler.collectGarbage');
        const { metrics } = (await cdp.send('Performance.getMetrics')) as {
          metrics: { name: string; value: number }[];
        };
        const heap = metrics.find(({ name }) => name === 'JSHeapUsedSize')?.value ?? Number.NaN;
        const heapMiB = heap / 1_048_576;
        const heapBudget = thresholds.memory.heapMiB[demoStudio.performanceTier];
        const frames = await page.locator('iframe').count();
        ran.push('frames', 'heap');

        // The sweep: the pointer across the four plates and back, then off them, each move
        // handing the one heavy slot on. Each rest makes its plate the heavy one, which the
        // sweep checks by its marker. Every iframe load in it counts, a remount's or a
        // reload's, through one capturing listener on the page, and so does every long task the
        // page's probe sees from the sweep's start until the frames settle: the plates' frames
        // are same-origin, on the page's own event loop.
        const views = page.locator('.studio-plate__view');
        await cdp.send('Emulation.setCPUThrottlingRate', { rate: CPU_THROTTLING_RATE });
        const start = await page.evaluate(() => {
          const counter = { loads: 0 };
          Object.defineProperty(window, '__gridLoads', { value: counter });
          document.addEventListener(
            'load',
            (event) => {
              if (event.target instanceof HTMLIFrameElement) counter.loads += 1;
            },
            true,
          );
          return performance.now();
        });
        let handedOn = 0;
        for (const at of SWEEP_ORDER) {
          await views.nth(at).hover();
          await expect(views.nth(at), `plate ${at + 1} takes the heavy slot`).toHaveAttribute(
            'data-motion',
            'full',
          );
          // One heavy plate at most: the slot moved, it wasn't added.
          await expect(page.locator('.studio-plate__view[data-motion="full"]')).toHaveCount(1);
          handedOn += 1;
          await page.waitForTimeout(SWEEP_DWELL_MS);
        }
        await page.mouse.move(1, 1);
        await expect(page.locator('.studio-plate__view[data-motion="full"]')).toHaveCount(0);
        await page.waitForTimeout(SWEEP_DWELL_MS);
        await expect(live).toHaveCount(4, { timeout: 30_000 });
        await page.waitForLoadState('networkidle');
        const { end, longTasks, reloads } = await page.evaluate(() => {
          const state = window as unknown as {
            __qualityPerf?: { longTasks: { startTime: number; duration: number }[] };
            __gridLoads?: { loads: number };
          };
          return {
            end: performance.now(),
            longTasks: state.__qualityPerf?.longTasks ?? [],
            reloads: state.__gridLoads?.loads ?? 0,
          };
        });
        await cdp.send('Emulation.setCPUThrottlingRate', { rate: 1 });
        const swept = longTasks.filter((task) => task.startTime >= start);
        const sweepTbtMs = Math.round(totalBlockingTime(swept, start, end));
        const tbtCeiling = ceilingFor('tbtMs', demoStudio.performanceTier, thresholds);
        ran.push('sweep');

        const file = testInfo.outputPath('perf.json');
        const result = {
          kind: PERF_INTERACTION_KIND,
          target: `${demoStudio.kind}:${demoStudio.target}`,
          route: demoStudio.route,
          tier: demoStudio.performanceTier,
          viewport: '1440x900',
          status,
          frames,
          heapMiB: Number(heapMiB.toFixed(1)),
          heapBudgetMiB: heapBudget,
          sweep: {
            order: SWEEP_ORDER,
            dwellMs: SWEEP_DWELL_MS,
            settleMs: SETTLE_MS,
            durationMs: Math.round(end - start),
            // Each rest that made its plate the heavy one, by its marker.
            handedOn,
            // Every iframe load in the sweep, a remount's or a reload's, and per plate.
            reloads,
            reloadsPerPlate: Number((reloads / 4).toFixed(2)),
            longTasks: swept.length,
            longTaskMs: Math.round(swept.reduce((total, task) => total + task.duration, 0)),
            tbtMs: sweepTbtMs,
            ceilingMs: tbtCeiling,
            cpuThrottling: CPU_THROTTLING_RATE,
          },
        };
        writeFileSync(file, `${JSON.stringify(result, null, 2)}\n`);
        await testInfo.attach('perf.json', { path: file, contentType: 'application/json' });
        testInfo.annotations.push({ type: CHECKS_ANNOTATION, description: ran.join(' ') });
        testInfo.annotations.push({
          type: 'compare grid',
          description: `${frames} frames, ${heapMiB.toFixed(1)} MiB of ${heapBudget} MiB, a sweep of ${handedOn} handovers and ${reloads} frame loads, ${swept.length} long tasks blocking ${sweepTbtMs} ms of ${tbtCeiling} ms`,
        });
        const records = testInfo.outputPath(RECORDS_ATTACHMENT);
        writeFileSync(records, '[]\n');
        await testInfo.attach(RECORDS_ATTACHMENT, {
          path: records,
          contentType: 'application/json',
        });
        // The verdict (lib/perf/compare-grid.ts): what the readings fail, and what's only reported.
        const verdict = compareGridVerdict({
          status,
          frames,
          heapMiB,
          heapBudgetMiB: heapBudget,
          handedOn,
          rests: SWEEP_ORDER.length,
          tbtMs: sweepTbtMs,
          tbtCeilingMs: tbtCeiling,
        });
        testInfo.annotations.push(...verdict.reported);
        expect(verdict.failures, `the Compare grid on ${demoStudio.route}`).toEqual([]);
      },
    );
  });
}
