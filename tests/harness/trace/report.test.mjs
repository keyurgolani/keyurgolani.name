import test from 'node:test';
import assert from 'node:assert/strict';
import {
  assetTotals,
  attributionSummary,
  buildReport,
  calibrationEntry,
  caseSummary,
  counterSummary,
  idleSummary,
  longTaskSummary,
  metricsObject,
  REPORT_VERSION,
  requestRecord,
  requestTotals,
} from './report.mjs';

const APP = 'http://127.0.0.1:4100';

const request = (fields) =>
  requestRecord({ method: 'GET', resourceType: 'script', appOrigin: APP, ...fields });

const REQUESTS = [
  request({
    url: `${APP}/`,
    resourceType: 'document',
    status: 200,
    transferBytes: 9000,
    fileBytes: 30000,
    startMs: 0,
  }),
  request({
    url: `${APP}/_next/static/chunks/a.js`,
    status: 200,
    transferBytes: 40000,
    fileBytes: 120000,
    gzipBytes: 39000,
    startMs: 12.4,
  }),
  request({
    url: `${APP}/_next/static/chunks/b.js`,
    status: 200,
    transferBytes: 2000,
    fileBytes: 5000,
    gzipBytes: 1900,
  }),
  request({
    url: `${APP}/_next/static/css/a.css`,
    resourceType: 'stylesheet',
    status: 200,
    transferBytes: 3000,
    fileBytes: 10000,
    gzipBytes: 2800,
  }),
  request({
    url: `${APP}/font.woff2`,
    resourceType: 'font',
    status: 200,
    transferBytes: 20500,
    fileBytes: 20000,
  }),
  request({
    url: `${APP}/missing.png`,
    resourceType: 'image',
    status: 404,
    transferBytes: 300,
    fileBytes: 120,
  }),
  request({
    url: `${APP}/?_rsc=1`,
    resourceType: 'fetch',
    status: 200,
    transferBytes: 800,
    fileBytes: 2000,
  }),
  request({
    url: 'https://picsum.photos/a.jpg',
    resourceType: 'image',
    aborted: 'third-party',
    failure: 'net::ERR_BLOCKED_BY_CLIENT',
  }),
  request({
    url: 'https://fonts.googleapis.com/css2?family=X',
    resourceType: 'stylesheet',
    aborted: 'third-party',
    failure: 'net::ERR_BLOCKED_BY_CLIENT',
  }),
  request({
    url: 'https://picsum.photos/b.jpg',
    resourceType: 'image',
    aborted: 'third-party',
    failure: 'net::ERR_BLOCKED_BY_CLIENT',
  }),
  request({ url: `${APP}/gone.js`, failure: 'net::ERR_CONNECTION_RESET' }),
];

test('a request record says whose it is and keeps unknown bytes null', () => {
  const own = request({ url: `${APP}/a.js`, startMs: 3.6 });
  assert.equal(own.origin, APP);
  assert.equal(own.thirdParty, false);
  assert.equal(own.transferBytes, null);
  assert.equal(own.startMs, 4);
  const outside = request({ url: 'https://cdn.example.test/a.js' });
  assert.equal(outside.origin, 'https://cdn.example.test');
  assert.equal(outside.thirdParty, true);
  const inline = request({ url: 'data:image/png;base64,AAAA', resourceType: 'image' });
  assert.equal(inline.origin, 'data');
  assert.equal(inline.thirdParty, false);
});

test('request totals count every request, and sum bytes only where they are known', () => {
  const totals = requestTotals(REQUESTS);
  assert.equal(totals.total, 11);
  assert.equal(totals.firstParty, 8);
  assert.equal(totals.thirdParty, 3);
  assert.equal(totals.aborted, 3);
  assert.equal(totals.failed, 1);
  assert.deepEqual(totals.thirdPartyHosts, ['fonts.googleapis.com', 'picsum.photos']);
  assert.deepEqual(Object.keys(totals.byType), [
    'document',
    'fetch',
    'font',
    'image',
    'script',
    'stylesheet',
  ]);
  assert.deepEqual(totals.byType.script, {
    count: 3,
    transferBytes: 42000,
    fileBytes: 125000,
    unknownBytes: 1,
    gzipBytes: 40900,
  });
  assert.deepEqual(totals.byType.image, {
    count: 3,
    transferBytes: 300,
    fileBytes: 120,
    unknownBytes: 2,
  });
  assert.equal(totals.byType.stylesheet.gzipBytes, 2800);
  assert.equal(totals.byType.stylesheet.unknownBytes, 1);
});

test('a type whose bytes no request knows sums to null, never 0', () => {
  const aborted = REQUESTS.filter((entry) => entry.aborted !== null);
  assert.deepEqual(requestTotals(aborted).byType.image, {
    count: 2,
    transferBytes: null,
    fileBytes: null,
    unknownBytes: 2,
  });
  assert.equal(requestTotals(aborted).byType.stylesheet.gzipBytes, undefined);
});

test("asset totals are the app's own files: JS and CSS with gzip, fonts and images by file bytes", () => {
  assert.deepEqual(assetTotals(REQUESTS), {
    js: { files: 2, bytes: 125000, gzipBytes: 40900 },
    css: { files: 1, bytes: 10000, gzipBytes: 2800 },
    fonts: { files: 1, bytes: 20000 },
    images: { files: 1, bytes: 120 },
  });
});

test('long tasks count from navigation to the window after load, longest first', () => {
  const summary = longTaskSummary(
    [
      { startTime: 100, duration: 120.04 },
      { startTime: 900, duration: 51 },
      { startTime: 5_899, duration: 60 },
      { startTime: 5_901, duration: 400 },
    ],
    { loadEventEnd: 900, supported: true },
  );
  assert.deepEqual(summary, {
    supported: true,
    cpuThrottling: 4,
    loadEventEndMs: 900,
    windowMs: 5000,
    count: 3,
    over50ms: 3,
    totalMs: 231,
    maxMs: 120,
    durationsMs: [120, 60, 51],
  });
  assert.equal(longTaskSummary([], { loadEventEnd: 10 }).maxMs, 0);
});

test('idle work is the change in each metric over the window', () => {
  const before = [
    { name: 'Timestamp', value: 100 },
    { name: 'TaskDuration', value: 1.5 },
    { name: 'ScriptDuration', value: 0.5 },
    { name: 'LayoutDuration', value: 0.1 },
    { name: 'RecalcStyleDuration', value: 0.2 },
    { name: 'LayoutCount', value: 10 },
    { name: 'RecalcStyleCount', value: 20 },
  ];
  const after = [
    { name: 'Timestamp', value: 102.0004 },
    { name: 'TaskDuration', value: 1.7546 },
    { name: 'ScriptDuration', value: 0.6 },
    { name: 'LayoutDuration', value: 0.15 },
    { name: 'RecalcStyleDuration', value: 0.25 },
    { name: 'LayoutCount', value: 131 },
    { name: 'RecalcStyleCount', value: 141 },
    { name: 'JSHeapUsedSize', value: 4_000_000 },
    { name: 'Nodes', value: 900 },
  ];
  assert.deepEqual(idleSummary(before, after), {
    windowS: 2.0004,
    taskDurationS: 0.2546,
    scriptDurationS: 0.1,
    layoutDurationS: 0.05,
    recalcStyleDurationS: 0.05,
    layoutCount: 121,
    recalcStyleCount: 121,
    jsHeapUsedBytes: 4_000_000,
    nodes: 900,
  });
  assert.deepEqual(metricsObject(undefined), {});
});

test('attribution across chunks merges packages and says how much the maps cover', () => {
  assert.equal(attributionSummary([]), null);
  const summary = attributionSummary([
    {
      bytes: 1000,
      unmappedBytes: 100,
      packages: [
        { package: 'react-dom', bytes: 900, gzipBytes: 300 },
        { package: '(unmapped)', bytes: 100, gzipBytes: 30 },
      ],
    },
    { bytes: 1000, unmappedBytes: 0, packages: [{ package: 'next', bytes: 1000, gzipBytes: 350 }] },
  ]);
  assert.deepEqual(summary, {
    chunks: 2,
    bytes: 2000,
    mappedShare: 0.95,
    packages: [
      { package: 'next', bytes: 1000, gzipBytes: 350 },
      { package: 'react-dom', bytes: 900, gzipBytes: 300 },
      { package: '(unmapped)', bytes: 100, gzipBytes: 30 },
    ],
  });
});

const PROBE = {
  windowMs: 2000,
  visibility: 'visible',
  frames: { windowCallbacks: 120, loops: [{ id: 1, callbacks: 120, perSecond: 60, origin: 'x' }] },
  timers: { recurring: 2 },
  canvas: { total: 1 },
  animations: { infinite: [{ kind: 'css spin', target: 'div' }] },
  csp: [{ effectiveDirective: 'style-src-elem' }],
};

const entry = (viewport, overrides = {}) => ({
  route: '/',
  viewport,
  selection: 'missing-variant',
  composition: 'fallback',
  profile: 'read-only',
  fixture: 'complete',
  browser: 'chromium 145.0.7632.6',
  requests: REQUESTS.slice(0, 4),
  longTasks: longTaskSummary([{ startTime: 1, duration: 70 }], { loadEventEnd: 500 }),
  idle: { windowS: 2, taskDurationS: 0.005 },
  probe: PROBE,
  attribution: {
    js: {
      chunks: 1,
      bytes: 10,
      mappedShare: 1,
      packages: [{ package: 'next', bytes: 10, gzipBytes: 5 }],
    },
    css: null,
    withoutMap: [],
    chunks: [],
  },
  ...overrides,
});

test('the counters in brief', () => {
  assert.deepEqual(counterSummary(PROBE), {
    frameCallbacks: 120,
    frameLoops: 1,
    recurringTimers: 2,
    canvasContexts: 1,
    infiniteAnimations: 1,
  });
});

test('a report sorts its cases and says how it measured', () => {
  const report = buildReport({
    cases: [entry('390x844'), entry('1440x900')],
    commit: 'abc',
    dirty: false,
    command: 'pnpm test:trace',
    options: { baseUrl: null, allowThirdParty: false, selection: null },
    generatedAt: '2026-10-22T00:00:00.000Z',
  });
  assert.equal(report.reportVersion, REPORT_VERSION);
  assert.equal(report.tool, 'pnpm test:trace');
  assert.deepEqual(
    report.cases.map((each) => each.viewport),
    ['1440x900', '390x844'],
  );
  assert.deepEqual(report.failures, []);
  assert.match(report.method.longTasks, /5000 ms after load, CPU throttled 4x/);
  assert.match(report.method.idle, /2000 ms of visible idle/);
});

test('a case in brief has its requests, assets, attribution, timings, and counters', () => {
  const summary = caseSummary(entry('1440x900'));
  assert.equal(summary.requests.total, 4);
  assert.deepEqual(summary.js, { files: 2, bytes: 125000, gzipBytes: 40900 });
  assert.deepEqual(summary.attribution.js.packages, [{ package: 'next', bytes: 10, gzipBytes: 5 }]);
  assert.equal(summary.attribution.css, null);
  assert.equal(summary.longTasks.count, 1);
  assert.equal(summary.idle.taskDurationS, 0.005);
  assert.equal(summary.counters.frameLoops, 1);
  assert.equal(summary.cspViolations, 1);
  const unattributed = caseSummary(
    entry('1440x900', { attribution: { js: null, css: null, withoutMap: ['a'], chunks: [] } }),
  );
  assert.equal(unattributed.attribution, null);
});

test('a calibration entry is one selection on one route, by viewport, with where it came from', () => {
  const report = buildReport({
    cases: [entry('1440x900'), entry('390x844')],
    commit: 'def',
    dirty: false,
    command: 'pnpm test:trace',
    options: { baseUrl: null, allowThirdParty: false, selection: null },
  });
  const calibration = calibrationEntry(report, {
    commit: '62a0f06',
    date: '2026-10-22',
    command: 'pnpm test:trace --base-url http://127.0.0.1:4000 --allow-third-party',
    notes: { thirdPartyBytes: 'unknown: aborted' },
  });
  assert.equal(calibration.commit, '62a0f06');
  assert.equal(calibration.tracedFrom, 'def');
  assert.equal(calibration.selection, 'missing-variant');
  assert.equal(calibration.composition, 'fallback');
  assert.equal(calibration.browser, 'chromium 145.0.7632.6');
  assert.equal(calibration.thirdPartyBytes, 'unknown: aborted');
  assert.deepEqual(Object.keys(calibration.viewports), ['1440x900', '390x844']);
  const mixed = buildReport({
    cases: [entry('1440x900'), entry('1440x900', { selection: 'other' })],
    commit: null,
    dirty: null,
    command: 'pnpm test:trace',
    options: { baseUrl: null, allowThirdParty: false, selection: null },
  });
  assert.throws(
    () => calibrationEntry(mixed, { commit: 'x', date: 'y', command: 'z' }),
    /one selection; the report has 2 on \//,
  );
});
