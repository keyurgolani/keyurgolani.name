import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import {
  canonicalize,
  toPublicView,
  validatePublicationUnit,
  type ParsedPair,
} from '@portfolio/schema';
import { buildRenderInput, pairSeed, type RenderInputArgs } from './render-input';
import { validateManifest } from './validate-manifest';

// The render input (#5, Slice 3, item 4, shipped with the contract): one
// JSON-serializable value from the pair, the route, and the request time,
// the same in every runtime. browser.test.ts runs it bundled for a browser.

const PAIR = new URL('../../schema/src/__fixtures__/pairs/engineering/yaml/', import.meta.url);

function pair(siteExtra = '', portfolioChange = (text: string) => text): ParsedPair {
  const result = validatePublicationUnit({
    portfolio: {
      text: portfolioChange(readFileSync(new URL('portfolio.yml', PAIR), 'utf8')),
      format: 'yaml',
      name: 'portfolio.yml',
    },
    site: {
      text: `${readFileSync(new URL('site.yml', PAIR), 'utf8')}${siteExtra}`,
      format: 'yaml',
      name: 'site.yml',
    },
  });
  assert.ok(result.pair, JSON.stringify(result.diagnostics));
  return result.pair;
}

const RAW = JSON.parse(
  readFileSync(new URL('./__fixtures__/manifest.json', import.meta.url), 'utf8'),
);
const MANIFEST = (() => {
  const result = validateManifest(RAW, { packageName: '@acme/ocean' });
  assert.ok(result.ok);
  return result.manifest;
})();

function args(unit: ParsedPair = pair(), extra: Partial<RenderInputArgs> = {}): RenderInputArgs {
  return {
    pair: unit,
    view: toPublicView(unit),
    manifest: MANIFEST,
    route: { route: 'home' },
    basePath: '',
    origin: 'https://rowan.test',
    requestTime: '2026-10-20T15:42:07.123Z',
    ...extra,
  };
}

test('the input carries the visible content, presentation, materialized controls, and route', async () => {
  const input = await buildRenderInput(args());
  assert.equal(input.contract, '2.0');
  assert.equal(input.variant, 'acme-ocean');
  assert.deepEqual(input.presentation, {
    displayMode: 'dark',
    motionPolicy: 'respect-os',
    visitorControls: {
      variant: 'locked',
      designLanguage: 'locked',
      colorScheme: 'selectable',
      typography: 'locked',
      displayMode: 'selectable',
    },
    features: { feed: true, productAttribution: false },
  });
  assert.deepEqual(input.controls, {
    showIndex: true,
    heroLayout: 'wide',
    columns: 2,
    leadSection: null,
    featured: [],
  });
  assert.deepEqual(input.route, { route: 'home' });
  assert.equal(input.basePath, '');
  assert.equal(input.origin, 'https://rowan.test');
  assert.deepEqual([input.derived, input.media, input.appearance], [{}, {}, null]);
  assert.deepEqual(input.ids, { prefix: '', main: 'main' });
});

test('it is plain JSON: a round trip changes nothing', async () => {
  const input = await buildRenderInput(args());
  assert.deepEqual(JSON.parse(JSON.stringify(input)), input);
});

test('the clock is the request time truncated to the UTC day, however it is given', async () => {
  const day = '2026-10-20T00:00:00.000Z';
  for (const [requestTime, expected] of [
    ['2026-10-20T15:42:07.123Z', day],
    ['2026-10-20T23:59:59.999Z', day],
    [Date.UTC(2026, 9, 20), day],
    [new Date('2026-10-20T00:00:00.000Z'), day],
    // 23:00 UTC, still the 20th.
    ['2026-10-20T20:00:00-03:00', day],
    // 01:00 UTC on the 21st.
    ['2026-10-20T22:00:00-03:00', '2026-10-21T00:00:00.000Z'],
  ] as const) {
    const { env } = await buildRenderInput(args(undefined, { requestTime }));
    assert.equal(env.now, expected, String(requestTime));
  }
});

test("the seed is the first 8 hex digits of the pair's SHA-256, stable and specific", async () => {
  const unit = pair();
  const expected = Number.parseInt(
    createHash('sha256').update(canonicalize(unit)).digest('hex').slice(0, 8),
    16,
  );
  assert.equal(await pairSeed(unit), expected);
  assert.equal((await buildRenderInput(args(unit))).env.seed, expected);
  assert.equal((await buildRenderInput(args(pair()))).env.seed, expected);
  const other = pair('', (text) =>
    text.replace('tagline: Platform engineer', 'tagline: Platform engineers'),
  );
  assert.notEqual(await pairSeed(other), expected);
  assert.ok(Number.isInteger(expected) && expected >= 0 && expected < 2 ** 32);
});

test('a hidden section, and the site document listing it, stay out of the input', async () => {
  const unit = pair('sections:\n  numbers:\n    hidden: true\n');
  const text = JSON.stringify(await buildRenderInput(args(unit)));
  assert.ok(!text.includes('"numbers"'), 'the hidden id is gone');
  assert.ok(text.includes('"about"'));
});

test('stored controls come from the site document, and a ref to a hidden section renders its default', async () => {
  const extra = `variantControls:
  acme-ocean:
    version: 2
    values:
      heroLayout: split
      leadSection: work
sections:
  work:
    hidden: true
`;
  const input = await buildRenderInput(args(pair(extra)));
  assert.equal(input.controls.heroLayout, 'split');
  assert.equal(input.controls.leadSection, null);
});

test('the id prefix and base path are checked, and the route passes through', async () => {
  const input = await buildRenderInput(
    args(undefined, {
      idPrefix: 'pv-',
      basePath: '/',
      route: { route: 'work', slug: 'tide-tables' },
    }),
  );
  assert.deepEqual(input.ids, { prefix: 'pv-', main: 'pv-main' });
  assert.equal(input.basePath, '');
  assert.deepEqual(input.route, { route: 'work', slug: 'tide-tables' });
  for (const bad of [
    { idPrefix: 'PV-' },
    { idPrefix: 'pv' },
    { origin: 'https://rowan.test/blog' },
    { origin: 'not a url' },
    { requestTime: 'yesterday' },
    { basePath: 'sample' },
  ] as Partial<RenderInputArgs>[]) {
    await assert.rejects(buildRenderInput(args(undefined, bad)), TypeError, JSON.stringify(bad));
  }
});
