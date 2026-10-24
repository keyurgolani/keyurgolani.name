import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { reportsDir } from '../../ci/lib/reports.mjs';
import { loadThresholds } from '../../quality/thresholds';
import { CHECKS_ANNOTATION, KIND_ANNOTATION } from './lib/checks';
import type { CellFailure } from './lib/failure-records';
import {
  defaultLoad,
  LAB_DEVICE,
  LAB_VIEWPORT,
  PERF_PROBE,
  staticLoad,
  startLab,
} from './lib/perf/measure';
import { PERF_KIND, perfCells } from './lib/perf/plan';
import { perfFindings, timingResult, type PerfRun } from './lib/perf/samples';
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
