// The quality cells' Playwright fixtures (#11, Slice 1, items 6, 7, and
// 11), on the harness's (tests/harness/fixtures.ts):
//
// - `app` runs the cell's server from the quality build (lib/server.ts). Its
//   egress trap and socket guard catch every attempt the server makes; the
//   harness's serverEgress fails the test it happens in, and an attempt
//   still on its way after the last test fails the worker as it stops.
// - The browser reaches nothing but the app: every other request is
//   aborted and logged, and any one fails the test, with no allowlist. A
//   redirect hop counts, and the request fixture follows no redirect.
// - The page's Date is pinned (page.clock.setFixedTime, never install), and
//   web-vitals records from before its first script.
// - Every request carries the run's canary, as a cookie, an Authorization
//   header, and a CSRF header, so a trace or log that kept one would hold
//   it, and run.ts fails the run if any artifact still does after the scrub.
// - A cell whose surface registers `auth: session`, such as #8's Studio,
//   loads signed in: its worker signs in once through the login API with
//   the run's owner password, the first time a cell asks, and every such
//   test's context starts with that session's cookies. The session's
//   secrets go to the scrub's list before any test runs with them.

import path from 'node:path';
import { test as base } from '../harness/fixtures';
import { startApp } from '../harness/app-server.mjs';
import { canaryPassword } from './lib/artifacts.mjs';
import { pinPageClock } from './lib/clock';
import { CANARY_COOKIE, qualityWeb, runCanary } from './lib/env';
import {
  egressFailure,
  guardRequests,
  installBrowserPolicy,
  serverEgressFailure,
} from './lib/egress';
import { appOptionsFor, type CellServer } from './lib/server';
import { createAuthSession, recordSessionSecrets, type Session } from './lib/session';
import { recordVitals } from './lib/vitals';

export { expect } from '../harness/fixtures';

/** The cookie that carries the canary. */
export { CANARY_COOKIE };

interface QualityWorkerFixtures {
  /** The cell's server, or null for a test of the harness itself, which takes appOptions. */
  cellServer: CellServer | null;
  /** The worker's #2 test session on its server, made the first time a cell needs one. */
  ownerSession: () => Promise<Session>;
}

interface QualityTestFixtures {
  /** Whether the cell's page loads signed in: `session` for a surface that registers it. */
  cellAuth: 'none' | 'session';
}

export const test = base.extend<QualityTestFixtures, QualityWorkerFixtures>({
  cellServer: [null, { scope: 'worker', option: true }],
  cellAuth: ['none', { option: true }],

  ownerSession: [
    async ({ app }, provide) => {
      let made: Promise<Session> | undefined;
      await provide(() => {
        made ??= createAuthSession({
          origin: app.origin,
          password: canaryPassword(runCanary()),
        }).then((session) => {
          // The scrub knows its secrets before any test runs with them.
          recordSessionSecrets(session, process.env.QUALITY_SECRETS_FILE);
          return session;
        });
        return made;
      });
    },
    { scope: 'worker' },
  ],

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

  context: async ({ context, app, cellAuth, ownerSession }, provide) => {
    const canary = runCanary();
    await context.addCookies([{ name: CANARY_COOKIE, value: canary, url: app.origin }]);
    if (cellAuth === 'session') {
      await context.addCookies([...(await ownerSession()).storageState.cookies]);
    }
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

  // Follows no redirect, and fails a 3xx that leaves the app.
  request: async ({ request, app }, provide) => {
    await provide(guardRequests(request, app.origin));
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
