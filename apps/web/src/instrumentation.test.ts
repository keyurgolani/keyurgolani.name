import test from 'node:test';
import assert from 'node:assert/strict';
import { onRequestError } from './instrumentation';

// onRequestError (#1, item 21): the digest, the request ID, and the route
// pattern, and nothing from the error, the URL, or the other headers.

test('a request error logs its digest with the request ID and the route pattern', async (t) => {
  const written = t.mock.method(console, 'log', () => {});
  const error = Object.assign(new Error('canary: /srv/canary/portfolio.yml'), { digest: '2918' });
  await onRequestError(
    error,
    {
      path: '/sample?variant=canary',
      method: 'GET',
      headers: { 'x-request-id': 'req-9', cookie: 'canary-cookie', authorization: 'canary' },
    },
    {
      routerKind: 'App Router',
      routePath: '/sample',
      routeType: 'render',
      revalidateReason: undefined,
    },
  );
  assert.equal(written.mock.callCount(), 1);
  const line = String(written.mock.calls[0]!.arguments[0]);
  assert.ok(!line.includes('canary'), line);
  const { ts, ...fields } = JSON.parse(line) as Record<string, unknown>;
  assert.equal(typeof ts, 'string');
  assert.deepEqual(fields, {
    level: 'error',
    event: 'request.error',
    digest: '2918',
    requestId: 'req-9',
    route: '/sample',
  });
});

test('an error without a digest, or a request without an ID, still logs the route', async (t) => {
  const written = t.mock.method(console, 'log', () => {});
  await onRequestError(
    'canary',
    { path: '/', method: 'GET', headers: { 'x-request-id': ['a', 'b'] } },
    { routerKind: 'App Router', routePath: '/', routeType: 'render', revalidateReason: undefined },
  );
  const { ts, ...fields } = JSON.parse(String(written.mock.calls[0]!.arguments[0])) as Record<
    string,
    unknown
  >;
  assert.equal(typeof ts, 'string');
  assert.deepEqual(fields, { level: 'error', event: 'request.error', route: '/' });
});
