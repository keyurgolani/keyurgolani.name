// The quality cells' Playwright fixtures (#11, Slice 1, items 6, 7, and
// 11), on the harness's (tests/harness/fixtures.ts):
//
// - `app` runs the cell's server from the quality build (lib/server.ts). Its
//   egress trap and socket guard catch every attempt the server makes;
//   serverEgress fails the test it happens in, a cell test with a record of
//   it, and an attempt still on its way after the last test fails the
//   worker as it stops.
// - The browser reaches nothing but the app: every other request is
//   aborted and logged, and any one fails the test, with no allowlist. A
//   redirect hop counts, and the request fixture follows no redirect.
// - The page's Date is pinned (page.clock.setFixedTime, never install), and
//   web-vitals records from before its first script.
// - Every request carries the run's canary, as a cookie and an Authorization
//   header, and in an anonymous cell as a CSRF header too, so a trace or log
//   that kept one would hold it, and run.ts fails the run if any artifact
//   still does after the scrub. A signed-in cell's page sends its session's
//   own CSRF token instead (cellHeaders, below).
// - A cell whose surface registers `auth: session`, such as #8's Studio,
//   loads signed in: its worker signs in once through the login API with
//   the run's owner password, the first time a cell asks, and every such
//   test's context starts with that session's cookies. The session's
//   secrets go to the scrub's list before any test runs with them.

import path from 'node:path';
import { test as base, serverEgressMessage } from '../harness/fixtures';
import { startApp } from '../harness/app-server.mjs';
import { canaryPassword } from './lib/artifacts.mjs';
import { pinPageClock } from './lib/clock';
import { CANARY_COOKIE, qualityWeb, runCanary } from './lib/env';
import {
  isolationFor,
  isolationLock,
  MAX_WAIT_MS,
  recordIsolationWait,
  runIsolationDir,
  type IsolationLock,
} from './lib/perf/isolation';
import {
  egressFailure,
  guardRequests,
  installBrowserPolicy,
  serverEgressFailure,
} from './lib/egress';
import { VIEWPORTS } from './lib/matrix';
import { failEgress } from './lib/records';
import { appOptionsFor, type CellServer } from './lib/server';
import { createAuthSession, recordSessionSecrets, type Session } from './lib/session';
import { recordVitals } from './lib/vitals';

export { expect } from '../harness/fixtures';

/** The cookie that carries the canary. */
export { CANARY_COOKIE };

/**
 * The extra headers a cell's context sends with every request: the canary as
 * Authorization, and, in an anonymous cell, as the CSRF header. Not in a
 * signed-in one: its page sends its session's own token on each command, and
 * Chromium's setExtraHTTPHeaders replaces a page's header of the same name,
 * so with the canary there every command failed ownerAuth.checkOrigin's CSRF
 * check (apps/web/src/server/owner/auth.ts) and Studio's preview never loaded.
 */
export function cellHeaders(canary: string, cellAuth: 'none' | 'session'): Record<string, string> {
  return {
    authorization: `Bearer ${canary}`,
    ...(cellAuth === 'session' ? {} : { 'x-csrf-token': canary }),
  };
}

interface QualityWorkerFixtures {
  /** The cell's server, or null for a test of the harness itself, which takes appOptions. */
  cellServer: CellServer | null;
  /** The worker's #2 test session on its server, made the first time a cell needs one. */
  ownerSession: () => Promise<Session>;
}

interface QualityTestFixtures {
  /** Whether the cell's page loads signed in: `session` for a surface that registers it. */
  cellAuth: 'none' | 'session';
  /** The run's isolation lock, held for the test: exclusive for a perf test, shared otherwise. */
  isolation: void;
}

let lock: IsolationLock | undefined;
/** The run's lock (lib/perf/isolation.ts): a perf test runs alone on its runner. */
const runIsolation = () => (lock ??= isolationLock(runIsolationDir(runCanary())));

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
      // A server's start is a burst of CPU, so none starts beside a perf test.
      const started = await runIsolation().acquire(
        `worker-${workerInfo.workerIndex}-app`,
        'shared',
      );
      let app: Awaited<ReturnType<typeof startApp>>;
      try {
        app = await startApp({ ...options, logFile });
      } finally {
        started();
      }
      await provide(app);
      await app.stop();
      // Read once the trap has closed, so nothing on its way in is missed.
      const failure = serverEgressFailure(app.egress());
      if (failure) throw new Error(failure);
    },
    // Its start may wait for a perf test, up to the lock's ceiling.
    { scope: 'worker', timeout: 120_000 + MAX_WAIT_MS },
  ],

  // Every test runs inside the lock: a perf test alone on its runner, every other test beside the
  // others but never beside a perf test. The wait isn't the test's own time, so it extends the
  // test's timeout by as much.
  isolation: [
    async ({}, provide, testInfo) => {
      const own = testInfo.timeout;
      // The wait isn't the test's own time: room for it up to the ceiling, then exactly what it took.
      if (own > 0) testInfo.setTimeout(own + MAX_WAIT_MS);
      const asked = Date.now();
      const release = await runIsolation().acquire(
        `worker-${testInfo.workerIndex}`,
        isolationFor(testInfo.file),
      );
      const waited = Date.now() - asked;
      // A test body that sets its own timeout (lib/run-cell.ts) adds this back, so it keeps the extension.
      recordIsolationWait(testInfo, waited);
      if (own > 0) testInfo.setTimeout(own + waited);
      try {
        await provide();
      } finally {
        release();
      }
    },
    { auto: true },
  ],

  context: async ({ context, app, cellAuth, ownerSession }, provide) => {
    const canary = runCanary();
    await context.addCookies([{ name: CANARY_COOKIE, value: canary, url: app.origin }]);
    if (cellAuth === 'session') {
      await context.addCookies([...(await ownerSession()).storageState.cookies]);
    }
    await context.setExtraHTTPHeaders(cellHeaders(canary, cellAuth));
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
    // A cell test's egress is a record of its own, which no records list may name.
    if (failure) {
      await failEgress(testInfo, VIEWPORTS, {
        file: 'blocked-requests.txt',
        attempts: blocked,
        rule: 'browser-egress',
        actual: failure,
        message: failure,
      });
    }
  },

  // The harness's own is auto, and so is this, which replaces it: a cell test's server egress is
  // a record of its own too, as its browser's is. The app fixture's late check, as the worker
  // stops, has no test to attach one to: its error blocks a listed test by the count alone.
  serverEgress: async ({ app }, provide, testInfo) => {
    const before = app.egress().length;
    await provide();
    const attempts = app.egress().slice(before);
    if (attempts.length > 0) {
      const message = serverEgressMessage(attempts);
      await failEgress(testInfo, VIEWPORTS, {
        file: 'server-egress.txt',
        attempts,
        rule: 'server-egress',
        actual: message.split('\n')[0]!,
        message,
      });
    }
  },
});
