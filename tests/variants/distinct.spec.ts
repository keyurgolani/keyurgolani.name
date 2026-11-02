import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { PNG } from 'pngjs';
import { expect, test } from '@playwright/test';
import { loadRegistrations } from '../quality/lib/registration';
import { decodePng } from '../quality/lib/pixels';
import {
  boxSimilarity,
  describeOutcome,
  edgeGrid,
  GRID_SIZES,
  judge,
  pairs,
  pixelDistance,
  sharedMarkupFindings,
  sharedShingles,
  SHARED_MARKUP_ENFORCED,
  signature,
  ssimMap,
  VIEWPORT_IDS,
  weightedJaccard,
  wrapInDivs,
  type BoxAcceptance,
  type Grid,
  type PairOutcome,
  type PairScore,
  type Thresholds,
} from './distinct';
import { captureComposition, FIXTURE, reportPath, ROUTE, type Capture } from './distinct-capture';
import { FALLBACK_ID, firstParty, UNDER_TEST } from './target';

// The distinct guards (Design gate rule 5, stream C): the five first-party
// compositions must really differ, with the appearance tuple held constant
// (distinct-capture.ts). Three guards, each scored for every pair at
// desktop and at mobile (distinct.ts), with thresholds from distinct.json:
//
// - Structure (design): the boundary's DOM shape, similarity at most T_dom.
// - Layout boxes (design): the top-level blocks across the first two
//   viewports, less the main landmark that wraps them, area-weighted IoU
//   similarity at most T_box, when its
//   calibration found a gap; null there, it doesn't gate.
// - Pixels (clones): the first viewport's edge map, distance at least T_px.
//   This guard catches clones, not design: T_px sits just over the noise a
//   re-render, a dark scheme, or another typography makes, so it fails only
//   two compositions whose first viewports are the same page. It gates every
//   pair, pending or not.
//
// A composition whose quality unit says `distinct: 'pending'` is waiting for
// its redesign: for the design guards, a pair of two pending ones is
// reported, not failed, and a pending one that already passes them against
// every other fails as stale, so the list can't hide a finished one. A
// failure prints the pair, its scores, and the shingles it shares most; the
// side-by-side screenshots and the edge agreement heatmap of every pair that
// doesn't pass go to reports/variants/distinct/.
//
// Each first-party boundary's section frames rendered shared are stream
// E's audit.shared-markup, observed in the rendered output. The findings
// are attached, and fail the run only once SHARED_MARKUP_ENFORCED is on,
// with E's PR 3 pins.

/** The thresholds, and the calibration they came from (distinct-calibration.spec.ts). */
const DISTINCT = JSON.parse(readFileSync(new URL('./distinct.json', import.meta.url), 'utf8')) as {
  readonly thresholds: Thresholds;
  /** Whether distinct-calibration.spec.ts set them. */
  readonly calibrated: boolean;
  /** The lead's recorded box-only acceptances, which a calibration leaves as they are. */
  readonly accepted?: readonly BoxAcceptance[];
};

const GUARDED = UNDER_TEST.filter(
  (variant) => firstParty(variant) && variant.manifest.id !== FALLBACK_ID,
);
const IDS = GUARDED.map(({ manifest }) => manifest.id);

test.describe.configure({ mode: 'serial' });

const captures: Capture[] = [];

for (const variant of GUARDED) {
  const { id } = variant.manifest;
  test(
    `${id}: home's boundary and first viewport, at desktop and mobile`,
    { annotation: [{ type: 'route', description: ROUTE }] },
    async ({ browser }, testInfo) => {
      testInfo.setTimeout(5 * 60_000);
      const own = await captureComposition({ browser, variant: id, testInfo });
      captures.push(...own);
      for (const capture of own) {
        await testInfo.attach(`${id}-${capture.viewport}.png`, {
          body: capture.png,
          contentType: 'image/png',
        });
      }

      // Transparency: the same boundary in 3 more divs is the same structure.
      const domThreshold = DISTINCT.thresholds.dom;
      for (const capture of domThreshold ? own : []) {
        const wrapped = weightedJaccard(
          signature(capture.boundary),
          signature(wrapInDivs(capture.boundary)),
        );
        expect(wrapped, `${id} in 3 more divs at ${capture.viewport}`).toBeGreaterThan(
          domThreshold![capture.viewport],
        );
      }

      // audit.shared-markup, the rendered side of stream E's rule.
      const findings = sharedMarkupFindings({
        packageName: variant.packageName,
        file: `${ROUTE} (${FIXTURE.name})`,
        frames: own.find(({ viewport }) => viewport === 'desktop')!.frames,
      });
      if (findings.length > 0) {
        await testInfo.attach('audit.shared-markup.json', {
          body: `${JSON.stringify(findings, null, 2)}\n`,
          contentType: 'application/json',
        });
        testInfo.annotations.push({
          type: 'audit.shared-markup',
          description: `${findings.length} shared frame(s)${SHARED_MARKUP_ENFORCED ? '' : ', reported until E’s PR 3 pins land'}`,
        });
      }
      if (SHARED_MARKUP_ENFORCED) expect(findings, 'audit.shared-markup').toEqual([]);
    },
  );
}

/** Two screenshots side by side, and the edge grids' SSIM heatmap, dark where they agree. */
function sideBySide(a: Capture, b: Capture, map: Grid): Buffer {
  const left = decodePng(a.png);
  const right = decodePng(b.png);
  const width = left.width + right.width + left.width;
  const height = Math.max(left.height, right.height);
  const out = new PNG({ width, height });
  out.data.fill(255);
  const blit = (image: typeof left, x0: number) => {
    for (let y = 0; y < image.height; y++) {
      const row = Buffer.from(
        image.data.buffer,
        image.data.byteOffset + y * image.width * 4,
        image.width * 4,
      );
      row.copy(out.data, (y * width + x0) * 4);
    }
  };
  blit(left, 0);
  blit(right, left.width);
  // The heatmap: each window's agreement, scaled over the third panel.
  for (let y = 0; y < left.height; y++) {
    for (let x = 0; x < left.width; x++) {
      const cell =
        map.data[
          Math.min(map.height - 1, Math.floor((y * map.height) / left.height)) * map.width +
            Math.min(map.width - 1, Math.floor((x * map.width) / left.width))
        ]!;
      const agreement = Math.max(0, Math.min(1, cell));
      const i = (y * width + left.width + right.width + x) * 4;
      out.data[i] = Math.round(255 * (1 - agreement));
      out.data[i + 1] = Math.round(64 * (1 - agreement));
      out.data[i + 2] = Math.round(64 * (1 - agreement));
      out.data[i + 3] = 255;
    }
  }
  return PNG.sync.write(out);
}

test('every first-party pair differs in structure and layout, and no two are clones', async ({}, testInfo) => {
  // The pairs grow with each registration (91 at 14), and under load the judging ran 34 to 42 s,
  // past Playwright's 30 s default, with clean verdicts (2026-10-30). The captures above get 5 minutes.
  testInfo.setTimeout(3 * 60_000);
  const { units } = await loadRegistrations();
  const pending = units.filter((unit) => unit.distinct === 'pending').map((unit) => unit.id);
  const find = (id: string, viewport: string) =>
    captures.find((each) => each.variant === id && each.viewport === viewport)!;
  const scores: PairScore[] = [];
  const shared = new Map<string, { shingle: string; weight: number }[]>();
  const heatmaps = new Map<string, Grid>();
  for (const viewport of VIEWPORT_IDS) {
    const { cols, rows } = GRID_SIZES[viewport];
    for (const [a, b] of pairs(IDS)) {
      const [ca, cb] = [find(a, viewport), find(b, viewport)];
      const [sa, sb] = [signature(ca.boundary), signature(cb.boundary)];
      const [ga, gb] = [edgeGrid(ca.png, cols, rows), edgeGrid(cb.png, cols, rows)];
      scores.push({
        a,
        b,
        viewport,
        dom: weightedJaccard(sa, sb),
        box: boxSimilarity(ca.boxes, cb.boxes),
        px: pixelDistance(ga, gb),
      });
      shared.set(`${a} ${b} ${viewport}`, sharedShingles(sa, sb));
      heatmaps.set(`${a} ${b} ${viewport}`, ssimMap(ga, gb));
    }
  }
  const verdict = judge({
    ids: IDS,
    pending,
    scores,
    thresholds: DISTINCT.thresholds,
    accepted: DISTINCT.accepted ?? [],
  });
  if (!DISTINCT.calibrated) {
    testInfo.annotations.push({
      type: 'distinct uncalibrated',
      description: "distinct.json's thresholds aren't a calibration's",
    });
  }

  const dir = reportPath(testInfo);
  mkdirSync(dir, { recursive: true });
  const explain = (outcome: PairOutcome) => {
    const key = `${outcome.a} ${outcome.b} ${outcome.viewport}`;
    const file = path.join(dir, `${outcome.a}-${outcome.b}-${outcome.viewport}.png`);
    writeFileSync(
      file,
      sideBySide(
        find(outcome.a, outcome.viewport),
        find(outcome.b, outcome.viewport),
        heatmaps.get(key)!,
      ),
    );
    const top = shared
      .get(key)!
      .map(({ shingle, weight }) => `      ${weight}  ${shingle}`)
      .join('\n');
    return `  ${describeOutcome(outcome, DISTINCT.thresholds)}\n    shared shingles:\n${top}\n    ${file}`;
  };
  const failures = verdict.failures.map(explain);
  const clones = verdict.clones.map(explain);
  const reports = verdict.reports.map(explain);
  writeFileSync(
    path.join(dir, 'verdict.json'),
    `${JSON.stringify({ thresholds: DISTINCT.thresholds, pending, ...verdict }, null, 2)}\n`,
  );
  await testInfo.attach('verdict.json', {
    path: path.join(dir, 'verdict.json'),
    contentType: 'application/json',
  });
  for (const outcome of verdict.outcomes) {
    testInfo.annotations.push({
      type: outcome.mode === 'report' ? 'distinct report' : 'distinct',
      description: describeOutcome(outcome, DISTINCT.thresholds),
    });
  }
  if (reports.length > 0) {
    console.log(
      `[distinct] ${reports.length} pending pair(s) don't differ yet, reported and not failed:\n${reports.join('\n')}`,
    );
  }

  expect(
    verdict.problems,
    'the guard covers every pending composition and scores every pair',
  ).toEqual([]);
  expect(
    verdict.stale,
    "pending compositions that already pass the design guards against every other: remove `distinct: 'pending'` from their quality units",
  ).toEqual([]);
  expect(clones, 'pairs whose first viewports are the same page, pending or not').toEqual([]);
  expect(failures, 'pairs with a composition off pending that do not differ').toEqual([]);
});
