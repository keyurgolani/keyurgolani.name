// The shape of pnpm test:trace's report (#6, Slice 1), and the summary of
// it that runtime-budgets.json's calibration block keeps. One case is one
// route, selection, and viewport. Its requests are every request the page
// made from navigation to the end of the idle window, the document, redirect
// hops, and WebSockets among them, with transfer bytes (headers and the body
// as sent), file bytes (the body as decoded, which is the build output's
// size), and, for JS and CSS, gzip level 9 bytes of that file. A request
// whose bytes the trace can't know, one it aborted, one that failed, or a
// WebSocket, has null bytes, never 0.
import { sumPackages } from './attribution.mjs';

export const REPORT_VERSION = 2;

/** How long after `load` long tasks count, and how much the CPU is slowed meanwhile. */
export const LONG_TASK_WINDOW_MS = 5_000;
export const CPU_THROTTLING_RATE = 4;
/** The visible idle window Performance.getMetrics is read over. */
export const IDLE_WINDOW_MS = 2_000;

/** What the report says about how it measured, and what slice 3 has to know. */
export const METHOD = {
  longTasks: `PerformanceObserver longtask entries in the top document from navigation to ${LONG_TASK_WINDOW_MS} ms after load, CPU throttled ${CPU_THROTTLING_RATE}x`,
  idle: `CDP Performance.getMetrics deltas over ${IDLE_WINDOW_MS} ms of visible idle, unthrottled, after the page settled`,
  counters:
    'the init script in every frame, started and read in each, summed over frames: a frame loop is a requestAnimationFrame call site that asks again after its own callback ran and runs in both halves of the window, counted as many as it ran in one frame; a recurring timer is an interval still set, or a setTimeout call site that sets another after its own fired, counted as many as it had pending at once',
  bytes:
    'transferBytes: headers and body as sent; fileBytes: the body as decoded; gzipBytes: gzip level 9 of fileBytes, JS and CSS only, a chunk prefetched under another resource type included',
  attribution:
    'chunk bytes split by source map mappings, gzip shared out by raw share; (unmapped) is bytes no mapping covers: module wrappers, bundler glue, and line breaks',
  dataUrls:
    'Playwright reports no request for a data: URL, so an image the page inlines as one, such as each of the complete fixture images, adds 0 requests and 0 image bytes: its bytes are in the document',
};

/**
 * What a request carries, by Playwright's resource type, or by its URL's
 * extension when the type says nothing about the bytes: a chunk the page
 * prefetches comes in as `other`, and one fetched, as `fetch`.
 *
 * @param {string} resourceType
 * @param {string} url
 */
export function kindOf(resourceType, url) {
  if (!['other', 'fetch', 'xhr'].includes(resourceType)) return resourceType;
  let pathname = '';
  try {
    pathname = new URL(url).pathname;
  } catch {
    return resourceType;
  }
  if (/\.m?js$/i.test(pathname)) return 'script';
  if (/\.css$/i.test(pathname)) return 'stylesheet';
  if (/\.(?:woff2?|ttf|otf|eot)$/i.test(pathname)) return 'font';
  if (/\.(?:png|jpe?g|gif|webp|avif|svg|ico)$/i.test(pathname)) return 'image';
  return resourceType;
}

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
  // A WebSocket's origin is its HTTP twin's, so ws: on the app host is the app's.
  const effective = protocol === 'ws:' || protocol === 'wss:' ? webOrigin(fields.url) : origin;
  return {
    url: fields.url,
    method: fields.method,
    resourceType: fields.resourceType,
    kind: kindOf(fields.resourceType, fields.url),
    origin: local ? protocol.slice(0, -1) : effective,
    thirdParty: !local && effective !== fields.appOrigin,
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

/** ws://host and wss://host as the http:// and https:// origins they share a host with. */
function webOrigin(url) {
  const parsed = new URL(url);
  parsed.protocol = parsed.protocol === 'wss:' ? 'https:' : 'http:';
  return parsed.origin;
}

const add = (sum, value) => (value === null || value === undefined ? sum : sum + value);
const known = (sum, value) => (value === null || value === undefined ? sum : (sum ?? 0) + value);

/**
 * Requests by kind, with byte sums over those whose bytes are known, and
 * how many aren't. A sum no request of the kind knows is null, never 0.
 */
export function requestTotals(requests) {
  const byType = {};
  for (const request of requests) {
    const row = (byType[request.kind] ??= {
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
    byType: Object.fromEntries(Object.entries(byType).sort(([a], [b]) => a.localeCompare(b))),
  };
}

/** What happened to a request the trace didn't let reach its server. */
function outcomeOf(request) {
  if (request.aborted !== null) return 'aborted';
  if (request.failure !== null) return 'failed';
  return 'answered';
}

/**
 * The requests outside the app: each URL, what it carried, what became of
 * it, and the bytes of them the trace knows. An aborted or failed request
 * never reached its server, so its bytes are unknown, not 0.
 */
export function thirdPartySummary(requests) {
  const outside = requests.filter((request) => request.thirdParty);
  const answered = outside.filter((request) => outcomeOf(request) === 'answered');
  return {
    count: outside.length,
    hosts: [...new Set(outside.map((request) => new URL(request.url).host))].sort(),
    requests: outside.map((request) => ({
      url: request.url,
      kind: request.kind,
      outcome: outcomeOf(request),
      ...(request.failure ? { failure: request.failure } : {}),
    })),
    bytes: {
      known: answered.reduce((total, request) => add(total, request.transferBytes), 0),
      unknownRequests: outside.filter((request) => request.transferBytes === null).length,
    },
  };
}

/** The app's own JS, CSS, font, and image files a case downloaded, and their bytes. */
export function assetTotals(requests) {
  const files = (kind) =>
    requests.filter(
      (request) => !request.thirdParty && request.kind === kind && request.fileBytes !== null,
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

const sum = (list, read) => list.reduce((total, item) => total + read(item), 0);

/**
 * Every frame's probe read as one: counts summed, lists joined with the
 * frame each came from, and the top document's window, visibility, and long
 * tasks. `reads` is one { url, read } per frame, the top one first; a frame
 * with no probe reads null.
 */
export function aggregateProbes(reads) {
  const present = reads.filter((entry) => entry.read);
  if (present.length === 0) throw new Error('No frame had the trace probe.');
  const [top] = present;
  const tagged = (list, url) => list.map((item) => ({ ...item, frame: url }));
  const joined = (pick) => present.flatMap(({ url, read }) => tagged(pick(read), url));
  const contexts = {};
  const nullContexts = {};
  for (const { read } of present) {
    for (const [type, n] of Object.entries(read.canvas.contexts))
      contexts[type] = (contexts[type] ?? 0) + n;
    for (const [type, n] of Object.entries(read.canvas.nullContexts ?? {}))
      nullContexts[type] = (nullContexts[type] ?? 0) + n;
  }
  const all = present.map(({ read }) => read);
  return {
    windowMs: top.read.windowMs,
    visibility: top.read.visibility,
    frames: {
      requests: sum(all, (read) => read.frames.requests),
      callbacks: sum(all, (read) => read.frames.callbacks),
      windowRequests: sum(all, (read) => read.frames.windowRequests),
      windowCallbacks: sum(all, (read) => read.frames.windowCallbacks),
      loops: joined((read) => read.frames.loops),
      loopCount: sum(all, (read) => read.frames.loopCount),
      transient: joined((read) => read.frames.transient),
    },
    timers: {
      timeoutCallbacks: sum(all, (read) => read.timers.timeoutCallbacks),
      intervalCallbacks: sum(all, (read) => read.timers.intervalCallbacks),
      windowTimeoutCallbacks: sum(all, (read) => read.timers.windowTimeoutCallbacks),
      windowIntervalCallbacks: sum(all, (read) => read.timers.windowIntervalCallbacks),
      intervals: joined((read) => read.timers.intervals),
      timeouts: joined((read) => read.timers.timeouts),
      recurring: sum(all, (read) => read.timers.recurring),
    },
    canvas: {
      contexts,
      total: sum(all, (read) => read.canvas.total),
      connected: sum(all, (read) => read.canvas.connected),
      offscreen: sum(all, (read) => read.canvas.offscreen),
      nullContexts,
    },
    animations: { infinite: joined((read) => read.animations.infinite) },
    csp: joined((read) => read.csp),
    longTasks: top.read.longTasks,
    documents: present.map(({ url, read }) => ({ url, ...counterSummary(read) })),
  };
}

/** The counters the probe read over the idle window, in brief. */
export function counterSummary(probe) {
  return {
    frameCallbacks: probe.frames.windowCallbacks,
    frameLoops: probe.frames.loopCount,
    transientFrameSites: probe.frames.transient.length,
    recurringTimers: probe.timers.recurring,
    canvasContexts: probe.canvas.total,
    nullCanvasContexts: sum(Object.values(probe.canvas.nullContexts ?? {}), (n) => n),
    infiniteAnimations: probe.animations.infinite.length,
  };
}

/**
 * The whole report: every case, with what ran it.
 *
 * @param {object} fields
 * @param {object[]} fields.cases
 * @param {{ commit: string | null, dirty: boolean | null, trees: Record<string, string | null> }} fields.checkout
 *   the checkout the trace ran from, and its apps, packages, and tests trees at HEAD
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
    checkout: fields.checkout,
    command: fields.command,
    options: fields.options,
    method: METHOD,
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
    conditions: entry.conditions,
    requests: requestTotals(entry.requests),
    ...assetTotals(entry.requests),
    thirdParty: thirdPartySummary(entry.requests),
    attribution: js || css ? { js, css } : null,
    longTasks: entry.longTasks,
    idle: entry.idle,
    counters: counterSummary(entry.probe),
    ...(entry.probe.documents?.length > 1 ? { documents: entry.probe.documents } : {}),
    cspViolations: entry.probe.csp.length,
    serverEgress: entry.serverEgress ?? null,
  };
}

const SHA = /^[0-9a-f]{40}$/;

/**
 * A calibration entry for runtime-budgets.json from a report: the report's
 * cases for one route and selection, by viewport. It names what was traced
 * by content, not by a branch commit a squash would orphan: the base
 * commit the app sat on, which a remote branch holds, and the git tree ids
 * of its apps and packages, plus the tests tree that holds the trace tool.
 * It refuses a report with a failed case, or one traced from a checkout with
 * uncommitted changes. Notes sit in their own object, so none can stand in
 * for a measured or recorded field.
 *
 * @param {any} report
 * @param {object} meta
 * @param {string} meta.base the app's base commit
 * @param {{ apps: string, packages: string }} meta.trees the traced app's tree ids
 * @param {string} meta.date
 * @param {string} meta.command what reproduces the entry
 * @param {string} [meta.route]
 * @param {Record<string, string>} [meta.notes]
 * @param {object | null} [meta.egress] the outside server's egress evidence, as baseline.mjs records it
 */
export function calibrationEntry(report, meta) {
  if (report.reportVersion !== REPORT_VERSION) {
    throw new Error(
      `The report is version ${report.reportVersion}; calibrate reads ${REPORT_VERSION}.`,
    );
  }
  if (report.failures.length > 0) {
    throw new Error(
      `The report has ${report.failures.length} failed case(s), so it calibrates nothing: ${report.failures.join('; ')}`,
    );
  }
  if (report.checkout?.dirty !== false) {
    throw new Error(
      'The trace ran from a checkout with uncommitted changes, or one git could not read; trace again from a clean one.',
    );
  }
  if (!SHA.test(meta.base ?? '')) throw new Error('The base is a full commit SHA.');
  for (const name of ['apps', 'packages']) {
    if (!SHA.test(meta.trees?.[name] ?? '')) throw new Error(`The ${name} tree is a full tree id.`);
  }
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
    base: meta.base,
    trees: { apps: meta.trees.apps, packages: meta.trees.packages },
    tracer: { tests: report.checkout.trees?.tests ?? null },
    date: meta.date,
    command: meta.command,
    trace: report.command,
    route,
    selection: first.selection,
    composition: first.composition ?? null,
    profile: first.profile ?? null,
    fixture: first.fixture ?? null,
    browser: first.conditions?.browser ?? null,
    egress: meta.egress ?? null,
    notes: { ...(meta.notes ?? {}) },
    viewports: Object.fromEntries(cases.map((entry) => [entry.viewport, caseSummary(entry)])),
  };
}
