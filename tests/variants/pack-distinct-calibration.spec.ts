import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { expect, test } from '@playwright/test';
import { pixelDistance, VIEWPORT_IDS } from './distinct';
import { DEFAULT_LOOK } from './distinct-capture';
import {
  AXES,
  calibrateAxis,
  chooseComposition,
  colorDrift,
  detectMaterial,
  familyPairControls,
  guardAxis,
  judgePacks,
  materialMode,
  schemeDelta,
  schemeVector,
  vectorDistance,
  withRenderedColors,
  type MaterialDetection,
  type PackControl,
  type PackPairScore,
  type ScoreCalibration,
  type SurfaceProbe,
} from './pack-distinct';
import {
  axisPacks,
  buildRegistry,
  controlLooks,
  darkLook,
  excludedPacks,
  onlyMode,
  packLook,
  readRoleColors,
  readSurfaceProbe,
  readTokenUse,
  rendersAsAsked,
  unscorable,
  type TokenUse,
} from './pack-distinct-capture';
import {
  captureShots,
  scoreOf,
  scorePairs,
  shotOf,
  writeReport,
  type Shot,
} from './pack-distinct-report';
import { UNDER_TEST } from './target';

// The pack-distinctness guard's calibration (LANG-3), which
// `PORTFOLIO_PACK_DISTINCT_CALIBRATE=1 pnpm test:variants --project
// pack-distinct-calibration` runs once per axis, and again whenever the
// controls or the catalog's families change. PORTFOLIO_PACK_DISTINCT_AXIS
// names the axis: designLanguage (the default), colorScheme, or typography.
//
// 1. The composition. Every registered composition renders in the guards'
//    tuple, and the one whose first viewport the axis's tokens paint most
//    wins: tokenUse()'s coverage, each visible element's share of the
//    viewport times the distinct tokens its rules reach (less the motion
//    tokens a still can't show), at the viewport where it's lower; ties to
//    the most distinct tokens there, then the most uses. A page of cards
//    showing their corners, borders, and shadows beats a column of
//    dividers. Each candidate also renders under the axis's fallback and the
//    pack farthest from it by tokens, and their pixel distance (its spread)
//    is reported beside it, as a check that the tokens counted really show.
//    PORTFOLIO_PACK_DISTINCT_COMPOSITION names one instead. Each candidate's
//    Surface probe and whether its material would score (detectMaterial())
//    are recorded beside it, with the reason.
// 2. The renders. That composition under every selectable pack on the axis,
//    and each pack again in its "same" controls' looks (a re-render, and the
//    axis's other-axis changes, pack-distinct.ts's AXES).
// 3. The controls, and the thresholds from them:
//    - "same": each pack against itself re-rendered and in each other-axis
//      change. Its token score is 0, since the pack's tokens don't change.
//      A change that moves geometry (another typography, another language)
//      is informational for the pixel score (AXES).
//    - "different": for each pair of families, the median cross pair of each
//      score (familyPairControls()).
//    Each score's alike line sits halfway into its gap, voting only with a
//    gap of 0.1 at both viewports, and its clone floor is twice its "same"
//    controls' largest distance (calibrateAxis()). The token score is the
//    one the verdict reads: for a design language, only the groups a static
//    render shows (pack-distinct.ts's LANGUAGE_GROUPS), and the material
//    only when the chosen composition's render shows the Surface primitive
//    (detectMaterial(), on the axis's default pack's render).
//    For a color scheme (LANG-4) the perceptual score is ΔE00 over its role
//    colors in each base mode, the worse mode's mean deciding
//    (pack-distinct.ts's schemeDelta(), per mode since the LANG-5b fix
//    round), and the edges are dropped. Each scheme renders in the dark display mode too,
//    and the colors both modes compute on the page are what score, so a
//    generator scheme scores what it solves, and a "same" control compares
//    the colors the scheme computes under another language or typography
//    with its own, light against light.
//
// It writes reports/variants/pack-distinct/<axis>/: calibration.json, every
// control with its roles, the report (pack-distinct-report.ts) for today's
// catalog, and <axis file>.calibrated.json, the shape the axis's JSON
// commits.

const AXIS = guardAxis();
const SPEC = AXES[AXIS];
const registry = buildRegistry();
/** The packs the axis can't score, and why (a generator scheme), reported beside the verdict. */
const SKIPPED = unscorable(registry, AXIS);
/** The packs this build leaves out, such as profile-image, named in the report and never scored. */
const EXCLUDED = excludedPacks(registry, AXIS);
const PACKS = axisPacks(registry, AXIS).filter(({ id }) => !SKIPPED.some((skip) => skip.id === id));
const CANDIDATES = UNDER_TEST.map(({ manifest }) => manifest.id);
/**
 * The composition the axis's JSON pins, when it pins one (LANG-2, the lead's
 * ruling): the calibration scores it whatever the coverage procedure would
 * pick, and records that pick beside it.
 */
const AXIS_JSON = new URL(`./${SPEC.file}`, import.meta.url);
const PINNED: string | null = (() => {
  if (!existsSync(AXIS_JSON)) return null;
  const axisJson = JSON.parse(readFileSync(AXIS_JSON, 'utf8')) as {
    pinned?: boolean;
    composition?: string;
  };
  return axisJson.pinned === true && axisJson.composition ? axisJson.composition : null;
})();

test.describe.configure({ mode: 'serial' });

const state: {
  composition?: string;
  choice?: ReturnType<typeof chooseComposition>;
  shots: Shot[];
  problems: string[];
  probes: Partial<Record<'desktop' | 'mobile', SurfaceProbe>>;
  /** A color scheme's rendered role colors, by look name, read at desktop. */
  colors: Record<string, Record<string, string>>;
  /** The schemes whose dark look rendered as asked. */
  dark: Set<string>;
} = {
  shots: [],
  problems: [],
  probes: {},
  colors: {},
  dark: new Set(),
};
/** Whether the axis judges ΔE00 over rendered colors, the edges dropped: the color schemes. */
const SCHEME = SPEC.perceptual === 'de';
/** The look the material's probe reads on the chosen composition: the axis's default pack's. */
const PROBE_LOOK = packLook(AXIS, DEFAULT_LOOK[AXIS]).name;
const outDir = (testInfo: import('@playwright/test').TestInfo) =>
  path.join(path.dirname(testInfo.project.outputDir), 'pack-distinct', AXIS);

test('the composition whose first viewport shows the most of the axis', async ({
  browser,
}, testInfo) => {
  testInfo.setTimeout(30 * 60_000);
  const uses: (TokenUse & { variant: string; viewport: string })[] = [];
  const probes = new Map<string, Partial<Record<'desktop' | 'mobile', SurfaceProbe>>>();
  const spreads: { variant: string; viewport: string; px: number }[] = [];
  const fallback = PACKS.find(({ id }) => id === DEFAULT_LOOK[AXIS])!;
  const farthest = [...PACKS].sort(
    (a, b) => vectorDistance(fallback.vector, b.vector) - vectorDistance(fallback.vector, a.vector),
  )[0]!;
  const far = packLook(AXIS, farthest.id);
  for (const variant of CANDIDATES) {
    if (!rendersAsAsked(registry, variant, DEFAULT_LOOK)) continue;
    const looks = rendersAsAsked(registry, variant, far) ? [DEFAULT_LOOK, far] : [DEFAULT_LOOK];
    const shots = await captureShots({
      browser,
      variant,
      looks,
      testInfo,
      onPage: async (page, capture) => {
        if (capture.look !== DEFAULT_LOOK.name) return;
        uses.push({ variant, viewport: capture.viewport, ...(await readTokenUse(page, AXIS)) });
        const own = probes.get(variant) ?? {};
        own[capture.viewport] = await readSurfaceProbe(page);
        probes.set(variant, own);
      },
    });
    for (const viewport of VIEWPORT_IDS) {
      const other = shots.find((each) => each.look === far.name && each.viewport === viewport);
      if (!other) continue;
      const own = shotOf(shots, DEFAULT_LOOK.name, viewport);
      spreads.push({
        variant,
        viewport,
        px: Math.round(pixelDistance(own.grid, other.grid) * 1000) / 1000,
      });
    }
  }
  const ranked = CANDIDATES.flatMap((variant) => {
    const own = uses.filter((each) => each.variant === variant);
    if (own.length === 0) return [];
    return [
      {
        variant,
        coverage: Math.min(...own.map((each) => each.coverage)),
        tokens: Math.min(...own.map((each) => each.tokens.length)),
        uses: own.reduce((sum, each) => sum + each.uses, 0),
        material: detectMaterial(probes.get(variant) ?? {}, materialMode()),
        spread: Object.fromEntries(
          spreads
            .filter((each) => each.variant === variant)
            .map((each) => [each.viewport, each.px]),
        ),
        byViewport: Object.fromEntries(
          own.map((each) => [
            each.viewport,
            {
              tokens: each.tokens.length,
              uses: each.uses,
              elements: each.elements,
              coverage: each.coverage,
              list: each.tokens,
            },
          ]),
        ),
      },
    ];
  }).sort((a, b) => b.coverage - a.coverage || b.tokens - a.tokens || b.uses - a.uses);
  const forced = process.env.PORTFOLIO_PACK_DISTINCT_COMPOSITION;
  state.choice = chooseComposition({ ranked, pinned: PINNED, forced: forced ?? null });
  state.composition = state.choice.composition;
  const dir = outDir(testInfo);
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    path.join(dir, 'composition.json'),
    `${JSON.stringify({ axis: AXIS, chosen: state.composition, forced: Boolean(forced), pinned: PINNED, by: state.choice.by, procedure: state.choice.procedure, line: state.choice.line, spreadPack: farthest.id, ranked }, null, 2)}\n`,
  );
  for (const each of ranked) {
    console.log(
      `[pack-distinct] ${each.variant}: coverage ${each.coverage}, ${each.tokens} tokens at its thinner viewport, ${each.uses} uses, spread to ${farthest.id} ${JSON.stringify(each.spread)} (${Object.entries(
        each.byViewport,
      )
        .map(
          ([viewport, value]) =>
            `${viewport} coverage ${value.coverage}, ${value.tokens} tokens, ${value.uses} uses, ${value.elements} elements`,
        )
        .join('; ')}); material: ${each.material.reason}`,
    );
  }
  console.log(`[pack-distinct] composition: ${state.composition}; ${state.choice.line}`);
  expect(ranked.length).toBeGreaterThan(0);
});

test('every pack on the axis, and each one in its "same" controls', async ({
  browser,
}, testInfo) => {
  testInfo.setTimeout(90 * 60_000);
  const variant = state.composition!;
  const looks = PACKS.flatMap(({ id }) => [packLook(AXIS, id), ...controlLooks(AXIS, id)]).filter(
    (look) => {
      const ok = rendersAsAsked(registry, variant, look);
      if (!ok) state.problems.push(`${variant} doesn't render ${look.name} as asked`);
      return ok;
    },
  );
  // A scheme's dark look, where it has one: one base mode renders under either preference.
  const darks = SCHEME
    ? PACKS.filter(({ id }) => !onlyMode(id))
        .map(({ id }) => darkLook(id))
        .filter((look) => rendersAsAsked(registry, variant, look))
    : [];
  for (const look of darks) state.dark.add(look.colorScheme);
  state.shots = await captureShots({
    browser,
    variant,
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

test('the controls set both scores’ thresholds, and today’s pairs are scored', async ({
  browser,
}, testInfo) => {
  testInfo.setTimeout(30 * 60_000);
  const { shots } = state;
  const lookOf = (id: string) => packLook(AXIS, id).name;
  const material: MaterialDetection = detectMaterial(state.probes, materialMode());
  console.log(`[pack-distinct] material on ${state.composition}: ${material.reason}`);
  const registered = axisPacks(registry, AXIS, material.scored).filter(({ id }) =>
    PACKS.some((pack) => pack.id === id),
  );
  const darkOf = (id: string) => (state.dark.has(id) ? darkLook(id).name : lookOf(id));
  const rendered = Object.fromEntries(
    registered.map(({ id }) => [
      id,
      { light: state.colors[lookOf(id)], dark: state.colors[darkOf(id)] },
    ]),
  );
  const recolored = SCHEME ? withRenderedColors(registered, rendered) : null;
  if (recolored) state.problems.push(...recolored.problems);
  const packs = recolored?.packs ?? registered;
  const scores: PackPairScore[] = scorePairs(packs, shots, lookOf, state.composition!);
  const controls: PackControl[] = [];
  for (const viewport of VIEWPORT_IDS) {
    for (const pack of packs) {
      const own = shotOf(shots, lookOf(pack.id), viewport);
      for (const look of controlLooks(AXIS, pack.id)) {
        const other = shots.find((each) => each.look === look.name && each.viewport === viewport);
        if (!other) continue;
        const name = look.name.slice(0, look.name.length - pack.id.length - 1);
        const px = SPEC.same.find((control) => control.name === name)?.px ?? 'same';
        // A scheme's control compares the colors it computes there with its own, light against light.
        const light = state.colors[lookOf(pack.id)];
        const there = state.colors[look.name];
        const colors =
          SCHEME && light && there ? { own: { light }, there: { light: there } } : null;
        controls.push({
          a: pack.id,
          b: `${pack.id}@${name}`,
          control: name,
          viewport,
          roles: SCHEME
            ? { px: 'informational', token: 'same', de: 'same' }
            : { px, token: 'same' },
          px: Math.round(pixelDistance(own.grid, other.grid) * 1000) / 1000,
          token:
            Math.round(
              (colors
                ? vectorDistance(schemeVector(colors.own), schemeVector(colors.there))
                : vectorDistance(pack.vector, pack.vector)) * 1000,
            ) / 1000,
          ...(colors ? { de: schemeDelta(colors.own, colors.there).score } : {}),
        });
      }
    }
    for (const score of [SPEC.perceptual, 'token'] as const) {
      for (const control of familyPairControls(
        packs,
        (a, b) => scoreOf(scores, a, b, viewport)?.[score],
      )) {
        const pair = scoreOf(scores, control.a, control.b, viewport)!;
        controls.push({
          a: control.a,
          b: control.b,
          control: `families ${control.families.join(' x ')} (${score} median of ${control.pairs})`,
          viewport,
          roles: { [score]: 'different' },
          px: pair.px,
          token: pair.token,
          ...(pair.de !== undefined ? { de: pair.de } : {}),
        });
      }
    }
  }
  const { calibration, thresholds } = calibrateAxis(controls, SPEC.perceptual);
  const ids = packs.map(({ id }) => id);
  const verdict = judgePacks({ ids, scores, thresholds });

  const dir = outDir(testInfo);
  mkdirSync(dir, { recursive: true });
  const { designLanguage, colorScheme, typography, displayMode } = DEFAULT_LOOK;
  const tuple = { designLanguage, colorScheme, typography, displayMode };
  writeFileSync(
    path.join(dir, 'calibration.json'),
    `${JSON.stringify({ axis: AXIS, composition: state.composition, tuple, material, calibration, thresholds, controls, skipped: SKIPPED, excluded: EXCLUDED, problems: state.problems }, null, 2)}\n`,
  );
  writeFileSync(
    path.join(dir, 'material.json'),
    `${JSON.stringify({ composition: state.composition, ...material }, null, 2)}\n`,
  );
  if (SCHEME) {
    // What each scheme rendered, and where that differs from its registered sets.
    writeFileSync(
      path.join(dir, 'colors.json'),
      `${JSON.stringify(
        Object.fromEntries(
          registered.map(({ id, colors }) => [
            id,
            {
              dark: state.dark.has(id)
                ? 'rendered in the dark display mode'
                : `its one base mode, ${onlyMode(id)}, as its default render shows it`,
              rendered: rendered[id],
              drift: colorDrift(colors ?? {}, rendered[id] ?? {}),
            },
          ]),
        ),
        null,
        2,
      )}\n`,
    );
  }
  const schemeNote = SCHEME
    ? " For a color scheme the perceptual score is ΔE00 (`de`, CIEDE2000) over the canvas, the primary and secondary text, the accent, and the default, subtle, and raised (prominent) surfaces, in both base modes, from the colors the render computes, combined as their mean over 50 (a mean over 50 counts as 1); a role under a ΔE00 of 2 is flagged near and never votes. The ΔE00 scale of 50 was chosen so the controls' gap can vote (over 100 the nearest family pair, at a mean ΔE00 of 7.5, never cleared calibrate()'s 0.1), and the calibrated line, alike under a mean ΔE00 of 3.8, is the decision (lead A, LANG-4). The edges are dropped: no `px` line, and a scheme pair is never judged on them. Generator schemes are unscorable without the owner's input and never counted as distinct (`skipped`)."
    : '';
  const committed = {
    note:
      "Thresholds from pack-distinct-calibration.spec.ts. Each score has an alike line (null when its calibration found no gap of 0.1 at both viewports, so it doesn't vote) and a clone floor. A pair fails when its pixels are under their alike line, whatever its tokens say (the token line decides only while the pixels have none), or when either score is under its clone floor. For a design language the token score reads only the groups a static render shows (corners, depth, borders, density), and the material (surface) only when the composition's render shows a visible Surface primitive (`material` records that detection and its reason); focus, motion, states, icons, texture, and an unrendered material are informational lines that never score. `pinned` true holds `composition` as the scored one whatever the coverage procedure picks, and `procedurePick` records that pick and its coverage. `enforced` false reports failures without failing the run." +
      schemeNote,
    calibrated: true,
    enforced: false,
    axis: AXIS,
    composition: state.composition,
    ...(PINNED ? { pinned: true } : {}),
    ...(state.choice?.procedure
      ? {
          procedurePick: {
            composition: state.choice.procedure.variant,
            coverage: state.choice.procedure.coverage,
            scoredCoverage: state.choice.scoredCoverage,
          },
        }
      : {}),
    tuple,
    material,
    thresholds,
    calibration,
    packs: packs.map(({ id, family }) => ({ id, family })),
    ...(SKIPPED.length > 0 ? { skipped: SKIPPED } : {}),
    ...(EXCLUDED.length > 0 ? { excluded: EXCLUDED } : {}),
  };
  writeFileSync(
    path.join(dir, `${path.basename(SPEC.file, '.json')}.calibrated.json`),
    `${JSON.stringify(committed, null, 2)}\n`,
  );
  const context = await browser.newContext({ viewport: { width: 1600, height: 900 } });
  try {
    const page = await context.newPage();
    await writeReport({
      dir,
      title: `${AXIS} on ${state.composition}, before`,
      packs,
      shots,
      lookOf,
      outcomes: verdict.outcomes,
      thresholds,
      page,
      ...(SCHEME ? { darkLookOf: darkOf } : {}),
      unscorable: SKIPPED,
      excluded: EXCLUDED,
    });
  } finally {
    await context.close();
  }
  const scored = calibration as unknown as Record<string, ScoreCalibration>;
  for (const score of [SPEC.perceptual, 'token'] as const) {
    for (const viewport of VIEWPORT_IDS) {
      const { same, different, gap, threshold } = scored[score]!.alike[viewport];
      const { floor, threshold: clone } = scored[score]!.clone[viewport];
      console.log(
        `[pack-distinct] ${score} ${viewport}: same ${same}, different ${different}, gap ${gap}, alike ${threshold}; noise floor ${floor}, clone ${clone}`,
      );
    }
  }
  console.log(
    `[pack-distinct] ${verdict.failures.length} of ${verdict.outcomes.length} pair-viewports fail; report in ${dir}`,
  );
  expect(state.problems, 'every look renders as asked').toEqual([]);
  expect(verdict.problems).toEqual([]);
});
