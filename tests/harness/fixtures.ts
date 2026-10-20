// Playwright fixtures for browser tests against the app under test.
//
//   import { test, expect } from '../harness/fixtures';
//   test.use({ appOptions: { env: { PORTFOLIO_ORIGIN: 'https://jane.test' } } });
//
// `app` is worker-scoped: every distinct `appOptions` gets its own server,
// source directory, and port. Every request the browser makes outside the app's
// origin fails, and the blocked URLs are attached to the test. A blocked
// request to a host outside EXPECTED_BLOCKED_HOSTS fails the test. The server
// itself reaches no host outside the app: any attempt it makes while a test
// runs fails that test.
import path from 'node:path';
import { test as base } from '@playwright/test';
import { startApp } from './app-server.mjs';

export { expect } from '@playwright/test';

// Outside requests a page may make today, which stay blocked: third-party
// fonts until #6 self-hosts them, and the fixtures' own .test hosts. A spec
// adds the hosts its own content names with the `blockedHosts` option.
const EXPECTED_BLOCKED_HOSTS = new Set(['fonts.googleapis.com', 'fonts.gstatic.com']);

function expectedBlock(url: string, extra: readonly string[]): boolean {
  const { hostname } = new URL(url);
  return (
    EXPECTED_BLOCKED_HOSTS.has(hostname) || extra.includes(hostname) || hostname.endsWith('.test')
  );
}

export interface AppOptions {
  /** Extra server environment. The default is read-only from `sourceDir`. */
  env?: Record<string, string>;
  /** Portfolio document copied into `sourceDir`; null for none. */
  portfolio?: string | null;
  /** The source directory's name (default `config`). */
  sourceName?: string;
}

export interface App {
  origin: string;
  port: number;
  /** The directory the server runs from, holding its build copy and `sourceDir`. */
  root: string;
  /** The server's PORTFOLIO_SOURCE_DIR unless `env` names another. */
  sourceDir: string;
  log: string;
  env: Record<string, string>;
  /** Every outside host the server tried to reach, in order (`host:port`). None got out. */
  egress: () => string[];
}

interface TestFixtures {
  /** More hosts a page may try to reach, such as the bundled sample's image host. */
  blockedHosts: readonly string[];
  /** URLs the browser tried to fetch outside the app; all were aborted. */
  blockedRequests: string[];
  /** Fails the test when the server tried to reach a host outside the app during it. */
  serverEgress: void;
}

interface WorkerFixtures {
  appOptions: AppOptions;
  app: App;
}

// Playwright's fixture callback is conventionally named `use`; it is `provide`
// here because the React Hooks lint rule mistakes `use(...)` for React's use().
export const test = base.extend<TestFixtures, WorkerFixtures>({
  appOptions: [{}, { scope: 'worker', option: true }],
  blockedHosts: [[], { option: true }],

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
    async ({ context, app, blockedHosts }, provide, testInfo) => {
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
      const unexpected = [...new Set(blocked.filter((url) => !expectedBlock(url, blockedHosts)))];
      if (unexpected.length > 0) {
        throw new Error(
          [
            `The page requested ${unexpected.length} URL(s) outside the app: ${unexpected.join(', ')}`,
            '',
            "Expected: only the app, third-party fonts, .test fixture hosts, and the spec's blockedHosts",
            `Received: ${unexpected.join(', ')}`,
          ].join('\n'),
        );
      }
    },
    { auto: true },
  ],

  serverEgress: [
    async ({ app }, provide, testInfo) => {
      const before = app.egress().length;
      await provide();
      const attempts = app.egress().slice(before);
      if (attempts.length > 0) {
        await testInfo.attach('server-egress.txt', {
          body: `${attempts.join('\n')}\n`,
          contentType: 'text/plain',
        });
        throw new Error(
          [
            `The server tried to reach ${attempts.length} host(s) outside the app: ${[...new Set(attempts)].join(', ')}`,
            '',
            'Expected: no outbound request from the server under test',
            `Received: ${attempts.join(', ')}`,
          ].join('\n'),
        );
      }
    },
    { auto: true },
  ],
});
