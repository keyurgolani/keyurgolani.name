import test from 'node:test';
import assert from 'node:assert/strict';
import {
  aggregateProbes,
  assetTotals,
  attributionSummary,
  buildReport,
  calibrationEntry,
  caseSummary,
  counterSummary,
  idleSummary,
  kindOf,
  longTaskSummary,
  metricsObject,
  REPORT_VERSION,
  requestRecord,
  requestTotals,
  thirdPartySummary,
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
  // A chunk the page prefetched: Playwright calls it other, and it is still JS.
  request({
    url: `${APP}/_next/static/chunks/b.js`,
    resourceType: 'other',
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
  // A redirect hop to another host: routing never saw it, and it failed to resolve.
  request({
    url: 'https://picsum.photos/b.jpg',
    resourceType: 'image',
    failure: 'net::ERR_NAME_NOT_RESOLVED',
  }),
  request({ url: `${APP}/gone.js`, failure: 'net::ERR_CONNECTION_RESET' }),
  request({ url: `ws://127.0.0.1:4100/ws`, resourceType: 'websocket' }),
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

test("a WebSocket is the app's own on the app host, and third-party anywhere else", () => {
  const own = request({ url: 'ws://127.0.0.1:4100/ws', resourceType: 'websocket' });
  assert.equal(own.origin, APP);
  assert.equal(own.thirdParty, false);
  assert.equal(own.kind, 'websocket');
  const outside = request({ url: 'ws://[::1]:4100/ws', resourceType: 'websocket' });
  assert.equal(outside.thirdParty, true);
  assert.equal(
    request({ url: 'wss://socket.example.test/', resourceType: 'websocket' }).origin,
    'https://socket.example.test',
  );
});

test('a prefetched or fetched chunk counts by what its URL says it is', () => {
  assert.equal(kindOf('other', `${APP}/_next/static/chunks/a.js`), 'script');
  assert.equal(kindOf('fetch', `${APP}/_next/static/chunks/a.mjs?v=1`), 'script');
  assert.equal(kindOf('other', `${APP}/_next/static/css/a.css`), 'stylesheet');
  assert.equal(kindOf('xhr', `${APP}/media/a.woff2`), 'font');
  assert.equal(kindOf('other', `${APP}/a.webp`), 'image');
  assert.equal(kindOf('fetch', `${APP}/?_rsc=1`), 'fetch');
  assert.equal(kindOf('other', `${APP}/manifest`), 'other');
  // A type that already says what it carries stays as it is.
  assert.equal(kindOf('document', `${APP}/a.js`), 'document');
  assert.equal(kindOf('image', `${APP}/a.js`), 'image');
});

test('request totals count every request by kind, and sum bytes only where they are known', () => {
  const totals = requestTotals(REQUESTS);
  assert.equal(totals.total, 12);
  assert.equal(totals.firstParty, 9);
  assert.equal(totals.thirdParty, 3);
  assert.equal(totals.aborted, 2);
  assert.equal(totals.failed, 2);
  assert.deepEqual(Object.keys(totals.byType), [
    'document',
    'fetch',
    'font',
    'image',
    'script',
    'stylesheet',
    'websocket',
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

test('a kind whose bytes no request knows sums to null, never 0', () => {
  const aborted = REQUESTS.filter((entry) => entry.thirdParty);
  assert.deepEqual(requestTotals(aborted).byType.image, {
    count: 2,
    transferBytes: null,
    fileBytes: null,
    unknownBytes: 2,
  });
  assert.equal(requestTotals(aborted).byType.stylesheet.gzipBytes, undefined);
});

test('third-party requests keep their URLs, what became of each, and which bytes are unknown', () => {
  assert.deepEqual(thirdPartySummary(REQUESTS), {
    count: 3,
    hosts: ['fonts.googleapis.com', 'picsum.photos'],
    requests: [
      {
        url: 'https://picsum.photos/a.jpg',
        kind: 'image',
        outcome: 'aborted',
        failure: 'net::ERR_BLOCKED_BY_CLIENT',
      },
      {
        url: 'https://fonts.googleapis.com/css2?family=X',
        kind: 'stylesheet',
        outcome: 'aborted',
        failure: 'net::ERR_BLOCKED_BY_CLIENT',
      },
      {
        url: 'https://picsum.photos/b.jpg',
        kind: 'image',
        outcome: 'failed',
        failure: 'net::ERR_NAME_NOT_RESOLVED',
      },
    ],
    bytes: { known: 0, unknownRequests: 3 },
  });
  const answered = request({ url: 'https://x.test/a.js', status: 200, transferBytes: 70 });
  assert.deepEqual(thirdPartySummary([answered]).bytes, { known: 70, unknownRequests: 0 });
  assert.equal(thirdPartySummary([answered]).requests[0].outcome, 'answered');
});

test("asset totals are the app's own files by kind: JS and CSS with gzip, prefetched JS too", () => {
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

/** One frame's probe read, with what a test sets. */
const read = (overrides = {}) => ({
  url: `${APP}/`,
  windowMs: 2000,
  visibility: 'visible',
  frames: {
    requests: 10,
    callbacks: 10,
    windowRequests: 8,
    windowCallbacks: 8,
    loops: [],
    loopCount: 0,
    transient: [],
  },
  timers: {
    timeoutCallbacks: 1,
    intervalCallbacks: 0,
    windowTimeoutCallbacks: 0,
    windowIntervalCallbacks: 0,
    intervals: [],
    timeouts: [],
    recurring: 0,
  },
  canvas: { contexts: {}, total: 0, connected: 0, offscreen: 0, nullContexts: {} },
  animations: { infinite: [] },
  csp: [],
  longTasks: { supported: true, entries: [{ startTime: 1, duration: 60 }] },
  ...overrides,
});

test('every frame counts: probe reads add up across frames, each list keeps its frame', () => {
  const loop = { site: 'http://127.0.0.1:4100/a.js:1:9', callbacks: 120, concurrent: 2 };
  const frame = read({
    url: 'http://127.0.0.1:4100/embed',
    frames: { ...read().frames, windowCallbacks: 240, loops: [loop], loopCount: 2 },
    timers: { ...read().timers, intervals: [{ site: 'x', delayMs: 100 }], recurring: 1 },
    canvas: {
      contexts: { webgl: 1 },
      total: 1,
      connected: 1,
      offscreen: 0,
      nullContexts: { webgl2: 1 },
    },
    animations: { infinite: [{ kind: 'css spin', target: 'div' }] },
    csp: [{ effectiveDirective: 'img-src' }],
    longTasks: { supported: true, entries: [{ startTime: 5, duration: 900 }] },
  });
  const all = aggregateProbes([
    { url: `${APP}/`, read: read() },
    { url: 'http://127.0.0.1:4100/embed', read: frame },
    { url: 'about:blank', read: null },
  ]);
  assert.equal(all.frames.windowCallbacks, 248);
  assert.equal(all.frames.loopCount, 2);
  assert.deepEqual(all.frames.loops, [{ ...loop, frame: 'http://127.0.0.1:4100/embed' }]);
  assert.equal(all.timers.recurring, 1);
  assert.equal(all.timers.intervals[0].frame, 'http://127.0.0.1:4100/embed');
  assert.deepEqual(all.canvas.contexts, { webgl: 1 });
  assert.deepEqual(all.canvas.nullContexts, { webgl2: 1 });
  assert.equal(all.animations.infinite.length, 1);
  assert.equal(all.csp[0].frame, 'http://127.0.0.1:4100/embed');
  // Long tasks are the top document's: it sees the event loop every frame shares.
  assert.deepEqual(all.longTasks.entries, [{ startTime: 1, duration: 60 }]);
  assert.deepEqual(
    all.documents.map((document) => [document.url, document.frameLoops]),
    [
      [`${APP}/`, 0],
      ['http://127.0.0.1:4100/embed', 2],
    ],
  );
  assert.throws(() => aggregateProbes([{ url: 'about:blank', read: null }]), /No frame had/);
});

test('the counters in brief count loops as many as run at once', () => {
  const loops = [{ concurrent: 3 }, { concurrent: 1 }];
  const probe = read({
    frames: { ...read().frames, windowCallbacks: 120, loops, loopCount: 4, transient: [{}] },
    timers: { ...read().timers, recurring: 2 },
    canvas: {
      contexts: { webgl: 1 },
      total: 1,
      connected: 1,
      offscreen: 0,
      nullContexts: { webgl: 2 },
    },
    animations: { infinite: [{ kind: 'css spin', target: 'div' }] },
  });
  assert.deepEqual(counterSummary(probe), {
    frameCallbacks: 120,
    frameLoops: 4,
    transientFrameSites: 1,
    recurringTimers: 2,
    canvasContexts: 1,
    nullCanvasContexts: 2,
    infiniteAnimations: 1,
  });
});

const TREES = {
  apps: 'a'.repeat(40),
  packages: 'b'.repeat(40),
  tests: 'c'.repeat(40),
};
const CONDITIONS = {
  browser: 'chromium 145.0.7632.6',
  viewport: '1440x900',
  dpr: 1,
  webgl: { webgl: false, webgl2: false },
};

const entry = (viewport, overrides = {}) => ({
  route: '/',
  viewport,
  selection: 'missing-variant',
  composition: 'fallback',
  profile: 'read-only',
  fixture: 'complete',
  conditions: { ...CONDITIONS, viewport },
  requests: REQUESTS.slice(0, 4),
  longTasks: longTaskSummary([{ startTime: 1, duration: 70 }], { loadEventEnd: 500 }),
  idle: { windowS: 2, taskDurationS: 0.005 },
  probe: aggregateProbes([{ url: `${APP}/`, read: read() }]),
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
  serverEgress: { attempts: [] },
  ...overrides,
});

const report = (cases, overrides = {}) =>
  buildReport({
    cases,
    checkout: { commit: 'd'.repeat(40), dirty: false, trees: TREES },
    command: 'pnpm test:trace',
    options: { baseUrl: null, allowThirdParty: false, selection: null },
    generatedAt: '2026-10-22T00:00:00.000Z',
    ...overrides,
  });

test('a report sorts its cases and says how it measured', () => {
  const built = report([entry('390x844'), entry('1440x900')]);
  assert.equal(built.reportVersion, REPORT_VERSION);
  assert.equal(built.tool, 'pnpm test:trace');
  assert.deepEqual(
    built.cases.map((each) => each.viewport),
    ['1440x900', '390x844'],
  );
  assert.deepEqual(built.failures, []);
  assert.deepEqual(built.checkout.trees, TREES);
  assert.match(built.method.longTasks, /5000 ms after load, CPU throttled 4x/);
  assert.match(built.method.dataUrls, /no request for a data: URL/);
  assert.match(built.method.attribution, /\(unmapped\)/);
});

test('a case in brief has its conditions, requests, third parties, attribution, timings, and counters', () => {
  const summary = caseSummary(entry('1440x900'));
  assert.deepEqual(summary.conditions, { ...CONDITIONS, viewport: '1440x900' });
  assert.equal(summary.requests.total, 4);
  assert.deepEqual(summary.js, { files: 2, bytes: 125000, gzipBytes: 40900 });
  assert.equal(summary.thirdParty.count, 0);
  assert.deepEqual(summary.attribution.js.packages, [{ package: 'next', bytes: 10, gzipBytes: 5 }]);
  assert.equal(summary.attribution.css, null);
  assert.equal(summary.longTasks.count, 1);
  assert.equal(summary.idle.taskDurationS, 0.005);
  assert.equal(summary.counters.frameLoops, 0);
  assert.equal(summary.cspViolations, 0);
  assert.deepEqual(summary.serverEgress, { attempts: [] });
  assert.equal('documents' in summary, false, 'one document needs no breakdown');
  const unattributed = caseSummary(
    entry('1440x900', { attribution: { js: null, css: null, withoutMap: ['a'], chunks: [] } }),
  );
  assert.equal(unattributed.attribution, null);
});

const META = {
  base: '62a0f06cf88c5d6c55045945bf0733a6882c5425',
  trees: { apps: TREES.apps, packages: TREES.packages },
  date: '2026-10-22',
  command: 'pnpm test:trace:baseline',
};

test('a calibration entry names what it traced by base commit and tree ids, never a branch commit', () => {
  const calibration = calibrationEntry(report([entry('1440x900'), entry('390x844')]), {
    ...META,
    notes: { commit: 'not a commit', base: 'nope', why: 'kept apart' },
  });
  assert.equal(calibration.base, META.base);
  assert.deepEqual(calibration.trees, META.trees);
  assert.deepEqual(calibration.tracer, { tests: TREES.tests });
  assert.equal('commit' in calibration, false);
  assert.equal('tracedFrom' in calibration, false);
  assert.equal(calibration.trace, 'pnpm test:trace');
  assert.equal(calibration.browser, 'chromium 145.0.7632.6', 'from the trace, never a note');
  assert.deepEqual(calibration.notes, { commit: 'not a commit', base: 'nope', why: 'kept apart' });
  assert.equal(calibration.selection, 'missing-variant');
  assert.deepEqual(Object.keys(calibration.viewports), ['1440x900', '390x844']);
});

test('a calibration entry refuses a report that failed or came from uncommitted work', () => {
  const cases = [entry('1440x900')];
  assert.throws(
    () => calibrationEntry(report(cases, { failures: ['fallback > / at 1440x900'] }), META),
    /1 failed case\(s\), so it calibrates nothing: fallback > \/ at 1440x900/,
  );
  for (const dirty of [true, null]) {
    assert.throws(
      () =>
        calibrationEntry(report(cases, { checkout: { commit: null, dirty, trees: TREES } }), META),
      /uncommitted changes, or one git could not read/,
    );
  }
  assert.throws(
    () => calibrationEntry(report(cases), { ...META, base: '62a0f06' }),
    /full commit SHA/,
  );
  assert.throws(
    () => calibrationEntry(report(cases), { ...META, trees: { apps: 'x', packages: 'y' } }),
    /apps tree is a full tree id/,
  );
  assert.throws(
    () => calibrationEntry({ ...report(cases), reportVersion: 1 }, META),
    /version 1; calibrate reads 2/,
  );
  const mixed = report([entry('1440x900'), entry('1440x900', { selection: 'other' })]);
  assert.throws(() => calibrationEntry(mixed, META), /one selection; the report has 2 on \//);
});
