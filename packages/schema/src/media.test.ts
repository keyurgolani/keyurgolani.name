import test from 'node:test';
import assert from 'node:assert/strict';
import { parsePortfolio, parseSite } from './load';
import { mediaCatalog } from './media-catalog';
import { mediaBlobs, parseMediaDocument, type MediaRecord } from './media';
import { resolvePortfolioView } from './view';

// The media catalog (#10, item 5): each record is one asset revision, with
// its renditions' own hashes, where its bytes came from, and whether that
// source was there; the authored half stays on the portfolio's media entry.

const hex = (digit: string) => digit.repeat(64);

/** `value` without `key`. */
function omit<T extends object>(value: T, key: keyof T): Partial<T> {
  const copy: Partial<T> = { ...value };
  delete copy[key];
  return copy;
}

const RECORD: MediaRecord = {
  assetId: 'atlas-cover',
  sha256: hex('a'),
  mime: 'image/jpeg',
  bytes: 2048,
  width: 1600,
  height: 900,
  aspectRatio: 1600 / 900,
  dominantColor: '#334455',
  renditions: [
    {
      name: 'w960-a1',
      ext: 'webp',
      mime: 'image/webp',
      bytes: 900,
      width: 960,
      height: 540,
      sha256: hex('b'),
    },
    {
      name: 'w960-a1-jpg',
      ext: 'jpg',
      mime: 'image/jpeg',
      bytes: 1100,
      width: 960,
      height: 540,
      sha256: hex('c'),
    },
  ],
  derivedAt: '2026-10-01T12:00:00Z',
  algorithmVersion: 1,
  source: { kind: 'local', path: 'atlas/cover.jpg' },
  availability: { state: 'available' },
};

test('a record names its source, local or remote, and whether it was there', () => {
  const ok = (record: unknown) => parseMediaDocument({ assets: [record] }).ok;
  assert.ok(ok(RECORD));
  assert.ok(ok({ ...RECORD, source: { kind: 'remote', url: 'https://images.test/a.jpg' } }));
  assert.ok(
    ok({
      ...RECORD,
      availability: { state: 'unavailable', reason: 'missing', since: '2026-10-02T08:00:00Z' },
    }),
  );
  for (const reason of ['unreachable', 'refused', 'invalid']) {
    assert.ok(
      ok({ ...RECORD, availability: { state: 'unavailable', reason, since: RECORD.derivedAt } }),
      reason,
    );
  }
  for (const bad of [
    omit(RECORD, 'source'),
    omit(RECORD, 'availability'),
    { ...RECORD, source: { kind: 'local', path: '/etc/passwd' } },
    { ...RECORD, source: { kind: 'local', path: '../outside.jpg' } },
    { ...RECORD, source: { kind: 'remote', url: 'http://images.test/a.jpg' } },
    { ...RECORD, source: { kind: 'upload', sha256: hex('d') } },
    { ...RECORD, availability: { state: 'unavailable', reason: 'missing' } },
    { ...RECORD, availability: { state: 'unavailable', reason: 'gone', since: RECORD.derivedAt } },
    { ...RECORD, availability: { state: 'available', since: RECORD.derivedAt } },
  ]) {
    assert.equal(ok(bad), false, JSON.stringify(bad));
  }
});

test("each rendition names its own blob, and never the source's", () => {
  const ok = (renditions: unknown) =>
    parseMediaDocument({ assets: [{ ...RECORD, renditions }] }).ok;
  const [webp, jpeg] = RECORD.renditions;
  assert.equal(ok([omit(webp!, 'sha256')]), false);
  assert.equal(ok([{ ...webp, sha256: 'B'.repeat(64) }]), false);
  const original = parseMediaDocument({
    assets: [{ ...RECORD, renditions: [webp, { ...jpeg, sha256: RECORD.sha256 }] }],
  });
  assert.ok(!original.ok);
  assert.equal(original.problems[0]!.pointer, '/assets/0/renditions/1/sha256');
});

test('a media document holds one record per asset: a repeated assetId is refused', () => {
  assert.ok(parseMediaDocument({ assets: [RECORD] }).ok);
  const repeated = parseMediaDocument({
    assets: [RECORD, { ...RECORD, sha256: hex('e') }],
  });
  assert.ok(!repeated.ok);
  assert.equal(repeated.problems[0]!.pointer, '/assets/1/assetId');
});

test('mediaBlobs lists every source and rendition blob once, as the store names them', () => {
  const other: MediaRecord = {
    ...RECORD,
    assetId: 'atlas-plate',
    sha256: hex('d'),
    renditions: [{ ...RECORD.renditions[0]!, sha256: hex('b') }],
  };
  assert.deepEqual(mediaBlobs({ assets: [RECORD, other] }), [
    `sha256:${hex('a')}`,
    `sha256:${hex('b')}`,
    `sha256:${hex('c')}`,
    `sha256:${hex('d')}`,
  ]);
  assert.deepEqual(mediaBlobs({ assets: [] }), []);
  // A document that doesn't check names nothing a store could keep or serve.
  assert.deepEqual(mediaBlobs({ blobs: [`sha256:${hex('e')}`] }), []);
  assert.deepEqual(mediaBlobs(null), []);
});

const lines = (...text: string[]) => `${text.join('\n')}\n`;

const PORTFOLIO = lines(
  'schemaVersion: 3',
  'locale: en',
  'direction: ltr',
  'identity:',
  '  name: Rowan Fixture',
  'media:',
  '  - id: atlas-plate',
  '    kind: image',
  '    source: plates/z-last.jpg',
  '    alt: Plate one',
  '    focalPoint: { x: 0.25, y: 0.75 }',
  '    rights: { holder: Rowan Fixture, license: CC BY 4.0, attributionRequired: true }',
  '  - id: atlas-cover',
  '    kind: image',
  '    source: atlas/cover.jpg',
  '    credit: Photo by Rowan',
  '  - id: ornament',
  '    kind: image',
  '    source: a-first.png',
  '    decorative: true',
  '  - id: private-scan',
  '    kind: image',
  '    source: private/scan.jpg',
  '    visibility: private',
  '    alt: private-canary-7f3a',
  'sections:',
  '  - kind: custom',
  '    id: plates',
  '    title: Plates',
  '    items:',
  '      - title: First',
  '        media: [{ asset: atlas-plate }, { asset: atlas-cover }, { asset: private-scan }]',
);

const SITE = lines(
  'schemaVersion: 2',
  'appearance:',
  '  variant: editorial',
  '  designLanguage: platform-neutral',
  '  colorScheme: warm',
  '  typography: classic',
  '  displayMode: system',
  'visitorControls:',
  '  variant: locked',
  '  designLanguage: locked',
  '  colorScheme: locked',
  '  typography: locked',
  '  displayMode: locked',
  'motionPolicy: respect-os',
  'features:',
  '  feed: false',
);

function pair() {
  const portfolio = parsePortfolio(PORTFOLIO, 'yaml');
  const site = parseSite(SITE, 'yaml');
  assert.ok(portfolio.ok, JSON.stringify(portfolio));
  assert.ok(site.ok, JSON.stringify(site));
  return { portfolio: portfolio.value, site: site.value };
}

test('the catalog joins each authored entry with its revision, in authored order', () => {
  const { portfolio } = pair();
  const plate: MediaRecord = {
    ...RECORD,
    assetId: 'atlas-plate',
    sha256: hex('e'),
    source: { kind: 'local', path: 'plates/z-last.jpg' },
  };
  const catalog = mediaCatalog(portfolio.media ?? [], { assets: [RECORD, plate] });
  // The authored list's order: not the records', and not the file names'.
  assert.deepEqual(
    catalog.map(({ id }) => id),
    ['atlas-plate', 'atlas-cover', 'ornament', 'private-scan'],
  );
  assert.deepEqual(catalog[0], {
    id: 'atlas-plate',
    kind: 'image',
    visibility: 'public',
    source: 'plates/z-last.jpg',
    alt: 'Plate one',
    rights: { holder: 'Rowan Fixture', license: 'CC BY 4.0', attributionRequired: true },
    focalPoint: { x: 0.25, y: 0.75 },
    revision: plate,
    availability: { state: 'available' },
  });
  assert.equal(catalog[1]!.credit, 'Photo by Rowan');
  assert.deepEqual(catalog[1]!.revision, RECORD);
  assert.equal(catalog[2]!.decorative, true);
  assert.equal(catalog[2]!.revision, null);
  assert.deepEqual(catalog[2]!.availability, { state: 'pending' });
  assert.equal(catalog[3]!.visibility, 'private');
  // A document that doesn't check holds no revisions.
  assert.ok(mediaCatalog(portfolio.media ?? [], { assets: 'x' }).every((e) => !e.revision));
});

test('rights must say something, and the view carries them but never the source', () => {
  const empty = parsePortfolio(PORTFOLIO.replace(/rights: \{[^}]*\}/, 'rights: {}'), 'yaml');
  assert.ok(!empty.ok);
  const unknown = parsePortfolio(
    PORTFOLIO.replace('license: CC BY 4.0', 'licence: CC BY 4.0'),
    'yaml',
  );
  assert.ok(!unknown.ok);

  const view = resolvePortfolioView(
    pair(),
    {
      media: {
        assets: [
          RECORD,
          {
            ...RECORD,
            assetId: 'private-scan',
            sha256: hex('f'),
            source: { kind: 'local', path: 'private/scan.jpg' },
          },
        ],
      },
      snapshots: {},
    },
    { mediaBase: '/media' },
  );
  assert.deepEqual(view.media['atlas-plate']!.rights, {
    holder: 'Rowan Fixture',
    license: 'CC BY 4.0',
    attributionRequired: true,
  });
  const text = JSON.stringify(view);
  // Where a revision came from is the owner's: no path or URL reaches a visitor.
  assert.ok(!text.includes('atlas/cover.jpg'));
  assert.ok(!text.includes('"availability"'));
  // A private asset and everything about it stays out.
  assert.ok(!('private-scan' in view.media));
  assert.ok(!text.includes('private-canary-7f3a'));
  assert.ok(!text.includes('private/scan.jpg'));
  assert.ok(!text.includes(hex('f')));
});
