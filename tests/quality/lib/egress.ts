// The quality cells' browser policy (#11, Slice 1, item 7): the page reaches
// the app under test and nothing else. Every request to another origin, and
// every WebSocket to another host, is aborted and listed, and any one fails
// the cell: there's no allowlist. Chromium itself also resolves no name but
// loopback (tests/harness/trace/policy.mjs's TRACE_LAUNCH_ARGS, which the
// quality config launches with), so what routing never sees, such as a
// redirect hop, fails to resolve instead of leaving the machine.

import type { BrowserContext } from '@playwright/test';

/** `url`'s origin, or null for one that doesn't parse. */
function originOf(url: string): string | null {
  try {
    return new URL(url).origin;
  } catch {
    return null;
  }
}

/**
 * Installs the policy on `context` for the app at `appOrigin`, and returns
 * the list it adds each blocked URL to.
 */
export async function installBrowserPolicy(
  context: BrowserContext,
  appOrigin: string,
): Promise<string[]> {
  const blocked: string[] = [];
  const appHost = new URL(appOrigin).host;
  await context.route('**/*', async (route) => {
    const url = route.request().url();
    if (originOf(url) !== appOrigin) {
      blocked.push(url);
      return route.abort('blockedbyclient');
    }
    return route.continue();
  });
  await context.routeWebSocket(/.*/, (ws) => {
    if (new URL(ws.url()).host === appHost) ws.connectToServer();
    else {
      blocked.push(ws.url());
      ws.close();
    }
  });
  return blocked;
}

/** The failure for what the policy blocked, or null when it blocked nothing. */
export function egressFailure(blocked: readonly string[]): string | null {
  if (blocked.length === 0) return null;
  return [
    `The page requested ${blocked.length} URL(s) outside the app: ${[...new Set(blocked)].join(', ')}`,
    '',
    'Expected: no request outside the app under test',
    `Received: ${blocked.join(', ')}`,
  ].join('\n');
}

/** The failure for the hosts the app's server tried to reach, or null when it tried none. */
export function serverEgressFailure(attempts: readonly string[]): string | null {
  if (attempts.length === 0) return null;
  return `The app under test tried to reach ${attempts.length} host(s) outside the machine: ${[...new Set(attempts)].join(', ')}`;
}
