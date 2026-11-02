import { cpSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, test } from '@playwright/test';
import { buildFixtureHost } from '../harness/fixture-host.mjs';
import {
  boxSimilarity,
  calibrate,
  edgeGrid,
  GRID_SIZES,
  judge,
  noiseFloor,
  pairs,
  pixelDistance,
  signature,
  VIEWPORT_IDS,
  weightedJaccard,
  wrapInDivs,
  type Calibration,
  type NoiseFloor,
  type PairScore,
  type Thresholds,
  type ViewportId,
} from './distinct';
import {
  captureComposition,
  controlLooks,
  DEFAULT_LOOK,
  reportPath,
  staticLayouts,
  type Capture,
} from './distinct-capture';
import { FALLBACK_ID, firstParty, UNDER_TEST } from './target';

// The distinct guards' calibration (Design gate rule 5), which
// `PORTFOLIO_DISTINCT_CALIBRATE=1 pnpm test:variants --project
// distinct-calibration` runs once, and again whenever a signature or the
// controls change. It writes reports/variants/distinct/calibration.json,
// every score with its role, and distinct.calibrated.json, the shape
// tests/variants/distinct.json commits.
//
// Every control names its role in each guard: `same`, `different`, or
// `informational`, which no threshold reads.
//
// - "Same": each first-party composition against itself re-rendered, in a
//   dark scheme, in another typography, and in a textured design language,
//   and its boundary against the same boundary in 3 extra divs (structure
//   only). The textured language changes radii, borders, and padding, so
//   it's informational for the pixel guard.
// - "Different", by construction: the chapters route fixture and the static
//   layouts in tests/fixtures/variants/static-layouts/ (one column, two
//   columns, a card grid, a full-bleed hero, a horizontal strip), each pair
//   of them, and chapters against each first-party composition.
// - Informational: notes against each composition and the reference variant
//   against the fallback, which render the same shared section markup and
//   so aren't different by construction, and each static layout against
//   each composition, which a composition could legitimately resemble.
//
// The design guards, structure and layout boxes, put their threshold
// halfway into the gap between their "same" and "different" controls, and
// gate only with a gap of 0.1 or more at both viewports. The clone guard's
// threshold is twice its "same" controls' noise floor.
//
// The fixture variants and the reference register only in a fixture host
// (tests/harness/fixture-host.mjs), so the run builds one: a copy of this
// checkout with chapters, notes, and the reference linked in, and measures
// every composition on it. The reference links from its sources, its
// package.json pointed at src/ in place of the dist/ its tarball ships, so
// the host installs offline with nothing fetched: test:external-variant's
// tarball add may read registry metadata. What renders is the same source.
// The static layouts render on the fallback composition's server, inside a
// copy of its document boundary, so they take the same tuple.

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REFERENCE_SOURCE = path.resolve(HERE, '..', 'external-variant');
const REFERENCE_ID = 'acme-reference';
const CHAPTERS = 'fixture-chapters';
const NOTES = 'fixture-notes';

/** The first-party compositions the guards cover. */
const GUARDED = UNDER_TEST.filter(
  (variant) => firstParty(variant) && variant.manifest.id !== FALLBACK_ID,
).map(({ manifest }) => manifest.id);

const STATICS = staticLayouts().map(({ name }) => name);

/**
 * The reference variant's package in `dir`, linked from its sources: the
 * files its tarball holds, with src/ for dist/, and package.json's exports
 * pointed there.
 */
function stageReference(dir: string): string {
  const out = path.join(dir, REFERENCE_ID);
  mkdirSync(out, { recursive: true });
  for (const name of ['manifest.json', 'styles.css', 'src']) {
    cpSync(path.join(REFERENCE_SOURCE, name), path.join(out, name), { recursive: true });
  }
  const manifest = JSON.parse(readFileSync(path.join(REFERENCE_SOURCE, 'package.json'), 'utf8'));
  delete manifest.files;
  delete manifest.peerDependencies;
  manifest.main = './src/index.tsx';
  manifest.types = './src/index.tsx';
  manifest.exports = {
    '.': './src/index.tsx',
    './manifest': './manifest.json',
    './styles.css': './styles.css',
    './package.json': './package.json',
    './enhancements/badge': './src/enhancements/badge.tsx',
  };
  writeFileSync(path.join(out, 'package.json'), `${JSON.stringify(manifest, null, 2)}\n`);
  return out;
}

test.describe.configure({ mode: 'serial' });

const host: { web?: string; root?: string; remove?: () => void } = {};
const captures: Capture[] = [];

test.beforeAll(async ({}, testInfo) => {
  testInfo.setTimeout(40 * 60_000);
  // PORTFOLIO_DISTINCT_HOST_WEB reuses a host an earlier run kept, by its apps/web.
  const kept = process.env.PORTFOLIO_DISTINCT_HOST_WEB;
  if (kept) {
    host.web = kept;
    return;
  }
  const staging = mkdtempSync(path.join(tmpdir(), 'portfolio-distinct-reference-'));
  const built = buildFixtureHost({
    variants: ['chapters', 'notes', stageReference(staging)],
    log: testInfo.outputPath('fixture-host.log'),
  });
  Object.assign(host, built);
  console.log(`[distinct] fixture host ${built.root}, the reference staged in ${staging}`);
});

test.afterAll(() => {
  // PORTFOLIO_DISTINCT_KEEP_HOST keeps the host for a look afterwards.
  if (!process.env.PORTFOLIO_DISTINCT_KEEP_HOST) host.remove?.();
});

for (const id of GUARDED) {
  test(`${id}: home in the guards' tuple and in each "same" control's look`, async ({
    browser,
  }, testInfo) => {
    testInfo.setTimeout(10 * 60_000);
    const looks = [DEFAULT_LOOK, ...controlLooks(id)];
    captures.push(
      ...(await captureComposition({ browser, web: host.web!, variant: id, looks, testInfo })),
    );
  });
}

test(`${FALLBACK_ID}: home in the guards' tuple, and the static layouts in it`, async ({
  browser,
}, testInfo) => {
  testInfo.setTimeout(10 * 60_000);
  captures.push(
    ...(await captureComposition({
      browser,
      web: host.web!,
      variant: FALLBACK_ID,
      statics: true,
      testInfo,
    })),
  );
});

for (const id of [CHAPTERS, NOTES, REFERENCE_ID]) {
  test(`${id}: home in the guards' tuple`, async ({ browser }, testInfo) => {
    testInfo.setTimeout(10 * 60_000);
    captures.push(
      ...(await captureComposition({ browser, web: host.web!, variant: id, testInfo })),
    );
  });
}

type Role = 'same' | 'different' | 'informational';
type Guard = 'dom' | 'box' | 'px';

interface ControlScore {
  readonly a: string;
  readonly b: string;
  readonly control: string;
  readonly viewport: ViewportId;
  /** Each guard's role for this control; a guard it doesn't measure is absent. */
  readonly roles: Partial<Record<Guard, Role>>;
  readonly dom: number;
  readonly box?: number;
  readonly px?: number;
}

const round = (value: number) => Math.round(value * 1000) / 1000;
const label = (capture: Capture) =>
  `${capture.variant}${capture.look === 'default' ? '' : `@${capture.look}`}`;

test('the controls set each threshold, and today’s first-party pairs are scored', async ({}, testInfo) => {
  const find = (variant: string, look: string, viewport: ViewportId) => {
    const capture = captures.find(
      (each) => each.variant === variant && each.look === look && each.viewport === viewport,
    );
    if (!capture) throw new Error(`No capture of ${variant} in ${look} at ${viewport}`);
    return capture;
  };
  const scores = (a: Capture, b: Capture) => {
    const { cols, rows } = GRID_SIZES[a.viewport];
    return {
      dom: round(weightedJaccard(signature(a.boundary), signature(b.boundary))),
      box: round(boxSimilarity(a.boxes, b.boxes)),
      px: round(pixelDistance(edgeGrid(a.png, cols, rows), edgeGrid(b.png, cols, rows))),
    };
  };
  const control = (
    a: Capture,
    b: Capture,
    name: string,
    roles: Partial<Record<Guard, Role>>,
  ): ControlScore => ({
    a: label(a),
    b: label(b),
    control: name,
    viewport: a.viewport,
    roles,
    ...scores(a, b),
  });
  const all = (role: Role) => ({ dom: role, box: role, px: role });

  const controls: ControlScore[] = [];
  const today: PairScore[] = [];
  for (const viewport of VIEWPORT_IDS) {
    const at = (variant: string, look = 'default') => find(variant, look, viewport);
    for (const id of GUARDED) {
      for (const look of ['rerender', 'dark', 'typography']) {
        controls.push(control(at(id), at(id, look), look, all('same')));
      }
      controls.push(
        control(at(id), at(id, 'textured'), 'textured', {
          dom: 'same',
          box: 'same',
          px: 'informational',
        }),
      );
      controls.push({
        a: id,
        b: `${id} in 3 more divs`,
        control: 'wrapped',
        viewport,
        roles: { dom: 'same' },
        dom: round(
          weightedJaccard(signature(at(id).boundary), signature(wrapInDivs(at(id).boundary))),
        ),
      });
    }
    for (const [a, b] of pairs([CHAPTERS, ...STATICS])) {
      controls.push(control(at(a), at(b), 'constructed', all('different')));
    }
    for (const id of GUARDED) {
      controls.push(control(at(CHAPTERS), at(id), 'chapters-composition', all('different')));
      controls.push(control(at(NOTES), at(id), 'notes-composition', all('informational')));
      for (const layout of STATICS) {
        controls.push(control(at(layout), at(id), 'static-composition', all('informational')));
      }
    }
    controls.push(control(at(REFERENCE_ID), at(FALLBACK_ID), 'reference', all('informational')));
    for (const [a, b] of pairs(GUARDED)) {
      today.push({ a, b, viewport, ...scores(at(a), at(b)) });
    }
  }

  const values = (guard: Guard, role: Role, viewport: ViewportId) =>
    controls.flatMap((each) =>
      each.viewport === viewport && each.roles[guard] === role && each[guard] !== undefined
        ? [each[guard]!]
        : [],
    );
  const calibration = { dom: {}, box: {}, px: {} } as {
    dom: Record<ViewportId, Calibration>;
    box: Record<ViewportId, Calibration>;
    px: Record<ViewportId, NoiseFloor>;
  };
  for (const viewport of VIEWPORT_IDS) {
    for (const guard of ['dom', 'box'] as const) {
      calibration[guard][viewport] = calibrate(
        values(guard, 'same', viewport),
        values(guard, 'different', viewport),
        'similarity',
      );
    }
    calibration.px[viewport] = noiseFloor(values('px', 'same', viewport));
  }
  // A design guard gates only when both viewports have a threshold.
  const design = (guard: 'dom' | 'box') =>
    VIEWPORT_IDS.every((viewport) => calibration[guard][viewport].threshold !== null)
      ? (Object.fromEntries(
          VIEWPORT_IDS.map((viewport) => [viewport, calibration[guard][viewport].threshold]),
        ) as Record<ViewportId, number>)
      : null;
  const thresholds: Thresholds = {
    dom: design('dom'),
    box: design('box'),
    px: Object.fromEntries(
      VIEWPORT_IDS.map((viewport) => [viewport, calibration.px[viewport].threshold]),
    ) as Record<ViewportId, number>,
  };
  const verdict = judge({ ids: GUARDED, pending: GUARDED, scores: today, thresholds });

  const dir = reportPath(testInfo);
  mkdirSync(dir, { recursive: true });
  const report = {
    tuple: DEFAULT_LOOK,
    guarded: GUARDED,
    calibration,
    thresholds,
    controls,
    verdict,
  };
  writeFileSync(path.join(dir, 'calibration.json'), `${JSON.stringify(report, null, 2)}\n`);
  const { designLanguage, colorScheme, typography, displayMode } = DEFAULT_LOOK;
  const tuple = { designLanguage, colorScheme, typography, displayMode };
  const committed = {
    note: "Thresholds and controls from distinct-calibration.spec.ts. Every control names its role in each guard: 'same' and 'different' set a threshold, and 'informational' sets none. A design guard (dom, box) whose threshold is null found no gap of 0.1 at both viewports, and doesn't gate.",
    calibrated: true,
    // The lead's recorded box acceptances carry over as they are: a calibration sets thresholds, not rulings.
    accepted:
      (
        JSON.parse(readFileSync(new URL('./distinct.json', import.meta.url), 'utf8')) as {
          accepted?: unknown[];
        }
      ).accepted ?? [],
    thresholds,
    calibration,
    tuple,
    controls,
    today: verdict.outcomes.map(({ a, b, viewport, dom, box, px }) => ({
      a,
      b,
      viewport,
      dom,
      box,
      px,
    })),
  };
  writeFileSync(
    path.join(dir, 'distinct.calibrated.json'),
    `${JSON.stringify(committed, null, 2)}\n`,
  );
  await testInfo.attach('calibration.json', {
    path: path.join(dir, 'calibration.json'),
    contentType: 'application/json',
  });
  console.log(`[distinct] calibration: ${path.join(dir, 'calibration.json')}`);
  for (const viewport of VIEWPORT_IDS) {
    for (const guard of ['dom', 'box'] as const) {
      const { same, different, gap, threshold } = calibration[guard][viewport];
      console.log(
        `[distinct] ${guard} ${viewport}: same ${same}, different ${different}, gap ${gap}, threshold ${threshold}`,
      );
    }
    const { floor, threshold } = calibration.px[viewport];
    console.log(`[distinct] px ${viewport}: noise floor ${floor}, threshold ${threshold}`);
  }
  for (const outcome of verdict.outcomes) {
    console.log(
      `[distinct] today ${outcome.viewport} ${outcome.a} ${outcome.b}: dom ${outcome.dom} (${outcome.domPass}), box ${outcome.box} (${outcome.boxPass}), px ${outcome.px} (${outcome.pxPass})`,
    );
  }
  // The clone guard always has a threshold; a design guard without a gap is reported above.
  expect(thresholds.px.desktop).toBeGreaterThan(0);
  expect(thresholds.px.mobile).toBeGreaterThan(0);
});
