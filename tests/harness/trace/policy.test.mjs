import test from 'node:test';
import assert from 'node:assert/strict';
import {
  connectsWebSocket,
  decide,
  installPolicy,
  thirdPartyFailure,
  TRACE_LAUNCH_ARGS,
} from './policy.mjs';

const APP = 'http://127.0.0.1:4100';

/** A browser context that records the policy's handlers and drives them by hand. */
function fakeContext() {
  const routes = [];
  const sockets = [];
  return {
    routes,
    sockets,
    async route(pattern, handler) {
      routes.push({ pattern, handler });
    },
    async routeWebSocket(pattern, handler) {
      sockets.push({ pattern, handler });
    },
    /** Sends one request through the route handler; returns it and what the handler did. */
    async send(url, method = 'GET', resourceType = 'image') {
      const request = { url: () => url, method: () => method, resourceType: () => resourceType };
      const calls = [];
      await routes[0].handler({
        request: () => request,
        continue: async () => calls.push('continue'),
        abort: async (code) => calls.push(`abort ${code}`),
      });
      return { request, calls };
    },
    /** Opens one WebSocket through the handler; returns what the handler did. */
    openWebSocket(url) {
      const calls = [];
      sockets[0].handler({
        url: () => url,
        connectToServer: () => calls.push('connect'),
        close: () => calls.push('close'),
      });
      return calls;
    },
  };
}

test('Chromium resolves nothing but 127.0.0.1 and localhost, and uses no proxy', () => {
  assert.deepEqual(TRACE_LAUNCH_ARGS, [
    '--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE 127.0.0.1, EXCLUDE localhost',
    '--no-proxy-server',
  ]);
});

test('only a GET or HEAD on the app origin goes through', () => {
  assert.deepEqual(decide({ url: `${APP}/`, method: 'GET' }, APP), { action: 'continue' });
  assert.deepEqual(decide({ url: `${APP}/a.js`, method: 'head' }, APP), { action: 'continue' });
  for (const method of ['POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS', 'post']) {
    assert.deepEqual(
      decide({ url: `${APP}/api/portfolio`, method }, APP),
      { action: 'abort', reason: 'method' },
      method,
    );
  }
});

test('anything off the app origin is third-party, other loopback addresses and ports among them', () => {
  for (const url of [
    'https://fonts.googleapis.com/css2?family=X',
    'http://[::1]:4100/pixel.png',
    'http://localhost:4100/',
    'http://127.0.0.1:4101/',
    'https://127.0.0.1:4100/',
    'not a url',
  ]) {
    assert.deepEqual(
      decide({ url, method: 'GET' }, APP),
      { action: 'abort', reason: 'third-party' },
      url,
    );
  }
  assert.deepEqual(decide({ url: 'https://elsewhere.test/', method: 'POST' }, APP), {
    action: 'abort',
    reason: 'third-party',
  });
});

test('a WebSocket connects only on the app host', () => {
  assert.equal(connectsWebSocket('ws://127.0.0.1:4100/ws', APP), true);
  assert.equal(connectsWebSocket('ws://127.0.0.1:4101/ws', APP), false);
  assert.equal(connectsWebSocket('ws://[::1]:4100/ws', APP), false);
  assert.equal(connectsWebSocket('wss://socket.example.test/', APP), false);
  assert.equal(connectsWebSocket('nope', APP), false);
});

test('installed, the policy routes everything, aborts what it must, and says why', async () => {
  const context = fakeContext();
  const policy = await installPolicy(context, APP);
  assert.equal(context.routes[0].pattern, '**/*');
  assert.ok(
    context.sockets[0].pattern instanceof RegExp && context.sockets[0].pattern.test('ws://x/'),
  );

  const page = await context.send(`${APP}/`, 'GET', 'document');
  assert.deepEqual(page.calls, ['continue']);
  assert.equal(policy.reason(page.request), null);

  const image = await context.send('http://[::1]:4200/pixel.png');
  assert.deepEqual(image.calls, ['abort blockedbyclient']);
  assert.equal(policy.reason(image.request), 'third-party');

  const beacon = await context.send(`${APP}/beacon`, 'POST', 'ping');
  assert.deepEqual(beacon.calls, ['abort blockedbyclient']);
  assert.equal(policy.reason(beacon.request), 'method');

  assert.deepEqual(policy.aborted, [
    {
      url: 'http://[::1]:4200/pixel.png',
      method: 'GET',
      resourceType: 'image',
      reason: 'third-party',
    },
    { url: `${APP}/beacon`, method: 'POST', resourceType: 'ping', reason: 'method' },
  ]);
  // A request object the handler never saw, such as the same URL again, is matched by URL.
  const again = { url: () => `${APP}/beacon`, method: () => 'POST' };
  assert.equal(policy.reason(again), 'method');
});

test('installed, the policy connects same-host WebSockets, closes the rest, and records both', async () => {
  const context = fakeContext();
  const policy = await installPolicy(context, APP);
  assert.deepEqual(context.openWebSocket('ws://127.0.0.1:4100/ws'), ['connect']);
  assert.deepEqual(context.openWebSocket('ws://[::1]:4200/ws'), ['close']);
  assert.deepEqual(policy.websockets, [
    { url: 'ws://127.0.0.1:4100/ws', connected: true },
    { url: 'ws://[::1]:4200/ws', connected: false },
  ]);
});

const record = (url, fields = {}) => ({
  url,
  thirdParty: !url.startsWith(APP),
  aborted: null,
  failure: null,
  ...fields,
});

test('no request outside the app: no verdict either way', () => {
  const records = [record(`${APP}/`), record(`${APP}/beacon`, { aborted: 'method' })];
  assert.equal(thirdPartyFailure(records, { allowThirdParty: false }), null);
  assert.equal(thirdPartyFailure(records, { allowThirdParty: true }), null);
});

test('any request outside the app fails a trace, the ones routing never saw too', () => {
  const records = [
    record(`${APP}/`),
    record('http://[::1]:4200/pixel.png', {
      aborted: 'third-party',
      failure: 'net::ERR_BLOCKED_BY_CLIENT',
    }),
    // A redirect hop: Playwright never routes it, and it fails to resolve.
    record('http://[::1]:4200/after.png', { failure: 'net::ERR_NAME_NOT_RESOLVED' }),
    record('ws://[::1]:4200/ws', { aborted: 'third-party' }),
    record('http://[::1]:4200/pixel.png', { aborted: 'third-party' }),
  ];
  const message = thirdPartyFailure(records, { allowThirdParty: false });
  assert.match(
    message,
    /^The page requested 3 URL\(s\) outside the app: http:\/\/\[::1\]:4200\/pixel\.png, http:\/\/\[::1\]:4200\/after\.png, ws:\/\/\[::1\]:4200\/ws\n/,
  );
  assert.match(message, /Expected: no third-party request/);
  assert.equal(thirdPartyFailure(records, { allowThirdParty: true }), null);
});

test('an answer from outside fails even the baseline, which allows third-party requests', () => {
  const records = [record(`${APP}/`), record('http://[::1]:4200/after.png', { status: 200 })];
  for (const allowThirdParty of [false, true]) {
    assert.match(
      thirdPartyFailure(records, { allowThirdParty }),
      /^The page got an answer from 1 URL\(s\) outside the app: http:\/\/\[::1\]:4200\/after\.png/,
    );
  }
});
