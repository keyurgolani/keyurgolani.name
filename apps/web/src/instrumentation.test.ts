import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { onRequestError } from './instrumentation';

// onRequestError (#1, item 21): the digest, the request ID, and the route
// pattern, and nothing from the error, the URL, or the other headers. Next
// reports a page's route path as its file path (`/page`, `/[...view]/page`),
// and a route handler's as `/api/ready/route` or already as `/api/ready`.

/** The one line onRequestError writes for an error at Next's `routePath`, without its time. */
async function logged(
  t: TestContext,
  routePath: string,
  routeType: 'render' | 'route',
): Promise<Record<string, unknown>> {
  const written = t.mock.method(console, 'log', () => {});
  await onRequestError(
    Object.assign(new Error('x'), { digest: '7' }),
    { path: '/', method: 'GET', headers: {} },
    { routerKind: 'App Router', routePath, routeType, revalidateReason: undefined },
  );
  const { ts, ...fields } = JSON.parse(String(written.mock.calls.at(-1)!.arguments[0])) as Record<
    string,
    unknown
  >;
  written.mock.restore();
  assert.equal(typeof ts, 'string');
  return fields;
}

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
      routePath: '/sample/[[...path]]/page',
      routeType: 'render',
      renderSource: 'react-server-components',
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
    route: '/sample/[[...path]]',
  });
});

test('an error without a digest, or a request without an ID, still logs the route', async (t) => {
  const written = t.mock.method(console, 'log', () => {});
  await onRequestError(
    'canary',
    { path: '/', method: 'GET', headers: { 'x-request-id': ['a', 'b'] } },
    {
      routerKind: 'App Router',
      routePath: '/page',
      routeType: 'render',
      revalidateReason: undefined,
    },
  );
  const { ts, ...fields } = JSON.parse(String(written.mock.calls[0]!.arguments[0])) as Record<
    string,
    unknown
  >;
  assert.equal(typeof ts, 'string');
  assert.deepEqual(fields, { level: 'error', event: 'request.error', route: '/' });
});

test('the route is the table pattern, whatever form of route path Next reports', async (t) => {
  const cases: [routePath: string, routeType: 'render' | 'route', route: string][] = [
    ['/page', 'render', '/'],
    ['/sample/[[...path]]/page', 'render', '/sample/[[...path]]'],
    ['/[...view]/page', 'render', '/[...view]'],
    ['/work/[slug]/[...view]/page', 'render', '/work/[slug]/[...view]'],
    ['/api/studio/[name]/route', 'route', '/api/studio/[name]'],
    ['/api/ready', 'route', '/api/ready'],
    ['/(site)/opengraph-image-12o0cb/route', 'route', '/opengraph-image-12o0cb'],
    ['/(site)/page', 'render', '/'],
    ['/(studio)/studio/sign-in/page', 'render', '/studio/sign-in'],
  ];
  for (const [routePath, routeType, route] of cases) {
    assert.equal((await logged(t, routePath, routeType)).route, route, routePath);
  }
});
