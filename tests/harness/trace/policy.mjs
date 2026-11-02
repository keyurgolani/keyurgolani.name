// pnpm test:trace's network policy (#6, Slice 1). Three layers keep a trace
// from reaching any host but the app:
//
// 1. Routing. Every request the browser routes is let through only when it's
//    a GET or HEAD on the app's own origin; anything else is aborted and
//    recorded with why. A WebSocket connects only on the app's own host.
// 2. Chromium itself (TRACE_LAUNCH_ARGS) resolves no name but 127.0.0.1 and
//    localhost, and uses no proxy, so what routing never sees, such as a
//    redirect hop (Playwright routes only a redirect's first URL), fails to
//    resolve instead of leaving the machine.
// 3. The verdict (thirdPartyFailure) reads every request the page made,
//    redirect hops and WebSockets among them: any one outside the app fails
//    the case, and with --allow-third-party, for the baseline calibration
//    only, one that got a response still fails it.

/** Chromium's flags for every trace: no name but loopback resolves, and no proxy is used. */
export const TRACE_LAUNCH_ARGS = [
  '--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE 127.0.0.1, EXCLUDE localhost',
  '--no-proxy-server',
];

/** The methods a trace lets through: it loads pages and submits nothing. */
const SAFE_METHODS = new Set(['GET', 'HEAD']);

/** `url`'s origin, or null for one that doesn't parse. */
function originOf(url) {
  try {
    return new URL(url).origin;
  } catch {
    return null;
  }
}

/**
 * What the policy does with one routed request.
 *
 * @param {{ url: string, method: string }} request
 * @param {string} appOrigin
 * @returns {{ action: 'continue' } | { action: 'abort', reason: 'third-party' | 'method' }}
 */
export function decide(request, appOrigin) {
  if (originOf(request.url) !== appOrigin) return { action: 'abort', reason: 'third-party' };
  if (!SAFE_METHODS.has(request.method.toUpperCase())) return { action: 'abort', reason: 'method' };
  return { action: 'continue' };
}

/** Whether a WebSocket to `url` may connect: only on the app's own host and port. */
export function connectsWebSocket(url, appOrigin) {
  try {
    return new URL(url).host === new URL(appOrigin).host;
  } catch {
    return false;
  }
}

/**
 * Installs the policy on a browser context (Playwright's BrowserContext, or
 * anything with its route and routeWebSocket). Returns why it aborted a
 * request, every request it aborted, and every WebSocket the page opened,
 * which the trace records as requests.
 *
 * @param {any} context
 * @param {string} appOrigin
 */
export async function installPolicy(context, appOrigin) {
  const reasons = new WeakMap();
  const aborted = [];
  const websockets = [];
  await context.route('**/*', (route) => {
    const request = route.request();
    const verdict = decide({ url: request.url(), method: request.method() }, appOrigin);
    if (verdict.action === 'continue') return route.continue();
    reasons.set(request, verdict.reason);
    aborted.push({
      url: request.url(),
      method: request.method(),
      resourceType: request.resourceType(),
      reason: verdict.reason,
    });
    return route.abort('blockedbyclient');
  });
  await context.routeWebSocket(/.*/, (ws) => {
    const url = ws.url();
    const connected = connectsWebSocket(url, appOrigin);
    websockets.push({ url, connected });
    if (connected) ws.connectToServer();
    else ws.close();
  });
  return {
    /** Why the policy aborted `request`, or null when it let it through. */
    reason: (request) =>
      reasons.get(request) ??
      aborted.find((entry) => entry.url === request.url() && entry.method === request.method())
        ?.reason ??
      null,
    aborted,
    websockets,
  };
}

/**
 * Why a case fails on its requests, or null when it doesn't. Every request
 * outside the app fails it, whatever happened to it: aborted, failed to
 * resolve, or answered. With `allowThirdParty`, only one that was answered
 * does: its bytes came from outside.
 *
 * @param {{ url: string, thirdParty: boolean, aborted: string | null, failure: string | null }[]} records
 * @param {{ allowThirdParty: boolean }} options
 */
export function thirdPartyFailure(records, { allowThirdParty }) {
  const outside = records.filter((record) => record.thirdParty);
  const answered = outside.filter((record) => record.aborted === null && record.failure === null);
  const list = (entries) => [...new Set(entries.map((record) => record.url))];
  if (answered.length > 0) {
    const urls = list(answered);
    return [
      `The page got an answer from ${urls.length} URL(s) outside the app: ${urls.join(', ')}`,
      '',
      'Expected: no request outside the app is answered',
      `Received: ${urls.join(', ')}`,
    ].join('\n');
  }
  if (outside.length > 0 && !allowThirdParty) {
    const urls = list(outside);
    return [
      `The page requested ${urls.length} URL(s) outside the app: ${urls.join(', ')}`,
      '',
      'Expected: no third-party request (only a --base-url trace may pass --allow-third-party)',
      `Received: ${urls.join(', ')}`,
    ].join('\n');
  }
  return null;
}
