#!/usr/bin/env node
// Starts the Compose fixture (the image under test behind Caddy with `tls
// internal`), checks that the app answers through the proxy over verified
// HTTPS, and tears the stack down.
//
// Environment:
//   PORTFOLIO_IMAGE   the image under test (default portfolio:ci, which ci:image builds)
//   CONTAINER_CLI     docker (default) or finch
//   CONTAINER_PREFIX  Compose project name prefix (default portfolio-ci-)
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { startProxyStack } from '../tests/harness/proxy-stack.mjs';
import { assessRoutes } from './lib/container.mjs';
import {
  currentGate,
  REPO_ROOT,
  reportError,
  reportsDir,
  writeFailureRecord,
} from './lib/reports.mjs';

const image = process.env.PORTFOLIO_IMAGE || 'portfolio:ci';
const LOG = path.join(reportsDir(), 'proxy', 'compose.log');
const FIXTURE_NAME = 'Rowan Fixture';

function fail(message, fields, logs) {
  reportError(`proxy smoke: ${message}`, { title: 'proxy smoke' });
  if (logs) {
    mkdirSync(path.dirname(LOG), { recursive: true });
    writeFileSync(LOG, logs);
    console.log(`--- compose logs (${path.relative(REPO_ROOT, LOG)}) ---\n${logs}`);
  }
  const gate = currentGate();
  if (gate) {
    writeFailureRecord({
      ...gate,
      ...fields,
      asset: image,
      artifacts: logs ? ['proxy/compose.log'] : [],
    });
  }
  return 1;
}

async function main() {
  let stack;
  try {
    stack = await startProxyStack({ image });
  } catch (error) {
    return fail(error.message, { test: 'proxy stack starts' }, error.logs);
  }
  try {
    console.log(`[proxy] ${stack.project} serving ${stack.origin}`);
    const health = await stack.request('/api/health');
    console.log(
      `[proxy] GET /api/health -> ${health.status}, certificate issued by ${health.issuer}`,
    );
    if (!/Caddy Local Authority/.test(health.issuer ?? '')) {
      return fail(
        'the certificate does not come from the local CA',
        {
          test: 'proxy serves tls internal',
          expected: 'Caddy Local Authority',
          actual: health.issuer ?? 'none',
        },
        stack.logs(),
      );
    }
    const home = await stack.request('/');
    console.log(`[proxy] GET / -> ${home.status}`);
    if (home.status !== 200 || !home.body.includes(FIXTURE_NAME)) {
      return fail(
        `GET / through the proxy answered ${home.status} without the fixture`,
        {
          test: 'GET / through the proxy',
          route: '/',
          expected: `200 containing ${FIXTURE_NAME}`,
          actual: home.status,
        },
        stack.logs(),
      );
    }
    // The app's network is `internal: true`, so the app has no route out.
    // Docker enforces that; nerdctl Compose (Finch) ignores the flag, so there
    // it is only reported.
    const routes = assessRoutes(stack.exec('app', ['ip', 'route']), stack.cli === 'docker');
    if (!routes.ok) {
      return fail(
        `the app container: ${routes.message}`,
        {
          test: 'app runs on an internal network',
          expected: 'no default route',
          actual: routes.message,
        },
        stack.logs(),
      );
    }
    console.log(
      `[proxy] app: ${routes.warning ? `warning: ${stack.cli}: ${routes.warning}` : routes.message}`,
    );
    console.log(`[proxy] passed`);
    return 0;
  } finally {
    stack.stop();
  }
}

process.exit(await main());
