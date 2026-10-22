import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parsePortfolio, parseSite } from '@portfolio/schema';
import type { CatalogReader } from '~/server/catalog-port';
import { readDeploymentConfig } from '~/server/config';
import { setDeploymentState } from '~/server/config-store';
import { GET } from './route';

// When the feed can't be built, the response body stays fixed, plus the
// request ID proxy.ts set. The log names the request and the step that
// failed, with a fixed code, and never the cause, which can carry a path.

function deploy(t: TestContext, getLive: CatalogReader['getLive']): void {
  const read = readDeploymentConfig(
    {
      NODE_ENV: 'production',
      PORTFOLIO_PROFILE: 'read-only',
      PORTFOLIO_ORIGIN: 'https://rowan.test',
      PORTFOLIO_SOURCE_DIR: '/srv/canary-config',
    },
    { cwd: '/' },
  );
  assert.ok(read.ok, JSON.stringify(read.issues));
  setDeploymentState({
    config: read.config,
    catalog: { getLive },
    dispatch: () => assert.fail('the feed runs no operation'),
    degraded: [],
  });
  t.after(() => setDeploymentState(undefined));
}

const request = () =>
  new Request('https://rowan.test/feed.xml', { headers: { 'x-request-id': 'req-0001' } });

test('a catalog that fails gives a fixed 500 and logs the request, not the cause', async (t) => {
  const logged = t.mock.method(console, 'log', () => {});
  deploy(t, () =>
    Promise.reject(
      new Error('canary: /srv/canary-config/portfolio.yml: /identity/name is required'),
    ),
  );
  const response = await GET(request());
  assert.equal(response.status, 500);
  assert.equal(await response.text(), 'Feed unavailable. Request ID: req-0001');
  assert.equal(response.headers.get('content-type'), 'text/plain; charset=utf-8');
  assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.equal(logged.mock.callCount(), 1);
  const line = String(logged.mock.calls[0]!.arguments[0]);
  assert.ok(!line.includes('canary'), line);
  assert.deepEqual(
    Object.entries(JSON.parse(line)).filter(([field]) => field !== 'ts'),
    [
      ['level', 'error'],
      ['event', 'feed.failed'],
      ['code', 'catalog_unavailable'],
      ['route', '/feed.xml'],
      ['requestId', 'req-0001'],
    ],
  );
});

test('a feed that fails to render logs render_failed', async (t) => {
  const logged = t.mock.method(console, 'log', () => {});
  // A revision the published view passes along whole, with a work whose title the feed can't escape.
  const portfolio = {
    schemaVersion: 3,
    locale: 'en',
    direction: 'ltr',
    identity: { name: 'Rowan Test' },
    works: [{ id: 'essay', title: 42, medium: 'writing' }],
    sections: [{ kind: 'works', id: 'essays', items: ['essay'] }],
  };
  const { site } = revision('en', true).unit;
  deploy(t, () => Promise.resolve({ unit: { portfolio, site, snapshots: {} } } as never));
  const response = await GET(request());
  assert.equal(response.status, 500);
  assert.equal(await response.text(), 'Feed unavailable. Request ID: req-0001');
  const line = JSON.parse(String(logged.mock.calls[0]!.arguments[0])) as Record<string, unknown>;
  assert.equal(line.code, 'render_failed');
});

test('a server with no deployment state serves no feed', async () => {
  setDeploymentState(undefined);
  const response = await GET(request());
  assert.equal(response.status, 503);
  assert.equal(response.headers.get('cache-control'), 'no-store');
});

/** A live revision of a portfolio in `locale`, on a site whose feed is `feed`. */
function revision(locale: string, feed: boolean): Awaited<ReturnType<CatalogReader['getLive']>> {
  const portfolio = parsePortfolio(
    `schemaVersion: 3\nlocale: ${locale}\ndirection: ltr\nidentity:\n  name: Rowan Test\nworks:\n  - { id: first-essay, title: First essay, medium: writing, url: 'https://rowan.test/first', publishedAt: '2026-01-02' }\nsections:\n  - kind: works\n    id: essays\n    items: [first-essay]\n`,
    'yaml',
  );
  const site = parseSite(
    readFileSync(new URL('../../../../../site.example.yml', import.meta.url), 'utf8').replace(
      'feed: true',
      `feed: ${feed}`,
    ),
    'yaml',
  );
  assert.ok(portfolio.ok && site.ok);
  return {
    revisionId: 'doc-test',
    unit: { portfolio: portfolio.value, site: site.value, snapshots: {} },
  };
}

test("the channel's language is the portfolio's locale", async (t) => {
  const live = revision('pt-BR', true);
  deploy(t, async () => live);
  const response = await GET(request());
  assert.equal(response.status, 200);
  const xml = await response.text();
  assert.match(xml, /<language>pt-BR<\/language>/);
  assert.match(xml, /<title>First essay<\/title>/);
  // Its GUID is made from the record's id (#10).
  assert.match(xml, /<guid isPermaLink="false">[^<]*\/#first-essay<\/guid>/);
});

test('a site with features.feed: false serves no feed', async (t) => {
  const live = revision('en', false);
  deploy(t, async () => live);
  const response = await GET(request());
  assert.equal(response.status, 404);
  assert.equal(await response.text(), 'Not found.');
});
