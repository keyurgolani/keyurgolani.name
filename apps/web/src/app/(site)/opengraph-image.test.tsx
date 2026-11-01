import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import type { CatalogReader } from '~/server/catalog-port';
import { readDeploymentConfig } from '~/server/config';
import { setDeploymentState } from '~/server/config-store';
import OpengraphImage from './opengraph-image';

// The share card (#22): drawn per request from the live person and the
// canonical host, with nothing about the variant, and a card that can't be
// built answers the fixed 500 the feed does, never the cause.

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
    dispatch: () => assert.fail('the card runs no operation'),
    degraded: [],
  });
  t.after(() => setDeploymentState(undefined));
}

test('a card whose revision fails to read is a fixed 500 that logs the route, not the cause', async (t) => {
  const logged = t.mock.method(console, 'log', () => {});
  deploy(t, () =>
    Promise.reject(new Error('canary: /srv/canary-config/portfolio.yml: unreadable')),
  );
  const response = (await OpengraphImage()) as Response;
  assert.equal(response.status, 500);
  assert.equal(await response.text(), 'Image unavailable. Request ID: none');
  assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.equal(response.headers.get('content-type'), 'text/plain; charset=utf-8');
  const line = String(logged.mock.calls[0]!.arguments[0]);
  assert.ok(!line.includes('canary'), line);
  assert.deepEqual(
    Object.entries(JSON.parse(line)).filter(([field]) => field !== 'ts'),
    [
      ['level', 'error'],
      ['event', 'metadata.failed'],
      ['code', 'render_failed'],
      ['route', '/opengraph-image-12o0cb'],
      ['requestId', 'none'],
    ],
  );
});

test('the card reads no variant: it names the person and the host alone', () => {
  const source = readFileSync(new URL('./opengraph-image.tsx', import.meta.url), 'utf8');
  assert.ok(!source.includes('~/lib/variants'), 'the card imports the variant registry');
  assert.ok(!/compositionFor|manifest|appearance/.test(source), 'the card reads the variant');
  assert.match(source, /portfolio\.identity\.name/);
  assert.match(source, /requireDeploymentConfig\(\)\.origin/);
});
