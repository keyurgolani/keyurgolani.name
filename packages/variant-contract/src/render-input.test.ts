import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import {
  canonicalize,
  resolvePortfolioView,
  validatePublicationUnit,
  type DocumentFormat,
  type ParsedPair,
  type UnitInput,
} from '@portfolio/schema';
import { buildRenderInput, viewSeed, type RenderInputArgs } from './render-input';
import { validateManifest } from './validate-manifest';

// The render input (#5, Slice 3, item 4, shipped with the contract): one
// JSON-serializable value from the published view, the route, and the
// request time, the same in every runtime. browser.test.ts runs it bundled
// for a browser.

const PAIRS = new URL('../../schema/src/__fixtures__/pairs/', import.meta.url);
const PAIR = new URL('engineering/yaml/', PAIRS);

function unit(portfolio: string, site: string, format: DocumentFormat = 'yaml') {
  const extension = format === 'yaml' ? 'yml' : 'json';
  return validatePublicationUnit({
    portfolio: { text: portfolio, format, name: `portfolio.${extension}` },
    site: { text: site, format, name: `site.${extension}` },
  });
}

function pair(siteExtra = '', portfolioChange = (text: string) => text): ParsedPair {
  const result = unit(
    portfolioChange(readFileSync(new URL('portfolio.yml', PAIR), 'utf8')),
    `${readFileSync(new URL('site.yml', PAIR), 'utf8')}${siteExtra}`,
  );
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

/** The published view of `from`, with the unit's derived data. */
const viewOf = (from: ParsedPair, unit: UnitInput = {}) =>
  resolvePortfolioView(from, unit, { mediaBase: '/media' });

function args(from: ParsedPair = pair(), extra: Partial<RenderInputArgs> = {}): RenderInputArgs {
  return {
    view: viewOf(from),
    manifest: MANIFEST,
    route: { route: 'home' },
    basePath: '',
    origin: 'https://rowan.test',
    requestTime: '2026-10-20T15:42:07.123Z',
    ...extra,
  };
}

test('the input carries the visible content, presentation, materialized controls, and route', () => {
  const input = buildRenderInput(args());
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
  assert.deepEqual(input.query, {});
  assert.equal(input.origin, 'https://rowan.test');
  // The github section has no snapshot, and the pair no media.
  assert.deepEqual(
    [input.derived, input.media, input.appearance],
    [{ 'on-code': { state: 'unavailable', reason: 'never-refreshed', since: null } }, {}, null],
  );
  assert.deepEqual(input.ids, { prefix: '', main: 'main' });
});

test("derived and media are the view's: a snapshot's data, and each asset with why it has no renditions yet (#10)", () => {
  const snapshot = {
    adapter: 'github',
    sectionId: 'on-code',
    fetchedAt: '2026-10-02T08:00:00Z',
    data: {
      username: 'ines',
      profileUrl: 'https://github.com/ines',
      source: 'rest',
      totalRepos: 3,
      totalStarsReceived: 4,
      starsGiven: null,
      contributionsLastYear: null,
      pinnedRepos: [],
      recentlyActive: [],
      contributionCalendar: [],
      languageBreakdown: [],
    },
  };
  const from = pair('', (text) =>
    text
      .replace(
        '  email: ines@okafor.test\n',
        '  email: ines@okafor.test\n  avatar: { asset: ines-portrait }\n',
      )
      .replace(
        '\nsections:\n',
        '\nmedia:\n  - { id: ines-portrait, kind: image, source: ines.jpg, alt: Ines Okafor }\nsections:\n',
      ),
  );
  const input = buildRenderInput({
    ...args(from),
    view: viewOf(from, { snapshots: { github: { records: [snapshot] } } }),
  });
  assert.deepEqual(input.derived, {
    'on-code': {
      state: 'ready',
      value: { ...snapshot.data, fetchedAt: snapshot.fetchedAt },
      derivedAt: snapshot.fetchedAt,
    },
  });
  assert.deepEqual(input.media, {
    'ines-portrait': {
      id: 'ines-portrait',
      kind: 'image',
      alt: 'Ines Okafor',
      derived: { state: 'unavailable', reason: 'processing', since: null },
    },
  });
  // Still plain JSON, and the snapshot is part of what the seed reads.
  assert.deepEqual(JSON.parse(JSON.stringify(input)), input);
  assert.notEqual(input.env.seed, buildRenderInput(args(from)).env.seed);
});

test("the manifest's kinds, views, and enhancements ride along, so a variant needn't import it", () => {
  const { capabilities } = buildRenderInput(args());
  assert.deepEqual(capabilities, {
    renderedKinds: MANIFEST.renderedKinds,
    unsupportedKinds: MANIFEST.unsupportedKinds,
    views: MANIFEST.routes.views,
    enhancements: MANIFEST.enhancements,
  });
  const bare = buildRenderInput(
    args(undefined, { manifest: { ...MANIFEST, enhancements: undefined } }),
  );
  assert.deepEqual(bare.capabilities.enhancements, []);
});

test('it is plain JSON: a round trip changes nothing', () => {
  const input = buildRenderInput(args());
  assert.deepEqual(JSON.parse(JSON.stringify(input)), input);
});

test('the clock is the request time truncated to the UTC day, however it is given', () => {
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
    const { env } = buildRenderInput(args(undefined, { requestTime }));
    assert.equal(env.now, expected, String(requestTime));
  }
});

test("the seed is the first 8 hex digits of the published view's SHA-256, stable and specific", () => {
  const view = viewOf(pair());
  const expected = Number.parseInt(
    createHash('sha256').update(canonicalize(view)).digest('hex').slice(0, 8),
    16,
  );
  assert.equal(viewSeed(view), expected);
  assert.equal(buildRenderInput(args()).env.seed, expected);
  assert.equal(buildRenderInput(args(pair())).env.seed, expected);
  const other = pair('', (text) =>
    text.replace('tagline: Platform engineer', 'tagline: Platform engineers'),
  );
  assert.notEqual(buildRenderInput(args(other)).env.seed, expected);
  assert.ok(Number.isInteger(expected) && expected >= 0 && expected < 2 ** 32);
});

test('an edit no visitor sees leaves the seed alone, so decoration stays put', () => {
  const hidden = 'sections:\n  stack:\n    hidden: true\n';
  const before = buildRenderInput(args(pair(hidden))).env.seed;
  // `stack` is hidden, and only it places the practice's tools, so editing one changes
  // nothing a visitor sees.
  const edited = pair(hidden, (text) => text.replace('- name: Neovim', '- name: Helix'));
  assert.notDeepEqual(edited.portfolio, pair(hidden).portfolio, 'the hidden part changed');
  assert.equal(buildRenderInput(args(edited)).env.seed, before);
});

test('a hidden section, and the site document listing it, stay out of the input', () => {
  const text = JSON.stringify(
    buildRenderInput(args(pair('sections:\n  numbers:\n    hidden: true\n'))),
  );
  assert.ok(!text.includes('"numbers"'), 'the hidden id is gone');
  assert.ok(text.includes('"about"'));
});

test('stored controls come from the site document, and a ref to a hidden section renders its default', () => {
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
  const input = buildRenderInput(args(pair(extra)));
  assert.equal(input.controls.heroLayout, 'split');
  assert.equal(input.controls.leadSection, null);
});

test("stored controls are the site's own entry, never one Object.prototype lends", () => {
  const raw = structuredClone(RAW);
  raw.id = 'constructor';
  const checked = validateManifest(raw, { packageName: 'constructor' });
  assert.ok(checked.ok, JSON.stringify(checked.diagnostics));
  const defaults = buildRenderInput(args()).controls;
  assert.equal(defaults.heroLayout, 'wide');
  // With Ocean's values stored alone, Object.prototype.constructor is no
  // entry, so every control renders its default.
  const ocean = pair('variantControls:\n  acme-ocean:\n    version: 2\n    values: {}\n');
  assert.deepEqual(
    buildRenderInput(args(ocean, { manifest: checked.manifest })).controls,
    defaults,
  );
  // Nor is an entry a polluted Object.prototype holds, beside the site's own for another variant.
  const prepared = args(pair('variantControls:\n  acme-reef:\n    version: 1\n    values: {}\n'));
  const prototype = Object.prototype as Record<string, unknown>;
  prototype['acme-ocean'] = { version: 2, values: { heroLayout: 'split' } };
  try {
    assert.equal(buildRenderInput(prepared).controls.heroLayout, 'wide');
  } finally {
    delete prototype['acme-ocean'];
  }
});

test('the id prefix and base path are checked, and the route passes through', () => {
  const input = buildRenderInput(
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
    { query: { variant: 7 } },
    { query: { '': 'acme-ocean' } },
  ] as unknown as Partial<RenderInputArgs>[]) {
    assert.throws(() => buildRenderInput(args(undefined, bad)), TypeError, JSON.stringify(bad));
  }
});

test("the query links keep rides along in name order, as /sample's variant does", () => {
  const input = buildRenderInput(
    args(undefined, { basePath: '/sample', query: { variant: 'acme-ocean', lang: 'de' } }),
  );
  assert.equal(input.basePath, '/sample');
  assert.deepEqual(Object.entries(input.query), [
    ['lang', 'de'],
    ['variant', 'acme-ocean'],
  ]);
  // The input stays plain JSON with it.
  assert.deepEqual(JSON.parse(JSON.stringify(input)), input);
});

// What YAML can write that JSON can't, in every number field and in stored control values.
const NON_FINITE = ['.inf', '-.inf', '.nan'];
/** The engineering portfolio with `record` first in its top-level `list`. */
const withRecord = (text: string, list: string, record: string) =>
  text.includes(`\n${list}:\n`)
    ? text.replace(`\n${list}:\n`, `\n${list}:\n${record}\n`)
    : text.replace('\nsections:\n', `\n${list}:\n${record}\nsections:\n`);
const PORTFOLIO_PROBES: ReadonlyArray<(text: string, value: string) => string> = [
  (text, value) =>
    withRecord(text, 'evidence', `  - { id: probe, type: metric, metric: { value: ${value} } }`),
  (text, value) =>
    withRecord(
      text,
      'works',
      `  - { id: probe, title: x, medium: audio-video, number: 1, durationMinutes: ${value} }`,
    ),
  (text, value) =>
    withRecord(
      text,
      'works',
      `  - { id: probe, title: x, medium: music, tracks: [{ title: t, durationSeconds: ${value} }] }`,
    ),
  (text, value) =>
    withRecord(
      text,
      'works',
      `  - { id: probe, title: x, medium: writing, readingTimeMinutes: ${value} }`,
    ),
  (text, value) =>
    withRecord(
      text,
      'media',
      `  - { id: probe, kind: image, source: a.png, focalPoint: { x: ${value}, y: 0 } }`,
    ),
  (text, value) =>
    withRecord(
      withRecord(text, 'media', '  - { id: probe, kind: image, source: a.png }'),
      'works',
      `  - { id: probe-work, title: x, medium: interface, cover: { asset: probe, focalPoint: { x: 0, y: ${value} } } }`,
    ),
  (text, value) =>
    `${text}\n  - { kind: '@other/x/y', id: probe, data: { ratio: ${value} } }\n  - { kind: lede, id: probe-two, body: x, extensions: { '@other/x': { size: ${value} } } }\n`,
];
const SITE_PROBES = [
  (value: string) =>
    `variantControls:\n  acme-ocean: { version: 2, values: { columns: ${value} } }\n`,
  (value: string) =>
    `variantControls:\n  acme-ocean: { version: 2, values: { featured: [about, ${value}] } }\n`,
  (value: string) => `variantControls:\n  other-one: { version: ${value}, values: {} }\n`,
];

test('no pair that validates can make the builder throw', () => {
  const base = {
    portfolio: readFileSync(new URL('portfolio.yml', PAIR), 'utf8'),
    site: readFileSync(new URL('site.yml', PAIR), 'utf8'),
  };
  const candidates: Array<[string, string, string, DocumentFormat]> = [];
  for (const practice of readdirSync(PAIRS)) {
    for (const format of ['yaml', 'json'] as const) {
      const dir = new URL(`${practice}/${format}/`, PAIRS);
      const extension = format === 'yaml' ? 'yml' : 'json';
      candidates.push([
        `${practice}/${format}`,
        readFileSync(new URL(`portfolio.${extension}`, dir), 'utf8'),
        readFileSync(new URL(`site.${extension}`, dir), 'utf8'),
        format,
      ]);
    }
  }
  const probe = (value: string): Array<[string, string, string]> => [
    ...PORTFOLIO_PROBES.map((write, index): [string, string, string] => [
      `portfolio probe ${index} ${value}`,
      write(base.portfolio, value),
      base.site,
    ]),
    ...SITE_PROBES.map((write, index): [string, string, string] => [
      `site probe ${index} ${value}`,
      base.portfolio,
      `${base.site}${write(value)}`,
    ]),
  ];
  // With a finite number each probe is a valid pair, so its refusal below is the number's doing.
  for (const [name, portfolio, site] of probe('1')) {
    assert.ok(unit(portfolio, site).pair, name);
  }
  for (const value of NON_FINITE) {
    for (const [name, portfolio, site] of probe(value)) {
      assert.equal(unit(portfolio, site).pair, null, name);
      candidates.push([name, portfolio, site, 'yaml']);
    }
  }
  let built = 0;
  for (const [name, portfolio, site, format] of candidates) {
    const result = unit(portfolio, site, format);
    if (!result.pair) continue;
    assert.doesNotThrow(() => buildRenderInput(args(result.pair!)), name);
    built += 1;
  }
  assert.equal(built, readdirSync(PAIRS).length * 2, 'every profession pair builds');
});
