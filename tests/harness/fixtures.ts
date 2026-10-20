// Playwright fixtures for browser tests against the app under test.
//
//   import { test, expect } from '../harness/fixtures';
//   test.use({ appOptions: { env: { SOME_SETTING: 'value' } } });
//
// `app` is worker-scoped: every distinct `appOptions` gets its own server, data
// directory, and port. Every request the browser makes outside the app's
// origin fails (third-party fonts and images included), and the blocked URLs
// are attached to the test.
import path from 'node:path';
import { test as base } from '@playwright/test';
import { startApp } from './app-server.mjs';

export { expect } from '@playwright/test';

export interface AppOptions {
  /** Extra server environment, such as a deployment profile. */
  env?: Record<string, string>;
  /** Portfolio file mounted as <dataDir>/portfolio.yml; null for none. */
  portfolio?: string | null;
}

export interface App {
  origin: string;
  port: number;
  dataDir: string;
  log: string;
  env: Record<string, string>;
}

interface TestFixtures {
  /** URLs the browser tried to fetch outside the app; all were aborted. */
  blockedRequests: string[];
}

interface WorkerFixtures {
  appOptions: AppOptions;
  app: App;
}

// Playwright's fixture callback is conventionally named `use`; it is `provide`
// here because the React Hooks lint rule mistakes `use(...)` for React's use().
export const test = base.extend<TestFixtures, WorkerFixtures>({
  appOptions: [{}, { scope: 'worker', option: true }],

  app: [
    async ({ appOptions }, provide, workerInfo) => {
      const logFile = path.join(
        workerInfo.project.outputDir,
        `app-server-worker-${workerInfo.workerIndex}.log`,
      );
      const app = await startApp({ ...appOptions, logFile });
      await provide(app);
      await app.stop();
    },
    { scope: 'worker', timeout: 120_000 },
  ],

  baseURL: async ({ app }, provide) => {
    await provide(app.origin);
  },

  blockedRequests: [
    async ({ context, app }, provide, testInfo) => {
      const blocked: string[] = [];
      const appHost = new URL(app.origin).host;
      await context.route('**/*', (route) => {
        const url = route.request().url();
        if (new URL(url).origin === app.origin) return route.continue();
        blocked.push(url);
        return route.abort('blockedbyclient');
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
      }
    },
    { auto: true },
  ],
});
