// The trace's fixtures and recording (#6, Slice 1), on the #12 harness's
// app-under-test fixture (tests/harness/fixtures.ts), which trace.spec.ts
// and the policy self-test in policy.spec.ts share.
//
// - The network policy (tests/harness/trace/policy.mjs) takes the place of
//   the harness's blocking: it routes every request and WebSocket and aborts
//   anything but a GET or HEAD on the app's own origin. Chromium launches
//   with TRACE_LAUNCH_ARGS (playwright.config.ts), so what routing never
//   sees resolves nowhere, and each case fails on any request outside the app.
// - With --base-url, `app` is that server: one the trace didn't start.
// - Requests are recorded from page events, which redirect hops reach too,
//   and WebSockets from the policy, which sees every one the page opens.
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Browser, Page, Request } from '@playwright/test';
import { expect, test as harness, type App } from '../harness/fixtures';
import {
  attributeChunk,
  gzipBytes,
  inlineSourceMap,
  sourceMapUrl,
  workspacePackages,
} from '../harness/trace/attribution.mjs';
import { readTraceEnv } from '../harness/trace/options.mjs';
import { installPolicy } from '../harness/trace/policy.mjs';
import { installTraceProbe } from '../harness/trace/probe.mjs';
import {
  aggregateProbes,
  attributionSummary,
  CPU_THROTTLING_RATE,
  kindOf,
  requestRecord,
} from '../harness/trace/report.mjs';

export { expect };

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

/** What tests/trace/run.mjs passed on. */
export const options = readTraceEnv();

export type TracePolicy = Awaited<ReturnType<typeof installPolicy>>;
type TraceProbe = ReturnType<typeof installTraceProbe>;
type RequestRecord = ReturnType<typeof requestRecord>;

declare global {
  interface Window {
    __portfolioTrace?: TraceProbe;
  }
}

/** A server the trace didn't start, as the harness's `app` describes one. */
export function outsideServer(origin: string): App {
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

export const test = base.extend<{ policy: TracePolicy }>({
  // The trace's policy takes the place of the harness's blocking, which lets
  // some outside hosts by. A plain override keeps it an auto fixture.
  blockedRequests: async ({}, provide) => {
    await provide([]);
  },
  policy: [
    async ({ context, app }, provide, testInfo) => {
      const policy = await installPolicy(context, new URL(app.origin).origin);
      await provide(policy);
      if (policy.aborted.length > 0) {
        await testInfo.attach('aborted-requests.txt', {
          body: `${policy.aborted.map((entry) => `${entry.reason} ${entry.method} ${entry.url}`).join('\n')}\n`,
          contentType: 'text/plain',
        });
      }
    },
    { auto: true },
  ],
});

/** The probe, in every frame the page opens, before any of its own scripts. */
export async function installProbe(page: Page): Promise<void> {
  await page.addInitScript({ content: `(${installTraceProbe.toString()})(window);` });
}

export interface Download {
  readonly url: string;
  readonly kind: 'js' | 'css';
  readonly code: string;
}

/**
 * Records every request the page makes, with its bytes, from
 * markNavigation() on, and the policy's WebSockets with them.
 */
export function watchRequests(page: Page, appOrigin: string, policy: TracePolicy) {
  const startedAt = new Map<Request, number>();
  let navigationStart = Date.now();
  const pending: Promise<void>[] = [];
  const records: RequestRecord[] = [];
  const downloads: Download[] = [];

  const settle = async (request: Request, failure: string | null) => {
    const response = failure === null ? await request.response() : null;
    const sizes = failure === null ? await request.sizes().catch(() => null) : null;
    const body = response ? await response.body().catch(() => null) : null;
    const kind = kindOf(request.resourceType(), request.url());
    const code = body && (kind === 'script' || kind === 'stylesheet') ? body : null;
    const started = startedAt.get(request);
    records.push(
      requestRecord({
        url: request.url(),
        method: request.method(),
        resourceType: request.resourceType(),
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
        kind: kind === 'script' ? 'js' : 'css',
        code: code.toString('utf8'),
      });
    }
  };

  const started = (request: Request) => startedAt.set(request, Date.now());
  const finished = (request: Request) => pending.push(settle(request, null));
  const failed = (request: Request) =>
    pending.push(settle(request, request.failure()?.errorText ?? 'failed'));
  page.on('request', started);
  page.on('requestfinished', finished);
  page.on('requestfailed', failed);
  return {
    markNavigation() {
      navigationStart = Date.now();
    },
    /**
     * Every request so far, once each has its bytes, in the order they
     * started, then the WebSockets, whose bytes the trace doesn't count.
     * Recording stops here, so nothing after the idle window, such as the
     * trace's own source map fetches, joins the case.
     */
    async done() {
      for (let seen = -1; seen !== pending.length;) {
        seen = pending.length;
        await Promise.all(pending.slice());
      }
      page.off('request', started);
      page.off('requestfinished', finished);
      page.off('requestfailed', failed);
      const ordered = [...records].sort(
        (a, b) => (a.startMs ?? Infinity) - (b.startMs ?? Infinity),
      );
      const websockets = policy.websockets.map(({ url, connected }) =>
        requestRecord({
          url,
          method: 'GET',
          resourceType: 'websocket',
          appOrigin,
          aborted: connected ? null : 'third-party',
        }),
      );
      return { records: [...ordered, ...websockets], downloads: [...downloads] };
    },
  };
}

/**
 * Each downloaded chunk's bytes by module and package, from the map its
 * sourceMappingURL names on the app's own origin, fetched with no redirect
 * followed. A build without maps attributes nothing, and lists each chunk
 * under withoutMap. Every map is fetched, one request after the other,
 * before any is parsed or attributed: a request sent right after a long
 * synchronous step can go out on a keep-alive connection the server closed
 * meanwhile.
 */
export async function attribute(page: Page, downloads: readonly Download[]) {
  const bodies: (Buffer | null)[] = [];
  for (const download of downloads) {
    const url = sourceMapUrl(download.code, download.url);
    let body: Buffer | null = null;
    if (url && new URL(url).origin === new URL(download.url).origin) {
      const response = await page.request.get(url, { failOnStatusCode: false, maxRedirects: 0 });
      if (response.ok()) body = await response.body();
    }
    bodies.push(body);
  }
  const workspace = workspacePackages(REPO_ROOT);
  const chunks: (ReturnType<typeof attributeChunk> & { kind: 'js' | 'css' })[] = [];
  const withoutMap: string[] = [];
  downloads.forEach((download, index) => {
    const url = sourceMapUrl(download.code, download.url);
    let map: unknown = url ? inlineSourceMap(url) : null;
    const body = bodies[index];
    if (!map && body) {
      try {
        map = JSON.parse(body.toString('utf8'));
      } catch {
        map = null;
      }
    }
    if (!map) {
      withoutMap.push(download.url);
      return;
    }
    chunks.push({
      kind: download.kind,
      ...attributeChunk({ url: download.url, code: download.code, map, workspace }),
    });
  });
  return {
    js: attributionSummary(chunks.filter((chunk) => chunk.kind === 'js')),
    css: attributionSummary(chunks.filter((chunk) => chunk.kind === 'css')),
    withoutMap,
    chunks,
  };
}

/** Two frames, from the page's own requestAnimationFrame as it was before the probe. */
export function nextFrames(page: Page): Promise<void> {
  return page.evaluate(
    () =>
      new Promise<void>((resolve) => {
        const frame =
          window.__portfolioTrace?.original.requestAnimationFrame ?? requestAnimationFrame;
        frame(() => frame(() => resolve()));
      }),
  );
}

/** The page's frames, the top one first. */
function framesOf(page: Page) {
  const top = page.mainFrame();
  return [top, ...page.frames().filter((frame) => frame !== top)];
}

/** Starts the probe's window in every frame. */
export async function startProbes(page: Page): Promise<void> {
  await Promise.all(
    framesOf(page).map((frame) =>
      frame.evaluate(() => window.__portfolioTrace?.start()).catch(() => undefined),
    ),
  );
}

/** Reads the probe in every frame, and adds them up (report.mjs aggregateProbes). */
export async function readProbes(page: Page) {
  const reads = await Promise.all(
    framesOf(page).map(async (frame) => ({
      url: frame.url(),
      read: await frame.evaluate(() => window.__portfolioTrace?.read() ?? null).catch(() => null),
    })),
  );
  return aggregateProbes(reads);
}

/**
 * What a case ran under: the browser, the viewport and its emulation, the
 * device pixel ratio, whether a WebGL context comes back null (it does in
 * a headless shell with no GPU), the CPU throttling, and the machine's
 * load. Read after the probe, so its own canvases count nowhere.
 */
export async function traceConditions(
  page: Page,
  browser: Browser,
  viewport: { size: string; isMobile: boolean; hasTouch: boolean },
) {
  const measured = await page.evaluate(() => ({
    dpr: window.devicePixelRatio,
    webgl: {
      webgl: document.createElement('canvas').getContext('webgl') !== null,
      webgl2: document.createElement('canvas').getContext('webgl2') !== null,
    },
  }));
  return {
    browser: `${browser.browserType().name()} ${browser.version()}`,
    viewport: viewport.size,
    isMobile: viewport.isMobile,
    hasTouch: viewport.hasTouch,
    ...measured,
    cpuThrottling: CPU_THROTTLING_RATE,
    loadAverage: Math.round(os.loadavg()[0]! * 10) / 10,
    cpus: os.availableParallelism(),
  };
}
