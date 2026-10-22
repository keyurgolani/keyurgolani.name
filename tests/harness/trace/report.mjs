// The shape of pnpm test:trace's report (#6, Slice 1), and the summary of
// it that runtime-budgets.json's calibration block keeps. One case is one
// route, selection, and viewport. Its requests are every request the page
// made from navigation to the end of the idle window, the document among
// them, with transfer bytes (headers and the body as sent), file bytes (the
// body as decoded, which is the build output's size), and, for JS and CSS,
// gzip level 9 bytes of that file. An aborted request has no bytes: null,
// never 0.
import { sumPackages } from './attribution.mjs';

export const REPORT_VERSION = 1;

/** How long after `load` long tasks count, and how much the CPU is slowed meanwhile. */
export const LONG_TASK_WINDOW_MS = 5_000;
export const CPU_THROTTLING_RATE = 4;
/** The visible idle window Performance.getMetrics is read over. */
export const IDLE_WINDOW_MS = 2_000;

/** The resource types a summary names; any other is `other`. */
const TYPES = ['document', 'script', 'stylesheet', 'font', 'image', 'media', 'fetch', 'xhr'];

/**
 * One request, as the report keeps it.
 *
 * @param {object} fields
 * @param {string} fields.url
 * @param {string} fields.method
 * @param {string} fields.resourceType as Playwright names it
 * @param {string} fields.appOrigin the origin of the app under test
 * @param {number | null} [fields.status]
 * @param {'third-party' | 'method' | null} [fields.aborted] why the trace aborted it
 * @param {string | null} [fields.failure] the browser's error for a request that failed
 * @param {number | null} [fields.transferBytes]
 * @param {number | null} [fields.fileBytes]
 * @param {number | null} [fields.gzipBytes]
 * @param {number | null} [fields.startMs] from navigation start
 */
export function requestRecord(fields) {
  const { origin, protocol } = new URL(fields.url);
  const local = protocol === 'data:' || protocol === 'blob:';
  return {
    url: fields.url,
    method: fields.method,
    resourceType: fields.resourceType,
    origin: local ? protocol.slice(0, -1) : origin,
    thirdParty: !local && origin !== fields.appOrigin,
    status: fields.status ?? null,
    aborted: fields.aborted ?? null,
    failure: fields.failure ?? null,
    transferBytes: fields.transferBytes ?? null,
    fileBytes: fields.fileBytes ?? null,
    gzipBytes: fields.gzipBytes ?? null,
    startMs:
      fields.startMs === null || fields.startMs === undefined ? null : Math.round(fields.startMs),
  };
}

const typeOf = (request) => (TYPES.includes(request.resourceType) ? request.resourceType : 'other');
const add = (sum, value) => (value === null || value === undefined ? sum : sum + value);

/**
 * Requests by type, with byte sums over those whose bytes are known, and
 * how many aren't. A sum no request of the type knows is null, never 0.
 */
export function requestTotals(requests) {
  const byType = {};
  const known = (sum, value) => (value === null || value === undefined ? sum : (sum ?? 0) + value);
  for (const request of requests) {
    const type = typeOf(request);
    const row = (byType[type] ??= {
      count: 0,
      transferBytes: null,
      fileBytes: null,
      unknownBytes: 0,
    });
    row.count += 1;
    if (request.transferBytes === null) row.unknownBytes += 1;
    row.transferBytes = known(row.transferBytes, request.transferBytes);
    row.fileBytes = known(row.fileBytes, request.fileBytes);
    if (request.gzipBytes !== null) row.gzipBytes = known(row.gzipBytes, request.gzipBytes);
  }
  const thirdParty = requests.filter((request) => request.thirdParty);
  return {
    total: requests.length,
    firstParty: requests.length - thirdParty.length,
    thirdParty: thirdParty.length,
    aborted: requests.filter((request) => request.aborted !== null).length,
    failed: requests.filter((request) => request.failure !== null && request.aborted === null)
      .length,
    thirdPartyHosts: [...new Set(thirdParty.map((request) => new URL(request.url).host))].sort(),
    byType: Object.fromEntries(Object.entries(byType).sort(([a], [b]) => a.localeCompare(b))),
  };
}

/** The first-party JS, CSS, font, and image files a case downloaded, and their bytes. */
export function assetTotals(requests) {
  const files = (type) =>
    requests.filter(
      (request) =>
        !request.thirdParty && request.resourceType === type && request.fileBytes !== null,
    );
  const sum = (list, key) => list.reduce((total, request) => add(total, request[key]), 0);
  const js = files('script');
  const css = files('stylesheet');
  const fonts = files('font');
  const images = files('image');
  return {
    js: { files: js.length, bytes: sum(js, 'fileBytes'), gzipBytes: sum(js, 'gzipBytes') },
    css: { files: css.length, bytes: sum(css, 'fileBytes'), gzipBytes: sum(css, 'gzipBytes') },
    fonts: { files: fonts.length, bytes: sum(fonts, 'fileBytes') },
    images: { files: images.length, bytes: sum(images, 'fileBytes') },
  };
}

const ms = (value) => Math.round(value * 10) / 10;

/**
 * The long tasks that started from navigation until `windowMs` after
 * `load` ended, under the CPU throttling the trace ran with.
 *
 * @param {{ startTime: number, duration: number }[]} entries
 * @param {{ loadEventEnd: number, windowMs?: number, throttling?: number, supported?: boolean }} options
 */
export function longTaskSummary(entries, options) {
  const windowMs = options.windowMs ?? LONG_TASK_WINDOW_MS;
  const end = options.loadEventEnd + windowMs;
  const inWindow = entries.filter((entry) => entry.startTime <= end);
  const durations = inWindow.map((entry) => entry.duration).sort((a, b) => b - a);
  return {
    supported: options.supported ?? true,
    cpuThrottling: options.throttling ?? CPU_THROTTLING_RATE,
    loadEventEndMs: ms(options.loadEventEnd),
    windowMs,
    count: durations.length,
    over50ms: durations.filter((duration) => duration > 50).length,
    totalMs: ms(durations.reduce((total, duration) => total + duration, 0)),
    maxMs: durations.length ? ms(durations[0]) : 0,
    durationsMs: durations.map(ms),
  };
}

/** Durations Performance.getMetrics reports, in seconds, and the counts beside them. */
const DURATIONS = ['TaskDuration', 'ScriptDuration', 'LayoutDuration', 'RecalcStyleDuration'];
const COUNTS = ['LayoutCount', 'RecalcStyleCount'];

/** CDP's metrics list as an object. */
export function metricsObject(metrics) {
  return Object.fromEntries((metrics ?? []).map(({ name, value }) => [name, value]));
}

const seconds = (value) => Math.round(value * 1e6) / 1e6;

/**
 * Main-thread work over the idle window: the change in each
 * Performance.getMetrics duration and count between `before` and
 * `after`, and the heap and node counts at the end. Report-only data for #11.
 */
export function idleSummary(before, after) {
  const start = metricsObject(before);
  const end = metricsObject(after);
  const delta = (name) => (end[name] ?? 0) - (start[name] ?? 0);
  const summary = { windowS: seconds(delta('Timestamp')) };
  for (const name of DURATIONS)
    summary[`${name[0].toLowerCase()}${name.slice(1)}S`] = seconds(delta(name));
  for (const name of COUNTS) summary[`${name[0].toLowerCase()}${name.slice(1)}`] = delta(name);
  summary.jsHeapUsedBytes = end.JSHeapUsedSize ?? null;
  summary.nodes = end.Nodes ?? null;
  return summary;
}

/**
 * Packages across a case's attributed chunks, and the share of their bytes
 * the maps cover. Null when no chunk had a map.
 *
 * @param {{ bytes: number, unmappedBytes: number, packages: { package: string, bytes: number, gzipBytes: number }[] }[]} chunks
 */
export function attributionSummary(chunks) {
  if (chunks.length === 0) return null;
  const bytes = chunks.reduce((total, chunk) => total + chunk.bytes, 0);
  const unmapped = chunks.reduce((total, chunk) => total + chunk.unmappedBytes, 0);
  return {
    chunks: chunks.length,
    bytes,
    mappedShare: bytes === 0 ? 0 : Math.round(((bytes - unmapped) / bytes) * 1000) / 1000,
    packages: sumPackages(chunks.flatMap((chunk) => chunk.packages)),
  };
}

/** The counters the probe read over the idle window, in brief. */
export function counterSummary(probe) {
  return {
    frameCallbacks: probe.frames.windowCallbacks,
    frameLoops: probe.frames.loops.length,
    recurringTimers: probe.timers.recurring,
    canvasContexts: probe.canvas.total,
    infiniteAnimations: probe.animations.infinite.length,
  };
}

/**
 * The whole report: every case, with what ran it.
 *
 * @param {object} fields
 * @param {object[]} fields.cases
 * @param {string | null} fields.commit the checkout the trace ran from
 * @param {boolean | null} fields.dirty
 * @param {string} fields.command
 * @param {{ baseUrl: string | null, allowThirdParty: boolean, selection: string | null }} fields.options
 * @param {string[]} [fields.failures] titles of the cases that failed
 * @param {string} [fields.generatedAt]
 */
export function buildReport(fields) {
  return {
    reportVersion: REPORT_VERSION,
    tool: 'pnpm test:trace',
    generatedAt: fields.generatedAt ?? new Date().toISOString(),
    commit: fields.commit,
    dirty: fields.dirty,
    command: fields.command,
    options: fields.options,
    method: {
      longTasks: `PerformanceObserver longtask entries from navigation to ${LONG_TASK_WINDOW_MS} ms after load, CPU throttled ${CPU_THROTTLING_RATE}x`,
      idle: `CDP Performance.getMetrics deltas over ${IDLE_WINDOW_MS} ms of visible idle, unthrottled, after the page settled`,
      bytes:
        'transferBytes: headers and body as sent; fileBytes: the body as decoded; gzipBytes: gzip level 9 of fileBytes, JS and CSS only',
      attribution: 'chunk bytes split by source map mappings; gzip shared out by raw share',
    },
    cases: [...fields.cases].sort((a, b) => caseKey(a).localeCompare(caseKey(b))),
    failures: fields.failures ?? [],
  };
}

const caseKey = (entry) => `${entry.selection}\u0000${entry.route}\u0000${entry.viewport}`;

/**
 * One case, in brief, as the calibration block keeps it.
 *
 * @param {any} entry a report case
 */
export function caseSummary(entry) {
  const { js = null, css = null } = entry.attribution ?? {};
  return {
    requests: requestTotals(entry.requests),
    ...assetTotals(entry.requests),
    attribution: js || css ? { js, css } : null,
    longTasks: entry.longTasks,
    idle: entry.idle,
    counters: counterSummary(entry.probe),
    cspViolations: entry.probe.csp.length,
  };
}

/**
 * A calibration entry for runtime-budgets.json from a report: the report's
 * cases for one route and selection, by viewport, with where they came from.
 *
 * @param {any} report
 * @param {{ commit: string, date: string, command: string, route?: string, notes?: Record<string, string> }} meta
 */
export function calibrationEntry(report, meta) {
  const route = meta.route ?? '/';
  const cases = report.cases.filter((entry) => entry.route === route);
  const selections = [...new Set(cases.map((entry) => entry.selection))];
  if (selections.length !== 1) {
    throw new Error(
      `A calibration entry is one selection; the report has ${selections.length} on ${route}.`,
    );
  }
  const [first] = cases;
  return {
    commit: meta.commit,
    date: meta.date,
    command: meta.command,
    tracedFrom: report.commit,
    route,
    selection: first.selection,
    composition: first.composition ?? null,
    profile: first.profile ?? null,
    fixture: first.fixture ?? null,
    ...(meta.notes ?? {}),
    viewports: Object.fromEntries(cases.map((entry) => [entry.viewport, caseSummary(entry)])),
  };
}
