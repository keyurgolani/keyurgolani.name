import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import YAML from 'yaml';
import { checkGrouping, pageOutline } from '@portfolio/kit/sections';
import {
  addressOf,
  caseAsideParts,
  coverCaption,
  longestWord,
  wordClass,
  wordFit,
  caseFacts,
  foldedOf,
  foldLine,
  latestRole,
  monthYear,
  albumTotal,
  contactLinks,
  contactRow,
  figuresBand,
  figureOf,
  firstSentence,
  grewOutOf,
  headOf,
  itemCount,
  lengthClass,
  opensWith,
  partContents,
  partGrouping,
  partsOf as partsFor,
  plainInline,
  posterLede,
  posterLine,
  proofOf,
  rangeOf,
  repoForWork,
  selectedWorks,
  shortDate,
  shortVenue,
  sinceYear,
  splitAside,
  workWhen,
  type ModelInput,
} from './model';

const MANIFEST = JSON.parse(readFileSync(new URL('../manifest.json', import.meta.url), 'utf8'));

/** The home page's outline, for a model input: at the site root, no id prefix. */
const outlineOf = (input: ModelInput) =>
  pageOutline({
    ...input,
    route: { route: 'home' },
    basePath: '',
    ids: { prefix: '' },
    media: {},
    capabilities: { renderedKinds: MANIFEST.renderedKinds, unsupportedKinds: [], views: [] },
  } as unknown as Parameters<typeof pageOutline>[0]);
const partsOf = (input: ModelInput) => partsFor(input, outlineOf(input));

// Swiss Signal's derivations over the repository's sample and the N4
// fixtures: one artifact, no proof list, no thesis, no chronology, no
// media, a long name, a non-Latin name, and right to left. Every fixture
// below is invented for the test; the sample is portfolio.example.yml.

type Raw = Record<string, unknown> & { sections?: unknown[] };

/** A render input's model fields from a raw portfolio: every list present, as the view gives it. */
function inputOf(
  raw: Raw,
  controls: ModelInput['controls'] = {},
  derived: ModelInput['derived'] = {},
): ModelInput {
  const portfolio = {
    schemaVersion: 3,
    locale: 'en',
    direction: 'ltr',
    links: [],
    featured: [],
    proof: [],
    archive: [],
    works: [],
    evidence: [],
    chronology: [],
    sections: [],
    ...raw,
  };
  return { portfolio, controls, derived } as unknown as ModelInput;
}

const ROOT = new URL('../../../', import.meta.url);
const SAMPLE_RAW = YAML.parse(readFileSync(new URL('portfolio.example.yml', ROOT), 'utf8')) as Raw;
const SNAPSHOT = JSON.parse(readFileSync(new URL('snapshots/github.json', ROOT), 'utf8')) as {
  records: { sectionId: string; fetchedAt: string; data: unknown }[];
};
const SAMPLE_DERIVED = Object.fromEntries(
  SNAPSHOT.records.map((record) => [
    record.sectionId,
    { state: 'ready', value: record.data, derivedAt: record.fetchedAt },
  ]),
) as unknown as ModelInput['derived'];
const sample = (controls: ModelInput['controls'] = {}) =>
  inputOf(SAMPLE_RAW, controls, SAMPLE_DERIVED);

/** An invented portfolio: a thesis, a hero, three works, metrics, a chronology. */
const RICH: Raw = {
  identity: {
    name: 'Rowan Vale',
    tagline: 'Maker of quiet tools',
    location: 'Lisbon',
    email: 'rowan@vale.test',
  },
  links: [
    { platform: 'website', url: 'https://vale.test/', label: 'vale.test' },
    { platform: 'github', url: 'https://code.test/rowan' },
    { platform: 'email', url: 'mailto:rowan@vale.test', label: 'Email' },
  ],
  practice: { thesis: 'I build *small* tools. They last.' },
  signature: 'kiln',
  featured: ['loom'],
  works: [
    {
      id: 'kiln',
      title: 'Kiln',
      medium: 'software',
      highlights: ['Used by 40 studios'],
      url: 'https://code.test/rowan/kiln',
    },
    { id: 'loom', title: 'Loom', medium: 'software', url: 'https://code.test/rowan/loom/' },
    {
      id: 'essay',
      title: 'On Repair',
      medium: 'writing',
      readingTimeMinutes: 9,
      publishedAt: '2024-05',
    },
    {
      id: 'album',
      title: 'Field',
      medium: 'music',
      tracks: [
        { title: 'A', durationSeconds: 61 },
        { title: 'B', durationSeconds: 120 },
      ],
    },
  ],
  evidence: [
    {
      id: 'years',
      type: 'metric',
      statement: 'Years building tools',
      metric: { value: 9, unit: 'years' },
    },
    { id: 'tools', type: 'metric', statement: 'Tools shipped', metric: { value: 1200 } },
    {
      id: 'share',
      type: 'metric',
      statement: 'Of studios renew',
      metric: { value: 92, unit: '%' },
    },
    { id: 'talk', type: 'talk', title: 'Quiet tools' },
  ],
  chronology: [
    { id: 'now-role', kind: 'role', title: 'Lead', period: { start: '2021-03' } },
    {
      id: 'old-role',
      kind: 'role',
      title: 'Engineer',
      period: { start: 'March 2015', end: '2021' },
    },
    { id: 'study', kind: 'study', title: 'B.Sc.', period: { start: '2011', end: '2015' } },
    {
      id: 'side',
      kind: 'project',
      title: 'A podcast',
      period: { start: '2022' },
      branchesFrom: 'now-role',
    },
  ],
  sections: [
    {
      kind: 'hero',
      id: 'top',
      tagline: 'Tools for people who mend things. Built to last.',
      subtagline: 'Currently at a co-op.',
    },
    { kind: 'practice', id: 'thesis', title: 'Practice', part: 'thesis' },
    { kind: 'works', id: 'work', title: 'Work', items: ['kiln', 'loom'] },
    { kind: 'evidence', id: 'figures', title: 'In numbers', items: ['years', 'tools', 'share'] },
    { kind: 'works', id: 'writing', title: 'Essays', items: ['essay'] },
    { kind: 'works', id: 'sound', title: 'Listening (a small experiment)', items: ['album'] },
    { kind: 'evidence', id: 'talks', title: 'Talks', items: ['talk'] },
    { kind: 'chronology', id: 'cv', title: 'Experience', items: ['now-role', 'old-role', 'side'] },
    { kind: 'lede', id: 'intro', body: 'An untitled introduction.' },
    { kind: 'custom', id: 'notes', title: 'Notes', body: 'Free text.' },
    { kind: 'github', id: 'gh', title: 'On GitHub', username: 'rowan' },
    { kind: 'contact', id: 'contact', title: 'Get in touch' },
    { kind: 'cta', id: 'next', title: 'Work together?' },
  ],
};
const rich = (controls: ModelInput['controls'] = {}, derived: ModelInput['derived'] = {}) =>
  inputOf(RICH, controls, derived);

const REPOS = {
  gh: {
    state: 'ready',
    derivedAt: '2026-10-01T00:00:00Z',
    value: {
      pinnedRepos: [
        {
          name: 'loom',
          url: 'https://code.test/rowan/loom',
          stars: 1241,
          forks: 30,
          description: '',
        },
      ],
      recentlyActive: [{ name: 'kiln', url: 'https://code.test/rowan/kiln', stars: 3 }],
    },
  },
} as unknown as ModelInput['derived'];

// ───────────── the sample ─────────────

test('the sample: the concept derivations, from fields alone', () => {
  const input = sample();
  const poster = posterLine(input);
  assert.equal(poster.text, 'I make failure legible.');
  assert.equal(poster.source, 'thesis');
  assert.equal(poster.length, 'short');
  assert.deepEqual(poster.aside, { text: 'Engineer, writer, speaker', source: 'tagline' });
  assert.equal(poster.namePrefix, true);
  assert.equal(figuresBand(input)?.section.id, 'at-a-glance');
  assert.equal(figuresBand(input)?.figures.length, 4, 'one cell per metric, never padded');
  assert.deepEqual(
    selectedWorks(input).map((work) => [work.id, proofOf(input, work)?.text]),
    [
      ['postmortem-template-kit', '3,200+ GitHub stars'],
      ['small-traces', '241 stars on GitHub'],
      ['the-quiet-cost-of-legible-systems', '14 min read'],
    ],
  );
  assert.equal(sinceYear(input), '2014');
});

test('the sample: parts follow the canonical map (K-1)', () => {
  const parts = partsOf(sample());
  const where = new Map(
    parts.flatMap((part) => part.sections.map((s) => [s.id, part.id] as const)),
  );
  // The director's majority placements.
  assert.equal(where.get('publications'), 'record');
  assert.equal(where.get('incident-history'), 'work');
  assert.equal(where.get('on-github'), 'record');
  assert.equal(where.get('skills'), 'about');
  assert.equal(where.get('essays'), 'writing');
  assert.equal(where.get('talks'), 'record');
  assert.equal(where.get('press'), 'record');
  // The poster and the band are not in a part.
  assert.equal(where.has('top'), false);
  assert.equal(where.has('at-a-glance'), false);
  assert.deepEqual(
    parts.map((part) => part.id),
    ['work', 'writing', 'record', 'about', 'contact'],
  );
  assert.equal(parts.at(-1)?.word, 'Get in touch');
  assert.equal(parts.at(-1)?.own, false);
  // Every other section is in exactly one part.
  const placed = parts.flatMap((part) => part.sections.map((s) => s.id));
  assert.equal(new Set(placed).size, placed.length);
  assert.equal(placed.length, sample().portfolio.sections.length - 2);
});

test('the sample: an authored aside and counts in heads, and S10 never repeats a unit', () => {
  const input = sample();
  const byId = (id: string) => input.portfolio.sections.find((s) => s.id === id)!;
  assert.deepEqual(headOf(byId('listening-a-small-experiment'), input), {
    title: 'Listening',
    hidden: false,
    paren: 'a small experiment',
  });
  assert.deepEqual(headOf(byId('essays'), input), {
    title: 'Essays',
    hidden: false,
    paren: '3',
    count: 3,
  });
  const years = figuresBand(input)!.figures[0]!;
  assert.equal(years.value, '12', 'the caption opens with "Years"');
  assert.match(years.caption!, /^Years engineering/);
});

test('the sample: contact rows never repeat their address (SS-M4)', () => {
  const rows = contactLinks(sample()).map(contactRow);
  for (const row of rows) {
    if (row.label) assert.notEqual(row.label.toLowerCase(), row.address.toLowerCase());
  }
  const site = rows.find((row) => row.address === 'anamika.example.com');
  assert.deepEqual(site, { label: 'Website', address: 'anamika.example.com' });
});

// ───────────── the poster ─────────────

test('posterLine: the thesis first sentence, as plain text in one voice', () => {
  const poster = posterLine(rich());
  assert.equal(poster.text, 'I build small tools.');
  assert.equal(poster.source, 'thesis');
  assert.deepEqual(poster.aside, { text: 'Maker of quiet tools', source: 'tagline' });
});

test('posterLine: the owner picks where the chain starts, and it falls through', () => {
  assert.equal(posterLine(rich({ posterLine: 'hero' })).text, 'Tools for people who mend things.');
  assert.equal(posterLine(rich({ posterLine: 'tagline' })).text, 'Maker of quiet tools');
  assert.equal(
    posterLine(rich({ posterLine: 'tagline' })).aside,
    undefined,
    'never the tagline twice',
  );
  const noHero = inputOf(
    { ...RICH, sections: RICH.sections!.filter((s) => (s as { kind: string }).kind !== 'hero') },
    { posterLine: 'hero' },
  );
  assert.equal(posterLine(noHero).source, 'tagline');
  // An unknown value starts at the thesis.
  assert.equal(posterLine(rich({ posterLine: 'stale' })).source, 'thesis');
});

test('posterLine=name: the h1 is the name, with no prefix, and the tagline aside (SS-M5)', () => {
  const poster = posterLine(rich({ posterLine: 'name' }));
  assert.equal(poster.text, 'Rowan Vale');
  assert.equal(poster.source, 'name');
  assert.equal(poster.namePrefix, false);
  assert.equal(poster.aside?.text, 'Maker of quiet tools');
  // Every other source puts the name in the h1.
  for (const choice of ['thesis', 'hero', 'tagline']) {
    assert.equal(posterLine(rich({ posterLine: choice })).namePrefix, true, choice);
  }
});

test('the aside: an authored parenthetical wins and stays when the owner turns the tagline off', () => {
  const authored = inputOf({ ...RICH, practice: { thesis: 'I mend things (slowly). And more.' } });
  assert.deepEqual(posterLine(authored).aside, { text: 'slowly', source: 'authored' });
  assert.equal(posterLine(authored).text, 'I mend things');
  assert.equal(posterLine(authored).tail, '.');
  const off = inputOf(
    { ...RICH, practice: { thesis: 'I mend things (slowly). And more.' } },
    { aside: 'off' },
  );
  assert.equal(posterLine(off).aside?.source, 'authored');
  assert.equal(posterLine(rich({ aside: 'off' })).aside, undefined);
});

test('length classes (S7): 32 and 64 characters are the edges, counted in code points', () => {
  assert.equal(lengthClass('x'.repeat(32)), 'short');
  assert.equal(lengthClass('x'.repeat(33)), 'medium');
  assert.equal(lengthClass('x'.repeat(64)), 'medium');
  assert.equal(lengthClass('x'.repeat(65)), 'long');
  assert.equal(lengthClass('数'.repeat(32)), 'short');
  const long = inputOf({
    ...RICH,
    practice: { thesis: `${'Long words '.repeat(9)}end. Then more.` },
  });
  assert.equal(posterLine(long).length, 'long');
});

test('posterLede: the hero tagline as the lede only when the poster did not take it', () => {
  assert.deepEqual(posterLede(rich()), {
    lede: 'Tools for people who mend things. Built to last.',
    position: 'Currently at a co-op.',
  });
  assert.deepEqual(posterLede(rich({ posterLine: 'hero' })), { position: 'Currently at a co-op.' });
});

// ───────────── N4 fixtures ─────────────

test('N4: one artifact', () => {
  const one = inputOf({
    identity: { name: 'Ana Lim' },
    works: [{ id: 'only', title: 'Only', medium: 'object' }],
    sections: [{ kind: 'works', id: 'w', items: ['only'] }],
  });
  assert.equal(posterLine(one).source, 'name');
  assert.equal(posterLine(one).aside, undefined);
  assert.deepEqual(
    selectedWorks(one).map((w) => w.id),
    ['only'],
  );
  assert.equal(proofOf(one, selectedWorks(one)[0]!), undefined);
  assert.equal(figuresBand(one), undefined);
  assert.deepEqual(
    partsOf(one).map((p) => p.id),
    ['work'],
  );
  assert.deepEqual(headOf(one.portfolio.sections[0]!, one), { title: 'Works', hidden: true });
});

test('N4: no proof list, no curation: the index is the first works section, archive left out', () => {
  const input = inputOf({
    ...RICH,
    signature: undefined,
    featured: [],
    proof: [],
    archive: ['loom'],
  });
  assert.deepEqual(
    selectedWorks(input).map((w) => w.id),
    ['kiln'],
  );
});

test('N4: no thesis falls through to the hero', () => {
  const input = inputOf({ ...RICH, practice: undefined });
  assert.equal(posterLine(input).source, 'hero');
  // A thesis without a visible thesis section is not the poster's.
  const hidden = inputOf({
    ...RICH,
    sections: RICH.sections!.filter((s) => (s as { id: string }).id !== 'thesis'),
  });
  assert.equal(posterLine(hidden).source, 'hero');
});

test('N4: no chronology: no since, and no Record part from it', () => {
  const input = inputOf({
    ...RICH,
    chronology: [],
    sections: RICH.sections!.filter((s) => (s as { kind: string }).kind !== 'chronology'),
  });
  assert.equal(sinceYear(input), undefined);
  assert.equal(sinceYear(rich({ since: false })), undefined);
  assert.equal(sinceYear(rich()), '2015', 'the earliest role, from a "Month YYYY" start');
});

test('N4: no media: proofs and counts still come from fields', () => {
  const input = rich({}, REPOS);
  const loom = input.portfolio.works.find((w) => w.id === 'loom')!;
  assert.equal(proofOf(input, loom)?.text, '1,241 stars on GitHub');
  assert.equal(proofOf(input, loom)?.own, true);
  const essay = input.portfolio.works.find((w) => w.id === 'essay')!;
  assert.equal(proofOf(input, essay)?.text, '9 min read');
  const album = input.portfolio.works.find((w) => w.id === 'album')!;
  assert.equal(proofOf(input, album)?.text, '2 tracks');
  assert.equal(albumTotal(album), '3:01');
});

test('N4: a long name and a non-Latin name stay whole, in code points', () => {
  const longName = 'Maximiliana Theodora Wilhelmina von Hohenberg-Ostrowski';
  const long = inputOf({ identity: { name: longName }, sections: [] }, { posterLine: 'name' });
  assert.equal(posterLine(long).text, longName);
  assert.equal(posterLine(long).length, 'medium');
  const kana = inputOf({
    identity: { name: '山田 花子' },
    practice: { thesis: '壊れたものを直す。それが仕事です。' },
    sections: [{ kind: 'practice', id: 't', part: 'thesis' }],
  });
  assert.equal(posterLine(kana).text, '壊れたものを直す。');
  assert.equal(posterLine(kana).length, 'short');
});

test('N4: right to left, in Arabic: sentences, numbers and parts', () => {
  const rtl = inputOf({
    locale: 'ar',
    direction: 'rtl',
    identity: { name: 'ليلى' },
    practice: { thesis: 'أصلح الأشياء؟ نعم.' },
    evidence: [{ id: 'm', type: 'metric', statement: 'سنوات', metric: { value: 1200 } }],
    sections: [
      { kind: 'practice', id: 't', part: 'thesis' },
      { kind: 'evidence', id: 'f', items: ['m'] },
    ],
  });
  assert.equal(posterLine(rtl).text, 'أصلح الأشياء؟');
  assert.equal(figuresBand(rtl)?.figures[0]?.value, new Intl.NumberFormat('ar').format(1200));
  assert.deepEqual(
    partsOf(rtl).map((p) => p.id),
    ['about'],
  );
});

// ───────────── figures, parts, heads ─────────────

test('figures: units fold in, tight or spaced; the owner can name the section', () => {
  const band = figuresBand(rich())!;
  assert.equal(band.section.id, 'figures');
  assert.deepEqual(
    band.figures.map((f) => f.value),
    ['9', '1,200', '92%'],
  );
  // A named evidence section with no metric values isn't the band: automatic is.
  assert.equal(figuresBand(rich({ figures: 'talks' }))?.section.id, 'figures');
  // A stale reference falls back to automatic.
  assert.equal(figuresBand(rich({ figures: 'gone' }))?.section.id, 'figures');
  // A spaced unit keeps its space, a no-break one.
  assert.equal(
    figureOf(
      {
        id: 'h',
        type: 'metric',
        statement: 'Saved each week',
        metric: { value: 40, unit: 'hours' },
      },
      'en',
    )?.value,
    '40\u00a0hours',
  );
});

/** RICH with one more evidence section: two metrics and a talk, mixed. */
const mixed = (controls: ModelInput['controls'] = {}) =>
  inputOf(
    {
      ...RICH,
      sections: [
        ...(RICH.sections as unknown[]),
        { kind: 'evidence', id: 'mixed', title: 'Reach', items: ['tools', 'share', 'talk'] },
      ],
    },
    controls,
  );

test('figures: a named section of metrics only is the band, and leaves every part', () => {
  const input = mixed({ figures: 'figures' });
  assert.equal(figuresBand(input)?.section.id, 'figures');
  const placed = partsOf(input).flatMap((part) => part.sections.map((s) => s.id));
  assert.equal(placed.includes('figures'), false);
  assert.equal(placed.includes('mixed'), true);
});

test('figures: a named mixed section is not the band; it keeps every entry in its part', () => {
  const input = mixed({ figures: 'mixed' });
  // The band falls back to the first section of metrics only.
  assert.equal(figuresBand(input)?.section.id, 'figures');
  const where = new Map(
    partsOf(input).flatMap((part) => part.sections.map((s) => [s.id, part.id] as const)),
  );
  assert.equal(where.get('mixed'), 'record', 'in its part, with its talk');
  // With no section of metrics only, there's no band at all.
  const alone = inputOf(
    {
      ...RICH,
      sections: (RICH.sections as { id: string }[])
        .filter((s) => s.id !== 'figures')
        .concat([{ kind: 'evidence', id: 'mixed', items: ['tools', 'talk'] } as never]),
    },
    { figures: 'mixed' },
  );
  assert.equal(figuresBand(alone), undefined);
});

test("S10: a unit repeats only as the caption's whole first word, in its own case", () => {
  const value = (unit: string, statement: string, n = 3) =>
    figureOf({ id: 'u', type: 'metric', statement, metric: { value: n, unit } }, 'en')?.value;
  assert.equal(value('M', 'Monthly readers'), '3M', 'M is not the start of Monthly');
  assert.equal(value('M', 'M readers a month'), '3', 'the caption opens with the unit');
  assert.equal(value('m', 'M readers a month'), '3m', 'one letter: case is the meaning');
  assert.equal(value('k', 'keys rotated'), '3k');
  assert.equal(value('k', 'k downloads'), '3');
  assert.equal(value('x', 'x86 builds'), '3x', 'x86 is a word of its own');
  assert.equal(value('x', 'faster deploys', 60), '60x');
  assert.equal(value('years', 'Years engineering', 12), '12', 'a word unit in any case');
  assert.equal(value('years', 'Yearslong', 12), '12\u00a0years');
  assert.equal(opensWith('% of studios', '%', 'en'), true);
});

test('parts: the canonical map through the grouping hook; index-only sections go to About', () => {
  const input = rich();
  const where = new Map(
    partsOf(input).flatMap((part) => part.sections.map((s) => [s.id, part.id] as const)),
  );
  assert.equal(where.has('top'), false, 'the poster is in no part');
  assert.equal(where.has('figures'), false, 'the band is in no part');
  assert.equal(where.get('intro'), 'about', 'an untitled lede: index-only in the kit, About here');
  assert.equal(where.get('notes'), 'about', 'custom: About');
  assert.equal(where.get('writing'), 'writing');
  assert.equal(where.get('talks'), 'record');
  // The grouping declares no mistake for any order.
  for (const partOrder of ['work-first', 'writing-first', 'record-first', 'about-first']) {
    const each = rich({ partOrder });
    assert.deepEqual(checkGrouping({ grouping: partGrouping(each) }, [outlineOf(each)]), []);
  }
});

test('parts: the owner order, contact last, empty parts gone, positions from 1', () => {
  const parts = partsOf(rich({ partOrder: 'about-first' }));
  assert.deepEqual(
    parts.map((p) => p.id),
    ['about', 'work', 'writing', 'record', 'contact'],
  );
  assert.deepEqual(
    parts.map((p) => p.position),
    [1, 2, 3, 4, 5],
  );
  // Contact's word is its section's own title, and its call to action heads its own call,
  // so the opener lists neither.
  assert.deepEqual(partContents(parts.at(-1)!), []);
  // Writing, one section, lists it.
  assert.deepEqual(partContents(parts.find((p) => p.id === 'writing')!), [
    { id: 'writing', title: 'Essays' },
  ]);
  assert.deepEqual(partsOf(rich({ partOrder: 'nonsense' })).map((p) => p.id)[0], 'work');
});

test('counts: an image series counts its photographs; one item shows (1), none no count', () => {
  const series = inputOf({
    identity: { name: 'A' },
    works: [
      {
        id: 's',
        title: 'S',
        medium: 'image-series',
        media: [{ asset: 'a' }, { asset: 'b' }, { asset: 'c' }],
      },
    ],
    sections: [{ kind: 'works', id: 'w', title: 'Looking', items: ['s'] }],
  });
  assert.equal(itemCount(series.portfolio.sections[0]!, series), 3);
  assert.equal(headOf(series.portfolio.sections[0]!, series).paren, '3');
  const input = rich();
  assert.equal(
    headOf(
      input.portfolio.sections.find((s) => s.id === 'talks')!,
      input,
    ).paren,
    '1',
  );
  // Prose has no count.
  assert.equal(
    headOf(
      input.portfolio.sections.find((s) => s.id === 'thesis')!,
      input,
    ).paren,
    undefined,
  );
});

test('counts on the sample: a practice part of one group counts its entries; GitHub its repositories', () => {
  const input = sample();
  const byId = (id: string) => input.portfolio.sections.find((s) => s.id === id)!;
  assert.equal(headOf(byId('engagements'), input).paren, '2');
  assert.equal(headOf(byId('patents'), input).paren, '1');
  assert.ok(Number(headOf(byId('on-github'), input).paren) > 0);
  assert.equal(headOf(byId('thesis'), input).paren, undefined, 'the thesis is prose');
});

test('a citation venue holds one line only when it is short', () => {
  assert.equal(shortVenue('Proc. FSTTCS 2016'), true);
  assert.equal(shortVenue('Proceedings of the ACM on Programming Languages'), false);
});

// ───────────── small helpers ─────────────

test('ranges use an en dash, never a hyphen (S13)', () => {
  assert.deepEqual(rangeOf({ start: '2018-08', end: '2023-03' }), {
    text: '2018–2023',
    open: false,
  });
  assert.deepEqual(rangeOf({ start: '2022-01' }), { text: '2022–now', open: true });
  assert.deepEqual(rangeOf({ start: '2022', end: 'present' }), { text: '2022–now', open: true });
  assert.deepEqual(rangeOf({ start: '2020', end: '2020' }), { text: '2020', open: false });
  assert.equal(workWhen(rich().portfolio.works.find((w) => w.id === 'essay')!)?.text, '2024');
  for (const work of sample().portfolio.works) {
    const when = workWhen(work);
    if (when) assert.doesNotMatch(when.text, /\d-\d|\d-$/, work.id);
  }
});

test('shortDate: day first, English months, the ISO form beside it', () => {
  assert.deepEqual(shortDate('2026-02-08'), { text: '8 Feb 2026', iso: '2026-02-08' });
  assert.deepEqual(shortDate('2024-12'), { text: 'Dec 2024', iso: '2024-12' });
  assert.deepEqual(shortDate('2016'), { text: '2016', iso: '2016' });
  assert.deepEqual(shortDate('March 2015'), { text: 'Mar 2015', iso: '2015-03' });
  assert.equal(shortDate('present'), undefined);
  assert.equal(shortDate(undefined), undefined);
});

test('text helpers', () => {
  assert.deepEqual(firstSentence('One. Two three.'), { lead: 'One.', rest: 'Two three.' });
  assert.deepEqual(firstSentence('No end'), { lead: 'No end' });
  assert.deepEqual(splitAside('Listening (a small experiment)'), {
    text: 'Listening',
    aside: 'a small experiment',
  });
  assert.deepEqual(splitAside('(only)'), { text: '(only)' });
  assert.deepEqual(splitAside('Mend (slowly).'), { text: 'Mend', aside: 'slowly', tail: '.' });
  assert.equal(
    plainInline('**Bold** and [a link](https://x.test) and `code`'),
    'Bold and a link and code',
  );
  assert.equal(addressOf('https://vale.test/'), 'vale.test');
  assert.equal(addressOf('mailto:a@b.test?subject=Hi'), 'a@b.test');
});

test('contact: labels, platforms, the email not listed twice', () => {
  const links = contactLinks(rich());
  assert.equal(
    links.some((link) => link.url.startsWith('mailto:')),
    false,
  );
  assert.deepEqual(links.map(contactRow), [
    { label: 'Website', address: 'vale.test' },
    { label: 'GitHub', address: 'code.test/rowan' },
  ]);
  assert.deepEqual(contactRow({ url: 'https://x.test' }), { address: 'x.test' });
});

test('repoForWork: matches by URL, trailing slash and case aside; nothing without a snapshot', () => {
  const input = rich({}, REPOS);
  const loom = input.portfolio.works.find((w) => w.id === 'loom')!;
  assert.deepEqual(repoForWork(input, loom), {
    name: 'loom',
    url: 'https://code.test/rowan/loom',
    stars: 1241,
    forks: 30,
  });
  assert.equal(repoForWork(rich(), loom), undefined);
  const unavailable = {
    gh: { state: 'unavailable', reason: 'processing', since: null },
  } as unknown as ModelInput['derived'];
  assert.equal(repoForWork({ derived: unavailable }, loom), undefined);
});

test('chronology: a branch names what it grew out of', () => {
  const input = rich();
  const side = input.portfolio.chronology.find((e) => e.id === 'side')!;
  assert.equal(grewOutOf(side, input)?.title, 'Lead');
  assert.equal(grewOutOf(input.portfolio.chronology[0]!, input), undefined);
});

// ───────────── the case study and the outline (P2) ─────────────

test('the case study: month and year, the aside, the fact sheet rows the work has', () => {
  assert.equal(longestWord('Postmortem Template Kit'), 10);
  assert.equal(wordClass('Postmortem Template Kit'), 'long');
  assert.equal(wordClass('I make failure legible.'), undefined);
  assert.deepEqual(wordFit('Work Showcase'), { '--layout-ss-word': 8 });
  assert.equal(monthYear('2022-01'), 'January 2022');
  assert.equal(monthYear('2022'), '2022');
  assert.equal(monthYear(undefined), undefined);
  const input = sample();
  const kit = input.portfolio.works.find((work) => work.id === 'postmortem-template-kit')!;
  assert.deepEqual(caseAsideParts(kit), { medium: 'software', when: '2022–now' });
  // Fig. 1: the owner's caption for the cover where written, else none (the page says "{title}, cover.").
  assert.equal(coverCaption(kit), kit.cover?.caption?.trim() ? kit.cover.caption : undefined);
  const captioned = { ...kit, cover: { ...kit.cover!, caption: 'The kit, fanned out on a desk.' } };
  assert.equal(coverCaption(captioned), 'The kit, fanned out on a desk.');
  assert.equal(coverCaption({ ...kit, cover: { ...kit.cover!, caption: '  ' } }), undefined);
  const award = input.portfolio.evidence.filter((entry) => (kit.evidence ?? []).includes(entry.id));
  const facts = caseFacts(kit, award);
  assert.deepEqual(
    facts.map((fact) => fact.term),
    ['Role', 'Period', 'Medium', 'Made with', 'Reach', 'Recognition'],
  );
  assert.equal(facts.find((fact) => fact.term === 'Period')?.value, 'Since January 2022');
  assert.ok(facts.find((fact) => fact.term === 'Reach')!.value.endsWith('.'));
  // A work with none of them has an empty sheet, never invented rows.
  assert.deepEqual(
    caseFacts({ id: 'x', title: 'X', medium: 'other' } as never, []).map((fact) => fact.term),
    [],
  );
});

test('the outline: the full record folds; words from collaborators and the first works stay', () => {
  const input = sample();
  const parts = partsOf(input);
  const record = parts.find((part) => part.id === 'record')!;
  const folded = foldedOf(record, input);
  assert.ok(!folded.has('words-from-collaborators'));
  for (const id of ['experience', 'publications', 'patents', 'on-github'])
    assert.ok(folded.has(id), id);
  const work = parts.find((part) => part.id === 'work')!;
  assert.ok(!foldedOf(work, input).has('work-showcase'));
  const contact = parts.find((part) => part.id === 'contact')!;
  assert.equal(foldedOf(contact, input).size, 0);
  const experience = input.portfolio.sections.find((section) => section.id === 'experience')!;
  assert.match(
    latestRole(experience, input)!,
    /^Principal Engineer, Reliability, Solstice Payments, 2023–now$/,
  );
});

test("a fold's first item carries its source's language (confirmation review 5)", () => {
  const input = sample();
  const section = input.portfolio.sections.find((each) => each.id === 'publications')!;
  const plain = foldLine(section, input);
  assert.equal(plain.count, '2 papers');
  assert.ok(plain.first);
  const lead = (section as { items: readonly string[] }).items[0];
  const german = {
    ...input,
    portfolio: {
      ...input.portfolio,
      evidence: input.portfolio.evidence.map((entry) =>
        entry.id === lead ? { ...entry, lang: 'de' } : entry,
      ),
    },
  } as typeof input;
  assert.equal(foldLine(section, german).firstLang, 'de');
  // A chronology's row: its latest role's language.
  const experience = input.portfolio.sections.find((each) => each.id === 'experience')!;
  const role = (input.portfolio.chronology ?? []).find((entry) => entry.kind === 'role')!;
  const hindi = {
    ...input,
    portfolio: {
      ...input.portfolio,
      chronology: (input.portfolio.chronology ?? []).map((entry) =>
        entry === role ? { ...entry, lang: 'hi' } : entry,
      ),
    },
  } as typeof input;
  assert.equal(foldLine(experience, hindi).firstLang, 'hi');
});
