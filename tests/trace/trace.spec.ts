// The runtime trace (#6, Slice 1): `pnpm test:trace`. Each case loads one
// route at one viewport for one selection, in Chromium, and records:
//
// - every request from navigation to the end of the idle window, the
//   document, redirect hops, and WebSockets among them: URL, resource type,
//   kind, origin, status, and bytes (tests/harness/trace/report.mjs says
//   which);
// - long tasks from navigation to 5 s after load, with the CPU throttled 4x;
// - Content Security Policy violations, and the init script's counts of
//   frame callbacks and loops, recurring timers, canvas contexts, and running
//   infinite animations over 2 s of visible idle, unthrottled, in every frame
//   (tests/harness/trace/probe.mjs);
// - CDP Performance.getMetrics over that same idle window, report-only data
//   for #11;
// - what it ran under: browser, viewport, device pixel ratio, WebGL, load;
// - on a PORTFOLIO_ANALYZE=1 build, which ships source maps, each
//   downloaded chunk's bytes by source module and package
//   (tests/harness/trace/attribution.mjs).
//
// The trace loads the route with a GET and does nothing else: no click, no
// input, no form. fixtures.ts says how the network policy keeps it on the
// app; any request outside the app fails the case, unless
// --allow-third-party, for the baseline calibration only, lets the ones that
// got no answer through. On the app under test, the harness's egress trap
// fails a case whose server tried to reach a host. Each case attaches
// trace-case.json, which report-writer.ts gathers into
// reports/trace/trace-report.json, and its policy proves itself first in
// policy.spec.ts.
import { thirdPartyFailure } from '../harness/trace/policy.mjs';
import {
  CPU_THROTTLING_RATE,
  IDLE_WINDOW_MS,
  idleSummary,
  LONG_TASK_WINDOW_MS,
  longTaskSummary,
} from '../harness/trace/report.mjs';
import {
  attribute,
  expect,
  installProbe,
  nextFrames,
  options,
  readProbes,
  startProbes,
  test,
  traceConditions,
  watchRequests,
} from './fixtures';
import type { TraceTarget } from './targets';

/** The routes each selection is traced on. */
const ROUTES = ['/'];

/** The viewports, as the variant specs' desktop and mobile modes set them. */
const VIEWPORTS = [
  {
    size: '1440x900',
    isMobile: false,
    hasTouch: false,
    context: { viewport: { width: 1440, height: 900 } },
  },
  {
    size: '390x844',
    isMobile: true,
    hasTouch: true,
    context: { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true },
  },
] as const;

for (const route of ROUTES) {
  for (const viewport of VIEWPORTS) {
    test.describe(() => {
      test.use(viewport.context);

      test(
        `${route} at ${viewport.size}`,
        { annotation: [{ type: 'route', description: route }] },
        async ({ page, app, policy, browser }, testInfo) => {
          const target = testInfo.project.metadata as unknown as TraceTarget;
          await installProbe(page);
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
          await startProbes(page);
          const before = await cdp.send('Performance.getMetrics');
          await page.waitForTimeout(IDLE_WINDOW_MS);
          const after = await cdp.send('Performance.getMetrics');
          const probe = await readProbes(page);
          const loadEventEnd = await page.evaluate(
            () =>
              (performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming)
                ?.loadEventEnd ?? 0,
          );
          await cdp.detach();
          const conditions = await traceConditions(page, browser, viewport);
          expect(probe.visibility, 'the idle window is visible').toBe('visible');

          const { records, downloads } = await requests.done();
          const entry = {
            route,
            viewport: viewport.size,
            selection: target.selection,
            composition: target.composition,
            profile: target.profile,
            fixture: target.fixture,
            origin: app.origin,
            conditions,
            document: { status: response?.status() ?? null },
            requests: records,
            longTasks: longTaskSummary(probe.longTasks.entries, {
              loadEventEnd,
              supported: probe.longTasks.supported,
            }),
            idle: {
              ...idleSummary(before.metrics, after.metrics),
              visibility: probe.visibility,
              networkIdle,
            },
            probe,
            attribution: await attribute(page, downloads),
            // What the app under test's server tried to reach since it
            // started: the harness's egress trap refused each. An outside
            // server's egress is its own runner's evidence.
            serverEgress: options.baseUrl ? null : { attempts: app.egress() },
          };
          await testInfo.attach('trace-case.json', {
            body: JSON.stringify(entry, null, 2),
            contentType: 'application/json',
          });
          const failure = thirdPartyFailure(records, options);
          if (failure) throw new Error(failure);
        },
      );
    });
  }
}
