// The quality cells' Playwright fixtures (#11, Slice 1, items 6, 7, and
// 11), on the harness's (tests/harness/fixtures.ts):
//
// - `app` runs the cell's server from the quality build (lib/server.ts). Its
//   egress trap and socket guard catch every attempt the server makes; the
//   harness's serverEgress fails the test it happens in, and an attempt
//   still on its way after the last test fails the worker as it stops.
// - The browser reaches nothing but the app: every other request is
//   aborted and logged, and any one fails the test, with no allowlist. Until
//   the host places the fixture markers, the app's responses get them from
//   the stand-in here (lib/markers.ts).
// - The page's Date is pinned (page.clock.setFixedTime, never install), and
//   web-vitals records from before its first script.
// - Every request carries the run's canary, as a cookie, an Authorization
//   header, and a CSRF header, so a trace or log that kept one would hold
//   it, and run.ts fails the run if any artifact still does after the scrub.

import path from 'node:path';
import { test as base } from '../harness/fixtures';
import { startApp } from '../harness/app-server.mjs';
import { pinPageClock } from './lib/clock';
import { qualityWeb, runCanary } from './lib/env';
import { HOST_MARKERS, standInMarkers, type MarkedResponse } from './lib/markers';
import { appOptionsFor, type CellServer } from './lib/server';
import { recordVitals } from './lib/vitals';

export { expect } from '../harness/fixtures';

/** The cookie that carries the canary. */
export const CANARY_COOKIE = 'quality_canary';

interface QualityWorkerFixtures {
  /** The cell's server, or null for a test of the harness itself, which takes appOptions. */
  cellServer: CellServer | null;
}

interface QualityTestFixtures {
  /** Every response from the app the page got, as the marker check reads them. */
  appResponses: MarkedResponse[];
}

export const test = base.extend<QualityTestFixtures, QualityWorkerFixtures>({
  cellServer: [null, { scope: 'worker', option: true }],

  app: [
    async ({ cellServer, appOptions }, provide, workerInfo) => {
      const logFile = path.join(
        workerInfo.project.outputDir,
        `app-server-worker-${workerInfo.workerIndex}.log`,
      );
      const options = cellServer
        ? appOptionsFor(cellServer, qualityWeb(), runCanary())
        : { ...appOptions, web: appOptions.web ?? qualityWeb() };
      const app = await startApp({ ...options, logFile });
      await provide(app);
      await app.stop();
      // Read once the trap has closed, so nothing on its way in is missed.
      const attempts = app.egress();
      if (attempts.length > 0) {
        throw new Error(
          `The app under test tried to reach ${attempts.length} host(s) outside the machine: ${[...new Set(attempts)].join(', ')}`,
        );
      }
    },
    { scope: 'worker', timeout: 120_000 },
  ],

  context: async ({ context, app }, provide) => {
    const canary = runCanary();
    await context.addCookies([{ name: CANARY_COOKIE, value: canary, url: app.origin }]);
    await context.setExtraHTTPHeaders({
      authorization: `Bearer ${canary}`,
      'x-csrf-token': canary,
    });
    await provide(context);
  },

  page: async ({ page }, provide) => {
    await pinPageClock(page);
    await recordVitals(page);
    await provide(page);
  },

  // The harness's own is auto, and so is this, which replaces it.
  blockedRequests: async ({ context, app }, provide, testInfo) => {
    const blocked: string[] = [];
    const appHost = new URL(app.origin).host;
    await context.route('**/*', async (route) => {
      const url = route.request().url();
      let origin: string | null = null;
      try {
        origin = new URL(url).origin;
      } catch {
        origin = null;
      }
      if (origin !== app.origin) {
        blocked.push(url);
        return route.abort('blockedbyclient');
      }
      if (HOST_MARKERS === 'host') return route.continue();
      const response = await route.fetch({ maxRedirects: 0 });
      const { headers, body } = standInMarkers(response.headers(), await response.body());
      return route.fulfill({ status: response.status(), headers, body });
    });
    await context.routeWebSocket(/.*/, (ws) => {
      if (new URL(ws.url()).host === appHost) ws.connectToServer();
      else {
        blocked.push(ws.url());
        ws.close();
      }
    });
    await provide(blocked);
    if (blocked.length > 0) {
      await testInfo.attach('blocked-requests.txt', {
        body: `${blocked.join('\n')}\n`,
        contentType: 'text/plain',
      });
      throw new Error(
        [
          `The page requested ${blocked.length} URL(s) outside the app: ${[...new Set(blocked)].join(', ')}`,
          '',
          'Expected: no request outside the app under test',
          `Received: ${blocked.join(', ')}`,
        ].join('\n'),
      );
    }
  },

  appResponses: async ({ page, app }, provide) => {
    const seen: MarkedResponse[] = [];
    page.on('response', (response) => {
      try {
        if (new URL(response.url()).origin !== app.origin) return;
      } catch {
        return;
      }
      seen.push({ url: response.url(), status: response.status(), headers: response.headers() });
    });
    await provide(seen);
  },
});
