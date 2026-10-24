import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import {
  parsePortfolio,
  parseSite,
  resolvePortfolioView,
  type PublicView,
} from '@portfolio/schema';
import { readDeploymentConfig } from '~/server/config';
import type { Profile } from '~/server/capabilities';
import { setDeploymentState } from '~/server/config-store';
import { experienceHead } from './experience-head';

// A portfolio document's head (#22): og:url only on a path the caller names,
// with no query, the JSON-LD only where the profile is indexable, never the
// identity's email, and no portfolio text that leaves its script element.

const ORIGIN = 'https://rowan.test';

function deploy(t: TestContext, profile: Profile): void {
  const read = readDeploymentConfig(
    {
      NODE_ENV: 'production',
      PORTFOLIO_PROFILE: profile,
      PORTFOLIO_ORIGIN: ORIGIN,
      ...(profile === 'demo' ? {} : { PORTFOLIO_SOURCE_DIR: '/srv/config' }),
    },
    { cwd: '/' },
  );
  assert.ok(read.ok, JSON.stringify(read.issues));
  setDeploymentState({
    config: read.config,
    catalog: { getLive: () => assert.fail('the head reads no catalog') },
    dispatch: () => assert.fail('the head runs no operation'),
    degraded: [],
  });
  t.after(() => setDeploymentState(undefined));
}

function unit(tagline = 'Draws calm maps.'): PublicView {
  const portfolio = parsePortfolio(
    [
      'schemaVersion: 3',
      'locale: en',
      'direction: ltr',
      'identity:',
      '  name: Rowan Vale',
      `  tagline: ${JSON.stringify(tagline)}`,
      '  email: rowan@rowan.test',
      'sections:',
      '  - kind: hero',
      '    id: top',
      '',
    ].join('\n'),
    'yaml',
  );
  const site = parseSite(
    [
      'schemaVersion: 2',
      'appearance:',
      '  variant: missing-variant',
      '  designLanguage: platform-neutral',
      '  colorScheme: warm',
      '  typography: classic',
      '  displayMode: system',
      'visitorControls:',
      '  variant: locked',
      '  designLanguage: locked',
      '  colorScheme: locked',
      '  typography: locked',
      '  displayMode: selectable',
      'motionPolicy: respect-os',
      'features:',
      '  feed: true',
      '',
    ].join('\n'),
    'yaml',
  );
  assert.ok(portfolio.ok && site.ok, JSON.stringify([portfolio, site]));
  return resolvePortfolioView(
    { portfolio: portfolio.value, site: site.value },
    {},
    { mediaBase: '/media' },
  );
}

const ogUrl = (head: ReturnType<typeof experienceHead>) =>
  (head.metadata.openGraph as { url?: unknown } | undefined)?.url;

test('og:url names only the path the caller gives, without its query, and never another host', (t) => {
  deploy(t, 'owner');
  assert.equal(ogUrl(experienceHead(unit(), ORIGIN)), undefined);
  assert.equal(ogUrl(experienceHead(unit(), ORIGIN, { path: '/' })), '/');
  assert.equal(
    ogUrl(experienceHead(unit(), ORIGIN, { path: '/work/atlas?x=1#top' })),
    '/work/atlas',
  );
  assert.equal(ogUrl(experienceHead(unit(), ORIGIN, { path: '//elsewhere.test/' })), undefined);
  assert.equal(
    ogUrl(experienceHead(unit(), ORIGIN, { path: 'https://elsewhere.test/' })),
    undefined,
  );
  assert.equal(String(experienceHead(unit(), ORIGIN).metadata.metadataBase), `${ORIGIN}/`);
});

for (const profile of ['owner', 'read-only'] as const) {
  test(`under ${profile}, the JSON-LD names the person, on the origin, and never the email`, (t) => {
    deploy(t, profile);
    const { jsonLd } = experienceHead(unit(), ORIGIN);
    const blocks = jsonLd.map((json) => JSON.parse(json) as Record<string, unknown>);
    const person = blocks.find((block) => block['@type'] === 'Person');
    assert.equal(person?.name, 'Rowan Vale');
    assert.equal(person?.url, ORIGIN);
    assert.ok(!jsonLd.join('').includes('rowan@rowan.test'), jsonLd.join('\n'));
    assert.ok(!jsonLd.join('').includes('"email"'), jsonLd.join('\n'));
  });
}

test('under demo, the head carries no JSON-LD at all: the sample is no real person', (t) => {
  deploy(t, 'demo');
  const head = experienceHead(unit(), ORIGIN);
  assert.deepEqual(head.jsonLd, []);
  // The rest of the head is there, so a share card still names the sample.
  assert.equal(head.metadata.title, 'Rowan Vale — Portfolio');
});

test('a caller may say whether the head is indexable, whatever the deployment', (t) => {
  deploy(t, 'demo');
  assert.ok(experienceHead(unit(), ORIGIN, { indexable: true }).jsonLd.length > 0);
  setDeploymentState(undefined);
  assert.deepEqual(experienceHead(unit(), ORIGIN, { indexable: false }).jsonLd, []);
});

test('portfolio text that closes a script element stays inside the JSON-LD', (t) => {
  deploy(t, 'owner');
  const { jsonLd } = experienceHead(
    unit('Maps </script><script>alert(1)</script> & <!-- more'),
    ORIGIN,
  );
  const html = jsonLd.map((json) => `<script type="application/ld+json">${json}</script>`).join('');
  // Each block's own closing tag is the only one.
  assert.equal(html.split('</script>').length - 1, jsonLd.length);
  assert.ok(!html.includes('<script>'), html);
  assert.ok(!html.includes('<!--'), html);
  const person = jsonLd
    .map((json) => JSON.parse(json) as Record<string, unknown>)
    .find((block) => block['@type'] === 'Person');
  assert.equal(person?.description, 'Maps </script><script>alert(1)</script> & <!-- more');
});
