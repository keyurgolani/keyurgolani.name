// Evidence only, never merged: replaces tests/quality/perf.spec.ts on its evidence branch. For the
// perf cells of kinetic-cosmos and raw-grid, the lab's default load (defaultLoad, unchanged) under a
// Chrome trace, and A/B variants with one of Kinetic Cosmos's three opening loops held still (or its
// sky's mask removed), injected as a style at DOMContentLoaded in every variant alike. Writes each
// load's readings and its trace under reports/quality/kc-probe/.
import { mkdirSync, writeFileSync } from 'node:fs';
import { loadavg } from 'node:os';
import path from 'node:path';
import { reportsDir } from '../../ci/lib/reports.mjs';
import { loadThresholds } from '../../quality/thresholds';
import { defaultLoad, LAB_DEVICE, LAB_VIEWPORT, PERF_PROBE, startLab } from './lib/perf/measure';
import { perfCells } from './lib/perf/plan';
import { setOwnTimeout } from './lib/perf/isolation';
import { PERF_TAG } from './lib/pr-shards';
import { cellServer, serverTag } from './lib/server';
import { test } from './fixtures';
import { loadPlan } from './plan';
import type { CDPSession } from '@playwright/test';

const plan = await loadPlan();
const thresholds = loadThresholds();
const OUT = path.join(reportsDir(), 'quality', 'kc-probe');
const TRACED = Number(process.env.KC_PROBE_TRACED ?? 3);
const PLAIN = Number(process.env.KC_PROBE_PLAIN ?? 3);
const CATEGORIES = [
  'toplevel',
  'devtools.timeline',
  'disabled-by-default-devtools.timeline',
  'disabled-by-default-devtools.timeline.frame',
  'blink',
  'blink.user_timing',
  'loading',
  'cc',
  'v8.execute',
];
const KC = "[data-variant='kinetic-cosmos']";
const VARIANTS: Record<string, readonly { name: string; css: string }[]> = {
  'kinetic-cosmos': [
    { name: 'base', css: '' },
    { name: 'no-inner', css: `${KC} .kc-plane--inner .kc-spin { animation: none !important; }` },
    { name: 'no-outer', css: `${KC} .kc-plane--outer .kc-spin { animation: none !important; }` },
    { name: 'no-drift', css: `${KC} .kc-sky__drift { animation: none !important; }` },
    { name: 'no-mask', css: `${KC} .kc-sky { mask-image: none !important; }` },
    {
      name: 'no-loops',
      css: `${KC} :is(.kc-spin, .kc-sky__drift) { animation: none !important; }`,
    },
  ],
  'raw-grid': [{ name: 'base', css: '' }],
};

const INJECT = `(() => {
  const add = () => {
    const css = window.__kcProbeCss || '';
    const style = document.createElement('style');
    style.setAttribute('data-kc-probe', '');
    style.textContent = css;
    document.head.append(style);
  };
  document.addEventListener('DOMContentLoaded', add, { once: true });
})()`;

async function traced<T>(cdp: CDPSession, file: string, run: () => Promise<T>): Promise<T> {
  await cdp.send('Tracing.start', {
    traceConfig: { includedCategories: CATEGORIES, recordMode: 'recordContinuously' },
    transferMode: 'ReturnAsStream',
  });
  let result: T;
  try {
    result = await run();
  } finally {
    const done = new Promise<{ stream?: string }>((resolve) =>
      cdp.once('Tracing.tracingComplete', resolve as (event: unknown) => void),
    );
    await cdp.send('Tracing.end');
    const { stream } = await done;
    const chunks: string[] = [];
    if (stream) {
      for (;;) {
        const chunk = await cdp.send('IO.read', { handle: stream, size: 4 * 1024 * 1024 });
        chunks.push(
          chunk.base64Encoded ? Buffer.from(chunk.data, 'base64').toString('utf8') : chunk.data,
        );
        if (chunk.eof) break;
      }
      await cdp.send('IO.close', { handle: stream });
    }
    writeFileSync(file, chunks.join(''));
  }
  return result!;
}

test.use({ trace: 'off', screenshot: 'off', ...LAB_DEVICE });

for (const cell of perfCells(plan)) {
  const variants = VARIANTS[cell.target];
  if (!variants || cell.kind !== 'composition') continue;
  test(
    `${cell.target} ${cell.state} ${cell.path}, performance at ${LAB_VIEWPORT} (${cell.performanceTier})`,
    { tag: [serverTag(cellServer(cell)), PERF_TAG] },
    async ({ page }, testInfo) => {
      setOwnTimeout(testInfo, 60 * 60_000);
      mkdirSync(OUT, { recursive: true });
      await page.addInitScript(PERF_PROBE);
      await page.addInitScript(INJECT);
      const cdp = await startLab(page);
      const rows: unknown[] = [];
      for (const variant of variants) {
        await page.addInitScript(`window.__kcProbeCss = ${JSON.stringify(variant.css)};`);
        for (let at = 0; at < TRACED + PLAIN; at += 1) {
          const tracedLoad = at < TRACED;
          const file = path.join(OUT, `${cell.target}-${variant.name}-${at + 1}.trace.json`);
          const run = tracedLoad
            ? await traced(cdp, file, () => defaultLoad(page, cdp, cell.path, thresholds))
            : await defaultLoad(page, cdp, cell.path, thresholds);
          const injected = await page
            .evaluate(() => document.querySelector('style[data-kc-probe]')?.textContent ?? null)
            .catch(() => null);
          // The mode the load rendered in: the boundary's display mode, its computed color-scheme,
          // and the emulated preference, so a reading is never taken as dark when the page was light.
          const look = await page
            .evaluate(() => {
              const boundary =
                document.querySelector('[data-appearance-boundary="document"]') ??
                document.documentElement;
              return {
                displayMode: boundary.getAttribute('data-display-mode'),
                colorScheme: getComputedStyle(boundary).colorScheme,
                prefersDark: matchMedia('(prefers-color-scheme: dark)').matches,
              };
            })
            .catch(() => null);
          const row = {
            target: cell.target,
            variant: variant.name,
            load: at + 1,
            traced: tracedLoad,
            injected,
            look,
            // The machine's 1-minute load as the load ended: a busy machine makes idle time noise.
            machineLoad1: Math.round((loadavg()[0] ?? 0) * 10) / 10,
            calibrationMs: run.calibrationMs,
            idleTaskMs: run.idleTaskMs,
            tbtMs: run.tbtMs,
            lcpMs: run.lcpMs,
            ...(tracedLoad ? { trace: path.basename(file) } : {}),
          };
          console.log(`[kc-probe] ${JSON.stringify(row)}`);
          rows.push(row);
        }
      }
      writeFileSync(
        path.join(OUT, `${cell.target}-loads.json`),
        `${JSON.stringify(rows, null, 2)}\n`,
      );
    },
  );
}
