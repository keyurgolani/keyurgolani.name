// The quality cells' Playwright fixtures (#11, Slice 1, items 6, 7, and
// 11), on the harness's (tests/harness/fixtures.ts):
//
// - `app` runs the cell's server from the quality build (lib/server.ts). Its
//   egress trap and socket guard catch every attempt the server makes; the
//   harness's serverEgress fails the test it happens in, and an attempt
//   still on its way after the last test fails the worker as it stops.
// - The browser reaches nothing but the app: every other request is
//   aborted and logged, and any one fails the test, with no allowlist.
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
import { egressFailure, installBrowserPolicy, serverEgressFailure } from './lib/egress';
import { appOptionsFor, type CellServer } from './lib/server';
import { recordVitals } from './lib/vitals';

export { expect } from '../harness/fixtures';

/** The cookie that carries the canary. */
export const CANARY_COOKIE = 'quality_canary';

interface QualityWorkerFixtures {
  /** The cell's server, or null for a test of the harness itself, which takes appOptions. */
  cellServer: CellServer | null;
}

export const test = base.extend<Record<never, never>, QualityWorkerFixtures>({
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
      const failure = serverEgressFailure(app.egress());
      if (failure) throw new Error(failure);
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
    const blocked = await installBrowserPolicy(context, app.origin);
    await provide(blocked);
    const failure = egressFailure(blocked);
    if (failure) {
      await testInfo.attach('blocked-requests.txt', {
        body: `${blocked.join('\n')}\n`,
        contentType: 'text/plain',
      });
      throw new Error(failure);
    }
  },
});
