import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { expect, test } from '@playwright/test';
import { DEFAULT_LOOK } from './distinct-capture';
import {
  AXES,
  applyRulings,
  describeRefused,
  describeSharedDivider,
  describeUnneeded,
  enforcementFailures,
  CLONE_RESOLUTION,
  describePackOutcome,
  detectMaterial,
  guardAxis,
  judgePacks,
  materialMode,
  reportOnlyCompositions,
  sharedDividers,
  withRenderedColors,
  type AxisPack,
  type MaterialDetection,
  type PackRuling,
  type PackThresholds,
  type SurfaceProbe,
} from './pack-distinct';
import {
  axisPacks,
  buildRegistry,
  darkLook,
  excludedPacks,
  onlyMode,
  packLook,
  readRoleColors,
  readSurfaceProbe,
  rendersAsAsked,
  unscorable,
} from './pack-distinct-capture';
import {
  captureShots,
  scorePairs,
  writeReport,
  writeReportOnly,
  type Shot,
} from './pack-distinct-report';

// The pack-distinctness guard (LANG-3): one composition, the one its axis's
// JSON names, renders under every selectable pack on the axis, with the
// other axes at the guards' tuple, reduced motion, and Math.random seeded,
// at 1440x900 and 390x844. Every pair gets a pixel score (the first
// viewport's edges, as distinct's clone guard reads them) and a token score
// over the groups a static render shows (pack-distinct.ts), with the other
// groups as informational lines. It fails when its pixels say alike,
// whatever its tokens say, or when either score sits under its clone floor,
// with the thresholds the axis's JSON holds
// (pack-distinct-calibration.spec.ts sets them).
//
// It reads the packs from the build's registry at run time, so a merge or a
// new pack needs no edit here. PORTFOLIO_PACK_DISTINCT_AXIS points it at
// another axis (LANG-4). With `enforced` false in the JSON, failures are
// reported (the matrices, the ranked list, and the specimen sheets in
// reports/variants/pack-distinct/<axis>/) and only a broken input fails.
//
// A design language's material scores only where the composition renders
// the Surface primitive: the run probes the axis's default pack's render at
// each viewport, and detectMaterial() decides (PORTFOLIO_PACK_DISTINCT_MATERIAL
// on or off overrides it). The report's material.json records the result
// and its reason, and the run says so when it differs from the calibration's.
//
// For a color scheme (LANG-4) the perceptual score is ΔE00 over the role
// colors the render computes, in both base modes, so each scheme renders in
// the dark display mode too, and the edges are dropped: they're reported
// beside each pair and never judged. A scheme with one base mode renders it
// under either preference, so its light render stands for both.
//
// Report only (LANG-2): after the verdict, each of the axis's report-only
// compositions (pack-distinct.ts's REPORT_ONLY, Editorial Evidence for the
// design languages) renders under every pack into report-only/<variant>/:
// its scores with their informational lines, its tiles, and its specimen
// sheets. They never vote: the verdict reads the scored composition's shots
// alone (scoreShots()), and a report-only render that fails is an
// annotation, never a failure.

const AXIS = guardAxis();
const SPEC = AXES[AXIS];
const JSON_FILE = new URL(`./${SPEC.file}`, import.meta.url);

interface AxisJson {
  readonly calibrated: boolean;
  readonly enforced: boolean;
  readonly composition: string;
  readonly thresholds: PackThresholds;
  /** The rulings: a failing pair a ruling names passes, and a ruling that no longer rules a failure is unneeded. */
  readonly rulings?: readonly PackRuling[];
  /** The material's detection on the calibration's render, when the calibration recorded one. */
  readonly material?: MaterialDetection;
  /** Whether the composition is pinned, so a composition with more coverage never moves it (LANG-2). */
  readonly pinned?: boolean;
  /** What the calibration's coverage procedure would pick, beside the scored composition's coverage. */
  readonly procedurePick?: {
    readonly composition: string;
    readonly coverage: number;
    readonly scoredCoverage: number | null;
  };
}

/**
 * The axis's thresholds and the composition they were calibrated on. An
 * axis with no JSON yet (LANG-4's, before its calibration) runs
 * uncalibrated on the languages' composition: no score votes, and only
 * identical renders or tokens fail, as reports.
 */
const DISTINCT: AxisJson = existsSync(JSON_FILE)
  ? JSON.parse(readFileSync(JSON_FILE, 'utf8'))
  : {
      calibrated: false,
      enforced: false,
      composition: (
        JSON.parse(
          readFileSync(new URL(`./${AXES.designLanguage.file}`, import.meta.url), 'utf8'),
        ) as AxisJson
      ).composition,
      thresholds: {
        [SPEC.perceptual]: {
          alike: null,
          clone: { desktop: CLONE_RESOLUTION, mobile: CLONE_RESOLUTION },
        },
        token: { alike: null, clone: { desktop: CLONE_RESOLUTION, mobile: CLONE_RESOLUTION } },
      } as unknown as PackThresholds,
    };

const registry = buildRegistry();
/** The packs the axis can't score, and why (a generator scheme), reported beside the verdict. */
const SKIPPED = unscorable(registry, AXIS);
/** The packs this build leaves out, such as profile-image, named in the report and never scored. */
const EXCLUDED = excludedPacks(registry, AXIS);
const PACKS = axisPacks(registry, AXIS).filter(({ id }) => !SKIPPED.some((skip) => skip.id === id));

test.describe.configure({ mode: 'serial' });

const state: {
  shots: Shot[];
  problems: string[];
  probes: Partial<Record<'desktop' | 'mobile', SurfaceProbe>>;
  /** The packs as the verdict scored them, the material in or out; the report-only scores read the same. */
  packs?: readonly AxisPack[];
  /** A color scheme's rendered role colors, by look name, read at desktop. */
  colors: Record<string, Record<string, string>>;
  /** The schemes whose dark look rendered as asked. */
  dark: Set<string>;
} = { shots: [], problems: [], probes: {}, colors: {}, dark: new Set() };
/** Whether the axis judges ΔE00 over rendered colors, the edges dropped: the color schemes. */
const SCHEME = SPEC.perceptual === 'de';
/** The look the material's probe reads: the axis's default pack's. */
const PROBE_LOOK = packLook(AXIS, DEFAULT_LOOK[AXIS]).name;

test(`${DISTINCT.composition} under every ${AXIS} pack, at desktop and mobile`, async ({
  browser,
}, testInfo) => {
  testInfo.setTimeout(30 * 60_000);
  const looks = PACKS.map(({ id }) => packLook(AXIS, id)).filter((look) => {
    const ok = rendersAsAsked(registry, DISTINCT.composition, look);
    if (!ok) state.problems.push(`${DISTINCT.composition} doesn't render ${look.name} as asked`);
    return ok;
  });
  const darks = SCHEME
    ? PACKS.filter(({ id }) => !onlyMode(id))
        .map(({ id }) => darkLook(id))
        .filter((look) => rendersAsAsked(registry, DISTINCT.composition, look))
    : [];
  for (const look of darks) state.dark.add(look.colorScheme);
  state.shots = await captureShots({
    browser,
    variant: DISTINCT.composition,
    looks: [...looks, ...darks],
    testInfo,
    onPage: async (page, capture) => {
      if (capture.look === PROBE_LOOK)
        state.probes[capture.viewport] = await readSurfaceProbe(page);
      if (SCHEME && capture.viewport === 'desktop') {
        const read = await readRoleColors(page);
        state.colors[capture.look] = read.colors;
        state.problems.push(...read.problems.map((problem) => `${capture.look}: ${problem}`));
      }
    },
  });
});

test(`no two ${AXIS} packs render alike`, async ({ browser }, testInfo) => {
  testInfo.setTimeout(10 * 60_000);
  const lookOf = (id: string) => packLook(AXIS, id).name;
  const material = detectMaterial(state.probes, materialMode());
  const darkOf = (id: string) => (state.dark.has(id) ? darkLook(id).name : lookOf(id));
  const registered = axisPacks(registry, AXIS, material.scored).filter(({ id }) =>
    PACKS.some((pack) => pack.id === id),
  );
  const recolored = SCHEME
    ? withRenderedColors(
        registered,
        Object.fromEntries(
          registered.map(({ id }) => [
            id,
            { light: state.colors[lookOf(id)], dark: state.colors[darkOf(id)] },
          ]),
        ),
      )
    : null;
  if (recolored) state.problems.push(...recolored.problems);
  const packs = recolored?.packs ?? registered;
  state.packs = packs;
  const scores = scorePairs(packs, state.shots, lookOf, DISTINCT.composition);
  const verdict = judgePacks({
    ids: PACKS.map(({ id }) => id),
    scores,
    thresholds: DISTINCT.thresholds,
  });
  const dir = path.join(path.dirname(testInfo.project.outputDir), 'pack-distinct', AXIS);
  mkdirSync(dir, { recursive: true });
  if (SKIPPED.length > 0 || EXCLUDED.length > 0) {
    writeFileSync(
      path.join(dir, 'skipped.json'),
      `${JSON.stringify({ unscorable: SKIPPED, excluded: EXCLUDED }, null, 2)}\n`,
    );
    testInfo.annotations.push({
      type: 'pack-distinct skipped',
      description: [
        ...SKIPPED.map(({ id, reason }) => `${id}: unscorable, ${reason}`),
        ...EXCLUDED.map(({ id, reason }) => `${id}: not in this build, ${reason}`),
      ].join('; '),
    });
  }
  writeFileSync(
    path.join(dir, 'material.json'),
    `${JSON.stringify({ composition: DISTINCT.composition, ...material, calibrated: DISTINCT.material ?? null }, null, 2)}\n`,
  );
  console.log(`[pack-distinct] material on ${DISTINCT.composition}: ${material.reason}`);
  // The scored composition, pinned or not, and what the coverage procedure would pick (LANG-2).
  const pick = DISTINCT.procedurePick;
  const compositionLine = `scored composition: ${DISTINCT.composition}${DISTINCT.pinned ? ', pinned' : ''}${
    pick
      ? pick.composition === DISTINCT.composition
        ? `, coverage ${pick.coverage}, which the coverage procedure also picks`
        : `, coverage ${pick.scoredCoverage ?? 'not ranked'}; the coverage procedure would pick ${pick.composition}, coverage ${pick.coverage}`
      : ''
  }`;
  writeFileSync(path.join(dir, 'composition.txt'), `${compositionLine}\n`);
  console.log(`[pack-distinct] ${compositionLine}`);
  testInfo.annotations.push({ type: 'pack-distinct composition', description: compositionLine });
  testInfo.annotations.push({ type: 'pack-distinct material', description: material.reason });
  if (DISTINCT.material && DISTINCT.material.scored !== material.scored) {
    testInfo.annotations.push({
      type: 'pack-distinct material changed',
      description: `the calibration scored the material ${DISTINCT.material.scored ? 'in' : 'out'}, this render ${material.scored ? 'in' : 'out'}: recalibrate`,
    });
  }
  const context = await browser.newContext({ viewport: { width: 1600, height: 900 } });
  let ranked;
  try {
    ({ ranked } = await writeReport({
      dir,
      title: `${AXIS} on ${DISTINCT.composition}`,
      packs,
      shots: state.shots,
      lookOf,
      outcomes: verdict.outcomes,
      thresholds: DISTINCT.thresholds,
      page: await context.newPage(),
      ...(SCHEME ? { darkLookOf: darkOf } : {}),
      unscorable: SKIPPED,
      excluded: EXCLUDED,
    }));
  } finally {
    await context.close();
  }
  if (!DISTINCT.calibrated) {
    testInfo.annotations.push({
      type: 'pack-distinct uncalibrated',
      description: `${SPEC.file}'s thresholds aren't a calibration's`,
    });
  }
  // The rulings (the LANG-5 enforcement commit): a failing pair a ruling names passes, a clone never
  // does, and a ruling whose pair fails nowhere is unneeded. A scoped ruling (LANG-5c) holds only on
  // the rows its viewport and mode name, is unneeded when none of those fails, and is refused when
  // its scope matches no row the guard scored.
  const rulings = applyRulings(
    ranked,
    DISTINCT.rulings ?? [],
    PACKS.map(({ id }) => id),
  );
  const failures = rulings.failures.map((outcome) =>
    describePackOutcome(outcome, DISTINCT.thresholds),
  );
  const ruled = rulings.ruled.map(
    ({ outcome, ruling }) =>
      `${describePackOutcome(outcome, DISTINCT.thresholds)}; ruled: ${ruling}`,
  );
  const unneeded = rulings.unneeded.map(describeUnneeded);
  const refused = rulings.refused.map(describeRefused);
  // D-1: a design-language pair that renders alike here, ruled or not, draws two dividers, since the
  // divider is most of what the report-only composition shows of a language.
  const dividers =
    AXIS === 'designLanguage'
      ? sharedDividers(
          verdict.outcomes,
          (id) => registry.packs.designLanguage.get(id)?.manifest.tokens['border-divider'],
        )
      : [];
  writeFileSync(path.join(dir, 'dividers.json'), `${JSON.stringify(dividers, null, 2)}\n`);
  testInfo.annotations.push({
    type: 'pack-distinct',
    description: `${failures.length} of ${verdict.outcomes.length} pair-viewports fail unruled, ${ruled.length} fail under a ruling, ${rulings.scopedApplied} scoped ruling(s) applied, ${unneeded.length} ruling(s) unneeded, ${refused.length} refused, ${dividers.length} alike pair(s) sharing a divider${DISTINCT.enforced ? '' : ', reported, not enforced'}; ${dir}`,
  });
  console.log(`[pack-distinct] ${rulings.scopedApplied} scoped ruling(s) applied`);
  if (failures.length > 0) {
    console.log(
      `[pack-distinct] ${failures.length} pair-viewport(s) render alike, unruled:\n  ${failures.join('\n  ')}`,
    );
  }
  if (ruled.length > 0) {
    console.log(
      `[pack-distinct] ${ruled.length} pair-viewport(s) render alike under a ruling:\n  ${ruled.join('\n  ')}`,
    );
  }
  if (unneeded.length > 0)
    console.log(`[pack-distinct] unneeded rulings:\n  ${unneeded.join('\n  ')}`);
  if (refused.length > 0)
    console.log(`[pack-distinct] refused rulings:\n  ${refused.join('\n  ')}`);
  if (AXIS === 'designLanguage') {
    console.log(
      `[pack-distinct] ${dividers.length} alike pair(s) sharing a divider${dividers.length > 0 ? `:\n  ${dividers.map(describeSharedDivider).join('\n  ')}` : ''}`,
    );
  }
  const retired = [...(registry.aliases?.[AXIS].keys() ?? [])];
  expect(
    PACKS.filter(({ id }) => retired.includes(id)).map(({ id }) => id),
    'no retired id is rendered or scored',
  ).toEqual([]);
  expect(state.problems, `every ${AXIS} pack renders as asked`).toEqual([]);
  expect(verdict.problems, 'every pair is scored').toEqual([]);
  expect(
    rulings.problems,
    `every ruling in ${SPEC.file} reads: two scored packs, known keys, a readable scope, none redundant`,
  ).toEqual([]);
  // Enforced or not: a scoped ruling that can match no scored row can never rule anything.
  expect(refused, `every scoped ruling in ${SPEC.file} matches a scored row`).toEqual([]);
  expect(
    enforcementFailures(DISTINCT, rulings, DISTINCT.thresholds, dividers),
    `${AXIS} packs that render alike with no ruling, rulings in ${SPEC.file} that rule nothing that fails, and alike languages that share a divider`,
  ).toEqual([]);
});

for (const variant of reportOnlyCompositions(AXIS, DISTINCT.composition)) {
  test(`${variant} under every ${AXIS} pack, report only`, async ({ browser }, testInfo) => {
    testInfo.setTimeout(30 * 60_000);
    const dir = path.join(
      path.dirname(testInfo.project.outputDir),
      'pack-distinct',
      AXIS,
      'report-only',
      variant,
    );
    const lookOf = (id: string) => packLook(AXIS, id).name;
    try {
      const packs = (state.packs ?? axisPacks(registry, AXIS)).filter(({ id }) =>
        rendersAsAsked(registry, variant, packLook(AXIS, id)),
      );
      const shots = await captureShots({
        browser,
        variant,
        looks: packs.map(({ id }) => packLook(AXIS, id)),
        testInfo,
      });
      const context = await browser.newContext({ viewport: { width: 1600, height: 900 } });
      try {
        const { scores } = await writeReportOnly({
          dir,
          composition: variant,
          scored: DISTINCT.composition,
          packs,
          shots,
          lookOf,
          page: await context.newPage(),
        });
        const description = `${packs.length} of ${PACKS.length} packs on ${variant}, ${scores.length} pair-viewports scored for the report only, never voting; ${dir}`;
        testInfo.annotations.push({ type: 'pack-distinct report-only', description });
        console.log(`[pack-distinct] report only: ${description}`);
      } finally {
        await context.close();
      }
    } catch (error) {
      testInfo.annotations.push({
        type: 'pack-distinct report-only',
        description: `${variant} didn't render for the report: ${String(error)}`,
      });
      console.log(`[pack-distinct] report-only ${variant} didn't render: ${String(error)}`);
    }
  });
}
