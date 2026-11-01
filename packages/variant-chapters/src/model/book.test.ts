import assert from 'node:assert/strict';
import test from 'node:test';
import type { VariantRenderInput } from '@portfolio/variant-contract';
import {
  FIXTURE_NAMES,
  fiveEras,
  fixtureInput,
  inputFor,
  pairOf,
  sampleInput,
} from '../__tests__/harness.test';
import { buildBook, listed, optionsOf, periodsOf, placeOf, slugify, type Book } from './book';

// The book model over the sample, every contract fixture, and the shapes the
// concept names: five eras (so all five inks show, review question 2), nine
// roles capped, overlapping study and work, year-only dates, no chronology,
// nothing dated, and a single era.

type Doc = Record<string, unknown>;

const role = (id: string, organization: string, start: string, end?: string, extra: Doc = {}) => ({
  id,
  kind: 'role',
  title: `Engineer at ${organization}`,
  organization,
  period: end ? { start, end } : { start },
  ...extra,
});

function portfolio(chronology: Doc[], more: Doc = {}): Doc {
  const { sections = [], ...rest } = more as { sections?: Doc[] };
  return {
    schemaVersion: 3,
    locale: 'en',
    direction: 'ltr',
    identity: { name: 'Rowan Vale', tagline: 'Builds things' },
    ...(chronology.length > 0 ? { chronology } : {}),
    sections: [
      { kind: 'hero', id: 'top' },
      ...(chronology.length > 0
        ? [{ kind: 'chronology', id: 'experience', title: 'Experience' }]
        : []),
      ...sections,
    ],
    ...rest,
  };
}

const bookOf = (doc: Doc, controls?: Record<string, unknown>): Book => {
  const input = inputFor(pairOf(doc, controls));
  return buildBook(input);
};

/** Every record id the book prints somewhere, or keeps on a fixed page. */
function accounted(book: Book): Set<string> {
  const ids = new Set<string>(book.printed.keys());
  for (const { evidence } of book.back.alsoBy) ids.add(evidence.id);
  for (const record of book.front.proof) ids.add(record.id);
  return ids;
}

test('the sample is three chapters: the study years merged, then each employer', () => {
  const book = buildBook(sampleInput());
  assert.equal(book.derivedFrom, 'chronology');
  assert.deepEqual(
    book.chapters.map((c) => [c.slug, c.title, c.span, c.ink]),
    [
      ['nit-karnataka-and-iit-bombay', 'NIT Karnataka and IIT Bombay', '2010 to 2016', 1],
      ['mosaic-search', 'Mosaic Search', 'August 2018 to March 2023', 2],
      ['solstice-payments', 'Solstice Payments', 'Since April 2023', 3],
    ],
  );
  assert.equal(book.current?.slug, 'solstice-payments');
  assert.deepEqual(book.chapters[0]!.roles, [
    'B.Tech., Information Technology',
    'M.S., Computer Science',
    'Research Assistant, Formal Methods Lab',
  ]);
  // The title page's title is the thesis's first sentence.
  assert.equal(book.front.title, 'I make failure legible.');
  assert.ok(book.front.subtitle?.startsWith('The systems I build'));
});

test('placement follows the rules in order: links, organization, date, present tense, then the back matter', () => {
  const book = buildBook(sampleInput());
  const rule = (id: string) => {
    const at = book.placed.get(id);
    return at ? `${at.chapter.n}:${at.rule}` : undefined;
  };
  assert.equal(rule('postmortem-template-kit'), '3:linked');
  assert.equal(rule('knight-capital-twelve-years-on'), '3:linked');
  assert.equal(rule('hosting-incident-history'), '3:branchesFrom');
  assert.equal(rule('karthik-subramanian'), '2:organization');
  assert.equal(rule('mira-anand'), '3:organization');
  assert.equal(rule('system-and-method-for-adaptive-consensus-quorum-sizing-in-geo'), '2:dated');
  assert.equal(rule('probabilistic-model-checking-of-eventually-consistent-stores'), '1:dated');
  assert.equal(rule('essays-published'), '3:present');
  // Undated work with nothing to place it: Uncollected, in the back matter. External work: Also by.
  assert.deepEqual(
    book.back.uncollected.flatMap((g) => g.records.map((r) => r.id)),
    ['chaos-curriculum'],
  );
  assert.deepEqual(
    book.back.alsoBy.map(({ evidence }) => evidence.id),
    ['anamika-photography', 'incident-history-podcast'],
  );
  // The side thread prints in its chapter's Alongside line.
  assert.deepEqual(
    book.chapters[2]!.side.map((e) => e.id),
    ['hosting-incident-history'],
  );
});

test('every record the sample shows is printed exactly once, and pages run on from chapter 1', () => {
  const input = sampleInput();
  const book = buildBook(input);
  const ids = accounted(book);
  for (const record of [...input.portfolio.works, ...input.portfolio.evidence]) {
    assert.ok(ids.has(record.id), `${record.id} is somewhere in the book`);
  }
  const keys = book.chapters.flatMap((c) => c.parts.map((p) => `${c.slug}#${p.key}`));
  assert.equal(new Set(keys).size, keys.length, 'part anchors are unique within a chapter');
  let page = 1;
  for (const chapter of book.chapters) {
    assert.equal(chapter.firstPage, page);
    for (const part of chapter.parts) {
      assert.equal(part.page, page);
      page += 2;
    }
    assert.equal(chapter.lastPage, page - 1);
  }
  assert.equal(book.backStart, page);
  assert.deepEqual(
    book.chapters.map((c) => [c.firstPage, c.lastPage]),
    [
      [1, 4],
      [5, 8],
      [9, 26],
    ],
  );
  // The current chapter closes on Still being written.
  assert.equal(book.chapters[2]!.parts.at(-1)!.type, 'close');
  // Plates alternate their image between the recto and the verso.
  const plates = book.chapters[2]!.parts.flatMap((p) => (p.type === 'plate' ? [p.imageSide] : []));
  assert.deepEqual(plates.slice(0, 2), ['recto', 'verso']);
});

test('the index gives each skill and tool a page where a spine entry or a work names it, else its group', () => {
  const book = buildBook(sampleInput());
  const term = (name: string) => book.back.terms.find((t) => t.name === name)!;
  assert.deepEqual(
    term('TypeScript').locators.map((l) => l.page),
    // Each the folio of the plate's text page: small-traces's text is on its recto (P1-1).
    [11, 14],
  );
  assert.deepEqual(term('Consensus').locators, []);
  assert.deepEqual(term('Consensus').groups, ['Distributed systems']);
  assert.equal(term('Go').version, '1.23');
  // A skill or a tool the book names is a term too, though the practice doesn't list it: the
  // study chapter's Coq and TLA+, Mosaic's Kafka, a plate's Markdown and AWS Lambda.
  for (const [name, pages] of [
    ['Coq', [1]],
    ['TLA+', [1]],
    ['Kafka', [5]],
    ['Markdown', [11]],
    ['AWS Lambda', [14]],
  ] as const) {
    assert.deepEqual(
      term(name).locators.map((l) => l.page),
      pages,
      name,
    );
    assert.deepEqual(term(name).groups, [], name);
  }
  const names = book.back.terms.map((t) => t.name);
  assert.deepEqual(
    names,
    [...names].sort((a, b) => a.localeCompare(b, 'en', { sensitivity: 'base' })),
  );
});

test('five eras take the five categorical inks in order, and chapterAccents off gives every chapter the accent', () => {
  const doc = portfolio([
    role('a', 'Acme', '2010-01', '2011-06'),
    role('b', 'Birch', '2012-01', '2013-12'),
    role('c', 'Cedar', '2014-02', '2016-03'),
    role('d', 'Dune', '2017-01', '2019-12'),
    role('e', 'Elm', '2020-04'),
  ]);
  const book = bookOf(doc);
  assert.deepEqual(
    book.chapters.map((c) => [c.title, c.ink]),
    [
      ['Acme', 1],
      ['Birch', 2],
      ['Cedar', 3],
      ['Dune', 4],
      ['Elm', 5],
    ],
  );
  assert.deepEqual(
    bookOf(doc, { chapterAccents: false }).chapters.map((c) => c.ink),
    [0, 0, 0, 0, 0],
  );
});

test('nine roles merge, shortest pair first, to the cap, and maxChapters lowers it', () => {
  const roles = Array.from({ length: 9 }, (_, i) =>
    role(
      `r${i}`,
      `Org ${String.fromCharCode(65 + i)}`,
      `${2000 + i * 2}-01`,
      `${2000 + i * 2}-${i === 4 ? '02' : '12'}`,
    ),
  );
  const doc = portfolio(roles);
  const six = bookOf(doc);
  assert.equal(six.chapters.length, 6);
  assert.equal(
    six.chapters.reduce((n, c) => n + c.entries.length, 0),
    9,
  );
  assert.equal(bookOf(doc, { maxChapters: 2 }).chapters.length, 2);
  // Out of range: the default.
  assert.equal(optionsOf({ maxChapters: 12 }).maxChapters, 6);
  // A merged era names its organizations, two and then "and n more".
  const two = bookOf(doc, { maxChapters: 2 });
  assert.match(two.chapters[0]!.title, /^Org [A-Z], Org [A-Z] and \d more$/);
});

test('overlapping study and work at year precision merge into one era; adjacent ones do not', () => {
  const doc = portfolio([
    {
      id: 'deg',
      kind: 'study',
      title: 'B.Sc.',
      organization: 'Uni',
      period: { start: '2010', end: '2014' },
    },
    role('job', 'Firm', '2014-06', '2016-01'),
    role('next', 'Later Co', '2016-02'),
  ]);
  const book = bookOf(doc);
  assert.deepEqual(
    book.chapters.map((c) => c.title),
    ['Uni and Firm', 'Later Co'],
  );
  assert.equal(book.chapters[0]!.span, '2010 to 2016');
});

test('chapterTitles picks the principal role or the years, and slugs stay unique and in the route grammar', () => {
  const doc = portfolio([
    role('a', 'Same', '2010-01', '2012-01'),
    role('b', 'Same', '2013-01', '2015-01'),
    role('c', 'Back Matter', '2016-01'),
  ]);
  const book = bookOf(doc);
  assert.deepEqual(
    book.chapters.map((c) => c.slug),
    ['same', 'same-2', 'back-matter-2'],
  );
  assert.deepEqual(
    bookOf(doc, { chapterTitles: 'years' }).chapters.map((c) => c.title),
    ['2010 to 2012', '2013 to 2015', 'Since 2016'],
  );
  assert.equal(bookOf(doc, { chapterTitles: 'role' }).chapters[0]!.title, 'Engineer at Same');
  assert.equal(slugify('محمد'), '');
  assert.equal(listed(['A', 'B', 'C']), 'A, B and C');
});

test('with no spine the chapters are calendar years; with nothing dated, one chapter holds everything', () => {
  const works = [
    { id: 'w1', title: 'One', medium: 'software', publishedAt: '2021-03' },
    { id: 'w2', title: 'Two', medium: 'writing', publishedAt: '2023-05' },
  ];
  const years = bookOf(
    portfolio([], {
      works,
      sections: [{ kind: 'works', id: 'work', title: 'Work', items: ['w1', 'w2'] }],
    }),
  );
  assert.equal(years.derivedFrom, 'years');
  assert.deepEqual(
    years.chapters.map((c) => c.title),
    ['2021', '2023'],
  );
  const undated = bookOf(
    portfolio([], {
      works: [{ id: 'w1', title: 'One', medium: 'software' }],
      sections: [{ kind: 'works', id: 'work', title: 'Selected work', items: ['w1'] }],
    }),
  );
  assert.equal(undated.derivedFrom, 'single');
  assert.equal(undated.chapters.length, 1);
  assert.equal(undated.chapters[0]!.title, 'Selected work');
  assert.ok(undated.printed.has('w1'));
});

for (const name of FIXTURE_NAMES) {
  test(`the contract fixture ${name} makes a book with every shown record in it`, () => {
    const input = fixtureInput(name);
    const book = buildBook(input);
    assert.ok(book.chapters.length >= 1 && book.chapters.length <= 6);
    for (const chapter of book.chapters) {
      assert.match(chapter.slug, /^[a-z0-9]+(?:-[a-z0-9]+)*$/);
      assert.ok(chapter.slug.length <= 64);
      assert.notEqual(chapter.slug, 'back-matter');
    }
    const ids = accounted(book);
    const shownIds = new Set(
      input.portfolio.sections.flatMap((s) =>
        'items' in s && Array.isArray(s.items) ? (s.items as unknown[]) : [],
      ),
    );
    for (const record of [...input.portfolio.works, ...input.portfolio.evidence]) {
      if (!shownIds.has(record.id)) continue;
      assert.ok(ids.has(record.id), `${name}: ${record.id} is in the book`);
    }
  });
}

// The owner's overrides (concept, "OPTIONAL owner overrides"; K-3's periodList and
// recordPlacement): their own chapters replace the derived boundaries and titles, and a move
// puts a record in another chapter. The host holds a stored value to the contract and renders
// the default when it fails; the book checks again, so a value that reaches it malformed
// prints the derived book, never a broken one.

const OWN = [
  { slug: 'school', title: 'School', from: '2010' },
  {
    slug: 'search',
    title: 'Search at Mosaic',
    from: '2018-08',
    teaser: 'Where I learned to measure.',
  },
  { slug: 'payments-year-one', title: 'Payments, year one', from: '2023-04' },
  { slug: 'payments-now', title: 'Payments, now', from: '2024-06' },
];

/** The book from an input whose controls reached it unchecked, as if the host let them by. */
const raw = (input: VariantRenderInput, controls: Record<string, unknown>) =>
  buildBook({
    ...input,
    controls: { ...input.controls, ...controls } as VariantRenderInput['controls'],
  });

const shape = (book: Book) => book.chapters.map((c) => [c.slug, c.title, c.span]);

test("the owner's chapters bind the sample: their titles, slugs and starts, records placing by date between them", () => {
  const book = buildBook(sampleInput(undefined, { chapters: OWN }));
  assert.equal(book.derivedFrom, 'owner');
  assert.deepEqual(book.overrides, { chapters: 'owner', moved: [], kept: [] });
  assert.deepEqual(shape(book), [
    ['school', 'School', '2010 to 2018'],
    ['search', 'Search at Mosaic', 'August 2018 to March 2023'],
    ['payments-year-one', 'Payments, year one', 'April 2023 to May 2024'],
    ['payments-now', 'Payments, now', 'Since June 2024'],
  ]);
  assert.equal(book.chapters[1]!.teaser, 'Where I learned to measure.');
  assert.equal(book.current?.slug, 'payments-now');
  // Each spine entry opens the chapter it starts in; the last chapter has none, and still holds
  // what's dated in it and the present tense.
  assert.deepEqual(
    book.chapters.map((c) => c.entries.length),
    [3, 1, 1, 0],
  );
  const rule = (id: string) => {
    const at = book.placed.get(id);
    return at ? `${at.chapter.slug}:${at.rule}` : undefined;
  };
  assert.equal(rule('postmortem-template-kit'), 'payments-year-one:linked');
  assert.equal(rule('karthik-subramanian'), 'search:organization');
  assert.equal(rule('small-traces'), 'payments-now:dated');
  assert.equal(rule('essays-published'), 'payments-now:present');
  // The cap and chapterTitles are for derived chapters: the owner's list is the book.
  const capped = buildBook(
    sampleInput(undefined, { chapters: OWN, maxChapters: 2, chapterTitles: 'years' }),
  );
  assert.deepEqual(shape(capped), shape(book));
  // Nothing is dropped, and pages run on.
  const derived = buildBook(sampleInput());
  assert.deepEqual([...accounted(book)].sort(), [...accounted(derived)].sort());
  assert.equal(book.chapters[0]!.firstPage, 1);
  for (const [i, c] of book.chapters.entries()) {
    if (i > 0) assert.equal(c.firstPage, book.chapters[i - 1]!.lastPage + 1);
  }
});

test("the owner's chapters split the five eras, and a move takes a spine entry with it", () => {
  const two = [
    { slug: 'early', title: 'Early years', from: '2010' },
    { slug: 'later', title: 'Later', from: '2019-01' },
  ];
  const book = buildBook(fiveEras({ chapters: two }));
  assert.deepEqual(shape(book), [
    ['early', 'Early years', '2010 to 2018'],
    ['later', 'Later', 'Since January 2019'],
  ]);
  assert.deepEqual(
    book.chapters.map((c) => c.entries.map((e) => e.id)),
    [
      ['role-0', 'role-1', 'role-2'],
      ['role-3', 'role-4'],
    ],
  );
  assert.deepEqual(
    book.chapters.map((c) => c.ink),
    [1, 2],
  );
  const moved = raw(fiveEras(), { chapters: two, place: { 'role-2': 'later' } });
  assert.deepEqual(
    moved.chapters.map((c) => c.entries.map((e) => e.id)),
    [
      ['role-0', 'role-1'],
      ['role-2', 'role-3', 'role-4'],
    ],
  );
  assert.deepEqual(moved.overrides.moved, ['role-2']);
  // A record dated before the first chapter starts goes in the first.
  const late = buildBook(
    fiveEras({ chapters: [{ slug: 'all', title: 'All of it', from: '2016-06' }] }),
  );
  assert.equal(late.placed.get('essay-0')?.chapter.slug, 'all');
});

test("a list the book can't bind is refused whole, and the derived chapters print", () => {
  const derived = shape(buildBook(sampleInput()));
  const cases: [string, unknown, string][] = [
    ['out of order', [OWN[1], OWN[0]], "chapter 2 doesn't start after the one before it"],
    [
      'the same start twice',
      [OWN[0], { ...OWN[1], from: '2010-01' }],
      "chapter 2 doesn't start after the one before it",
    ],
    [
      'a slug twice',
      [OWN[0], { ...OWN[1], slug: 'school' }],
      "chapter 2's slug is missing, malformed, taken or reserved",
    ],
    [
      'the back matter',
      [{ ...OWN[0], slug: 'back-matter' }],
      "chapter 1's slug is missing, malformed, taken or reserved",
    ],
    [
      'a path in a slug',
      [{ ...OWN[0], slug: '../home' }],
      "chapter 1's slug is missing, malformed, taken or reserved",
    ],
    [
      'markup in a title',
      [{ ...OWN[0], title: '<b>School</b>' }],
      "chapter 1's title isn't one plain line",
    ],
    ['a padded title', [{ ...OWN[0], title: ' School' }], "chapter 1's title isn't one plain line"],
    [
      'two lines',
      [{ ...OWN[0], title: 'School\nand after' }],
      "chapter 1's title isn't one plain line",
    ],
    [
      'a long title',
      [{ ...OWN[0], title: 'x'.repeat(61) }],
      "chapter 1's title isn't one plain line",
    ],
    ['a day', [{ ...OWN[0], from: '2010-01-04' }], "chapter 1's start isn't YYYY or YYYY-MM"],
    ['month 13', [{ ...OWN[0], from: '2010-13' }], "chapter 1's start isn't YYYY or YYYY-MM"],
    [
      'a long teaser',
      [{ ...OWN[0], teaser: 'x'.repeat(301) }],
      "chapter 1's teaser isn't plain text of 300 characters or fewer",
    ],
    ['an unknown key', [{ ...OWN[0], ink: 2 }], "chapter 1 isn't { slug, title, from, teaser? }"],
    ['not a period', ['school'], "chapter 1 isn't { slug, title, from, teaser? }"],
    [
      'eight',
      Array.from({ length: 8 }, (_, i) => ({ slug: `c${i}`, title: `C${i}`, from: `${2010 + i}` })),
      'more than 7 chapters',
    ],
    ['not a list', { school: '2010' }, 'not a list of chapters'],
    [
      'after now',
      [OWN[0], { slug: 'next', title: 'Next', from: '2031' }],
      'a chapter starts after now',
    ],
  ];
  for (const [name, value, reason] of cases) {
    const book = raw(sampleInput(), { chapters: value });
    assert.equal(book.derivedFrom, 'chronology', name);
    assert.deepEqual(book.overrides, { chapters: 'refused', reason, moved: [], kept: [] }, name);
    assert.deepEqual(shape(book), derived, name);
    // The host refuses it too, before the book sees it, except what only the book knows: the
    // render's now, and its own back matter's name.
    if (name !== 'after now' && name !== 'the back matter') {
      assert.deepEqual(sampleInput(undefined, { chapters: value }).controls.chapters, [], name);
    }
  }
  // An empty or absent list is the derived book, with nothing refused.
  for (const value of [[], undefined, null]) {
    assert.equal(raw(sampleInput(), { chapters: value }).overrides.chapters, 'derived');
  }
  assert.deepEqual(periodsOf(OWN).periods, OWN);
});

test('a move puts a record in another chapter; one the book cannot make keeps its derived place', () => {
  const book = raw(sampleInput(), {
    place: {
      // Uncollected into a chapter, and a testimonial out of its organization's.
      'chaos-curriculum': 'mosaic-search',
      'mira-anand': 'nit-karnataka-and-iit-bombay',
      // A link holds its work, and a parent its side thread (rule a comes first).
      'postmortem-template-kit': 'mosaic-search',
      'hosting-incident-history': 'mosaic-search',
      // External work keeps Also by; no such record; no such chapter.
      'anamika-photography': 'mosaic-search',
      'no-such-record': 'mosaic-search',
      'small-traces': 'no-such-chapter',
    },
  });
  const rule = (id: string) => {
    const at = book.placed.get(id);
    return at ? `${at.chapter.n}:${at.rule}` : undefined;
  };
  assert.equal(rule('chaos-curriculum'), '2:override');
  assert.equal(rule('mira-anand'), '1:override');
  assert.equal(rule('postmortem-template-kit'), '3:linked');
  assert.equal(rule('hosting-incident-history'), '3:branchesFrom');
  assert.equal(rule('small-traces'), '3:dated');
  assert.equal(book.back.uncollected.length, 0);
  assert.ok(book.back.alsoBy.some(({ evidence }) => evidence.id === 'anamika-photography'));
  assert.deepEqual(book.overrides.moved, ['chaos-curriculum', 'mira-anand']);
  assert.deepEqual(book.overrides.kept, [
    'postmortem-template-kit',
    'hosting-incident-history',
    'anamika-photography',
    'no-such-record',
    'small-traces',
  ]);
  // Through the host, a map that fits places the same; one with a dangling id is refused whole.
  const hosted = buildBook(
    sampleInput(undefined, { place: { 'chaos-curriculum': 'mosaic-search' } }),
  );
  assert.equal(hosted.placed.get('chaos-curriculum')?.rule, 'override');
  assert.deepEqual(
    sampleInput(undefined, {
      place: { 'chaos-curriculum': 'mosaic-search', nope: 'mosaic-search' },
    }).controls.place,
    {},
  );
  // A malformed map is refused whole: no moves at all, and the book says why.
  const many = Object.fromEntries(
    Array.from({ length: 257 }, (_, i) => [`record-${i}`, 'mosaic-search']),
  );
  for (const [value, reason] of [
    ['mosaic-search', 'not a map of record ids to chapter slugs'],
    [['chaos-curriculum'], 'not a map of record ids to chapter slugs'],
    [{ 'chaos-curriculum': 3 }, "the move of chaos-curriculum doesn't name a chapter slug"],
    // One bad move refuses the good one beside it.
    [{ 'chaos-curriculum': 'mosaic-search', x: 3 }, "the move of x doesn't name a chapter slug"],
    [
      { 'chaos-curriculum': 'Mosaic Search' },
      "the move of chaos-curriculum doesn't name a chapter slug",
    ],
    [{ ...many, 'chaos-curriculum': 'mosaic-search' }, 'more than 256 moves'],
  ] as const) {
    assert.deepEqual(placeOf(value), { moves: {}, refused: reason });
    const refused = raw(sampleInput(), { place: value });
    assert.equal(refused.placed.get('chaos-curriculum')?.rule, undefined, reason);
    assert.deepEqual(refused.overrides.placeRefused, reason);
    assert.deepEqual(refused.overrides.moved, []);
  }
  // Absent, or exactly 256 well-formed moves, is no refusal.
  assert.deepEqual(placeOf(null), { moves: {} });
  const most = Object.fromEntries(Object.entries(many).slice(0, 256));
  assert.equal(placeOf(most).refused, undefined);
});

test("every contract fixture binds the owner's chapters, or refuses them, and loses no record", () => {
  const own = [
    { slug: 'before', title: 'Before', from: '2000' },
    { slug: 'since', title: 'Since', from: '2020-01', teaser: 'The years since.' },
  ];
  for (const name of FIXTURE_NAMES) {
    const derived = buildBook(fixtureInput(name));
    const book = buildBook(fixtureInput(name, { chapters: own }));
    assert.equal(book.derivedFrom, 'owner', name);
    assert.deepEqual(
      book.chapters.map((c) => c.slug),
      ['before', 'since'],
      name,
    );
    assert.deepEqual([...accounted(book)].sort(), [...accounted(derived)].sort(), name);
    const bad = raw(fixtureInput(name), { chapters: [own[1], own[0]], place: 'everything' });
    assert.deepEqual(shape(bad), shape(derived), name);
  }
});

test('optionsOf holds the spine and folios to their values, else their defaults', () => {
  assert.equal(optionsOf({ spine: 'top' }).spine, 'top');
  assert.equal(optionsOf({ spine: 'off' }).spine, 'off');
  assert.equal(optionsOf({ spine: 'right' }).spine, 'left');
  assert.equal(optionsOf({ folios: false }).folios, false);
  assert.equal(optionsOf({ folios: 'no' }).folios, true);
});

/** How many times each record prints: across every chapter's parts, and the back matter's Uncollected. */
function printings(book: Book): Map<string, number> {
  const times = new Map<string, number>();
  const add = (id: string) => times.set(id, (times.get(id) ?? 0) + 1);
  for (const chapter of book.chapters) {
    for (const part of chapter.parts) {
      if (part.type === 'plate' || part.type === 'series') add(part.work.id);
      if (part.type === 'flow') for (const record of part.group.records) add(record.id);
      if (part.type === 'groups')
        for (const group of [...part.verso, ...part.recto])
          for (const record of group.records) add(record.id);
    }
  }
  for (const group of book.back.uncollected) for (const record of group.records) add(record.id);
  return times;
}

test('every record prints exactly once: on the sample, the five eras, the owner chapters and every fixture', () => {
  const books: [string, Book][] = [
    ['sample', buildBook(sampleInput())],
    ['sample in the owner chapters', buildBook(sampleInput(undefined, { chapters: OWN }))],
    [
      'sample with moves',
      raw(sampleInput(), {
        place: {
          'chaos-curriculum': 'mosaic-search',
          'mira-anand': 'nit-karnataka-and-iit-bombay',
        },
      }),
    ],
    ['five eras', buildBook(fiveEras())],
    ...FIXTURE_NAMES.flatMap((name): [string, Book][] => [
      [name, buildBook(fixtureInput(name))],
      [
        `${name} in two owner chapters`,
        buildBook(
          fixtureInput(name, {
            chapters: [
              { slug: 'before', title: 'Before', from: '2000' },
              { slug: 'since', title: 'Since', from: '2020-01' },
            ],
          }),
        ),
      ],
    ]),
  ];
  for (const [name, book] of books) {
    const twice = [...printings(book)].filter(([, n]) => n !== 1).map(([id]) => id);
    assert.deepEqual(twice, [], `${name}: printed more than once`);
    // And each record the book's locators name is one that prints, and only those.
    assert.deepEqual([...printings(book).keys()].sort(), [...book.printed.keys()].sort(), name);
  }
});
