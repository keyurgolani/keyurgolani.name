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
//   (tests/harness/trace/attribution.mjs);
// - on the app under test, the purity assertion's verdict (#6, Slice 2):
//   from the document's HTML and RSC payload, the settled DOM, and the
//   attribution of every chunk the page downloaded or its document names,
//   whether the page loads or names anything but the selected units and
//   experience-base.css, a forbidden module, a third-party file, or a link
//   to Studio (tests/harness/trace/purity.mjs). It needs source maps, so
//   it fails on a build without them.
//
// A second test per selection loads the public pages / links to, and a
// 404 page, once each at the desktop viewport, and holds each to the same
// assertion; its pages go into the report's `purity` list.
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
import { createRequire } from 'node:module';
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
  linkedPages,
  nextFrames,
  options,
  purityOf,
  readProbes,
  startProbes,
  test,
  traceConditions,
  watchRequests,
} from './fixtures';
import type { TraceTarget } from './targets';
import type * as WorkPage from '../../apps/web/src/lib/work-page';
import { REGISTERED } from '../variants/target';

// apps/web has no "type": "module", so its modules are CommonJS to Node and
// load through require(). The work page's rule is the app's own (#10b).
const { pageComposition } = createRequire(import.meta.url)(
  '../../apps/web/src/lib/work-page.ts',
) as typeof WorkPage;

/**
 * The composition `route` renders in when `composition` is selected: the
 * fallback composition's on a work's own page that `composition` leaves to
 * the host, by its manifest's routes.work (#10b), and its own on every other.
 */
function compositionOf(composition: string, route: string): string {
  const variant = REGISTERED.find(({ manifest }) => manifest.id === composition);
  if (!variant) throw new Error(`The build registers no variant ${composition}.`);
  const segments = new URL(route, 'http://trace.test').pathname
    .split('/')
    .filter((segment) => segment !== '')
    .map((segment) => decodeURIComponent(segment));
  return pageComposition(variant.manifest, segments);
}

/** The routes each selection is traced on. */
const ROUTES = ['/'];

/** How many of the pages / links to the purity test loads, in path order, besides / and a 404. */
const LINKED_PAGES = 12;

/** A path no route matches, whose 404 page renders in the site's boundary. */
const NOT_FOUND = '/no-such-page';

/** The purity assertion's problems as one error, page by page. */
function impurity(pages: readonly { route: string; problems: readonly string[] }[]): string | null {
  const lines = pages.flatMap(({ route, problems }) =>
    problems.map((problem) => `${route}: ${problem}`),
  );
  return lines.length === 0
    ? null
    : `The public pages aren't pure (#6, Slice 2):\n- ${lines.join('\n- ')}`;
}

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
          const html = (await response?.text()) ?? '';
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
          const attribution = await attribute(page, downloads);
          const appOrigin = new URL(app.origin).origin;
          const purity = target.composition
            ? await purityOf(page, {
                html,
                composition: target.composition,
                appOrigin,
                records,
                downloads,
                attribution,
              })
            : null;
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
            attribution,
            purity,
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
          const impure = purity ? impurity([{ route, problems: purity.problems }]) : null;
          if (impure) throw new Error(impure);
        },
      );
    });
  }
}

test(
  'every public page / links to, and a 404 page, loads and names nothing but the selected units and experience-base.css (#6, Slice 2)',
  { annotation: [{ type: 'route', description: 'the pages / links to, and a 404' }] },
  async ({ page, app, policy }, testInfo) => {
    const target = testInfo.project.metadata as unknown as TraceTarget;
    test.skip(!target.composition, 'an outside server: the trace knows no selection to hold it to');
    const appOrigin = new URL(app.origin).origin;
    const home = await page.goto('/', { waitUntil: 'load' });
    expect(home?.status(), 'GET /').toBe(200);
    // What / loads after it hydrates, such as an island's enhancement, is
    // its own, so it settles before the next page's requests count.
    await page.waitForLoadState('networkidle', { timeout: 15_000 }).catch(() => undefined);
    const linked = (await linkedPages(page, appOrigin)).slice(0, LINKED_PAGES);
    const pages = [];
    for (const route of [...linked, NOT_FOUND]) {
      const requests = watchRequests(page, appOrigin, policy);
      requests.markNavigation();
      const response = await page.goto(route, { waitUntil: 'load' });
      await page.waitForLoadState('networkidle', { timeout: 15_000 }).catch(() => undefined);
      const html = (await response?.text()) ?? '';
      const { records, downloads } = await requests.done();
      const attribution = await attribute(page, downloads);
      // Each page is held to the one composition that renders it: a shared
      // variant's work page to the fallback's units and none of its own.
      const composition = compositionOf(target.composition!, route);
      const verdict = await purityOf(page, {
        html,
        composition,
        appOrigin,
        records,
        downloads,
        attribution,
      });
      pages.push({ route, composition, status: response?.status() ?? null, ...verdict });
    }
    await testInfo.attach('purity-pages.json', {
      body: JSON.stringify(
        {
          selection: target.selection,
          composition: target.composition,
          profile: target.profile,
          fixture: target.fixture,
          pages,
        },
        null,
        2,
      ),
      contentType: 'application/json',
    });
    for (const { route, status } of pages) {
      expect(status, `GET ${route}`).toBe(route === NOT_FOUND ? 404 : 200);
    }
    const impure = impurity(pages);
    if (impure) throw new Error(impure);
  },
);
