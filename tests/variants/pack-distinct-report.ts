// The pack-distinctness guard's shared steps (LANG-3): capturing one
// composition under a list of looks a few packs at a time, scoring every pair
// of packs, and writing the report: the pair matrices at each viewport, the
// ranked list, and the specimen sheets. pack-distinct.spec.ts and
// pack-distinct-calibration.spec.ts both use them.

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { Browser, Page, TestInfo } from '@playwright/test';
import { edgeGrid, GRID_SIZES, VIEWPORT_IDS, type Grid, type ViewportId } from './distinct';
import { captureComposition, type Look } from './distinct-capture';
import {
  csv,
  describeModes,
  describePainted,
  PAINTED_REPORT_UNDER,
  describePackOutcome,
  unscoredLines,
  unscoredRows,
  type UnscoredPack,
  linesOf,
  NEAR_DE00,
  perceptualOf,
  describeReportOnlyScore,
  matrixRows,
  rankPairs,
  scoreShots,
  type AxisPack,
  type PackPairOutcome,
  type PackPairScore,
  sheetHtml,
  thumbnail,
  type PackThresholds,
  type Tile,
} from './pack-distinct';
import { writeSheet } from './pack-distinct-capture';

/** One look at one viewport, as the guard keeps it: its edge grid and where its screenshot is. */
export interface Shot {
  /** The composition it renders. */
  readonly variant: string;
  readonly look: string;
  readonly viewport: ViewportId;
  readonly grid: Grid;
  readonly file: string;
}

/** How many looks one server renders before the next starts, so a run holds a few screenshots, not hundreds. */
export const LOOKS_PER_SERVER = 24;

/**
 * Captures `variant` in each of `looks`, LOOKS_PER_SERVER at a time, and
 * keeps each capture's edge grid and its screenshot's path (captureComposition
 * writes it beside the test's output). `onShot` sees each capture first.
 */
export async function captureShots({
  browser,
  web,
  variant,
  looks,
  testInfo,
  onPage,
}: {
  readonly browser: Browser;
  readonly web?: string;
  readonly variant: string;
  readonly looks: readonly Look[];
  readonly testInfo: TestInfo;
  readonly onPage?: Parameters<typeof captureComposition>[0]['onPage'];
}): Promise<Shot[]> {
  const shots: Shot[] = [];
  for (let start = 0; start < looks.length; start += LOOKS_PER_SERVER) {
    const captures = await captureComposition({
      browser,
      ...(web ? { web } : {}),
      variant,
      looks: looks.slice(start, start + LOOKS_PER_SERVER),
      testInfo,
      ...(onPage ? { onPage } : {}),
    });
    for (const capture of captures) {
      const { cols, rows } = GRID_SIZES[capture.viewport];
      shots.push({
        variant,
        look: capture.look,
        viewport: capture.viewport,
        grid: edgeGrid(capture.png, cols, rows),
        file: testInfo.outputPath(`${variant}-${capture.look}-${capture.viewport}.png`),
      });
    }
  }
  return shots;
}

/** The shot of `look` at `viewport`. */
export function shotOf(shots: readonly Shot[], look: string, viewport: ViewportId): Shot {
  const shot = shots.find((each) => each.look === look && each.viewport === viewport);
  if (!shot) throw new Error(`No capture of ${look} at ${viewport}`);
  return shot;
}

/**
 * Every pair of `packs`' scores at each viewport on `composition`, each
 * pack's shot named by `lookOf`, with the pair's informational lines:
 * scoreShots(), which reads that composition's shots alone.
 */
export const scorePairs = (
  packs: readonly AxisPack[],
  shots: readonly Shot[],
  lookOf: (id: string) => string,
  composition: string,
): PackPairScore[] => scoreShots(packs, shots, lookOf, composition);

/** A pair's score, either way round. */
export const scoreOf = (
  scores: readonly PackPairScore[],
  a: string,
  b: string,
  viewport: ViewportId,
): PackPairScore | undefined =>
  scores.find(
    (each) =>
      each.viewport === viewport &&
      ((each.a === a && each.b === b) || (each.a === b && each.b === a)),
  );

/** The tile widths: a quarter of each viewport. */
const TILE_WIDTH: Readonly<Record<ViewportId, number>> = { desktop: 360, mobile: 130 };
/** How many of the worst pairs the pair sheet shows at each viewport. */
export const WORST_SHOWN = 24;

/**
 * Writes each pack's tile at each viewport, a quarter of its size, and a
 * specimen sheet of every pack at each viewport, into `dir`, and returns
 * where each pack's tile is, relative to `dir`. `note`, when given, heads
 * each sheet, as a report-only composition's says it never votes.
 */
/** A pack's tile, relative to the report's directory: its default look, or its dark one. */
export type TileOf = (id: string, viewport: ViewportId, dark?: boolean) => string;

export async function writeSpecimens({
  dir,
  title,
  packs,
  shots,
  lookOf,
  darkLookOf,
  page,
  note,
}: {
  readonly dir: string;
  readonly title: string;
  readonly packs: readonly AxisPack[];
  readonly shots: readonly Shot[];
  readonly lookOf: (id: string) => string;
  /** Each pack's dark look, for an axis that renders one (the color schemes): tiles and sheets of their own. */
  readonly darkLookOf?: (id: string) => string;
  readonly page: Page;
  readonly note?: string;
}): Promise<TileOf> {
  mkdirSync(path.join(dir, 'tiles'), { recursive: true });
  const ids = packs.map(({ id }) => id);
  const tile: TileOf = (id, viewport, dark = false) =>
    path.join('tiles', `${id}-${viewport}${dark ? '-dark' : ''}.png`);
  const modes = darkLookOf ? [false, true] : [false];
  for (const id of ids) {
    for (const viewport of VIEWPORT_IDS) {
      for (const dark of modes) {
        const shot = shotOf(shots, dark ? darkLookOf!(id) : lookOf(id), viewport);
        writeFileSync(
          path.join(dir, tile(id, viewport, dark)),
          thumbnail(readFileSync(shot.file), TILE_WIDTH[viewport]),
        );
      }
    }
  }
  const family = new Map(packs.map(({ id, family: name }) => [id, name]));
  for (const viewport of VIEWPORT_IDS) {
    for (const dark of modes) {
      const perRow = viewport === 'desktop' ? 4 : 8;
      const tiles: Tile[] = ids.map((id) => ({
        file: tile(id, viewport, dark),
        caption: [id, family.get(id) ?? ''],
      }));
      const rows: Tile[][] = [];
      for (let start = 0; start < tiles.length; start += perRow)
        rows.push(tiles.slice(start, start + perRow));
      const suffix = dark ? '-dark' : '';
      await writeSheet(
        page,
        sheetHtml(
          `${title}: every pack at ${viewport}${dark ? ', dark' : ''}`,
          rows,
          TILE_WIDTH[viewport],
          note,
        ),
        path.join(dir, `specimens-${viewport}${suffix}.html`),
        path.join(dir, `specimens-${viewport}${suffix}.png`),
      );
    }
  }
  return tile;
}

/**
 * Writes a report-only composition's evidence into `dir` (LANG-2): its
 * scores (scoreShots() on its own shots, with the informational lines) as
 * the pixel and informational matrices, scores.json, and a list from the
 * nearest pixels up, and its tiles and specimen sheets. None of it votes:
 * it names no verdict, and the guard's verdict never reads these shots.
 */
export async function writeReportOnly({
  dir,
  composition,
  scored,
  packs,
  shots,
  lookOf,
  page,
}: {
  readonly dir: string;
  readonly composition: string;
  readonly scored: string;
  readonly packs: readonly AxisPack[];
  readonly shots: readonly Shot[];
  readonly lookOf: (id: string) => string;
  readonly page: Page;
}): Promise<{ scores: PackPairScore[] }> {
  mkdirSync(dir, { recursive: true });
  const scores = scoreShots(packs, shots, lookOf, composition);
  const ids = packs.map(({ id }) => id);
  for (const viewport of VIEWPORT_IDS) {
    writeFileSync(
      path.join(dir, `matrix-px-${viewport}.csv`),
      csv(matrixRows(ids, (a, b) => scoreOf(scores, a, b, viewport)?.px.toFixed(3) ?? '')),
    );
  }
  const informational = [...new Set(scores.flatMap((each) => Object.keys(each.info ?? {})))];
  for (const group of informational) {
    writeFileSync(
      path.join(dir, `matrix-info-${group}.csv`),
      csv(
        matrixRows(
          ids,
          (a, b) => scoreOf(scores, a, b, 'desktop')?.info?.[group]?.toFixed(3) ?? '',
        ),
      ),
    );
  }
  const note = `Report only: ${composition} never votes and never gates. The verdict reads ${scored} alone.`;
  writeFileSync(
    path.join(dir, 'scores.json'),
    `${JSON.stringify({ composition, scored, reportOnly: true, note, scores }, null, 2)}\n`,
  );
  const nearest = [...scores].sort((x, y) => x.px - y.px || (x.a + x.b < y.a + y.b ? -1 : 1));
  writeFileSync(
    path.join(dir, 'ranked.txt'),
    `${note}\n${nearest.map((each, index) => `${index + 1}. ${describeReportOnlyScore(each, composition)}`).join('\n')}\n`,
  );
  await writeSpecimens({
    dir,
    title: `${composition}, report only`,
    packs,
    shots,
    lookOf,
    page,
    note,
  });
  return { scores };
}

/**
 * Writes the report into `dir`: the matrices (pixels at each viewport,
 * tokens, the verdict at each viewport, and each informational group) as
 * CSV, the ranked list as
 * JSON and text, each pack's tile, a specimen sheet of every pack at each
 * viewport, and a sheet of the worst pairs at each viewport. `page` is a
 * page of its own the sheets render in.
 */
export async function writeReport({
  dir,
  title,
  packs,
  shots,
  lookOf,
  outcomes,
  thresholds,
  page,
  darkLookOf,
  unscorable = [],
  excluded = [],
}: {
  readonly dir: string;
  readonly title: string;
  readonly packs: readonly AxisPack[];
  readonly shots: readonly Shot[];
  readonly lookOf: (id: string) => string;
  readonly outcomes: readonly PackPairOutcome[];
  readonly thresholds: PackThresholds;
  readonly page: Page;
  /** Each pack's dark look, for the color schemes: its tiles sit beside the light ones. */
  readonly darkLookOf?: (id: string) => string;
  /** Packs the axis can't score (a generator scheme): listed in every matrix and ranked list, never scored. */
  readonly unscorable?: readonly UnscoredPack[];
  /** Packs the build leaves out: listed the same way. */
  readonly excluded?: readonly UnscoredPack[];
}): Promise<{ ranked: PackPairOutcome[] }> {
  const perceptual = perceptualOf(thresholds);
  mkdirSync(path.join(dir, 'tiles'), { recursive: true });
  const ids = packs.map(({ id }) => id);
  const matrix = (cell: (a: string, b: string) => string) =>
    csv([...matrixRows(ids, cell), ...unscoredRows(unscorable, excluded)]);
  const outcome = (a: string, b: string, viewport: ViewportId) =>
    outcomes.find(
      (each) =>
        each.viewport === viewport &&
        ((each.a === a && each.b === b) || (each.a === b && each.b === a)),
    );
  for (const viewport of VIEWPORT_IDS) {
    writeFileSync(
      path.join(dir, `matrix-px-${viewport}.csv`),
      matrix((a, b) => outcome(a, b, viewport)?.px.toFixed(3) ?? ''),
    );
    writeFileSync(
      path.join(dir, `matrix-verdict-${viewport}.csv`),
      matrix((a, b) => {
        const found = outcome(a, b, viewport);
        return found === undefined ? '' : found.fail ? found.reasons.join('+') : '.';
      }),
    );
  }
  writeFileSync(
    path.join(dir, 'matrix-token.csv'),
    matrix((a, b) => outcome(a, b, 'desktop')?.token.toFixed(3) ?? ''),
  );
  if (perceptual === 'de') {
    // ΔE00 reads the rendered colors, the same at both viewports: the score, the mean, and the near roles.
    writeFileSync(
      path.join(dir, 'matrix-de.csv'),
      matrix((a, b) => outcome(a, b, 'desktop')?.de?.toFixed(3) ?? ''),
    );
    writeFileSync(
      path.join(dir, 'matrix-de-mean.csv'),
      matrix((a, b) => outcome(a, b, 'desktop')?.deMean?.toFixed(2) ?? ''),
    );
    // Each mode's own mean, since the worse one decides.
    for (const mode of ['light', 'dark'] as const) {
      writeFileSync(
        path.join(dir, `matrix-de-mean-${mode}.csv`),
        matrix((a, b) => outcome(a, b, 'desktop')?.deModes?.[mode]?.toFixed(2) ?? ''),
      );
    }
    writeFileSync(
      path.join(dir, 'matrix-de-near.csv'),
      matrix((a, b) => {
        const near = outcome(a, b, 'desktop')?.near;
        return near === undefined ? '' : String(near.length);
      }),
    );
    // The painted score (report only, never voting): every pair under PAINTED_REPORT_UNDER, least first.
    const painted = outcomes
      .filter(
        (each) =>
          each.viewport === 'desktop' &&
          each.painted !== undefined &&
          each.painted.least < PAINTED_REPORT_UNDER,
      )
      .sort((x, y) => x.painted!.least - y.painted!.least || x.a.localeCompare(y.a));
    writeFileSync(
      path.join(dir, 'painted-under-5.txt'),
      `${[
        `Pairs whose painted score is under ${PAINTED_REPORT_UNDER} in a mode (report only, never voting), beside their per-mode token score:`,
        ...painted.map(
          (each) =>
            `${each.a} and ${each.b}: tokens ${describeModes(each.deModes)}; ${describePainted(each.painted!)}`,
        ),
      ].join('\n')}\n`,
    );
  }
  // The informational lines, a matrix for each group: reported, never scored.
  const informational = [...new Set(outcomes.flatMap((each) => Object.keys(each.info ?? {})))];
  for (const group of informational) {
    writeFileSync(
      path.join(dir, `matrix-info-${group}.csv`),
      matrix((a, b) => outcome(a, b, 'desktop')?.info?.[group]?.toFixed(3) ?? ''),
    );
  }
  const ranked = rankPairs(outcomes);
  writeFileSync(path.join(dir, 'ranked.json'), `${JSON.stringify(ranked, null, 2)}\n`);
  writeFileSync(
    path.join(dir, 'ranked.txt'),
    `${[
      ...ranked.map((each, index) => `${index + 1}. ${describePackOutcome(each, thresholds)}`),
      ...unscoredLines(unscorable, excluded),
    ].join('\n')}\n`,
  );

  const tile = await writeSpecimens({
    dir,
    title,
    packs,
    shots,
    lookOf,
    page,
    ...(darkLookOf ? { darkLookOf } : {}),
  });
  const family = new Map(packs.map(({ id, family: name }) => [id, name]));
  const pLines = linesOf(thresholds, perceptual)!;
  const pName = perceptual === 'de' ? 'ΔE00' : 'Pixels';
  const lines = (viewport: ViewportId) =>
    `${pName} alike under ${pLines.alike?.[viewport] ?? 'no vote'}, clone under ${pLines.clone[viewport]}; tokens alike under ${thresholds.token.alike?.[viewport] ?? 'no vote'}, clone under ${thresholds.token.clone[viewport]}.`;
  const scoreLine = (each: PackPairOutcome) => {
    if (perceptual !== 'de') return `pixels ${each.px.toFixed(3)}, tokens ${each.token.toFixed(3)}`;
    const near = each.near ?? [];
    return `ΔE00 ${each.de?.toFixed(3)} (mean ${each.deMean?.toFixed(2)}${each.deModes ? `; ${describeModes(each.deModes)}` : ''}), tokens ${each.token.toFixed(3)}${near.length > 0 ? `; near: ${near.join(', ')}` : ''}`;
  };
  const pairRow = (each: PackPairOutcome, index: number, viewport: ViewportId): Tile[] => [
    {
      file: tile(each.a, viewport),
      caption: [`${index + 1}. ${each.a}`, family.get(each.a) ?? ''],
    },
    {
      file: tile(each.b, viewport),
      caption: [
        each.b,
        family.get(each.b) ?? '',
        `${each.fail ? `FAIL ${each.reasons.join(', ')}` : 'pass'}: ${scoreLine(each)}`,
      ],
    },
    ...(darkLookOf
      ? [
          { file: tile(each.a, viewport, true), caption: [`${each.a}, dark`] },
          { file: tile(each.b, viewport, true), caption: [`${each.b}, dark`] },
        ]
      : []),
  ];
  const rule =
    perceptual === 'de'
      ? 'the deciding score over its alike line: the ΔE00 score whenever it votes, and tokens never rescue an alike ΔE00'
      : 'the deciding score over its alike line: the pixels whenever they vote, and tokens never rescue alike pixels';
  for (const viewport of VIEWPORT_IDS) {
    const atViewport = ranked.filter((each) => each.viewport === viewport);
    const worst = atViewport.slice(0, WORST_SHOWN);
    await writeSheet(
      page,
      sheetHtml(
        `${title}: the ${worst.length} worst pairs at ${viewport}`,
        worst.map((each, index) => pairRow(each, index, viewport)),
        TILE_WIDTH[viewport],
        `Ranked by the fail rule: failures first, clones before alike pairs, then by alikeness (${rule}). ${lines(viewport)}`,
      ),
      path.join(dir, `worst-${viewport}.html`),
      path.join(dir, `worst-${viewport}.png`),
    );
    // Every pair that fails, each tile named, side by side (LANG-4's report).
    const alike = atViewport.filter((each) => each.fail);
    const modes =
      perceptual === 'de'
        ? ` A role under ΔE00 ${NEAR_DE00} is near, flagged and never voting. Each pair shows its light render, then its dark one.`
        : '';
    await writeSheet(
      page,
      sheetHtml(
        `${title}: all ${alike.length} pairs that render alike at ${viewport}`,
        alike.map((each, index) => pairRow(each, index, viewport)),
        TILE_WIDTH[viewport],
        `Every failing pair, worst first (${rule}). ${lines(viewport)}${modes}`,
      ),
      path.join(dir, `alike-${viewport}.html`),
      path.join(dir, `alike-${viewport}.png`),
    );
  }
  return { ranked };
}
