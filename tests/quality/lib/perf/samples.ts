// The performance cells' judgement (#11, 11-3), pure over what a perf test
// measured (measure.ts), so quality:meta and the unit tests feed it
// recorded samples. Two kinds of rule:
//
// - Deterministic, which fail any run, a pull request's included
//   (perfFindings):
//   - lcp-entry: every load has a largest-contentful-paint entry.
//   - lcp-element: a canvas-led load, one where a <canvas> showed in the
//     first viewport at any point, makes a poster image or headline text
//     its LCP element, found in the document's raw response body and
//     covering at least vitals.canvasLcpMinShare of the viewport, since
//     Chromium never picks a canvas.
//   - static-emulation: the static load's page matched
//     prefers-reduced-motion: reduce, so the window below means something.
//   - frame-callbacks: no requestAnimationFrame callback from
//     reducedMotion.rafWindowMs[0] to [1] after load in static mode. A loop
//     that starts after that window ends passes, as the thresholds set it.
//   - layout-count: no layout in that window either (LayoutCount growth).
// - Timing, the lab vitals, idle work, and memory, as the median of
//   timing.runs loads (timingResult). Pull request and scheduled runs report
//   it; the release run fails a median more than releaseTolerance over its
//   ceiling (timing.ts).
//
// Every limit comes from quality/thresholds.json.

import { loadThresholds, type Thresholds } from '../../../../quality/thresholds';
import type { PerformanceTier } from '../registration';
import type { PreferenceMode } from '../vocabulary';

/** What an LCP element is, as the canvas-led rule reads it. */
export type LcpKind =
  /** An <img> (in a <picture> or not), an SVG <image>, or a <video>'s poster. */
  | 'image'
  /** Text in an h1 to h3, or in an element with role="heading", or that element itself. */
  | 'headline'
  /** Any other text block. */
  | 'text'
  /** An image some other element paints: a CSS background. */
  | 'background'
  /** The element left the document before the entry was read. */
  | 'removed';

/** The largest-contentful-paint entry a load ended with, and its element. */
export interface LcpEntry {
  /** When it painted, in ms from navigation start. */
  readonly startTime: number;
  readonly kind: LcpKind;
  /** Its element's tag, lowercase, such as h1 or img. */
  readonly tag: string | null;
  /** The entry's size: the painted area, in CSS px squared. */
  readonly size: number;
  /** That size over the viewport's area. */
  readonly share: number;
  /** Its text or its image's URL is in the document's raw response body, outside any script. */
  readonly serverRendered: boolean;
  /** Its element as a selector, for the record. */
  readonly selector: string | null;
}

/** What one load at default motion measured. Null is a measurement that didn't come. */
export interface PerfRun {
  readonly status: number;
  /** Null when the load ended with no LCP entry. */
  readonly lcp: LcpEntry | null;
  /** A <canvas> showed in the first viewport at some point from navigation until the load was read. */
  readonly canvasLed: boolean;
  readonly lcpMs: number | null;
  readonly cls: number | null;
  /** Total blocking time: long tasks' time over 50 ms, from FCP to 5 s after load. */
  readonly tbtMs: number | null;
  /**
   * Each long task TBT counted, as its length from FCP (a task FCP splits counted from FCP), in
   * ms: what the gate recomputes TBT from at the reference runner's speed (row 141).
   */
  readonly blockingTasks: readonly number[] | null;
  /**
   * The calibration workload's TaskDuration on this runner, in ms, under the lab's CPU throttle,
   * just before this load (row 141): the runner's speed, against timing.calibration.referenceMs.
   */
  readonly calibrationMs: number | null;
  /** TaskDuration over the idle window, in ms, less the harness's own garbage collection. */
  readonly idleTaskMs: number | null;
  /** JSHeapUsedSize at memory.sampleMs after load, after a garbage collection, in MiB. */
  readonly heapMiB: number | null;
  /** Its growth across memory.growthWindowMs, each end after a garbage collection, in MiB. */
  readonly growthMiB: number | null;
  /** What the load transferred: report-only, since #6's budgets gate bytes. */
  readonly payload: {
    readonly requests: number;
    readonly transferBytes: number;
    readonly byType: Readonly<Record<string, number>>;
  };
}

/** What one load in static mode, OS reduced motion, measured over the frame window. */
export interface StaticRun {
  readonly status: number;
  readonly lcp: LcpEntry | null;
  readonly canvasLed: boolean;
  /** The page matched prefers-reduced-motion: reduce. */
  readonly reducedMotion: boolean;
  /** requestAnimationFrame callbacks the page ran in the window. */
  readonly frameCallbacks: number;
  /** LayoutCount's growth across the window. */
  readonly layoutCount: number;
}

/** A perf cell's measurements: the static load and timing.runs loads at default motion. */
export interface PerfSample {
  readonly tier: PerformanceTier;
  readonly static: StaticRun;
  readonly runs: readonly PerfRun[];
}

/** A deterministic rule a load broke. */
export interface PerfFinding {
  readonly rule:
    'lcp-entry' | 'lcp-element' | 'static-emulation' | 'frame-callbacks' | 'layout-count';
  readonly preferenceMode: Extract<PreferenceMode, 'default' | 'reduced-motion'>;
  readonly expected: string;
  readonly actual: string;
  readonly selector?: string;
}

const percent = (share: number) => `${Math.round(share * 1000) / 10}%`;

/** Why a canvas-led load's LCP element doesn't do, or null when it does. */
function lcpElementProblem(lcp: LcpEntry, minShare: number): string | null {
  const element = lcp.tag ? `<${lcp.tag}>` : 'an element';
  if (lcp.kind === 'removed') return 'an element no longer in the document';
  if (lcp.kind !== 'image' && lcp.kind !== 'headline') {
    return `${lcp.kind === 'background' ? 'a CSS background on' : 'text in'} ${element}, not a poster image or headline`;
  }
  if (!lcp.serverRendered) {
    return `${lcp.kind} ${element}, which the document's response body doesn't hold`;
  }
  if (lcp.share < minShare) {
    return `${lcp.kind} ${element} covering ${percent(lcp.share)} of the viewport, under ${percent(minShare)}`;
  }
  return null;
}

/** The deterministic rules a load broke: an LCP entry, and a canvas-led load's LCP element. */
function lcpFindings(
  load: Pick<PerfRun, 'lcp' | 'canvasLed'>,
  preferenceMode: PerfFinding['preferenceMode'],
  label: string,
  thresholds: Thresholds,
): PerfFinding[] {
  if (load.lcp === null) {
    return [
      {
        rule: 'lcp-entry',
        preferenceMode,
        expected: load.canvasLed
          ? 'a largest-contentful-paint entry: a canvas-led page needs server-rendered text or a poster image, since Chromium never counts a canvas'
          : 'a largest-contentful-paint entry',
        actual: `${label} ended with none`,
      },
    ];
  }
  if (!load.canvasLed) return [];
  const minShare = thresholds.vitals.canvasLcpMinShare;
  const problem = lcpElementProblem(load.lcp, minShare);
  if (problem === null) return [];
  return [
    {
      rule: 'lcp-element',
      preferenceMode,
      expected: `with a canvas in the first viewport, a server-rendered poster image or headline covering at least ${percent(minShare)} of the viewport as the LCP element`,
      actual: `${label}'s LCP element is ${problem}`,
      selector: load.lcp.selector ?? undefined,
    },
  ];
}

/**
 * Every deterministic rule `sample` broke, once each: an LCP entry on every
 * load, a canvas-led load's LCP element, a static load that matched reduced
 * motion, and no frame callback or layout in its window.
 */
export function perfFindings(
  sample: Pick<PerfSample, 'static' | 'runs'>,
  thresholds: Thresholds = loadThresholds(),
): PerfFinding[] {
  const [from, to] = thresholds.reducedMotion.rafWindowMs;
  const window = `from ${from} ms to ${to} ms after load`;
  const findings: PerfFinding[] = [
    ...lcpFindings(sample.static, 'reduced-motion', 'the static load', thresholds),
    ...sample.runs.flatMap((run, index) =>
      lcpFindings(run, 'default', `load ${index + 1} of ${sample.runs.length}`, thresholds),
    ),
  ];
  if (!sample.static.reducedMotion) {
    findings.push({
      rule: 'static-emulation',
      preferenceMode: 'reduced-motion',
      expected: 'the static load to match (prefers-reduced-motion: reduce)',
      actual: "it didn't, so its frame and layout counts say nothing about static mode",
    });
  }
  if (sample.static.frameCallbacks > thresholds.reducedMotion.rafCallbacks) {
    findings.push({
      rule: 'frame-callbacks',
      preferenceMode: 'reduced-motion',
      expected: `at most ${thresholds.reducedMotion.rafCallbacks} requestAnimationFrame callbacks ${window} in static mode`,
      actual: `${sample.static.frameCallbacks}`,
    });
  }
  if (sample.static.layoutCount > 0) {
    findings.push({
      rule: 'layout-count',
      preferenceMode: 'reduced-motion',
      expected: `no layout ${window} in static mode`,
      actual: `${sample.static.layoutCount} layouts`,
    });
  }
  const seen = new Set<string>();
  return findings.filter((finding) => {
    const key = `${finding.rule} ${finding.expected} ${finding.selector ?? ''}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/** The timing metrics, in the order a report lists them. */
export const TIMING_METRICS = [
  'lcpMs',
  'cls',
  'tbtMs',
  'idleTaskMs',
  'heapMiB',
  'growthMiB',
] as const;
export type TimingMetric = (typeof TIMING_METRICS)[number];

/** A metric's ceiling for `tier`, from the thresholds file. */
export function ceilingFor(
  metric: TimingMetric,
  tier: PerformanceTier,
  thresholds: Thresholds = loadThresholds(),
): number {
  switch (metric) {
    case 'lcpMs':
      return thresholds.vitals.lcpMs;
    case 'cls':
      return thresholds.vitals.cls;
    case 'tbtMs':
      return thresholds.vitals.tbtMs;
    case 'idleTaskMs':
      return thresholds.idle.taskDurationMs[tier];
    case 'heapMiB':
      return thresholds.memory.heapMiB[tier];
    case 'growthMiB':
      return thresholds.memory.growthMiB;
  }
}

/** The median of `values`: the middle one, or the mean of the middle two. */
export function median(values: readonly number[]): number {
  if (values.length === 0) throw new Error('The median of no values is undefined.');
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[middle]! : (sorted[middle - 1]! + sorted[middle]!) / 2;
}

const round = (value: number) => Math.round(value * 1000) / 1000;

/** The metrics judged at the reference runner's speed (row 141); the rest are read as measured. */
export const CALIBRATED_METRICS = [
  'tbtMs',
  'idleTaskMs',
] as const satisfies readonly TimingMetric[];
const calibrated = (metric: TimingMetric) =>
  (CALIBRATED_METRICS as readonly TimingMetric[]).includes(metric);

/**
 * `run`'s value of `metric` at the reference runner's speed, or as measured where the metric
 * isn't calibrated or no reference has been measured yet. Null where it can't be read: the
 * metric didn't come, or the load has no calibration (or, for TBT, no long tasks) to scale by.
 */
export function atReference(
  run: PerfRun,
  metric: TimingMetric,
  referenceMs: number | null,
): number | null {
  const measured = run[metric];
  if (!calibrated(metric) || referenceMs === null) return measured;
  if (measured === null || run.calibrationMs === null || !(run.calibrationMs > 0)) return null;
  const scale = referenceMs / run.calibrationMs;
  if (metric === 'idleTaskMs') return measured * scale;
  // TBT: each long task at the reference speed, then its time over 50 ms.
  if (run.blockingTasks === null) return null;
  return run.blockingTasks.reduce((total, ms) => total + Math.max(0, ms * scale - 50), 0);
}

/** One metric over a cell's loads. */
export interface TimingRow {
  readonly metric: TimingMetric;
  readonly ceiling: number;
  /** What the release run fails over: the ceiling plus timing.releaseTolerance of it. */
  readonly releaseLimit: number;
  /**
   * Each load's value, null where it didn't come: at the reference runner's speed for
   * CALIBRATED_METRICS once a reference is measured (row 141), else as measured.
   */
  readonly values: readonly (number | null)[];
  /** Each load's value as measured on this runner. */
  readonly rawValues: readonly (number | null)[];
  /** The values are at the reference runner's speed. */
  readonly calibrated: boolean;
  /** The median of the values that came, or null when none did. */
  readonly median: number | null;
  /** The spread, max less min, over the median: how steady the loads were. */
  readonly spread: number | null;
  /** The median is over the ceiling: the trend a pull request reports. */
  readonly overCeiling: boolean;
  /** The median is over the release limit: what fails a release. */
  readonly overRelease: boolean;
}

/** The runner's speed over a cell's loads (row 141). */
export interface RunnerSpeed {
  /** Each load's calibration workload, in ms. */
  readonly calibrationMs: readonly (number | null)[];
  /** Their median over the reference: 2 is a runner half the reference's speed. Null without both. */
  readonly factor: number | null;
  readonly referenceMs: number | null;
}

export interface TimingResult {
  readonly tier: PerformanceTier;
  readonly runs: number;
  readonly rows: readonly TimingRow[];
  readonly runner: RunnerSpeed;
}

/** Each timing metric's median over `runs`, against its ceiling for `tier` and its release limit. */
export function timingResult(
  runs: readonly PerfRun[],
  tier: PerformanceTier,
  thresholds: Thresholds = loadThresholds(),
): TimingResult {
  const tolerance = thresholds.timing.releaseTolerance;
  const referenceMs = thresholds.timing.calibration.referenceMs;
  const calibrations = runs.map((run) => run.calibrationMs ?? null);
  const measuredSpeeds = calibrations.filter((ms): ms is number => ms !== null && ms > 0);
  return {
    tier,
    runs: runs.length,
    runner: {
      calibrationMs: calibrations,
      factor:
        referenceMs !== null && measuredSpeeds.length > 0
          ? round(median(measuredSpeeds) / referenceMs)
          : null,
      referenceMs,
    },
    rows: TIMING_METRICS.map((metric): TimingRow => {
      const ceiling = ceilingFor(metric, tier, thresholds);
      const releaseLimit = round(ceiling * (1 + tolerance));
      const rawValues = runs.map((run) => run[metric]);
      const scaled = calibrated(metric) && referenceMs !== null;
      // Read as measured, the values are the raw ones untouched; only scaled ones are rounded.
      const values = scaled
        ? runs.map((run) => {
            const value = atReference(run, metric, referenceMs);
            return value === null ? null : round(value);
          })
        : rawValues;
      const present = values.filter((value): value is number => value !== null);
      const middle = present.length > 0 ? round(median(present)) : null;
      const spread =
        middle !== null && middle > 0
          ? round((Math.max(...present) - Math.min(...present)) / middle)
          : null;
      return {
        metric,
        ceiling,
        releaseLimit,
        values,
        rawValues,
        calibrated: scaled,
        median: middle,
        spread,
        overCeiling: middle !== null && middle > ceiling,
        overRelease: middle !== null && middle > releaseLimit,
      };
    }),
  };
}

/** Why a timing result fails a release: too few loads, a metric missing, or a median over. */
export interface ReleaseProblem {
  readonly rule: 'timing-runs' | 'timing-missing' | 'timing-over';
  readonly message: string;
}

/**
 * Why `result` fails a release, one each, or none: fewer loads than
 * timing.runs, a metric that didn't come on every load, or a median more
 * than releaseTolerance over its ceiling.
 */
export function releaseProblems(
  result: TimingResult,
  thresholds: Thresholds = loadThresholds(),
): ReleaseProblem[] {
  const problems: ReleaseProblem[] = [];
  if (result.runs < thresholds.timing.runs) {
    problems.push({
      rule: 'timing-runs',
      message: `${result.runs} load(s), not the ${thresholds.timing.runs} the median takes, so it isn't one.`,
    });
  }
  for (const row of result.rows) {
    const missing = row.values.filter((value) => value === null).length;
    if (missing > 0) {
      problems.push({
        rule: 'timing-missing',
        message: `${row.metric} didn't come on ${missing} of ${row.values.length} load(s).`,
      });
    } else if (row.overRelease) {
      problems.push({
        rule: 'timing-over',
        message: `${row.metric}'s median ${row.median} is over ${row.releaseLimit}, its ${result.tier} ceiling ${row.ceiling} plus ${Math.round(thresholds.timing.releaseTolerance * 100)}%.`,
      });
    }
  }
  return problems;
}
