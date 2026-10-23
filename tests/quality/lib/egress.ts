// The quality cells' browser policy (#11, Slice 1, item 7): the page reaches
// the app under test and nothing else. Every request to another origin, and
// every WebSocket to another host, is aborted and listed, and any one fails
// the cell: there's no allowlist. Chromium itself also resolves no name but
// loopback (tests/harness/trace/policy.mjs's TRACE_LAUNCH_ARGS, which the
// quality config launches with). Routing sees only a request's first URL,
// so every request the context makes is listed too: a redirect hop to
// another origin fails the cell, even though Chromium can't resolve it.
// The `request` fixture follows no redirect (guardRequests), so an API call
// can't be sent off the machine by a 3xx either.

import type { APIRequestContext, APIResponse, BrowserContext } from '@playwright/test';

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
  const block = (url: string) => {
    if (!blocked.includes(url)) blocked.push(url);
  };
  const appHost = new URL(appOrigin).host;
  await context.route('**/*', async (route) => {
    const url = route.request().url();
    if (originOf(url) !== appOrigin) {
      block(url);
      return route.abort('blockedbyclient');
    }
    return route.continue();
  });
  // Every request, a redirect's next hop included, which routing never sees.
  context.on('request', (request) => {
    const url = request.url();
    if (/^(?:https?|wss?):/.test(url) && originOf(url) !== appOrigin) block(url);
  });
  await context.routeWebSocket(/.*/, (ws) => {
    if (new URL(ws.url()).host === appHost) ws.connectToServer();
    else {
      block(ws.url());
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

const REQUEST_METHODS = ['fetch', 'get', 'post', 'put', 'patch', 'delete', 'head'] as const;

/** Whether `location`, resolved against `base`, stays on `base`'s origin. */
function staysOn(base: string, location: string): boolean {
  try {
    return new URL(location, base).origin === new URL(base).origin;
  } catch {
    return false;
  }
}

/**
 * `request` with redirects off: each call follows none, and a 3xx whose
 * Location leaves the app throws, naming it. A test that wants the redirect
 * reads the response's Location itself.
 */
export function guardRequests<T extends Pick<APIRequestContext, (typeof REQUEST_METHODS)[number]>>(
  request: T,
  appOrigin: string,
): T {
  return new Proxy(request, {
    get(target, property, receiver) {
      const value = Reflect.get(target, property, receiver) as unknown;
      if (!(REQUEST_METHODS as readonly PropertyKey[]).includes(property)) return value;
      const method = value as (url: unknown, options?: object) => Promise<APIResponse>;
      return async (url: unknown, options: object = {}) => {
        const response = await method.call(target, url, { ...options, maxRedirects: 0 });
        const location = response.headers()['location'];
        if (response.status() >= 300 && response.status() < 400 && location) {
          if (!staysOn(response.url() || appOrigin, location)) {
            throw new Error(
              `${response.url()} redirected outside the app, to ${location}, and the request fixture follows no redirect.`,
            );
          }
        }
        return response;
      };
    },
  });
}
