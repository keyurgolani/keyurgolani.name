import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { acmePortfolioPhotography } from './__fixtures__/acme-portfolio-photography';
import { parsePortfolio, parseSite, readPortfolio } from './load';
import {
  isPublic,
  newestFirst,
  publicSectionIndexes,
  resolvePortfolioView,
  type ParsedPair,
  type PublicPortfolio,
  type PublicView,
  type UnitInput,
  type ViewOptions,
} from './view';

// The published view (#10, item 5): hidden means gone. A record stays only
// when something visible reaches it, and every reference left resolves.

const lines = (...text: string[]) => `${text.join('\n')}\n`;

const SITE_HEAD = lines(
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
  '  colorScheme: selectable',
  '  typography: locked',
  '  displayMode: selectable',
  'motionPolicy: respect-os',
  'features:',
  '  feed: true',
);
const hiding = (...ids: string[]) =>
  ids.length === 0
    ? SITE_HEAD
    : `${SITE_HEAD}sections:\n${ids.map((id) => `  ${id}: { hidden: true }\n`).join('')}`;

function parsed(portfolio: string, site = SITE_HEAD, extensions = [acmePortfolioPhotography]) {
  const p = parsePortfolio(portfolio, 'yaml', { extensions });
  const s = parseSite(site, 'yaml', { extensions });
  assert.ok(p.ok, JSON.stringify(p));
  assert.ok(s.ok, JSON.stringify(s));
  return { portfolio: p.value, site: s.value } satisfies ParsedPair;
}

const OPTIONS: ViewOptions = { mediaBase: '/media', extensions: [acmePortfolioPhotography] };
const view = (pair: ParsedPair, unit: UnitInput = {}, options: ViewOptions = OPTIONS) =>
  resolvePortfolioView(pair, unit, options);
const ids = (records: readonly { readonly id: string }[]) => records.map(({ id }) => id);

// A portfolio with a canary marker in everything no visitor may see: records
// only a hidden section lists and their media, a private record a visible
// section lists and a private asset a kept work places, a record nothing
// lists, a hidden practice part, and a contact record only a hidden section
// places.
const CANARY = lines(
  'schemaVersion: 3',
  'locale: en',
  'direction: ltr',
  'identity:',
  '  name: Rowan View',
  '  email: rowan@rowan.test',
  '  avatar: { asset: portrait }',
  'links:',
  '  - { url: https://rowan.test, label: Site }',
  'meta:',
  '  title: Rowan View',
  '  ogImage: { asset: card }',
  'signature: atlas',
  'featured: [ledger, canary-private-work]',
  'proof: [award]',
  'practice:',
  '  thesis: I make failure legible.',
  '  skills: [{ name: Public, items: [Go] }]',
  '  tools: [{ name: Daily, items: [{ name: canary-hidden-tool }] }]',
  'contact:',
  '  message: canary-hidden-contact',
  'works:',
  '  - id: atlas',
  '    title: Atlas',
  '    medium: interface',
  '    cover: { asset: atlas-cover }',
  '    evidence: [atlas-quote, canary-private-quote]',
  '  - { id: ledger, title: Ledger, medium: research }',
  '  - id: shown',
  '    title: Shown',
  '    medium: system',
  '    media: [{ asset: shown-shot }, { asset: canary-private-asset }]',
  '  - id: canary-hidden-work',
  '    title: canary-hidden-work-title',
  '    medium: writing',
  '    cover: { asset: canary-hidden-cover }',
  '    evidence: [canary-hidden-evidence]',
  '  - id: canary-private-work',
  '    title: canary-private-work-title',
  '    medium: writing',
  '    visibility: private',
  '    cover: { asset: canary-private-only }',
  '  - { id: canary-unlisted-work, title: canary-unlisted-title, medium: object }',
  'evidence:',
  '  - { id: award, type: award, title: Award }',
  '  - id: atlas-quote',
  '    type: testimonial',
  '    statement: Kind words.',
  '    source: { name: A. Reviewer, avatar: { asset: reviewer } }',
  '  - id: canary-private-quote',
  '    type: testimonial',
  '    statement: canary-private-quote-text',
  '    source: { name: canary-private-source }',
  '    visibility: private',
  '  - { id: canary-hidden-evidence, type: award, title: canary-hidden-evidence-title }',
  'chronology:',
  "  - { id: older, kind: role, title: Older, period: { start: '2015', end: '2019' } }",
  "  - { id: newer, kind: role, title: Newer, period: { start: '2020' } }",
  '  - id: canary-private-entry',
  '    kind: role',
  '    title: canary-private-entry-title',
  "    period: { start: '2024' }",
  '    visibility: private',
  'media:',
  '  - { id: portrait, kind: image, source: portrait.jpg, alt: Rowan }',
  '  - { id: card, kind: image, source: card.png, alt: Card }',
  '  - { id: atlas-cover, kind: image, source: atlas.png, alt: Atlas map }',
  '  - { id: reviewer, kind: image, source: reviewer.png, alt: Reviewer }',
  '  - { id: shown-shot, kind: image, source: shot.png, alt: Shot }',
  '  - id: canary-private-asset',
  '    kind: image',
  '    source: canary-private-asset.png',
  '    alt: canary-private-asset-alt',
  '    visibility: private',
  '  - { id: canary-hidden-cover, kind: image, source: canary-hidden.png, alt: canary-hidden-alt }',
  '  - { id: canary-private-only, kind: image, source: canary-only.png, alt: canary-only-alt }',
  '  - { id: canary-unused, kind: image, source: canary-unused.png, alt: canary-unused-alt }',
  'sections:',
  '  - { kind: works, id: work, title: Work, items: [shown, canary-private-work] }',
  '  - { kind: works, id: drafts, title: Drafts, items: [canary-hidden-work] }',
  '  - { kind: chronology, id: history, title: History }',
  '  - { kind: practice, id: skills, title: Skills, part: skills }',
  '  - { kind: practice, id: thesis, part: thesis }',
  '  - { kind: practice, id: tools-draft, title: Tools, part: tools }',
  '  - { kind: contact, id: get-in-touch, title: Contact }',
);
const CANARY_SITE = hiding('drafts', 'tools-draft', 'get-in-touch');

test('nothing a visitor may not see reaches the view, and every reference in it resolves', () => {
  const pair = parsed(CANARY, CANARY_SITE);
  const before = JSON.stringify(pair);
  const published = view(pair);
  const text = JSON.stringify(published);
  assert.ok(!text.includes('canary'), text.match(/.{60}canary.{40}/)?.[0]);
  // Nor any hidden section's id, even in the site document's settings.
  for (const id of ['drafts', 'tools-draft', 'get-in-touch']) assert.ok(!text.includes(id), id);
  assert.equal(published.site.sections, undefined);
  // The pair itself is left as it was.
  assert.equal(JSON.stringify(pair), before);

  const { portfolio } = published;
  assert.deepEqual(
    portfolio.sections.map(({ id }) => id),
    ['work', 'history', 'skills', 'thesis'],
  );
  // The signature and the featured list are roots too, and a kept work reaches its evidence.
  assert.deepEqual(ids(portfolio.works), ['atlas', 'ledger', 'shown']);
  assert.deepEqual(ids(portfolio.evidence), ['award', 'atlas-quote']);
  assert.equal(portfolio.signature, 'atlas');
  assert.deepEqual(portfolio.featured, ['ledger']);
  assert.deepEqual(portfolio.proof, ['award']);
  assert.deepEqual(portfolio.archive, []);
  assert.deepEqual(portfolio.works[0]!.evidence, ['atlas-quote']);
  assert.deepEqual(portfolio.works[2]!.media, [{ asset: 'shown-shot' }]);
  assert.deepEqual(portfolio.sections[0], {
    kind: 'works',
    id: 'work',
    title: 'Work',
    items: ['shown'],
  });
  assert.deepEqual(portfolio.practice, {
    thesis: 'I make failure legible.',
    skills: [{ name: 'Public', items: ['Go'] }],
  });
  assert.equal(portfolio.contact, undefined);
  // Each asset a kept record places, and no other.
  assert.deepEqual(Object.keys(published.media), [
    'portrait',
    'card',
    'atlas-cover',
    'reviewer',
    'shown-shot',
  ]);
  const references = [
    ...portfolio.sections.flatMap((section) =>
      section.kind === 'works' || section.kind === 'evidence' || section.kind === 'chronology'
        ? (section.items ?? [])
        : [],
    ),
    ...portfolio.featured,
    ...portfolio.proof,
    ...portfolio.works.flatMap(({ evidence }) => evidence ?? []),
  ];
  const held = new Set([
    ...ids(portfolio.works),
    ...ids(portfolio.evidence),
    ...ids(portfolio.chronology),
  ]);
  for (const id of references) assert.ok(held.has(id), id);
});

test('a chronology section without items lists every public entry, newest first', () => {
  const { portfolio } = view(parsed(CANARY, CANARY_SITE));
  assert.deepEqual(portfolio.sections[1], {
    kind: 'chronology',
    id: 'history',
    title: 'History',
    items: ['newer', 'older'],
  });
  // The records keep their authored order.
  assert.deepEqual(ids(portfolio.chronology), ['older', 'newer']);
  assert.deepEqual(
    newestFirst([
      { period: { start: '2019-05' } },
      { period: { start: '2019' } },
      { period: { start: '2021', end: '2022' } },
      { period: { start: '2021' } },
    ]).map(({ period }) => [period.start, period.end ?? null]),
    [
      ['2021', '2022'],
      ['2021', null],
      ['2019-05', null],
      ['2019', null],
    ],
  );
});

test('a contact section places the contact record, or the ways to reach the author', () => {
  const visible = view(parsed(CANARY, hiding('drafts', 'tools-draft')));
  assert.deepEqual(visible.portfolio.contact, { message: 'canary-hidden-contact' });
  assert.ok(visible.portfolio.sections.some(({ id }) => id === 'get-in-touch'));
  // With no contact record, the identity's email or a link is something to show.
  const bare = (identity: string, links: string[]) =>
    view(
      parsed(
        lines(
          'schemaVersion: 3',
          'locale: en',
          'direction: ltr',
          'identity:',
          '  name: Rowan Bare',
          ...(identity ? [identity] : []),
          ...links,
          'sections:',
          '  - { kind: lede, id: about, body: Hi. }',
          '  - { kind: contact, id: contact, title: Contact }',
        ),
      ),
    ).portfolio.sections.map(({ id }) => id);
  assert.deepEqual(bare('  email: rowan@rowan.test', []), ['about', 'contact']);
  assert.deepEqual(bare('', ['links:', '  - { url: https://rowan.test }']), ['about', 'contact']);
  assert.deepEqual(bare('', []), ['about']);
});

test('a private record is gone wherever it is named, and so is what only it uses', () => {
  const pair = parsed(
    lines(
      'schemaVersion: 3',
      'locale: en',
      'direction: ltr',
      'identity: { name: Rowan Private }',
      'archive: [notes]',
      'works:',
      '  - { id: notes, title: canary-notes, medium: writing, visibility: private }',
      '  - { id: atlas, title: Atlas, medium: interface }',
      'chronology:',
      "  - { id: role, kind: role, title: Role, period: { start: '2020' }, works: [notes, atlas] }",
      'sections:',
      '  - { kind: works, id: work, items: [atlas] }',
      '  - { kind: chronology, id: history, items: [role] }',
    ),
  );
  const { portfolio } = view(pair);
  assert.deepEqual(portfolio.archive, []);
  assert.deepEqual(portfolio.chronology[0]!.works, ['atlas']);
  assert.ok(!JSON.stringify(portfolio).includes('canary'));
  assert.equal(isPublic({}), true);
  assert.equal(isPublic({ visibility: 'public' }), true);
  assert.equal(isPublic({ visibility: 'private' }), false);
});

test("a private record or asset that repeats a public one's id stays out of the view", () => {
  // A repeated id blocks publishing, but the pair still previews.
  const read = readPortfolio(
    lines(
      'schemaVersion: 3',
      'locale: en',
      'direction: ltr',
      'identity: { name: Rowan Twice }',
      'works:',
      '  - { id: atlas, title: Atlas, medium: interface, cover: { asset: shot } }',
      '  - { id: atlas, title: canary-work, medium: interface, visibility: private }',
      'evidence:',
      '  - { id: award, type: award, title: Award }',
      '  - { id: award, type: award, title: canary-evidence, visibility: private }',
      'chronology:',
      "  - { id: role, kind: role, title: Role, period: { start: '2020' } }",
      "  - { id: role, kind: role, title: canary-role, period: { start: '2021' }, visibility: private }",
      'media:',
      '  - { id: shot, kind: image, source: shots/atlas.png, alt: Atlas }',
      '  - { id: shot, kind: image, source: shots/b.png, alt: canary-media, visibility: private }',
      'sections:',
      '  - { kind: works, id: work, items: [atlas] }',
      '  - { kind: evidence, id: proof, items: [award] }',
      '  - { kind: chronology, id: history, items: [role] }',
    ),
    'yaml',
  );
  assert.equal(read.duplicates.length, 4);
  assert.ok(read.value);
  const site = parseSite(SITE_HEAD, 'yaml');
  assert.ok(site.ok);
  const published = view({ portfolio: read.value, site: site.value });
  assert.deepEqual(
    published.portfolio.works.map(({ title }) => title),
    ['Atlas'],
  );
  assert.deepEqual(
    published.portfolio.evidence.map(({ title }) => title),
    ['Award'],
  );
  assert.deepEqual(
    published.portfolio.chronology.map(({ title }) => title),
    ['Role'],
  );
  assert.equal(published.media.shot?.alt, 'Atlas');
  assert.ok(!JSON.stringify(published).includes('canary'));
});

test("an appearance input's sourceAsset stays in the view only when the view keeps that asset", () => {
  const portfolio = lines(
    'schemaVersion: 3',
    'locale: en',
    'direction: ltr',
    'identity: { name: Rowan Inputs, avatar: { asset: portrait } }',
    'media:',
    '  - { id: portrait, kind: image, source: me.jpg, alt: Rowan }',
    '  - { id: canary-private, kind: image, source: p.jpg, alt: P, visibility: private }',
    '  - { id: canary-unplaced, kind: image, source: u.jpg, alt: U }',
    'sections:',
    '  - { kind: lede, id: about, body: Hi. }',
  );
  const inputs = (...entries: string[]) =>
    `${SITE_HEAD}appearanceInputs:\n${entries.map((entry) => `  ${entry}\n`).join('')}`;
  const published = view(
    parsed(
      portfolio,
      inputs(
        'from-portrait: { sourceAsset: portrait }',
        'from-private: { sourceAsset: canary-private }',
        'from-unplaced: { sourceAsset: canary-unplaced }',
        "from-seed: { seedColor: '#3366ff' }",
      ),
    ),
  );
  assert.deepEqual(published.site.appearanceInputs, {
    'from-portrait': { sourceAsset: 'portrait' },
    'from-seed': { seedColor: '#3366ff' },
  });
  assert.ok(!JSON.stringify(published).includes('canary'));
  // With none left, the key goes too.
  const none = view(parsed(portfolio, inputs('from-private: { sourceAsset: canary-private }')));
  assert.equal(Object.hasOwn(none.site, 'appearanceInputs'), false);
});

test('a work whose medium names an unregistered extension is reported, and never reaches the view', () => {
  const text = lines(
    'schemaVersion: 3',
    'locale: en',
    'direction: ltr',
    'identity: { name: Rowan Media }',
    'featured: [darkroom]',
    'works:',
    "  - { id: darkroom, title: canary-darkroom, medium: '@other/portfolio-film/darkroom', cover: { asset: print } }",
    "  - { id: prints, title: Prints, medium: '@acme/portfolio-photography/darkroom' }",
    'media:',
    '  - { id: print, kind: image, source: print.jpg, alt: canary-print }',
    'sections:',
    '  - { kind: works, id: work, items: [darkroom, prints] }',
    '  - { kind: works, id: film, items: [darkroom] }',
  );
  const read = parsePortfolio(text, 'yaml', { extensions: [acmePortfolioPhotography] });
  assert.ok(read.ok);
  assert.deepEqual(
    read.warnings.map(({ pointer, message }) => [pointer, message]),
    [
      [
        '/works/0/medium',
        "/works/0/medium is a medium from an extension this build doesn't register. Its work is kept as written, unchecked, and never shown to visitors.",
      ],
    ],
  );
  const published = view(parsed(text));
  assert.deepEqual(ids(published.portfolio.works), ['prints']);
  assert.deepEqual(
    published.portfolio.sections.map(({ id }) => id),
    ['work'],
  );
  assert.deepEqual(published.portfolio.featured, []);
  assert.deepEqual(published.media, {});
  assert.ok(!JSON.stringify(published).includes('canary'));
  assert.ok(!JSON.stringify(published).includes('@other'));
});

test("a custom section's items keep only the public evidence and media they name", () => {
  const { portfolio, media } = view(
    parsed(
      lines(
        'schemaVersion: 3',
        'locale: en',
        'direction: ltr',
        'identity: { name: Rowan Custom }',
        'evidence:',
        '  - { id: attendance, type: metric, statement: Forty came., metric: { key: attendance, value: 40 } }',
        '  - { id: canary-private, type: award, title: canary-private-title, visibility: private }',
        'media:',
        '  - { id: flyer, kind: image, source: flyer.png, alt: The flyer }',
        '  - { id: canary-flyer, kind: image, source: canary.png, visibility: private }',
        'sections:',
        '  - kind: custom',
        '    id: workshop',
        '    title: Workshop',
        '    items:',
        '      - title: Next session',
        '        media: [{ asset: flyer }, { asset: canary-flyer }]',
        '        evidence: [attendance, canary-private]',
        '      - title: Archive',
        '        media: [{ asset: canary-flyer }]',
      ),
    ),
  );
  assert.deepEqual(portfolio.sections[0], {
    kind: 'custom',
    id: 'workshop',
    title: 'Workshop',
    items: [
      { title: 'Next session', media: [{ asset: 'flyer' }], evidence: ['attendance'] },
      { title: 'Archive' },
    ],
  });
  assert.deepEqual(ids(portfolio.evidence), ['attendance']);
  assert.deepEqual(Object.keys(media), ['flyer']);
  assert.ok(!JSON.stringify(portfolio).includes('canary'));
});

const SHA = 'a'.repeat(64);
const MEDIA_DOCUMENT = {
  assets: [
    {
      assetId: 'atlas-cover',
      sha256: SHA,
      mime: 'image/png',
      bytes: 2048,
      width: 1600,
      height: 900,
      aspectRatio: 1600 / 900,
      dominantColor: '#334455',
      renditions: [
        { name: 'w960-a1', ext: 'webp', mime: 'image/webp', bytes: 900, width: 960, height: 540 },
      ],
      derivedAt: '2026-10-01T12:00:00Z',
      algorithmVersion: 1,
    },
  ],
};

test('each asset carries its derived record: ready with rendition URLs, or unavailable with why', () => {
  const pair = parsed(CANARY, CANARY_SITE);
  const ready = view(pair, { media: MEDIA_DOCUMENT }).media;
  assert.deepEqual(ready['atlas-cover'], {
    id: 'atlas-cover',
    kind: 'image',
    alt: 'Atlas map',
    derived: {
      state: 'ready',
      derivedAt: '2026-10-01T12:00:00Z',
      value: {
        sha256: SHA,
        mime: 'image/png',
        bytes: 2048,
        width: 1600,
        height: 900,
        aspectRatio: 1600 / 900,
        dominantColor: '#334455',
        renditions: [
          {
            url: `/media/atlas-cover/${SHA}/w960-a1.webp`,
            name: 'w960-a1',
            mime: 'image/webp',
            bytes: 900,
            width: 960,
            height: 540,
          },
        ],
      },
    },
  });
  // The source is never in the view: originals are never served.
  assert.ok(!JSON.stringify(ready).includes('atlas.png'));
  // An asset the document has no record for is still processing.
  assert.deepEqual(ready.portrait!.derived, {
    state: 'unavailable',
    reason: 'processing',
    since: null,
  });
  // A preview builds its URLs on its own media base.
  const preview = view(
    pair,
    { media: MEDIA_DOCUMENT },
    { ...OPTIONS, mediaBase: '/preview-assets/g1/' },
  );
  assert.equal(
    preview.media['atlas-cover']!.derived.state === 'ready' &&
      preview.media['atlas-cover']!.derived.value.renditions[0]!.url,
    `/preview-assets/g1/atlas-cover/${SHA}/w960-a1.webp`,
  );
  // Without a media document every asset is processing; with one that doesn't check, failed.
  assert.equal(view(pair).media['atlas-cover']!.derived.state, 'unavailable');
  assert.deepEqual(view(pair, { media: { assets: 'no' } }).media['atlas-cover']!.derived, {
    state: 'unavailable',
    reason: 'failed',
    since: null,
  });
});

const GITHUB = lines(
  'schemaVersion: 3',
  'locale: en',
  'direction: ltr',
  'identity: { name: Rowan Code }',
  'sections:',
  '  - { kind: github, id: on-github, title: On GitHub, username: anamika }',
  '  - { kind: github, id: canary-github, title: Drafts, username: anamika }',
);
const SNAPSHOT = JSON.parse(
  readFileSync(new URL('../../../snapshots/github.json', import.meta.url), 'utf8'),
) as { records: Array<{ sectionId: string; fetchedAt: string; data: Record<string, unknown> }> };

test("a GitHub section's snapshot is ready, never refreshed, or failed, and a hidden one's is gone", () => {
  const pair = parsed(GITHUB, hiding('canary-github'));
  const snapshot = {
    records: [SNAPSHOT.records[0]!, { ...SNAPSHOT.records[0]!, sectionId: 'canary-github' }],
  };
  const ready = view(pair, { snapshots: { github: snapshot } });
  assert.deepEqual(Object.keys(ready.derived), ['on-github']);
  const derived = ready.derived['on-github']!;
  assert.equal(derived.state, 'ready');
  if (derived.state === 'ready') {
    assert.equal(derived.derivedAt, SNAPSHOT.records[0]!.fetchedAt);
    assert.equal(derived.value.fetchedAt, SNAPSHOT.records[0]!.fetchedAt);
    assert.equal(derived.value.username, SNAPSHOT.records[0]!.data.username);
  }
  assert.ok(!JSON.stringify(ready).includes('canary'));
  assert.deepEqual(view(pair).derived['on-github'], {
    state: 'unavailable',
    reason: 'never-refreshed',
    since: null,
  });
  assert.deepEqual(view(pair, { snapshots: { github: { records: 'no' } } }).derived['on-github'], {
    state: 'unavailable',
    reason: 'failed',
    since: null,
  });
  // A snapshot of a kind the view doesn't read changes nothing.
  assert.deepEqual(view(pair, { snapshots: { 'npm-stats': { any: 'thing' } } }), view(pair));
});

test("a GitHub section's settings filter its snapshot, so what it doesn't show never reaches the view", () => {
  const record = SNAPSHOT.records[0]!;
  const data = record.data as Record<string, Array<Record<string, unknown>>>;
  const github = {
    records: [
      {
        ...record,
        data: {
          ...record.data,
          pinnedRepos: [...data.pinnedRepos!, { ...data.pinnedRepos![0], name: 'canary-pinned' }],
          recentlyActive: [
            { ...data.recentlyActive![0], name: 'canary-recent' },
            ...data.recentlyActive!,
          ],
          languageBreakdown: [
            ...data.languageBreakdown!,
            { ...data.languageBreakdown![0], language: 'canary-language' },
          ],
        },
      },
    ],
  };
  const shown = (settings: string) => {
    const pair = parsed(
      lines(
        'schemaVersion: 3',
        'locale: en',
        'direction: ltr',
        'identity: { name: Rowan Code }',
        'sections:',
        `  - { kind: github, id: on-github, username: anamika${settings} }`,
      ),
    );
    const published = view(pair, { snapshots: { github } });
    assert.equal(
      published.portfolio.sections.some((section) => 'excludeRepos' in section),
      false,
    );
    const derived = published.derived['on-github'];
    assert.equal(derived?.state, 'ready');
    if (derived?.state !== 'ready') throw new Error('unreachable');
    return derived.value;
  };
  const names = (repos: ReadonlyArray<{ readonly name: string }>) => repos.map(({ name }) => name);
  // An excluded repository leaves every list, and the section's own list of them goes too.
  // The language breakdown is off by default.
  const excluded = shown(', excludeRepos: [canary-pinned, canary-recent]');
  assert.deepEqual(names(excluded.pinnedRepos), names(data.pinnedRepos as never));
  assert.deepEqual(names(excluded.recentlyActive), names(data.recentlyActive as never));
  assert.deepEqual(excluded.languageBreakdown, []);
  assert.equal(excluded.totalStarsReceived, record.data.totalStarsReceived);
  assert.ok(!JSON.stringify(excluded).includes('canary'));
  // A part a setting turns off is empty, and a figure null.
  const off = shown(
    ', showPinnedRepos: false, showRecentlyActive: false, showContributionGraph: false, showTotalStars: false',
  );
  assert.deepEqual([off.pinnedRepos, off.recentlyActive, off.contributionCalendar], [[], [], []]);
  assert.deepEqual([off.totalStarsReceived, off.starsGiven], [null, null]);
  // The recently active list keeps to its limit, and the breakdown shows when it's asked for.
  const limited = shown(', recentlyActiveLimit: 2, showLanguageBreakdown: true');
  assert.deepEqual(names(limited.recentlyActive), [
    'canary-recent',
    names(data.recentlyActive as never)[0],
  ]);
  assert.equal(limited.languageBreakdown.at(-1)?.language, 'canary-language');
});

test('the view is plain JSON: it round-trips, with no undefined left in it', () => {
  const published: PublicView = view(parsed(CANARY, CANARY_SITE), { media: MEDIA_DOCUMENT });
  assert.deepEqual(JSON.parse(JSON.stringify(published)), published);
  const walk = (node: unknown, path: string): void => {
    if (Array.isArray(node)) node.forEach((child, index) => walk(child, `${path}/${index}`));
    else if (node !== null && typeof node === 'object') {
      for (const [key, child] of Object.entries(node)) {
        assert.notEqual(child, undefined, `${path}/${key}`);
        walk(child, `${path}/${key}`);
      }
    }
  };
  walk(published, '');
  // Every list a renderer reads is there, empty or not.
  const empty = view(
    parsed(lines('schemaVersion: 3', 'locale: en', 'direction: ltr', 'identity: { name: E }')),
  );
  assert.deepEqual(
    [
      empty.portfolio.links,
      empty.portfolio.featured,
      empty.portfolio.proof,
      empty.portfolio.archive,
      empty.portfolio.works,
      empty.portfolio.evidence,
      empty.portfolio.chronology,
      empty.portfolio.sections,
    ],
    [[], [], [], [], [], [], [], []],
  );
  assert.deepEqual(empty.media, {});
  assert.deepEqual(empty.derived, {});
});

// The extension fixture: @acme/portfolio-photography, which these tests
// register, and @other/portfolio-music, which nothing registers.
const EXTENSIONS_SITE = lines(
  'schemaVersion: 2',
  'appearance:',
  '  variant: editorial',
  '  designLanguage: platform-neutral',
  '  colorScheme: warm',
  '  typography: classic',
  '  displayMode: system',
  '  extensions:',
  "    '@acme/portfolio-photography': { camera: Leica }",
  "    '@other/portfolio-music': { tempo: 90 }",
  'visitorControls:',
  '  variant: locked',
  '  designLanguage: locked',
  '  colorScheme: selectable',
  '  typography: locked',
  '  displayMode: selectable',
  'motionPolicy: respect-os',
  'features:',
  '  feed: true',
  'variantControls:',
  '  editorial:',
  '    version: 1',
  "    values: { extensions: { '@other/portfolio-music': kept } }",
  'sections:',
  '  plates: { hidden: true }',
  '  exhibitions: { hidden: false }',
);
const extensionsPair = (extensions = [acmePortfolioPhotography]) =>
  parsed(
    readFileSync(new URL('./__fixtures__/extensions/portfolio.yml', import.meta.url), 'utf8'),
    EXTENSIONS_SITE,
    extensions,
  );

test('hidden sections and unregistered extension data stay out of the public view', () => {
  const published = view(extensionsPair());
  // plates is hidden, so its work and that work's media go too; nothing registers @other/portfolio-music.
  assert.deepEqual(
    published.portfolio.sections.map(({ id }) => id),
    ['exhibitions'],
  );
  assert.deepEqual(published.portfolio.works, []);
  assert.deepEqual(published.media, {});
  assert.deepEqual(published.portfolio.identity.extensions, {
    '@acme/portfolio-photography': { camera: 'Leica M6', film: true },
  });
  assert.deepEqual(published.site.appearance.extensions, {
    '@acme/portfolio-photography': { camera: 'Leica' },
  });
  // A kept section's settings stay; control values hold any keys, so nothing is taken out of them.
  assert.deepEqual(published.site.sections, { exhibitions: { hidden: false } });
  assert.deepEqual(published.site.variantControls?.editorial?.values, {
    extensions: { '@other/portfolio-music': 'kept' },
  });
});

test("publicSectionIndexes says where each of the view's sections sits in the document", () => {
  const input = extensionsPair();
  const extensions = [acmePortfolioPhotography];
  // plates (0) is hidden and releases (2) is unregistered, so the view keeps exhibitions alone.
  assert.deepEqual(publicSectionIndexes(input, { extensions }), [1]);
  assert.deepEqual(publicSectionIndexes(input), []);
  // Matched by position, not by id: the repeat of a dropped section's id is still its own section.
  const [plates, exhibitions, releases] = input.portfolio.sections!;
  const repeated: ParsedPair = {
    ...input,
    portfolio: {
      ...input.portfolio,
      sections: [releases!, { ...exhibitions!, id: releases!.id }, plates!],
    },
  };
  const indexes = publicSectionIndexes(repeated, { extensions });
  assert.deepEqual(indexes, [1]);
  assert.deepEqual(
    view(repeated).portfolio.sections.map(({ kind }) => kind),
    indexes.map((index) => repeated.portfolio.sections![index]!.kind),
  );
  // A section with nothing public leaves the view, and its position with it (#10).
  const lonely = parsed(
    lines(
      'schemaVersion: 3',
      'locale: en',
      'direction: ltr',
      'identity:',
      '  name: Rowan Fixture',
      'works:',
      '  - { id: secret, title: Secret, medium: writing, visibility: private }',
      'sections:',
      '  - { kind: works, id: drafts, items: [secret] }',
      '  - { kind: lede, id: about, body: Hello. }',
    ),
  );
  assert.deepEqual(publicSectionIndexes(lonely), [1]);
});

test('with nothing registered, every extension section and extensions entry is dropped', () => {
  const published = view(extensionsPair([]), {}, { mediaBase: '/media' });
  assert.deepEqual(published.portfolio.sections, []);
  assert.equal('extensions' in published.portfolio.identity, false);
  assert.equal('extensions' in published.site.appearance, false);
  // Only the variant's control values, which hold any keys, still name it.
  assert.ok(!JSON.stringify(published.portfolio).includes('@other/portfolio-music'));
});

test('only resolvePortfolioView makes the portfolio a renderer takes', () => {
  const input = parsed(CANARY, CANARY_SITE);
  const render = (portfolio: PublicPortfolio) => portfolio.identity.name;
  // @ts-expect-error A parsed portfolio isn't the published view's.
  assert.ok(render(input.portfolio));
  assert.ok(render(view(input).portfolio));
});
