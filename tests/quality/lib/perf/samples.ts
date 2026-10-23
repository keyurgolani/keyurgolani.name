// The performance cells' judgement (#11, 11-3), pure over what a perf test
// measured (measure.ts), so quality:meta and the unit tests feed it
// recorded samples. Two kinds of rule:
//
// - Deterministic, which fail any run, a pull request's included
//   (perfFindings):
//   - lcp-entry: every load has a largest-contentful-paint entry.
//   - lcp-element: a canvas-led cell, with a <canvas> in the first viewport,
//     makes an image or a text block of the server HTML its LCP element,
//     since Chromium never picks a canvas.
//   - frame-callbacks: no requestAnimationFrame callback from
//     reducedMotion.rafWindowMs[0] to [1] after load in static mode.
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

/** The largest-contentful-paint entry a load ended with, and its element. */
export interface LcpEntry {
  /** When it painted, in ms from navigation start. */
  readonly startTime: number;
  /** image, text, or removed when the element left the document. */
  readonly kind: 'image' | 'text' | 'removed';
  /** Its element's tag, lowercase, such as h1 or img. */
  readonly tag: string | null;
  /** The element was in the document when it finished parsing: server HTML, not a client render. */
  readonly serverRendered: boolean;
  /** Its element as a selector, for the record. */
  readonly selector: string | null;
}

/** What one load at default motion measured. Null is a measurement that didn't come. */
export interface PerfRun {
  readonly status: number;
  /** Null when the load ended with no LCP entry. */
  readonly lcp: LcpEntry | null;
  /** A <canvas> showed in the first viewport at load. */
  readonly canvasLed: boolean;
  readonly lcpMs: number | null;
  readonly cls: number | null;
  /** Total blocking time: long tasks' time over 50 ms, from FCP to 5 s after load. */
  readonly tbtMs: number | null;
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
  readonly rule: 'lcp-entry' | 'lcp-element' | 'frame-callbacks' | 'layout-count';
  readonly preferenceMode: Extract<PreferenceMode, 'default' | 'reduced-motion'>;
  readonly expected: string;
  readonly actual: string;
  readonly selector?: string;
}

const describeLcp = (lcp: LcpEntry) =>
  `${lcp.kind === 'removed' ? 'an element no longer in the document' : `${lcp.kind} <${lcp.tag}>`}${lcp.serverRendered ? '' : ', rendered on the client'}`;

/** The deterministic rules a load broke: an LCP entry, and a canvas-led cell's LCP element. */
function lcpFindings(
  load: Pick<PerfRun, 'lcp' | 'canvasLed'>,
  preferenceMode: PerfFinding['preferenceMode'],
  label: string,
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
  const { lcp } = load;
  if (!load.canvasLed || (lcp.kind !== 'removed' && lcp.serverRendered)) return [];
  return [
    {
      rule: 'lcp-element',
      preferenceMode,
      expected:
        'with a canvas in the first viewport, an image or text block of the server HTML as the LCP element',
      actual: `${label}'s LCP element is ${describeLcp(lcp)}`,
      selector: lcp.selector ?? undefined,
    },
  ];
}

/**
 * Every deterministic rule `sample` broke, once each: an LCP entry on every
 * load, a canvas-led cell's LCP element, and no frame callback or layout in
 * the static load's window.
 */
export function perfFindings(
  sample: Pick<PerfSample, 'static' | 'runs'>,
  thresholds: Thresholds = loadThresholds(),
): PerfFinding[] {
  const [from, to] = thresholds.reducedMotion.rafWindowMs;
  const window = `from ${from} ms to ${to} ms after load`;
  const findings: PerfFinding[] = [
    ...lcpFindings(sample.static, 'reduced-motion', 'the static load'),
    ...sample.runs.flatMap((run, index) =>
      lcpFindings(run, 'default', `load ${index + 1} of ${sample.runs.length}`),
    ),
  ];
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

/** One metric over a cell's loads. */
export interface TimingRow {
  readonly metric: TimingMetric;
  readonly ceiling: number;
  /** What the release run fails over: the ceiling plus timing.releaseTolerance of it. */
  readonly releaseLimit: number;
  /** Each load's value, null where it didn't come. */
  readonly values: readonly (number | null)[];
  /** The median of the values that came, or null when none did. */
  readonly median: number | null;
  /** The spread, max less min, over the median: how steady the loads were. */
  readonly spread: number | null;
  /** The median is over the ceiling: the trend a pull request reports. */
  readonly overCeiling: boolean;
  /** The median is over the release limit: what fails a release. */
  readonly overRelease: boolean;
}

export interface TimingResult {
  readonly tier: PerformanceTier;
  readonly runs: number;
  readonly rows: readonly TimingRow[];
}

/** Each timing metric's median over `runs`, against its ceiling for `tier` and its release limit. */
export function timingResult(
  runs: readonly PerfRun[],
  tier: PerformanceTier,
  thresholds: Thresholds = loadThresholds(),
): TimingResult {
  const tolerance = thresholds.timing.releaseTolerance;
  return {
    tier,
    runs: runs.length,
    rows: TIMING_METRICS.map((metric): TimingRow => {
      const ceiling = ceilingFor(metric, tier, thresholds);
      const releaseLimit = round(ceiling * (1 + tolerance));
      const values = runs.map((run) => run[metric]);
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
