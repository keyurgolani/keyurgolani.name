import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { renderToStaticMarkup } from 'react-dom/server';
import type { RouteTarget, VariantRenderInput } from '@portfolio/variant-contract';
import { pageOutline } from '@portfolio/kit/sections';
import { checkOutline } from '@portfolio/variant-contract/node';
import {
  count,
  FIXTURE_NAMES,
  fixtureInput,
  fiveEras,
  fragmentLinks,
  idsIn,
  inputFor,
  MANIFEST,
  pairOf,
  PACKAGE_DIR,
  renderInput,
  sampleInput,
} from './__tests__/harness.test';
import { metricParts } from './entries';
import { buildBook } from './model/book';
import { Unbroken, UNBROKEN_MAX } from './text';

// Every page of the book, on the sample and every contract fixture, held to
// the contract's outline (one h1, the skip link's main, heading order, named
// navigation, real links) and to the book's own promises: one visitor slot
// per page, each section framed once at most, every fragment landing, the
// chapters linked by their path view, and nothing through the kit's shared
// renderers. Then the five conditions of the P-0 review, read from the
// markup and the stylesheet.

const [CHAPTER, BACK] = MANIFEST.routes.views;

/** Every route of the book for an input: home, the back matter, each chapter, each case study, an unknown chapter. */
function routes(input: VariantRenderInput): [string, RouteTarget][] {
  const book = buildBook(input);
  return [
    ['home', { route: 'home' }],
    ['back-matter', { route: 'view', view: BACK!, params: {} }],
    ...book.chapters.map(
      (c) =>
        [`chapter ${c.slug}`, { route: 'view', view: CHAPTER!, params: { chapter: c.slug } }] as [
          string,
          RouteTarget,
        ],
    ),
    ...input.portfolio.works
      .filter((w) => w.caseStudy && w.slug)
      .map((w) => [`work ${w.slug}`, { route: 'work', slug: w.slug! }] as [string, RouteTarget]),
    ['unknown chapter', { route: 'view', view: CHAPTER!, params: { chapter: 'no-such-chapter' } }],
  ];
}

/** The owner's own chapters, as an owner might list them for the sample. */
const OWN_CHAPTERS = [
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
/** Two chapters any fixture can take: before 2020 and since. */
const TWO_CHAPTERS = [
  { slug: 'before', title: 'Before', from: '2000' },
  { slug: 'since', title: 'Since', from: '2020-01', teaser: 'The years since.' },
];

const PAIRS: [string, () => VariantRenderInput][] = [
  ['sample', () => sampleInput()],
  ['sample with a preview prefix', () => sampleInput('pv-')],
  [
    "sample in the owner's chapters, with a move",
    () =>
      sampleInput(undefined, {
        chapters: OWN_CHAPTERS,
        place: { 'chaos-curriculum': 'search' },
      }),
  ],
  ["five eras in two of the owner's", () => fiveEras({ chapters: TWO_CHAPTERS })],
  ...FIXTURE_NAMES.flatMap((name) => [
    [name, () => fixtureInput(name)] as [string, () => VariantRenderInput],
    [`${name} in the owner's chapters`, () => fixtureInput(name, { chapters: TWO_CHAPTERS })] as [
      string,
      () => VariantRenderInput,
    ],
  ]),
];

for (const [name, make] of PAIRS) {
  test(`${name}: every page holds the outline and the book's own rules`, () => {
    const base = make();
    const framedAnywhere = new Set<string>();
    for (const [label, route] of routes(base)) {
      const input = { ...base, route };
      const html = renderInput(input);
      const where = `${name} ${label}`;
      // Every frame on the page holds to its shape; which sections home must frame is the
      // app's sweep's (apps/web composition-outline), with the unit's outlineKnown.
      const findings = checkOutline(html, input.ids, {});
      assert.deepEqual(findings, [], where);
      assert.equal(count(html, /data-visitor-control-slot/g), 1, `${where}: one visitor slot`);
      assert.equal(count(html, /data-renderer="shared"/g), 0, `${where}: no shared renderer`);
      const sections = [...html.matchAll(/data-section-id="([^"]+)"/g)].map(([, id]) => id!);
      assert.equal(new Set(sections).size, sections.length, `${where}: each section framed once`);
      for (const id of sections) framedAnywhere.add(id);
      const ids = idsIn(html);
      assert.equal(new Set(ids).size, ids.length, `${where}: ids are unique`);
      for (const id of ids)
        assert.ok(id.startsWith(input.ids.prefix), `${where}: ${id} has the prefix`);
      const known = new Set(ids);
      for (const target of fragmentLinks(html))
        assert.ok(known.has(target), `${where}: #${target} lands`);
      // Write lands on the contact section's own frame, by its content id as on every
      // composition (the motion contract's jump clicks it), or on the colophon without one.
      const contact = buildBook(input).colophon.contact;
      const write = /<a href="#([^"]+)">Write<span class="ch-wide">/.exec(html)?.[1];
      assert.equal(
        write,
        `${input.ids.prefix}${contact?.id ?? 'ch--colophon'}`,
        `${where}: Write's target`,
      );
      if (contact)
        assert.match(
          html,
          new RegExp(`<section [^>]*id="${write}" data-section-id="${contact.id}"`),
          `${where}: Write lands on the contact frame`,
        );
    }
    // Each section the page outline lists has its frame on some page of the book: home, the
    // back matter, or a chapter, a proof-only one in the imprint (the app's sweep reads home
    // and the back matter alone, so the unit lists the rest as known).
    const unframed = pageOutline(base)
      .sections.map(({ id }) => id)
      .filter((id) => !framedAnywhere.has(id));
    assert.deepEqual(unframed, [], `${name}: every section is framed somewhere`);
  });
}

test('the chapters are linked by their path view below the mount point, and an unknown one is the home page with its note, noindex', () => {
  const input = sampleInput();
  const home = renderInput(input);
  assert.match(home, /href="\/sample\/chapters\/solstice-payments"/);
  assert.match(home, /href="\/sample\/back-matter#ch--index"|href="\/sample\/back-matter"/);
  const unknown = renderInput({
    ...input,
    route: { route: 'view', view: CHAPTER!, params: { chapter: 'no-such-chapter' } },
  });
  assert.match(unknown, /<meta name="robots" content="noindex"\/>/);
  assert.match(unknown, /No chapter by that name\./);
  assert.match(unknown, /class="tp-title"/);
});

test('the chapter view is its era: the opener, the plates, the close, and the turnstile on to the back matter', () => {
  const input = sampleInput();
  const html = renderInput({
    ...input,
    route: { route: 'view', view: CHAPTER!, params: { chapter: 'solstice-payments' } },
  });
  assert.equal(count(html, /<h1/g), 1);
  assert.match(html, /class="op-num" aria-hidden="true">3</);
  assert.match(html, /Plate 3\.1/);
  assert.match(html, /Still being written/);
  assert.match(html, /href="\/sample\/back-matter"/);
  assert.match(html, /href="\/sample\/work\/postmortem-template-kit"/);
});

test('P1-6: a plate keeps its two folios on a phone; a series and a lone group print theirs joined', () => {
  const html = renderInput({
    ...sampleInput(),
    route: { route: 'view', view: CHAPTER!, params: { chapter: 'solstice-payments' } },
  });
  const spreads = [
    ...html.matchAll(/<(?:article|div) class="ch-spread ch-spread--(\w+)[^"]*"[^>]*id="([^"]+)"/g),
  ];
  const joined = new Map<string, boolean>();
  spreads.forEach((match, i) => {
    const end = spreads[i + 1]?.index ?? html.length;
    joined.set(`${match[1]} ${match[2]}`, html.slice(match.index, end).includes('ch-folio--both'));
  });
  assert.equal(joined.get('plate postmortem-template-kit'), false);
  assert.equal(joined.get('plate small-traces'), false);
  assert.equal(joined.get('series looking-photographs'), true);
  assert.equal(joined.get('flow incident-history--pages'), true);
  const groups = [...joined].filter(([key]) => key.startsWith('groups '));
  assert.ok(groups.length > 0);
  for (const [key, both] of groups) assert.equal(both, false, key);
});

test("the owner's chapters print their titles and teasers, and their slugs are the chapter paths", () => {
  const controls = { chapters: OWN_CHAPTERS, place: { 'chaos-curriculum': 'search' } };
  const home = renderInput(sampleInput(undefined, controls));
  assert.match(home, /href="\/sample\/chapters\/payments-year-one"/);
  assert.match(
    home,
    /<p class="toc__teaser" data-type-role="body-compact">Where I learned to measure\.<\/p>/,
  );
  assert.doesNotMatch(home, /chapters\/solstice-payments/);
  // P2-17: the owner named them, so the contents names no sections they were made from.
  assert.match(
    home,
    /<p class="toc__from" data-type-role="body-compact">[A-Z][a-z]+ chapters\.<\/p>/,
  );
  const search = renderInput(
    sampleInput(undefined, controls, {
      route: 'view',
      view: CHAPTER!,
      params: { chapter: 'search' },
    }),
  );
  assert.match(
    search,
    /<span class="op-title__t" data-type-role="headline">Search at Mosaic<\/span>/,
  );
  assert.match(
    search,
    /<p class="op-teaser" data-type-role="body">Where I learned to measure\.<\/p>/,
  );
  // The move: chaos-curriculum prints in the chapter, and the back matter has no Uncollected.
  assert.match(
    search.replace(/<[^>]+>/g, ''),
    /A four-week curriculum for teaching engineering teams/,
  );
  const back = renderInput(
    sampleInput(undefined, controls, { route: 'view', view: BACK!, params: {} }),
  );
  assert.doesNotMatch(back, /Uncollected/);
  // The derived slug is an unknown chapter now: the contents, with its note.
  const old = renderInput(
    sampleInput(undefined, controls, {
      route: 'view',
      view: CHAPTER!,
      params: { chapter: 'solstice-payments' },
    }),
  );
  assert.match(old, /No chapter by that name\./);
});

test('the spine control marks the book, and with folios off no page prints a page number', () => {
  const top = renderInput(sampleInput(undefined, { spine: 'top' }));
  assert.match(top, /<div class="ch" data-view="home" data-ink="0" data-spine="top">/);
  assert.match(CSS, /\.ch\[data-spine='top'\] \.ch-progress \{ display: flex; \}/);
  assert.match(
    CSS,
    /\.ch:is\(\[data-spine='top'\], \[data-spine='off'\]\) \.ch-edge \{ display: none; \}/,
  );
  assert.match(CSS, /\.ch\[data-folios='off'\] \.ch-folio \{ display: none; \}/);
  const off = { folios: false };
  const base = sampleInput(undefined, off);
  for (const [label, route] of routes(base)) {
    const html = renderInput({ ...base, route });
    assert.match(html, /data-folios="off"/, label);
    assert.doesNotMatch(html, /class="(?:toc__pg|op-map__pg)"/, label);
    // No page cited in words; the text a reader sees names chapters instead.
    const text = html.replace(/<[^>]+>/g, ' ');
    assert.doesNotMatch(text, /\bpages? \d/i, label);
  }
  const back = renderInput({ ...base, route: { route: 'view', view: BACK!, params: {} } });
  const index = [...back.matchAll(/class="ix__pg"[^>]*>([^<]+)</g)].map(([, n]) => n);
  assert.ok(index.length > 0);
  for (const n of index) assert.match(n!, /^(?:\d|B)$/);
  const chapter = renderInput({
    ...base,
    route: { route: 'view', view: CHAPTER!, params: { chapter: 'solstice-payments' } },
  });
  // A plate's cite of its evidence names the chapter, not a page.
  assert.match(chapter, /, <a href="[^"]*">chapter 3<\/a>/);
});

test('the back matter: its kicker, Uncollected one level under its own heading, and the index framed by sections', () => {
  const html = renderInput({
    ...sampleInput(),
    route: { route: 'view', view: BACK!, params: {} },
  });
  assert.match(html, /<span class="op-kicker ch-caps">After the last chapter<\/span>/);
  const unc = html.slice(html.indexOf('>Uncollected</h2>'));
  assert.match(
    unc,
    /^>Uncollected<\/h2>[\s\S]*?<h3 class="gp__t"[^>]*>Work Showcase<\/h3>[\s\S]*?<h4 class="it__t"/,
  );
  assert.match(html, /<section class="fl ix" id="skills" data-section-id="skills"/);
  assert.match(
    html,
    /<section class="ix__terms" id="stack-i-currently-reach-for" data-section-id="stack-i-currently-reach-for"/,
  );
});

test("P2-D and P2-F: the case's fact sheet names Recognized once; the contents keeps each run whole", () => {
  const work = renderInput({
    ...sampleInput(),
    route: { route: 'work', slug: 'postmortem-template-kit' },
  });
  assert.equal(count(work, /<dt>Recognized<\/dt>/g), 1);
  assert.match(
    work,
    /SREcon Practitioner Award, <a [^>]*>page 15<\/a><\/span><span>; How to Write/,
  );
  const home = renderInput(sampleInput());
  assert.match(
    home,
    /<span class="toc__run">Since April 2023\.<\/span> <span class="toc__run">Principal Engineer, Reliability\.<\/span>/,
  );
});

test("the contents names the owner's chronology sections its chapters are made from", () => {
  assert.match(
    renderInput(sampleInput()),
    /<p class="toc__from" data-type-role="body-compact">Three chapters, from Experience and Education\.<\/p>/,
  );
  // Each title a section the book splits across chapters still prints in the book.
  const academic = renderInput(fixtureInput('academic'));
  assert.match(
    academic,
    /class="toc__from"[^>]*>[^<]*(?:Education[^<]*Positions|Positions[^<]*Education)/,
  );
});

test('P1-10: a metric hangs its number alone; a unit its statement does not open opens the words', () => {
  const input = inputFor(
    pairOf({
      schemaVersion: 3,
      locale: 'en',
      direction: 'ltr',
      identity: { name: 'Rowan Vale', tagline: 'Builds things' },
      evidence: [
        {
          id: 'ships',
          type: 'metric',
          statement: 'Built for the fleet',
          description: 'Since launch.',
          metric: { value: 1200, unit: 'cargo ships' },
        },
        {
          id: 'years',
          type: 'metric',
          statement: 'Years engineering',
          metric: { value: 12, unit: 'years' },
        },
        {
          id: 'bare',
          type: 'metric',
          statement: 'Ships built',
          metric: { key: 'ships-built', unit: 'ships' },
        },
      ],
      sections: [
        { kind: 'hero', id: 'top' },
        { kind: 'evidence', id: 'proof', title: 'Proof', items: ['ships', 'years', 'bare'] },
      ],
    }),
  );
  const of = (id: string) =>
    metricParts(
      input.portfolio.evidence.find((e) => e.id === id)!,
      input,
    );
  // The unit leads the words, its own words and the next one bound: "cargo ships, built ...".
  assert.deepEqual(of('ships'), {
    figure: '1,200',
    rest: 'cargo\u00a0ships,\u00a0built for the fleet, since launch',
  });
  // A unit the statement opens is said once, by the statement.
  assert.deepEqual(of('years'), { figure: '12', rest: 'years engineering' });
  // No number, no figure: the unit is not printed on its own.
  assert.deepEqual(of('bare'), { figure: '', rest: 'ships built' });
});

test("M4 and P2-10: the thesis section's title prints in the colophon, never on the title page, and names the title's article", () => {
  const home = renderInput(sampleInput());
  assert.match(
    home,
    /<p class="ch-endpaper__end" data-type-role="caption">Anamika Devi\. The title is from <i id="ch--title-from">Practice<\/i>\. /,
  );
  assert.match(home, /<article class="tp-thesis"[^>]*aria-labelledby="ch--title-from"/);
  assert.doesNotMatch(home.slice(0, home.indexOf('ch-endpaper')), /The title is from/);
  assert.doesNotMatch(home, /aria-label="Practice"/);
});

test("the content sweep's fields: what the owner wrote prints in the book", () => {
  const back = renderInput({ ...sampleInput(), route: { route: 'view', view: BACK!, params: {} } });
  // Also by: the highlights, the owner's button text, the URL's label; the section's subtitle.
  assert.match(back, /<b class="it__fig ch-nobreak">120\+<\/b> Published frames/);
  assert.match(back, /<span class="it__url"> incidenthistory\.fm<\/span>/);
  assert.match(back, /A few homes for work that doesn/);
  // The index names the author's own groups.
  assert.match(back, /<li class="ix__head"><span>Runtimes<\/span>/);
  // A plate without a cover is captioned by its image's own caption.
  const complete = fixtureInput('complete');
  const chapters = buildBook(complete).chapters;
  const html = chapters
    .map((c) =>
      renderInput({
        ...complete,
        route: { route: 'view', view: CHAPTER!, params: { chapter: c.slug } },
      }),
    )
    .join('');
  assert.match(
    html,
    /<span class="pl__no">Plate [\d.]+<\/span> <span>Gallery caption, Gallery location\.<\/span>/,
  );
  assert.match(html, /<dt>Filed under<\/dt><dd>[^<]*Gallery tag/);
});

test("every link home gives to a chapter, the back matter or a case is root-relative, as the app's sweeps read them", () => {
  for (const make of [
    () => sampleInput(),
    ...FIXTURE_NAMES.map((name) => () => fixtureInput(name)),
  ]) {
    const html = renderInput(make());
    const book = [...html.matchAll(/\shref="([^"]*)"/g)]
      .map(([, href]) => href!)
      .filter(
        (href) => /(?:^|\/)(?:chapters\/|back-matter|work\/)/.test(href) && !/^[a-z]+:/i.test(href),
      );
    assert.ok(book.length > 0);
    for (const href of book) assert.match(href, /^\//, href);
  }
});

test("M1: a proof record's Markdown renders as Markdown, never as the marks the owner typed", () => {
  const input = inputFor(
    pairOf({
      schemaVersion: 3,
      locale: 'en',
      direction: 'ltr',
      identity: { name: 'Rowan Vale', tagline: 'Builds things' },
      evidence: [
        {
          id: 'shipyard',
          type: 'award',
          title: 'Shipyard',
          statement: '**Thirty** teams deploy with [it](https://shipyard.test).',
        },
        {
          id: 'essays',
          type: 'metric',
          statement: '**Essays** _published_',
          metric: { value: 47 },
        },
        { id: 'quiet', type: 'award', statement: 'Named **best** in [show](https://show.test)' },
      ],
      proof: ['shipyard', 'essays', 'quiet'],
      sections: [
        { kind: 'hero', id: 'top' },
        { kind: 'evidence', id: 'proof', title: 'Proof', items: ['shipyard', 'essays', 'quiet'] },
      ],
    }),
  );
  const html = renderInput(input);
  const band = html.slice(html.indexOf('class="tp-band__r"'));
  assert.doesNotMatch(band, /\*\*|\]\(|_published_/);
  // The titled record: the link on its name, then its words as Markdown, the owner's link kept.
  assert.match(
    band,
    /Shipyard<\/a>\. <span class="pf-rich-text"><strong>Thirty<\/strong> teams deploy with <a href="https:\/\/shipyard\.test">it<\/a>/,
  );
  // The metric's sentence and the untitled record's name are their words.
  assert.match(band, /essays published/);
  assert.match(band, /Named best in show/);
});

test("M2: a case page prints every one of the work's media, its other images as plates and a document by its caption", () => {
  const input = fixtureInput('complete');
  const html = renderInput({ ...input, route: { route: 'work', slug: 'project-name' } });
  assert.match(
    html,
    /<span class="pl__no">Plate \d+\.1a<\/span> <span>Project shot caption\.<\/span>/,
  );
  // P1-9: lettered from the insert's plate, never a chapter's number.
  assert.match(html, /<span class="pl__no">Plate \d+\.1b<\/span> Project document caption\./);
  assert.doesNotMatch(html, /Plate \d+\.2</);
});

test("C2 on the title page: a proof record's plain words keep a hyphenated name whole", () => {
  const home = renderInput(sampleInput());
  const band = home.slice(home.indexOf('class="tp-band__r"'));
  assert.match(band, /<span class="ch-nobreak">postmortem-template-kit<\/span>/);
});

test('P1-7: every "see" in the index lands on a headword that carries its members', () => {
  for (const make of [
    () => sampleInput(),
    ...FIXTURE_NAMES.map((name) => () => fixtureInput(name)),
  ]) {
    const input = make();
    const book = buildBook(input);
    if (!book.back.parts.some((part) => part.key === 'index')) continue;
    const back = renderInput({ ...input, route: { route: 'view', view: BACK!, params: {} } });
    const targets = new Set(
      book.back.terms
        .filter((term) => term.locators.length === 0)
        .flatMap((term) => term.groups.filter((group) => group !== term.name)),
    );
    for (const target of targets) {
      const at = back.indexOf(`<li class="ix__head"><span>${target.replace(/&/g, '&amp;')}</span>`);
      assert.ok(at >= 0, `${target} is a headword`);
      assert.match(back.slice(at, at + 4000), /<ul class="ix__sub" role="list"><li>/, target);
    }
  }
});

test('P1-8: an assembled line never starts a sentence in lowercase, and a role line names no tool', () => {
  for (const make of [
    () => sampleInput(),
    ...FIXTURE_NAMES.map((name) => () => fixtureInput(name)),
  ]) {
    const input = make();
    const book = buildBook(input);
    const pages = [
      renderInput({ ...input, route: { route: 'view', view: BACK!, params: {} } }),
      ...book.chapters.map((c) =>
        renderInput({
          ...input,
          route: { route: 'view', view: CHAPTER!, params: { chapter: c.slug } },
        }),
      ),
    ];
    for (const html of pages) {
      for (const [, line] of html.matchAll(
        /<p class="(?:it__meta|op-along)"[^>]*>([\s\S]*?)<\/p>/g,
      )) {
        const text = line!.replace(/<[^>]+>/g, '').replace(/&#x27;|&quot;|&amp;/g, ' ');
        assert.doesNotMatch(text, /\. [a-z]/, text);
      }
    }
  }
  const back = renderInput({ ...sampleInput(), route: { route: 'view', view: BACK!, params: {} } });
  const entry = back.slice(back.indexOf('id="chaos-curriculum"'));
  const role = /<p class="it__meta"[^>]*>([^<]*Curriculum author[^<]*)<\/p>/.exec(entry)?.[1];
  assert.ok(role);
  assert.doesNotMatch(role!, /Markdown|Curriculum design/);
  assert.match(
    entry,
    /<p class="it__meta" data-type-role="body-compact">Made with Curriculum design and Markdown\.<\/p>/,
  );
  // The side thread's own words already name where it grew from: no second sentence.
  const chapter = renderInput({
    ...sampleInput(),
    route: { route: 'view', view: CHAPTER!, params: { chapter: 'solstice-payments' } },
  });
  assert.doesNotMatch(chapter, /It grew out of the work as/);
});

// The P-0 review's five conditions.
// The stylesheet as one line of text, comments out, so the checks read it however it's wrapped.
const CSS = readFileSync(path.join(PACKAGE_DIR, 'src', 'styles.css'), 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/\s+/g, ' ')
  .replace(/\( /g, '(')
  .replace(/ \)/g, ')')
  .replace(/, \)/g, ')');

test('C1: no rule sets a weight of its own on a type role; book-serif ships its titles at 600 only', () => {
  const weights = [...CSS.matchAll(/font-weight:\s*([^;}]+)/g)].map(([, value]) => value!.trim());
  for (const value of weights) {
    assert.ok(
      /^var\(--type-[a-z-]+-font-weight\)$/.test(value) || value === '600',
      `font-weight ${value} reads a role's weight, or is the 600 of a bold run`,
    );
  }
  // The 600 is only ever on a run of bold text inside a line, never on a role's element.
  for (const [, selector] of CSS.matchAll(/([^{}]+)\{[^}]*font-weight:\s*600/g)) {
    assert.match(
      selector!,
      /(\bb\b|__title|__who)\s*$/,
      `${selector!.trim()} sets 600 on a run, not a role`,
    );
  }
  const html = renderInput(sampleInput());
  assert.doesNotMatch(html, /class="tp-author" data-type-role="title"/);
});

test('C2: the measures count characters as the faces render, and tables, meta lines and dates never wrap early', () => {
  assert.match(
    CSS,
    /--layout-measure-scale: calc\(var\(--type-body-size-adjust\) \/ var\(--type-body-aspect\)\)/,
  );
  for (const part of [
    '.ch-facts',
    '.op-map li',
    '.tp-proof li',
    '.it__meta',
    '.toc__yr',
    '.pl__tracks li',
    '.ch-bars li',
  ]) {
    assert.ok(CSS.includes(part), `${part} is released from the compact measure`);
  }
  assert.match(CSS, /:is\(\.ch-date, \.ch-nobreak[^)]*\) \{ white-space: nowrap; \}/);
  assert.doesNotMatch(CSS, /\d+ch\b/, "no width in ch: the measures are the pack's");
});

test('C3: Now, as of a date, is not in the mono label role', () => {
  const html = renderInput({
    ...sampleInput(),
    route: { route: 'view', view: CHAPTER!, params: { chapter: 'solstice-payments' } },
  });
  assert.match(html, /class="cl__asof" data-type-role="body-compact">Now, as of/);
  assert.doesNotMatch(html, /data-type-role="label"/);
});

test('C4: on a phone the running head keeps Write beside Contents', () => {
  const html = renderInput(sampleInput());
  const recto = /<nav class="ch-runhead__recto"[\s\S]*?<\/nav>/.exec(html)![0];
  assert.match(recto, /<li><a href="\/sample#ch--contents">Contents<\/a><\/li>/);
  assert.match(
    recto,
    /<li><a href="#contact">Write<span class="ch-wide"> to Anamika<\/span><\/a><\/li>/,
  );
  assert.match(CSS, /@media \(width < 60rem\) \{[\s\S]*:is\(\.ch-runhead__gutter, \.ch-wide,/);
});

test("C5: folios, page numbers and durations sit on their row's baseline", () => {
  for (const selector of [
    '.op-map li',
    '.pl__tracks li',
    '.toc__a',
    '.ch-facts > div',
    '.tp-proof li',
  ]) {
    const rule = new RegExp(
      `${selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')} \\{[^}]*align-items: baseline`,
    );
    assert.match(CSS, rule, `${selector} aligns its items on the baseline`);
  }
  assert.match(CSS, /\.ch-folio \{[^}]*align-self: baseline/);
});

// The P1 design review's fixes.

/** The folio printed under the page that holds `id` in a view's markup: the verso's or the recto's of its spread. */
function folioUnder(html: string, id: string): string | undefined {
  const at = html.indexOf(` id="${id}"`);
  if (at < 0) return undefined;
  const start = html.lastIndexOf('class="ch-spread', at);
  const next = html.indexOf('class="ch-spread', at);
  const spread = html.slice(start, next < 0 ? undefined : next);
  const offset = at - start;
  const folio = (side: 'verso' | 'recto') =>
    new RegExp(`ch-folio--${side}" aria-hidden="true" data-type-role="numeric">([^<]+)<`).exec(
      spread,
    )?.[1];
  const recto = spread.indexOf('class="ch-page ch-page--recto"');
  return recto >= 0 && offset > recto ? folio('recto') : folio('verso');
}

for (const [name, make] of [
  ['sample', () => sampleInput()],
  ['five eras', fiveEras],
] as const) {
  test(`P1-1, ${name}: every locator is the folio printed under the page its record is set on`, () => {
    const input = make();
    const book = buildBook(input);
    let checked = 0;
    for (const chapter of book.chapters) {
      const html = renderInput({
        ...input,
        route: { route: 'view', view: CHAPTER!, params: { chapter: chapter.slug } },
      });
      for (const part of chapter.parts) {
        const records =
          part.type === 'groups'
            ? [...part.verso, ...part.recto].flatMap((g) => g.records.map((r) => [r.id, r.id]))
            : part.type === 'flow'
              ? part.group.records.map((r) => [r.id, r.id])
              : part.type === 'plate' || part.type === 'series'
                ? [[part.work.id, `${part.work.id}--title`]]
                : [];
        for (const [record, element] of records) {
          const at = book.printed.get(record!)!;
          assert.equal(
            String(at.page),
            folioUnder(html, element!),
            `${name}: ${record} in chapter ${chapter.n}`,
          );
          checked += 1;
        }
      }
      // In this chapter lists each part at the folio its heading prints under.
      for (const [, key, page] of html.matchAll(
        /<li><a href="#([^"]+)">[^<]*<\/a><span class="op-map__pg" data-type-role="numeric">(\d+)<\/span><\/li>/g,
      )) {
        const part = chapter.parts.find((p) => p.key === key)!;
        const element = part.type === 'plate' ? `${part.work.id}--title` : key!;
        assert.equal(page, folioUnder(html, element), `${name}: In this chapter, ${key}`);
      }
    }
    assert.ok(checked > 3, `${name}: checked ${checked} locators`);
    // The back matter's own list, each part at the folio it's set on.
    const back = renderInput({ ...input, route: { route: 'view', view: BACK!, params: {} } });
    for (const part of book.back.parts) {
      assert.equal(
        String(part.page),
        folioUnder(back, `ch--${part.key}`),
        `${name}: back matter ${part.key}`,
      );
    }
  });
}

test('P1-2: the case study is tipped in at its plate, its leaves 11a to 11h, none a page of the chapter', () => {
  const html = renderInput({
    ...sampleInput(),
    route: { route: 'work', slug: 'postmortem-template-kit' },
  });
  const folios = [
    ...html.matchAll(
      /ch-folio--(?:verso|recto)" aria-hidden="true" data-type-role="numeric">([^<]+)</g,
    ),
  ].map(([, f]) => f);
  const leaves = folios.filter((f) => /^\d+[a-z]$/.test(f!));
  assert.deepEqual(leaves, ['11a', '11b', '11c', '11d', '11e', '11f', '11g', '11h']);
  assert.match(html, /Chapter 3: Solstice Payments, page 11</);
});

test('P1-3: a caption or a fact value is one run of text, no space before its punctuation', () => {
  assert.doesNotMatch(CSS, /\.pl__cap \{[^}]*display: (flex|grid)/);
  assert.doesNotMatch(CSS, /\.ch-facts dd \{[^}]*display: (flex|grid)/);
  const input = sampleInput();
  const pages = [
    renderInput({
      ...input,
      route: { route: 'view', view: CHAPTER!, params: { chapter: 'solstice-payments' } },
    }),
    renderInput({ ...input, route: { route: 'work', slug: 'postmortem-template-kit' } }),
  ];
  const text = (html: string) => html.replace(/<[^>]+>/g, '');
  for (const html of pages) {
    const runs = [
      ...[...html.matchAll(/<figcaption class="pl__cap"[^>]*>([\s\S]*?)<\/figcaption>/g)].map(
        ([, c]) => c!,
      ),
      ...[...html.matchAll(/<dd>([\s\S]*?)<\/dd>/g)].map(([, c]) => c!),
    ];
    assert.ok(runs.length > 4);
    for (const run of runs) assert.doesNotMatch(text(run), /\s[.,;]/, text(run));
  }
});

test('C2: the release is on the list element, and quantities and hyphenated names never break', () => {
  assert.match(CSS, /\.ch :is\(ul, ol, dl\)\[data-type-role\] \{ max-inline-size: none; \}/);
  const html = renderInput({
    ...sampleInput(),
    route: { route: 'view', view: CHAPTER!, params: { chapter: 'solstice-payments' } },
  });
  assert.match(html, /<ul class="op-hl ch-bars" role="list" data-type-role="body-compact">/);
  assert.match(html, /<span class="ch-nobreak">14 min<\/span>/);
  assert.match(html, /<span class="ch-nobreak">postmortem-template-kit<\/span>/);
  const home = renderInput(sampleInput());
  assert.match(home, /<ul class="tp-proof" role="list" data-type-role="body-compact">/);
});

test('long text: no word widens a page', () => {
  // A one-column grid's implicit track starts at zero, so break-word breaks a long word in its
  // page (the long-text fixture's tagline in the imprint was 807 px wide at 390).
  assert.match(CSS, /:is\(\.ch, \.ch \*\) \{ grid-auto-columns: minmax\(0, auto\); \}/);
  // A hyphenated run is kept whole only while it fits a phone line.
  const short = 'a-'.repeat(UNBROKEN_MAX / 2 - 1) + 'ab';
  const long = 'Electroencephalographically-informed-neuroergonomic-interface';
  const html = renderToStaticMarkup(<Unbroken text={`${short} and ${long}`} />);
  assert.match(html, new RegExp(`<span class="ch-nobreak">${short}</span>`));
  assert.doesNotMatch(html, new RegExp(`nobreak">${long}`));
  assert.ok(html.includes(long));
});

test('P1-5: with no epigraph and no preface, the contents is set across both pages', () => {
  const html = renderInput(fiveEras());
  assert.match(html, /class="ch-spread ch-spread--contents ch-spread--wide"/);
  assert.doesNotMatch(html, /class="ch-page ch-page--recto"><div class="ch-page__in"><\/div>/);
  const sample = renderInput(sampleInput());
  assert.doesNotMatch(sample, /ch-spread--wide/);
});
