// The runtime trace (#6, Slice 1): `pnpm test:trace`. Each case loads one
// route at one viewport for one selection, in Chromium, and records:
//
// - every request from navigation to the end of the idle window, the
//   document among them: URL, resource type, origin, status, and bytes
//   (tests/harness/trace/report.mjs says which);
// - long tasks from navigation to 5 s after load, with the CPU throttled 4x;
// - Content Security Policy violations, and the init script's counts of
//   frame callbacks and loops, recurring timers, canvas contexts, and running
//   infinite animations over 2 s of visible idle, unthrottled
//   (tests/harness/trace/probe.mjs);
// - CDP Performance.getMetrics over that same idle window, report-only data
//   for #11;
// - on a PORTFOLIO_ANALYZE=1 build, which ships source maps, each
//   downloaded chunk's bytes by source module and package
//   (tests/harness/trace/attribution.mjs).
//
// The trace loads the route with a GET and does nothing else: no click, no
// input, no form. Every request outside the app's origin is recorded and
// aborted, and fails the case unless --allow-third-party, for the baseline
// calibration only, says to record it and go on. A request that isn't a GET
// or HEAD is aborted too. The browser resolves nothing but 127.0.0.1 and
// localhost (playwright.config.ts), so nothing it misses reaches a host. On
// the app under test, the harness's egress trap fails a case whose server
// tried to reach one. Each case attaches trace-case.json, which
// report-writer.ts gathers into reports/trace/trace-report.json.
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Page, Request } from '@playwright/test';
import { expect, test as harness, type App } from '../harness/fixtures';
import {
  attributeChunk,
  gzipBytes,
  inlineSourceMap,
  sourceMapUrl,
  workspacePackages,
} from '../harness/trace/attribution.mjs';
import { readTraceEnv } from '../harness/trace/options.mjs';
import { installTraceProbe } from '../harness/trace/probe.mjs';
import {
  attributionSummary,
  CPU_THROTTLING_RATE,
  IDLE_WINDOW_MS,
  idleSummary,
  LONG_TASK_WINDOW_MS,
  longTaskSummary,
  requestRecord,
} from '../harness/trace/report.mjs';
import type { TraceTarget } from './targets';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const options = readTraceEnv();

/** The routes each selection is traced on. */
const ROUTES = ['/'];

/** The viewports, as the variant specs' desktop and mobile modes set them. */
const VIEWPORTS = [
  { size: '1440x900', context: { viewport: { width: 1440, height: 900 } } },
  {
    size: '390x844',
    context: { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true },
  },
] as const;

type TraceProbe = ReturnType<typeof installTraceProbe>;

declare global {
  interface Window {
    __portfolioTrace?: TraceProbe;
  }
}

type AbortReason = 'third-party' | 'method';

interface AbortedRequest {
  readonly url: string;
  readonly method: string;
  readonly resourceType: string;
  readonly reason: AbortReason;
}

interface TracePolicy {
  /** Why the trace aborted `request`, or null when it let it through. */
  reason(request: Request): AbortReason | null;
  readonly aborted: readonly AbortedRequest[];
}

/** A server the trace didn't start, as the harness's `app` describes one. */
function outsideServer(origin: string): App {
  return {
    origin,
    port: Number(new URL(origin).port),
    root: '',
    sourceDir: '',
    log: '',
    env: {},
    egress: () => [],
  };
}

const outside = options.baseUrl;
const base = outside
  ? harness.extend({
      app: [
        async ({}, provide) => {
          await provide(outsideServer(outside));
        },
        { scope: 'worker' },
      ],
    })
  : harness;

const test = base.extend<{ policy: TracePolicy }>({
  // The trace's own policy below takes the place of the harness's, which
  // lets some outside hosts by. A plain override keeps it an auto fixture.
  blockedRequests: async ({}, provide) => {
    await provide([]);
  },
  policy: [
    async ({ context, app }, provide, testInfo) => {
      const appOrigin = new URL(app.origin).origin;
      const reasons = new WeakMap<Request, AbortReason>();
      const aborted: AbortedRequest[] = [];
      const abort = (request: Request, reason: AbortReason) => {
        reasons.set(request, reason);
        aborted.push({
          url: request.url(),
          method: request.method(),
          resourceType: request.resourceType(),
          reason,
        });
      };
      await context.route('**/*', (route) => {
        const request = route.request();
        if (new URL(request.url()).origin !== appOrigin) {
          abort(request, 'third-party');
          return route.abort('blockedbyclient');
        }
        if (request.method() !== 'GET' && request.method() !== 'HEAD') {
          abort(request, 'method');
          return route.abort('blockedbyclient');
        }
        return route.continue();
      });
      await context.routeWebSocket(/.*/, (ws) => {
        if (new URL(ws.url()).host === new URL(appOrigin).host) {
          ws.connectToServer();
          return;
        }
        aborted.push({
          url: ws.url(),
          method: 'GET',
          resourceType: 'websocket',
          reason: 'third-party',
        });
        ws.close();
      });
      await provide({
        reason: (request) =>
          reasons.get(request) ??
          aborted.find((entry) => entry.url === request.url() && entry.method === request.method())
            ?.reason ??
          null,
        aborted,
      });
      if (aborted.length > 0) {
        await testInfo.attach('aborted-requests.txt', {
          body: `${aborted.map((entry) => `${entry.reason} ${entry.method} ${entry.url}`).join('\n')}\n`,
          contentType: 'text/plain',
        });
      }
      const thirdParty = [
        ...new Set(aborted.filter((entry) => entry.reason === 'third-party').map((e) => e.url)),
      ];
      if (thirdParty.length > 0 && !options.allowThirdParty) {
        throw new Error(
          [
            `The page requested ${thirdParty.length} URL(s) outside the app: ${thirdParty.join(', ')}`,
            '',
            'Expected: no third-party request (only a --base-url trace may pass --allow-third-party)',
            `Received: ${thirdParty.join(', ')}`,
          ].join('\n'),
        );
      }
    },
    { auto: true },
  ],
});

interface Download {
  readonly url: string;
  readonly kind: 'js' | 'css';
  readonly code: string;
}

/** Records every request the page makes, with its bytes, from markNavigation() on. */
function watchRequests(page: Page, appOrigin: string, policy: TracePolicy) {
  const startedAt = new Map<Request, number>();
  let navigationStart = Date.now();
  const pending: Promise<void>[] = [];
  const records: ReturnType<typeof requestRecord>[] = [];
  const downloads: Download[] = [];

  const settle = async (request: Request, failure: string | null) => {
    const response = failure === null ? await request.response() : null;
    const sizes = failure === null ? await request.sizes().catch(() => null) : null;
    const body = response ? await response.body().catch(() => null) : null;
    const type = request.resourceType();
    const code = body && (type === 'script' || type === 'stylesheet') ? body : null;
    const started = startedAt.get(request);
    records.push(
      requestRecord({
        url: request.url(),
        method: request.method(),
        resourceType: type,
        appOrigin,
        status: response?.status() ?? null,
        aborted: policy.reason(request),
        failure,
        transferBytes: sizes ? sizes.responseHeadersSize + sizes.responseBodySize : null,
        fileBytes: body ? body.length : null,
        gzipBytes: code ? gzipBytes(code) : null,
        startMs: started === undefined ? null : started - navigationStart,
      }),
    );
    if (code && new URL(request.url()).origin === appOrigin) {
      downloads.push({
        url: request.url(),
        kind: type === 'script' ? 'js' : 'css',
        code: code.toString('utf8'),
      });
    }
  };

  page.on('request', (request) => startedAt.set(request, Date.now()));
  page.on('requestfinished', (request) => pending.push(settle(request, null)));
  page.on('requestfailed', (request) =>
    pending.push(settle(request, request.failure()?.errorText ?? 'failed')),
  );
  return {
    markNavigation() {
      navigationStart = Date.now();
    },
    /** Every request so far, once each has its bytes, in the order they started. */
    async done() {
      for (let seen = -1; seen !== pending.length;) {
        seen = pending.length;
        await Promise.all(pending.slice());
      }
      records.sort((a, b) => (a.startMs ?? Infinity) - (b.startMs ?? Infinity));
      return { records, downloads };
    },
  };
}

/**
 * Each downloaded chunk's bytes by module and package, from the map its
 * sourceMappingURL names on the app's own origin. A build without maps
 * attributes nothing, and lists each chunk under withoutMap.
 */
async function attribute(page: Page, downloads: readonly Download[]) {
  const workspace = workspacePackages(REPO_ROOT);
  const chunks: (ReturnType<typeof attributeChunk> & { kind: 'js' | 'css' })[] = [];
  const withoutMap: string[] = [];
  for (const download of downloads) {
    const url = sourceMapUrl(download.code, download.url);
    let map: unknown = url ? inlineSourceMap(url) : null;
    if (url && !map && new URL(url).origin === new URL(download.url).origin) {
      const response = await page.request.get(url, { failOnStatusCode: false });
      if (response.ok()) map = await response.json().catch(() => null);
    }
    if (!map) {
      withoutMap.push(download.url);
      continue;
    }
    chunks.push({
      kind: download.kind,
      ...attributeChunk({ url: download.url, code: download.code, map, workspace }),
    });
  }
  return {
    js: attributionSummary(chunks.filter((chunk) => chunk.kind === 'js')),
    css: attributionSummary(chunks.filter((chunk) => chunk.kind === 'css')),
    withoutMap,
    chunks,
  };
}

/** Two frames, from the page's own requestAnimationFrame as it was before the probe. */
function nextFrames(page: Page): Promise<void> {
  return page.evaluate(
    () =>
      new Promise<void>((resolve) => {
        const frame =
          window.__portfolioTrace?.original.requestAnimationFrame ?? requestAnimationFrame;
        frame(() => frame(() => resolve()));
      }),
  );
}

for (const route of ROUTES) {
  for (const viewport of VIEWPORTS) {
    test.describe(() => {
      test.use(viewport.context);

      test(
        `${route} at ${viewport.size}`,
        { annotation: [{ type: 'route', description: route }] },
        async ({ page, app, policy }, testInfo) => {
          const target = testInfo.project.metadata as unknown as TraceTarget;
          await page.addInitScript({ content: `(${installTraceProbe.toString()})(window);` });
          const requests = watchRequests(page, new URL(app.origin).origin, policy);
          const cdp = await page.context().newCDPSession(page);
          await cdp.send('Performance.enable');
          await cdp.send('Emulation.setCPUThrottlingRate', { rate: CPU_THROTTLING_RATE });

          requests.markNavigation();
          const response = await page.goto(route, { waitUntil: 'load' });
          expect(response?.status(), `GET ${route}`).toBe(200);
          // Long tasks count until 5 s after load, all of it throttled.
          await page.waitForTimeout(LONG_TASK_WINDOW_MS);
          await cdp.send('Emulation.setCPUThrottlingRate', { rate: 1 });
          const networkIdle = await page
            .waitForLoadState('networkidle', { timeout: 15_000 })
            .then(() => true)
            .catch(() => false);
          await nextFrames(page);

          // The visible idle window: nothing touches the page meanwhile.
          await page.evaluate(() => window.__portfolioTrace!.start());
          const before = await cdp.send('Performance.getMetrics');
          await page.waitForTimeout(IDLE_WINDOW_MS);
          const after = await cdp.send('Performance.getMetrics');
          const probe = await page.evaluate(() => window.__portfolioTrace!.read());
          const loadEventEnd = await page.evaluate(
            () =>
              (performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming)
                ?.loadEventEnd ?? 0,
          );
          await cdp.detach();
          expect(probe.visibility, 'the idle window is visible').toBe('visible');

          const { records, downloads } = await requests.done();
          const { longTasks, ...counters } = probe;
          const entry = {
            route,
            viewport: viewport.size,
            selection: target.selection,
            composition: target.composition,
            profile: target.profile,
            fixture: target.fixture,
            origin: app.origin,
            document: { status: response?.status() ?? null },
            requests: records,
            longTasks: longTaskSummary(longTasks.entries, {
              loadEventEnd,
              supported: longTasks.supported,
            }),
            idle: {
              ...idleSummary(before.metrics, after.metrics),
              visibility: probe.visibility,
              networkIdle,
            },
            probe: counters,
            attribution: await attribute(page, downloads),
          };
          await testInfo.attach('trace-case.json', {
            body: JSON.stringify(entry, null, 2),
            contentType: 'application/json',
          });
        },
      );
    });
  }
}
