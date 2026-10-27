import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import {
  composeSchemas,
  resolvePortfolioView,
  type AppearanceCatalog,
  type ParsedPair,
  type Section,
} from '@portfolio/schema';
import { loadPair, readUnitFiles } from '@portfolio/schema/node';
import {
  buildRenderInput,
  validateManifest,
  type RouteTarget,
  type VariantRenderInput,
} from '@portfolio/variant-contract';
import { CONTRACT_FIXTURES, FIXTURES_DIR } from '@portfolio/variant-contract/node';
import {
  caseStudyOutline,
  composePages,
  footerOutline,
  KIND_FAMILIES,
  pageOutline,
  registerHostModules,
  renderSection,
  SHARED_RENDERERS,
  SHARED_SECTIONS,
  SharedFrame,
  type SectionComposition,
  type SectionFrameProps,
} from '.';

// The outline a composition's own navigation, case-study page, and footer
// read (stream E). It lists a section exactly when renderSection() renders
// it, by the same rule, so no link names a section that isn't on the page,
// and every anchor is the id the section's frame carries.

Object.assign(globalThis, { React });

const { PortfolioSchema, SiteSchema } = composeSchemas();

/** The appearance ids the contract fixtures name, as their own test lists them. */
const IDS = {
  colorScheme: ['warm', 'warm-parchment', 'noir', 'ink-and-paper', 'nebula', 'aurora', 'solar'],
  typography: ['classic', 'humanist-ui', 'modernist', 'geometric', 'humanist'],
  displayMode: ['system', 'light', 'dark', 'high-contrast'],
} as const;
const CATALOG: AppearanceCatalog = {
  ids: (axis) => (axis in IDS ? IDS[axis as keyof typeof IDS] : null),
  generatorInput: () => undefined,
};

function manifestWith(extra: Record<string, unknown> = {}) {
  const result = validateManifest(
    {
      id: 'kit-outline',
      name: 'Outline',
      promise: 'A test composition for the outline.',
      description: 'A test composition for the kit.',
      contract: '2.0',
      schemas: { portfolio: { min: 3, max: 3 }, site: { min: 2, max: 2 } },
      tokenContract: 1,
      compositionFamily: 'document',
      motionIntent: 'still',
      performanceTier: 'light',
      renderedKinds: [],
      unsupportedKinds: [],
      contentSlots: [],
      routes: { home: 'shared', work: 'shared', views: [] },
      controls: { version: 1, items: [], migrations: [] },
      visitorControl: { placement: 'header' },
      textDirection: ['ltr', 'rtl'],
      provenance: { provisional: false, sources: [] },
      ...extra,
    },
    { packageName: '@kit/outline' },
  );
  assert.ok(result.ok, JSON.stringify(result.diagnostics));
  return result.manifest;
}

interface Options {
  readonly manifest?: Record<string, unknown>;
  readonly route?: RouteTarget;
  readonly idPrefix?: string;
  readonly basePath?: string;
  readonly query?: Record<string, string>;
}

function inputOf(
  pair: ParsedPair,
  unit: Parameters<typeof resolvePortfolioView>[1],
  options: Options = {},
): VariantRenderInput {
  return buildRenderInput({
    view: resolvePortfolioView(pair, unit, { mediaBase: '/media' }),
    manifest: manifestWith(options.manifest),
    route: options.route ?? { route: 'home' },
    basePath: options.basePath ?? '',
    query: options.query,
    origin: 'https://rowan.test',
    requestTime: '2026-01-01T00:00:00Z',
    idPrefix: options.idPrefix,
  });
}

/** A contract fixture's render input, as a host builds it. */
function fixture(name: string, options: Options = {}): VariantRenderInput {
  const dir = path.join(FIXTURES_DIR, name);
  const loaded = loadPair(dir, { catalog: CATALOG });
  assert.ok(loaded.ok, `${name}: ${JSON.stringify(loaded.diagnostics)}`);
  const { snapshots, media } = readUnitFiles(dir);
  return inputOf(loaded.pair, { snapshots, ...(media ? { media } : {}) }, options);
}

const SITE = SiteSchema.parse({
  schemaVersion: 2,
  appearance: {
    variant: 'kit-outline',
    designLanguage: 'platform-neutral',
    colorScheme: 'warm',
    typography: 'classic',
    displayMode: 'system',
  },
  visitorControls: {
    variant: 'locked',
    designLanguage: 'locked',
    colorScheme: 'locked',
    typography: 'locked',
    displayMode: 'locked',
  },
  motionPolicy: 'respect-os',
  features: { feed: true },
});

/** A portfolio written in the test. */
function written(portfolio: unknown, options: Options = {}): VariantRenderInput {
  const parsed = PortfolioSchema.safeParse(portfolio);
  assert.ok(parsed.success, JSON.stringify(parsed.error?.issues, null, 2));
  return inputOf({ portfolio: parsed.data, site: SITE } as ParsedPair, {}, options);
}

/** The ids of the sections renderSection() renders, in order. */
const rendered = (input: VariantRenderInput, composition: SectionComposition = SHARED_SECTIONS) =>
  input.portfolio.sections.flatMap((section) =>
    renderSection(section, input, composition) === null ? [] : [section.id],
  );

const MANIFESTS: readonly Record<string, unknown>[] = [
  {},
  { unsupportedKinds: ['works', 'github', 'contact'] },
  { unsupportedKinds: ['hero', 'evidence', 'chronology', 'practice'] },
];

test('the outline lists exactly the sections renderSection() renders, in order, for every contract fixture', () => {
  for (const { name } of CONTRACT_FIXTURES) {
    for (const manifest of MANIFESTS) {
      for (const idPrefix of ['', 'pv-']) {
        const input = fixture(name, { manifest, idPrefix });
        const outline = pageOutline(input);
        assert.deepEqual(
          outline.sections.map(({ id }) => id),
          rendered(input),
          `${name} ${JSON.stringify(manifest)} ${idPrefix}`,
        );
        // Each anchor is the DOM id the section's frame carries.
        for (const entry of outline.sections) {
          const section = input.portfolio.sections.find(({ id }) => id === entry.id)!;
          const markup = renderToStaticMarkup(
            <>{renderSection(section, input, SHARED_SECTIONS)}</>,
          );
          assert.match(markup, new RegExp(`^<section id="${entry.anchor}" `), entry.id);
          assert.equal(entry.href, `#${entry.anchor}`);
        }
      }
    }
  }
});

test('the outline leaves out a section with nothing public and an extension section with no renderer, as renderSection() does', () => {
  const input = written({
    schemaVersion: 3,
    locale: 'en',
    direction: 'ltr',
    identity: { name: 'Rowan Vale' },
    works: [{ id: 'kept', title: 'Kept', medium: 'software', visibility: 'private' }],
    sections: [
      { kind: 'lede', id: 'about', title: 'About', body: 'Hi.' },
      { kind: 'works', id: 'empty', title: 'Nothing public', items: ['kept'] },
    ],
  });
  assert.deepEqual(
    pageOutline(input).sections.map(({ id }) => id),
    ['about'],
  );
  const extension = {
    kind: '@acme/portfolio-photography/exhibitions',
    id: 'shows',
    title: 'Shows',
    data: { items: [] },
  } as unknown as Section;
  const withExtension = {
    ...input,
    portfolio: { ...input.portfolio, sections: [...input.portfolio.sections, extension] },
  };
  registerHostModules({});
  try {
    assert.deepEqual(rendered(withExtension), ['about']);
    assert.deepEqual(
      pageOutline(withExtension).sections.map(({ id }) => id),
      ['about'],
    );
    registerHostModules({
      extensionRenderers: { '@acme/portfolio-photography/exhibitions': () => <p>Shows</p> },
    });
    assert.deepEqual(rendered(withExtension), ['about', 'shows']);
    const shows = pageOutline(withExtension).sections.find(({ id }) => id === 'shows')!;
    assert.equal(shows.family, 'other');
    assert.equal(shows.title, 'Shows');
  } finally {
    registerHostModules({});
  }
});

test("a frame carries the section's lang, and dir when it runs the other way, in the right-to-left fixture", () => {
  const input = fixture('rtl');
  const english = input.portfolio.sections.find(({ id }) => id === 'english')!;
  const frames: SectionFrameProps['frame'][] = [];
  const Frame = ({ frame, children }: SectionFrameProps) => {
    frames.push(frame);
    return <article {...frame}>{children}</article>;
  };
  const markup = renderToStaticMarkup(
    <>{renderSection(english, input, { renderers: {}, Frame })}</>,
  );
  assert.match(
    markup,
    /^<article id="english" data-section-id="english" data-kind="lede" data-renderer="shared" lang="en" dir="ltr">/,
  );
  assert.deepEqual(frames, [
    {
      id: 'english',
      'data-section-id': 'english',
      'data-kind': 'lede',
      'data-renderer': 'shared',
      lang: 'en',
      dir: 'ltr',
    },
  ]);
  // A section in the page's own language and direction carries neither.
  const about = input.portfolio.sections.find(({ id }) => id === 'about')!;
  assert.match(
    renderToStaticMarkup(<>{renderSection(about, input, SHARED_SECTIONS)}</>),
    /^<section id="about" data-section-id="about" data-kind="lede" data-renderer="shared">/,
  );
  const outline = pageOutline(input);
  const entry = outline.sections.find(({ id }) => id === 'english')!;
  assert.equal(entry.lang, 'en');
  assert.equal(entry.dir, 'ltr');
  assert.equal(outline.sections.find(({ id }) => id === 'about')!.dir, undefined);
});

test("a composition's frame gets the section, its level, and the renderer's output", () => {
  const input = fixture('complete');
  const seen: string[] = [];
  const composition: SectionComposition = {
    renderers: {},
    Frame: ({ frame, section, level, children }) => {
      seen.push(`${section.id}:${level}`);
      return (
        <section {...frame} className="own">
          {children}
        </section>
      );
    },
  };
  const about = input.portfolio.sections.find(({ id }) => id === 'about')!;
  const markup = renderToStaticMarkup(
    <>{renderSection(about, input, composition, { level: 3 })}</>,
  );
  assert.deepEqual(seen, ['about:3']);
  assert.match(markup, /^<section id="about" [^>]*class="own"><header[^>]*><h3/);
});

test('each section entry counts its items and names the first, with the first image among them', () => {
  const outline = pageOutline(fixture('complete'));
  const by = (id: string) => outline.sections.find((entry) => entry.id === id)!;
  assert.equal(by('projects').count, 2);
  assert.deepEqual(by('projects').firstItem, { title: 'Project name' });
  assert.equal(by('projects').leadImage?.asset, 'project-image');
  assert.equal(by('projects').leadImage?.alt, 'Alt project-image override');
  assert.equal(by('projects').family, 'work');
  assert.equal(by('experience').family, 'history');
  assert.ok(by('experience').count > 0);
  assert.equal(by('about').count, 0);
  assert.equal(by('about').firstItem, undefined);
  assert.equal(by('about').leadImage, undefined);
  assert.equal(by('top').family, 'opening');
  for (const entry of outline.sections) {
    assert.equal(entry.anchor, entry.id);
    assert.ok(entry.count >= 0);
  }
});

test('every core kind has a family', () => {
  assert.deepEqual(Object.keys(KIND_FAMILIES).sort(), Object.keys(SHARED_RENDERERS).sort());
});

test("links reach home's sections from any route, under the routes' base and with their query", () => {
  const home = pageOutline(fixture('complete', { basePath: '/sample', query: { variant: 'x' } }));
  assert.equal(home.home, '/sample?variant=x');
  assert.equal(home.sections[0]!.href, `#${home.sections[0]!.anchor}`);
  const work = pageOutline(
    fixture('complete', {
      basePath: '/sample',
      query: { variant: 'x' },
      route: { route: 'work', slug: 'project-name' },
    }),
  );
  assert.equal(work.sections[0]!.href, `/sample?variant=x#${work.sections[0]!.anchor}`);
  assert.deepEqual(
    work.works.map(({ slug, href, current }) => [slug, href, current]),
    [['project-name', '/sample/work/project-name?variant=x', true]],
  );
  assert.equal(home.works[0]!.current, false);
});

/** Three works with their own pages, two sharing a tag, listed by two sections. */
const CINEMA = {
  schemaVersion: 3,
  locale: 'en',
  direction: 'ltr',
  identity: { name: 'Rowan Vale', email: ' rowan@rowan.test ', tagline: 'Maker' },
  links: [{ platform: 'mastodon', url: 'https://social.rowan.test/@rowan' }],
  meta: { title: 'Rowan Vale, maker', description: 'Things made.' },
  contact: { message: 'Write any time.', links: [{ url: '#about', label: 'About me' }] },
  works: [
    {
      id: 'loom',
      slug: 'loom',
      title: 'Loom',
      medium: 'software',
      tags: ['textiles'],
      caseStudy: { challenge: 'Weave.' },
    },
    {
      id: 'tide',
      slug: 'tide',
      title: 'Tide',
      medium: 'software',
      tags: ['maps', 'textiles'],
      tools: ['Rust'],
      caseStudy: {
        challenge: 'Chart.',
        decisions: [{ decision: 'One.' }, { decision: 'Two.' }],
        reflection: 'Calm.',
      },
    },
    {
      id: 'kiln',
      slug: 'kiln',
      title: 'Kiln',
      medium: 'object',
      tools: ['Rust'],
      caseStudy: { outcomes: 'Fired.' },
    },
    { id: 'sketch', slug: 'sketch', title: 'Sketch', medium: 'object' },
  ],
  sections: [
    { kind: 'lede', id: 'about', title: 'About', body: 'Hi.' },
    { kind: 'works', id: 'later', title: 'Later', items: ['kiln'] },
    { kind: 'works', id: 'first', title: 'First', items: ['tide', 'loom', 'kiln'] },
    { kind: 'contact', id: 'reach', title: 'Contact' },
  ],
};

test('routed works keep the order the page lists them in, and a case study knows its neighbors and relatives', () => {
  const home = written(CINEMA);
  assert.deepEqual(
    pageOutline(home).works.map(({ slug }) => slug),
    ['kiln', 'tide', 'loom'],
  );
  assert.equal(caseStudyOutline(home), null);
  const tide = caseStudyOutline(written(CINEMA, { route: { route: 'work', slug: 'tide' } }))!;
  assert.equal(tide.work.id, 'tide');
  assert.equal(tide.previous?.slug, 'kiln');
  assert.equal(tide.next?.slug, 'loom');
  assert.deepEqual(
    tide.parts.map(({ key, anchor, count }) => [key, anchor, count]),
    [
      ['challenge', 'tide--challenge', 1],
      ['decisions', 'tide--decisions', 2],
      ['reflection', 'tide--reflection', 1],
    ],
  );
  // Loom shares a tag and Kiln a tool, one each; the page's order breaks the tie.
  assert.deepEqual(
    tide.related.map(({ slug, shared, sameMedium }) => [slug, shared, sameMedium]),
    [
      ['kiln', ['Rust'], false],
      ['loom', ['textiles'], true],
    ],
  );
  assert.deepEqual(
    tide.works.map(({ slug, current }) => [slug, current]),
    [
      ['kiln', false],
      ['tide', true],
      ['loom', false],
    ],
  );
  const kiln = caseStudyOutline(written(CINEMA, { route: { route: 'work', slug: 'kiln' } }))!;
  assert.equal(kiln.previous, undefined);
  assert.equal(kiln.next?.slug, 'tide');
  const loom = caseStudyOutline(
    written(CINEMA, { route: { route: 'work', slug: 'loom' }, idPrefix: 'pv-' }),
  )!;
  assert.equal(loom.next, undefined);
  assert.equal(loom.parts[0]!.href, '#pv-loom--challenge');
  // A slug the view doesn't route has no case study.
  assert.equal(
    caseStudyOutline(written(CINEMA, { route: { route: 'work', slug: 'sketch' } })),
    null,
  );
});

test('the footer outline has the identity, the links, the contact record, and the render day', () => {
  const footer = footerOutline(written(CINEMA, { route: { route: 'work', slug: 'tide' } }));
  assert.deepEqual(footer, {
    name: 'Rowan Vale',
    tagline: 'Maker',
    email: { text: 'rowan@rowan.test', href: 'mailto:rowan@rowan.test' },
    links: [
      {
        text: 'mastodon',
        href: 'https://social.rowan.test/@rowan',
        platform: 'mastodon',
      },
    ],
    contact: { message: 'Write any time.', links: [{ text: 'About me', href: '#about' }] },
    contactHref: '/#reach',
    colophon: {
      title: 'Rowan Vale, maker',
      description: 'Things made.',
      locale: 'en',
      direction: 'ltr',
    },
    renderedOn: '2026-01-01T00:00:00.000Z',
    year: 2026,
  });
  const bare = footerOutline(fixture('identity-only'));
  assert.deepEqual(bare.links, []);
  assert.equal(bare.contact, undefined);
  assert.equal(bare.contactHref, undefined);
});

test('the contact entry counts the links its section lists, the email first', () => {
  const reach = pageOutline(written(CINEMA)).sections.find(({ id }) => id === 'reach')!;
  assert.equal(reach.count, 2);
  assert.deepEqual(reach.firstItem, { title: 'rowan@rowan.test' });
});

test("composePages() renders the case-study page on a routed work's page, and the home page everywhere else", () => {
  const Composition = composePages({
    HomePage: ({ input, outline }) => (
      <main id={input.ids.main} data-page="home" data-sections={outline.sections.length} />
    ),
    CaseStudyPage: ({ input, work, outline }) => (
      <main
        id={input.ids.main}
        data-page="work"
        data-work={work.slug}
        data-parts={outline.parts.length}
      />
    ),
  });
  const html = (route: RouteTarget) =>
    renderToStaticMarkup(<Composition input={written(CINEMA, { route })} />);
  assert.equal(
    html({ route: 'home' }),
    '<main id="main" data-page="home" data-sections="4"></main>',
  );
  assert.equal(
    html({ route: 'work', slug: 'tide' }),
    '<main id="main" data-page="work" data-work="tide" data-parts="3"></main>',
  );
  assert.match(html({ route: 'work', slug: 'sketch' }), /data-page="home"/);
  const HomeOnly = composePages({ HomePage: () => <main data-page="home" /> });
  assert.equal(
    renderToStaticMarkup(
      <HomeOnly input={written(CINEMA, { route: { route: 'work', slug: 'tide' } })} />,
    ),
    '<main data-page="home"></main>',
  );
});

test("composePages() renders a view's own page with its parameters, the home page with a noindex note for one it doesn't know, and the home page for a view it names no page for (K-3)", () => {
  const CHAPTER = {
    id: 'chapter',
    under: 'home',
    type: 'path',
    segment: 'chapters/{chapter}',
  } as const;
  const BACK = { id: 'back-matter', under: 'home', type: 'path', segment: 'back-matter' } as const;
  const LIST = { id: 'list', under: 'home', type: 'path', segment: 'list' } as const;
  const Composition = composePages({
    HomePage: ({ input, notice }) => (
      <main id={input.ids.main} data-page="home">
        {notice ? <p data-notice={notice.view.id}>{notice.text}</p> : null}
      </main>
    ),
    views: {
      chapter: {
        Page: ({ input, view, params, outline }) => (
          <main
            id={input.ids.main}
            data-page={view.id}
            data-chapter={params.chapter}
            data-sections={outline.sections.length}
          />
        ),
        known: (_, params) => params.chapter === 'early-years',
        unknown: 'No chapter by that name.',
      },
      'back-matter': ({ view }) => <main data-page={view.id} />,
    },
  });
  const html = (route: RouteTarget) =>
    renderToStaticMarkup(<Composition input={written(CINEMA, { route })} />);
  const view = (declaration: typeof CHAPTER | typeof BACK | typeof LIST, params = {}) =>
    html({ route: 'view', view: declaration, params });
  assert.equal(
    view(CHAPTER, { chapter: 'early-years' }),
    '<main id="main" data-page="chapter" data-chapter="early-years" data-sections="4"></main>',
  );
  assert.equal(view(BACK), '<main data-page="back-matter"></main>');
  // A slug no chapter has: the contents, with the note, and noindex.
  assert.equal(
    view(CHAPTER, { chapter: 'nowhere' }),
    '<meta name="robots" content="noindex"/><main id="main" data-page="home"><p data-notice="chapter">No chapter by that name.</p></main>',
  );
  // A view it names no page for renders the home page, as Cinema's list does.
  assert.equal(view(LIST), '<main id="main" data-page="home"></main>');
  assert.equal(html({ route: 'home' }), '<main id="main" data-page="home"></main>');
  // The host asks first, and leaves the noted page alone without a canonical.
  const unknown = (route: RouteTarget) =>
    Composition.unknownView?.(written(CINEMA, { route })) ?? 'unset';
  assert.equal(unknown({ route: 'view', view: CHAPTER, params: { chapter: 'nowhere' } }), true);
  const indexable: RouteTarget[] = [
    { route: 'view', view: CHAPTER, params: { chapter: 'early-years' } },
    { route: 'view', view: BACK, params: {} },
    { route: 'view', view: LIST, params: {} },
    { route: 'home' },
  ];
  for (const route of indexable) {
    assert.equal(unknown(route), false, JSON.stringify(route));
  }
  // The note defaults from the view's id.
  const Bare = composePages({
    HomePage: ({ notice }) => <main>{notice?.text}</main>,
    views: { chapter: { Page: () => <main />, known: () => false } },
  });
  assert.match(
    renderToStaticMarkup(
      <Bare
        input={written(CINEMA, {
          route: { route: 'view', view: CHAPTER, params: { chapter: 'x' } },
        })}
      />,
    ),
    /<main>No chapter by that name\.<\/main>/,
  );
});

test("a composition's anchorOf() moves or drops a frame's id, and the outline and the footer follow it", () => {
  const input = written(CINEMA);
  const composition: SectionComposition = {
    renderers: {},
    Frame: SharedFrame,
    anchorOf: (section) =>
      section.id === 'about' ? null : section.id === 'reach' ? 'get-in-touch' : undefined,
  };
  const markup = (id: string) =>
    renderToStaticMarkup(
      <>
        {renderSection(
          input.portfolio.sections.find((section) => section.id === id)!,
          input,
          composition,
        )}
      </>,
    );
  assert.match(markup('about'), /^<section data-section-id="about" data-kind="lede"/);
  assert.match(markup('reach'), /^<section id="get-in-touch" data-section-id="reach"/);
  assert.match(markup('first'), /^<section id="first" data-section-id="first"/);
  const outline = pageOutline(input, composition);
  const by = (id: string) => outline.sections.find((entry) => entry.id === id)!;
  assert.equal(by('about').anchor, undefined);
  assert.equal(by('about').href, undefined);
  assert.equal(by('about').title, 'About');
  assert.equal(by('reach').anchor, 'get-in-touch');
  assert.equal(by('reach').href, '#get-in-touch');
  assert.equal(by('first').href, '#first');
  // Without the composition, every section anchors on its own id.
  assert.equal(pageOutline(input).sections.find(({ id }) => id === 'about')!.href, '#about');
  assert.equal(
    footerOutline(written(CINEMA, { route: { route: 'work', slug: 'tide' } }), composition)
      .contactHref,
    '/#get-in-touch',
  );
  const none: SectionComposition = { ...composition, anchorOf: () => null };
  assert.equal(footerOutline(input, none).contactHref, undefined);
});

test("a section in the page's own direction carries no dir, in the frame or the outline, whatever its lang", () => {
  const input = written({
    ...CINEMA,
    sections: [
      { kind: 'lede', id: 'british', title: 'British', lang: 'en-GB', body: 'Colour.' },
      { kind: 'lede', id: 'arabic', title: 'Arabic', lang: 'ar', body: 'نعم.' },
    ],
  });
  const [british, arabic] = pageOutline(input).sections;
  assert.equal(british!.lang, 'en-GB');
  assert.equal(british!.dir, undefined);
  assert.equal(arabic!.dir, 'rtl');
});

test('routed works and the footer skip a works or contact section the composition leaves out', () => {
  const skipped = written(CINEMA, { manifest: { unsupportedKinds: ['works', 'contact'] } });
  // No works section renders, so the routed works take the portfolio's record order.
  assert.deepEqual(
    pageOutline(skipped).works.map(({ slug }) => slug),
    ['loom', 'tide', 'kiln'],
  );
  assert.equal(footerOutline(skipped).contactHref, undefined);
  assert.equal(footerOutline(written(CINEMA)).contactHref, '#reach');
});

test("a case study's evidence part counts the evidence it cites, and is one part for its text alone", () => {
  const cited = written(
    {
      ...CINEMA,
      evidence: [
        { id: 'one', type: 'metric', title: 'One' },
        { id: 'two', type: 'metric', title: 'Two' },
      ],
      works: [
        {
          id: 'tide',
          slug: 'tide',
          title: 'Tide',
          medium: 'software',
          evidence: ['one', 'two'],
          caseStudy: { evidence: 'Measured.' },
        },
      ],
      sections: [
        { kind: 'works', id: 'first', title: 'First', items: ['tide'] },
        { kind: 'evidence', id: 'proof', title: 'Proof', items: ['one', 'two'] },
      ],
    },
    { route: { route: 'work', slug: 'tide' } },
  );
  assert.deepEqual(
    caseStudyOutline(cited)!.parts.map(({ key, count }) => [key, count]),
    [['evidence', 2]],
  );
  const text = written(
    {
      ...CINEMA,
      works: [
        {
          id: 'tide',
          slug: 'tide',
          title: 'Tide',
          medium: 'software',
          caseStudy: { evidence: 'Measured.' },
        },
      ],
      sections: [{ kind: 'works', id: 'first', title: 'First', items: ['tide'] }],
    },
    { route: { route: 'work', slug: 'tide' } },
  );
  assert.deepEqual(
    caseStudyOutline(text)!.parts.map(({ key, count }) => [key, count]),
    [['evidence', 1]],
  );
});

test('an extension kind the composition renders bespoke renders with no host renderer, in the page and the outline', () => {
  const kind = '@acme/portfolio-photography/exhibitions';
  const base = written(CINEMA, { manifest: { renderedKinds: [kind] } });
  const extension = {
    kind,
    id: 'shows',
    title: 'Shows',
    data: { items: [] },
  } as unknown as Section;
  const input = { ...base, portfolio: { ...base.portfolio, sections: [extension] } };
  registerHostModules({});
  const own: SectionComposition = {
    renderers: { [kind]: () => <p>Own shows</p> },
    Frame: SharedFrame,
  };
  assert.equal(
    renderToStaticMarkup(<>{renderSection(extension, input, own)}</>),
    `<section id="shows" data-section-id="shows" data-kind="${kind}" data-renderer="bespoke"><p>Own shows</p></section>`,
  );
  assert.deepEqual(
    pageOutline(input).sections.map(({ id }) => id),
    ['shows'],
  );
});
