// The trace's network policy, proved on loopback before any trace runs (#6,
// Slice 1). Two stand-in servers: the app on 127.0.0.1, and a third party on
// [::1], which is still this machine but another origin, and which no rule
// lets Chromium resolve. The app's page asks for everything the policy has
// to stop: an image from the third party, a same-origin link that redirects
// to it (Playwright never routes a redirect hop), a beacon and a POST, and a
// WebSocket to each. The third party must hear nothing, the app must get no
// POST, and every request outside the app must be on the record, so the
// verdict can fail the case. Weaken any layer, and a check here fails:
// routing (the image gets through to the resolver, unaborted), the method
// rule (the app hears a POST), or Chromium's flags (the stand-in hears the
// redirect hop).
import crypto from 'node:crypto';
import { once } from 'node:events';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import type { Duplex } from 'node:stream';
import { thirdPartyFailure, TRACE_LAUNCH_ARGS } from '../harness/trace/policy.mjs';
import { expect, outsideServer, test as trace, watchRequests } from './fixtures';

interface StandIn {
  readonly origin: string;
  /** Every request and WebSocket upgrade it got, as `METHOD /path`. */
  readonly hits: string[];
  close(): Promise<void>;
}

/** An HTTP and WebSocket server on `host`, answering with `handle`, that records every hit. */
async function standIn(
  host: string,
  handle: (request: http.IncomingMessage, response: http.ServerResponse) => void,
): Promise<StandIn> {
  const hits: string[] = [];
  // An upgraded socket leaves the server's connections, so closing it is ours to do.
  const upgraded = new Set<Duplex>();
  const server = http.createServer((request, response) => {
    hits.push(`${request.method} ${request.url}`);
    handle(request, response);
  });
  server.on('upgrade', (request, socket) => {
    hits.push(`UPGRADE ${request.url}`);
    upgraded.add(socket);
    socket.on('close', () => upgraded.delete(socket));
    socket.on('error', () => {});
    const accept = crypto
      .createHash('sha1')
      .update(`${request.headers['sec-websocket-key']}258EAFA5-E914-47DA-95CA-C5AB0DC85B11`)
      .digest('base64');
    socket.write(
      [
        'HTTP/1.1 101 Switching Protocols',
        'Upgrade: websocket',
        'Connection: Upgrade',
        `Sec-WebSocket-Accept: ${accept}`,
        '',
        '',
      ].join('\r\n'),
    );
  });
  server.listen(0, host);
  await once(server, 'listening');
  const { port } = server.address() as AddressInfo;
  return {
    origin: `http://${host.includes(':') ? `[${host}]` : host}:${port}`,
    hits,
    close: () =>
      new Promise<void>((resolve) => {
        for (const socket of upgraded) socket.destroy();
        server.closeAllConnections();
        server.close(() => resolve());
      }),
  };
}

const ws = (origin: string) => origin.replace(/^http/, 'ws');

/** The app's page: everything the policy has to stop, and one WebSocket it lets through. */
function page(app: string, outside: string): string {
  return `<!doctype html>
<html lang="en"><head><title>Policy</title></head><body>
<img src="${outside}/pixel.png" alt="">
<img src="/hop" alt="">
<script>
  navigator.sendBeacon('/beacon', 'x');
  fetch('/post', { method: 'POST', body: 'x' }).catch(() => {});
  window.sockets = [new WebSocket('${ws(app)}/ws'), new WebSocket('${ws(outside)}/ws')];
</script>
</body></html>`;
}

const test = trace.extend<object, { servers: { app: StandIn; outside: StandIn } }>({
  servers: [
    async ({}, provide) => {
      const outside = await standIn('::1', (_request, response) => response.end('outside'));
      const app = await standIn('127.0.0.1', (request, response) => {
        if (request.url === '/') {
          response.setHeader('content-type', 'text/html');
          response.end(page(app.origin, outside.origin));
        } else if (request.url === '/hop') {
          response.statusCode = 302;
          response.setHeader('location', `${outside.origin}/after.png`);
          response.end();
        } else {
          response.statusCode = 204;
          response.end();
        }
      });
      await provide({ app, outside });
      await app.close();
      await outside.close();
    },
    { scope: 'worker' },
  ],
  app: [
    async ({ servers }, provide) => {
      await provide(outsideServer(servers.app.origin));
    },
    { scope: 'worker' },
  ],
});

test('the policy lets the app through and records everything else, redirect hops and WebSockets too', async ({
  page: tab,
  policy,
  servers,
}, testInfo) => {
  const { app, outside } = servers;
  const requests = watchRequests(tab, app.origin, policy);
  requests.markNavigation();
  await tab.goto('/', { waitUntil: 'load' });
  await expect.poll(() => policy.websockets.length).toBe(2);
  await tab.waitForLoadState('networkidle');
  const { records } = await requests.done();
  await testInfo.attach('records.json', {
    body: JSON.stringify({ records, app: app.hits, outside: outside.hits }, null, 2),
    contentType: 'application/json',
  });
  const find = (url: string) => records.filter((record) => record.url === url);

  // Routing aborts a third-party request it sees.
  expect(find(`${outside.origin}/pixel.png`)).toMatchObject([
    {
      thirdParty: true,
      aborted: 'third-party',
      failure: expect.stringMatching(/^net::ERR_BLOCKED_BY_CLIENT/),
    },
  ]);
  // A redirect hop routing never sees resolves nowhere, and is on the record.
  expect(find(`${app.origin}/hop`)).toMatchObject([{ thirdParty: false, status: 302 }]);
  expect(find(`${outside.origin}/after.png`)).toMatchObject([
    { thirdParty: true, aborted: null, failure: 'net::ERR_NAME_NOT_RESOLVED' },
  ]);
  // Nothing but GET and HEAD reaches the app: not a beacon, not a POST.
  expect(find(`${app.origin}/beacon`)).toMatchObject([{ method: 'POST', aborted: 'method' }]);
  expect(find(`${app.origin}/post`)).toMatchObject([{ method: 'POST', aborted: 'method' }]);
  // A WebSocket connects on the app's own host only, and both are requests.
  expect(find(`${ws(app.origin)}/ws`)).toMatchObject([
    { kind: 'websocket', thirdParty: false, aborted: null },
  ]);
  expect(find(`${ws(outside.origin)}/ws`)).toMatchObject([
    { kind: 'websocket', thirdParty: true, aborted: 'third-party' },
  ]);

  // The verdict fails a trace on all three, and lets the baseline record them.
  expect(thirdPartyFailure(records, { allowThirdParty: false })).toMatch(
    /^The page requested 3 URL\(s\) outside the app/,
  );
  expect(thirdPartyFailure(records, { allowThirdParty: true })).toBeNull();

  // What the servers heard: the app, its own GETs and its WebSocket; the third party, nothing.
  expect(app.hits.filter((hit) => !/^(?:GET|UPGRADE) /.test(hit))).toEqual([]);
  expect(app.hits).toContain('UPGRADE /ws');
  expect(outside.hits).toEqual([]);
});

test('every trace launches Chromium with the policy flags', async ({}, testInfo) => {
  expect(testInfo.project.use.launchOptions?.args).toEqual(
    expect.arrayContaining(TRACE_LAUNCH_ARGS),
  );
});
