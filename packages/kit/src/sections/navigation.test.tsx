import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as React from 'react';
import {
  ALL_SECTION_KINDS,
  composeSchemas,
  EVIDENCE_TYPES,
  PRACTICE_PARTS,
  resolvePortfolioView,
  type AppearanceCatalog,
  type ParsedPair,
} from '@portfolio/schema';
import { loadPair, readPair, readUnitFiles } from '@portfolio/schema/node';
import {
  buildRenderInput,
  validateManifest,
  type RouteTarget,
  type VariantRenderInput,
} from '@portfolio/variant-contract';
import { CONTRACT_FIXTURES, FIXTURES_DIR } from '@portfolio/variant-contract/node';
import {
  CANONICAL_DESTINATIONS,
  canonicalDestination,
  checkDestinationOverrides,
  checkGrouping,
  defaultDestination,
  defineNavigationOverrides,
  DESTINATION_LABELS,
  DESTINATIONS,
  footerOutline,
  navigationModel,
  pageOutline,
  renderSection,
  sameTarget,
  sectionClass,
  SHARED_SECTIONS,
  type DestinationId,
  type DestinationOverrideMap,
  type GroupContext,
  type GroupingOptions,
  type NavigationOptions,
  type OutlineSection,
  type PageOutline,
} from '.';

// The navigation model (stream A, global rule 7): the outline grouped into
// at most five destinations plus the index, so no composition's chrome
// lists every section. It reads the outline alone, so every link it gives
// is one the outline gives: a section the page renders.

// tsx compiles JSX to React.createElement calls, and renderSection() builds elements.
Object.assign(globalThis, { React });

const REPO = fileURLToPath(new URL('../../../../', import.meta.url));
const { PortfolioSchema, SiteSchema } = composeSchemas();

const MANIFEST = (() => {
  const result = validateManifest(
    {
      id: 'kit-navigation',
      name: 'Navigation',
      promise: 'A test composition for the navigation model.',
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
    },
    { packageName: '@kit/navigation' },
  );
  assert.ok(result.ok, JSON.stringify(result.diagnostics));
  return result.manifest;
})();

function inputOf(
  pair: ParsedPair,
  unit: Parameters<typeof resolvePortfolioView>[1],
  route: RouteTarget = { route: 'home' },
  idPrefix = '',
): VariantRenderInput {
  return buildRenderInput({
    view: resolvePortfolioView(pair, unit, { mediaBase: '/media' }),
    manifest: MANIFEST,
    route,
    basePath: '/sample',
    origin: 'https://rowan.test',
    requestTime: '2026-01-01T00:00:00Z',
    idPrefix,
  });
}

/** The bundled sample, as the demo renders it, with its frozen GitHub snapshot. */
function sample(route?: RouteTarget, idPrefix?: string): VariantRenderInput {
  const read = readPair({
    portfolio: path.join(REPO, 'portfolio.example.yml'),
    site: path.join(REPO, 'site.example.yml'),
  });
  assert.ok(read.ok, JSON.stringify(read.diagnostics));
  const unit = readUnitFiles(REPO);
  return inputOf(read.pair, { snapshots: unit.snapshots }, route, idPrefix);
}

const IDS = {
  colorScheme: ['warm', 'warm-parchment', 'noir', 'ink-and-paper', 'nebula', 'aurora', 'solar'],
  typography: ['classic', 'humanist-ui', 'modernist', 'geometric', 'humanist'],
  displayMode: ['system', 'light', 'dark', 'high-contrast'],
} as const;
const CATALOG: AppearanceCatalog = {
  ids: (axis) => (axis in IDS ? IDS[axis as keyof typeof IDS] : null),
  generatorInput: () => undefined,
};

function fixture(name: string): VariantRenderInput {
  const dir = path.join(FIXTURES_DIR, name);
  const loaded = loadPair(dir, { catalog: CATALOG });
  assert.ok(loaded.ok, `${name}: ${JSON.stringify(loaded.diagnostics)}`);
  const { snapshots, media } = readUnitFiles(dir);
  return inputOf(loaded.pair, { snapshots, ...(media ? { media } : {}) });
}

const SITE = SiteSchema.parse({
  schemaVersion: 2,
  appearance: {
    variant: 'kit-navigation',
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

function written(portfolio: unknown): VariantRenderInput {
  const parsed = PortfolioSchema.safeParse(portfolio);
  assert.ok(parsed.success, JSON.stringify(parsed.error?.issues, null, 2));
  return inputOf({ portfolio: parsed.data, site: SITE } as ParsedPair, {});
}

const ids = (sections: readonly OutlineSection[]) => sections.map(({ id }) => id);

test("the sample's 28 sections fold into the five destinations in their fixed order, and the index keeps every one", () => {
  const input = sample();
  const outline = pageOutline(input);
  assert.equal(outline.sections.length, 28);
  const model = navigationModel(outline);
  assert.deepEqual(model.name, { label: 'Anamika Devi', href: '/sample' });
  // Work, Writing, Record, About, Contact, whatever the page's order: About's
  // lede comes first on the page. About lands on the section titled About,
  // not on Practice, its first; the others have none so titled, and land on their first.
  assert.deepEqual(
    model.primary.map(({ id, label, href }) => [id, label, href]),
    [
      ['work', 'Work', '#work-showcase'],
      ['writing', 'Writing', '#essays'],
      ['record', 'Record', '#at-a-glance'],
      ['about', 'About', '#about'],
      ['contact', 'Contact', '#contact'],
    ],
  );
  const by = Object.fromEntries(model.primary.map((each) => [each.id, ids(each.sections)]));
  assert.deepEqual(by, {
    about: [
      'thesis',
      'about',
      'now',
      'currently-focused-on',
      'skills',
      'off-the-page',
      'quote',
      'stack-i-currently-reach-for',
      'engagements',
    ],
    work: ['work-showcase', 'incident-history', 'looking', 'listening-a-small-experiment'],
    record: [
      'at-a-glance',
      'words-from-collaborators',
      'experience',
      'education',
      'publications',
      'talks',
      'awards',
      'patents',
      'press',
      'elsewhere',
      'on-github',
    ],
    writing: ['essays'],
    contact: ['contact', 'want-to-work-together'],
  });
  // The index is every section, the hero too, in reading order.
  assert.deepEqual(ids(model.index), ids(outline.sections));
  // Only the hero is the index's alone.
  const grouped = new Set(model.primary.flatMap((each) => ids(each.sections)));
  assert.deepEqual(
    ids(model.index).filter((id) => !grouped.has(id)),
    ['top'],
  );
  assert.deepEqual(model.works, outline.works);
});

test('a works section is Writing when every work it shows is writing or research, and Work otherwise', () => {
  const outline = pageOutline(sample());
  const media = (id: string) => outline.sections.find((each) => each.id === id)!.media;
  assert.deepEqual(media('essays'), [{ medium: 'writing', count: 3 }]);
  assert.deepEqual(media('work-showcase'), [
    { medium: 'software', count: 2 },
    { medium: 'writing', count: 1 },
  ]);
  assert.equal(media('at-a-glance'), undefined, 'only a works section has media');
  const works = (media: { medium: string; count: number }[]): OutlineSection => ({
    id: 'w',
    kind: 'works',
    family: 'work',
    count: media.reduce((sum, { count }) => sum + count, 0),
    media,
  });
  assert.equal(defaultDestination(works([{ medium: 'writing', count: 2 }])), 'writing');
  assert.equal(
    defaultDestination(
      works([
        { medium: 'research', count: 1 },
        { medium: 'writing', count: 1 },
      ]),
    ),
    'writing',
  );
  assert.equal(
    defaultDestination(
      works([
        { medium: 'writing', count: 1 },
        { medium: 'audio-video', count: 1 },
      ]),
    ),
    'work',
  );
  assert.equal(defaultDestination(works([{ medium: '@acme/x/zine', count: 1 }])), 'work');
  // Evidence of writing, such as talks and publications, stays Record.
  assert.equal(defaultDestination({ ...works([]), kind: 'evidence', family: 'proof' }), 'record');
});

test('every family has its destination, and the hero, an untitled lede, and others are the index alone', () => {
  const at = (family: OutlineSection['family'], kind = 'x', title?: string): OutlineSection => ({
    id: kind,
    kind,
    family,
    count: 0,
    ...(title ? { title } : {}),
  });
  assert.equal(defaultDestination(at('proof', 'evidence')), 'record');
  assert.equal(defaultDestination(at('proof', 'github')), 'record');
  assert.equal(defaultDestination(at('history', 'chronology')), 'record');
  assert.equal(defaultDestination(at('practice', 'focus')), 'about');
  assert.equal(defaultDestination(at('personal', 'now')), 'about');
  assert.equal(defaultDestination(at('connect', 'contact')), 'contact');
  assert.equal(defaultDestination(at('connect', 'cta')), 'contact');
  assert.equal(defaultDestination(at('opening', 'lede', 'About')), 'about');
  assert.equal(defaultDestination(at('opening', 'lede')), null);
  assert.equal(defaultDestination(at('opening', 'hero', 'Hi')), null);
  assert.equal(defaultDestination(at('other', 'custom', 'Notes')), null);
});

test('the five destination ids are fixed, with plain default labels, the same for every composition', () => {
  assert.deepEqual(DESTINATIONS, ['work', 'writing', 'record', 'about', 'contact']);
  assert.deepEqual(DESTINATION_LABELS, {
    work: 'Work',
    writing: 'Writing',
    record: 'Record',
    about: 'About',
    contact: 'Contact',
  });
  // A composition relabels for its metaphor, and the ids stay.
  const relabelled = navigationModel(pageOutline(sample()), {
    labels: { record: { text: 'Craft' }, writing: { text: 'Journal' } },
  });
  assert.deepEqual(
    relabelled.primary.map(({ id, label }) => [id, label]),
    [
      ['work', 'Work'],
      ['writing', 'Journal'],
      ['record', 'Craft'],
      ['about', 'About'],
      ['contact', 'Contact'],
    ],
  );
  // An override to an id that isn't one of the five sends a section to the index alone.
  const stray = navigationModel(pageOutline(sample()), {
    overrides: defineNavigationOverrides({ quote: 'quotes' as never }),
  });
  assert.ok(stray.primary.every(({ id }) => DESTINATIONS.includes(id)));
  assert.ok(!stray.primary.some(({ sections }) => ids(sections).includes('quote')));
  assert.ok(ids(stray.index).includes('quote'));
});

/** Overrides that send every kind of section to `to`. */
const everything = (to: DestinationId | null): DestinationOverrideMap =>
  Object.fromEntries(
    [
      'hero',
      'lede',
      'works',
      'evidence',
      'github',
      'chronology',
      'practice',
      'focus',
      'now',
      'quote',
      'fun-facts',
      'contact',
      'cta',
      'custom',
      'extension',
    ].map((kind) => [kind, to]),
  );

test('Writing is a destination whenever the page has a writing works section, however few fit and whatever the overrides say', () => {
  const outline = pageOutline(sample());
  for (const primary of [1, 2, 3, 4, 5]) {
    const model = navigationModel(outline, { primary });
    assert.ok(
      model.primary.some(({ id }) => id === 'writing'),
      `Writing is kept with primary ${primary}`,
    );
  }
  // A composition that groups every other section its own way still can't move the essays.
  const regrouped = navigationModel(outline, {
    overrides: defineNavigationOverrides({ ...everything('work'), 'works:writing': 'work' }),
  });
  assert.deepEqual(
    regrouped.primary.map(({ id, sections }) => [id, sections.length]),
    [
      ['work', 27],
      ['writing', 1],
    ],
  );
  for (const { name } of CONTRACT_FIXTURES) {
    const fixtureOutline = pageOutline(fixture(name));
    const writing = fixtureOutline.sections.filter(
      (section) =>
        section.href !== undefined &&
        section.kind === 'works' &&
        (section.media ?? []).length > 0 &&
        section.media!.every(({ medium }) => medium === 'writing' || medium === 'research'),
    );
    for (const primary of [1, 3, 5]) {
      const model = navigationModel(fixtureOutline, {
        primary,
        overrides: defineNavigationOverrides(everything('about')),
      });
      const kept = model.primary.find(({ id }) => id === 'writing');
      assert.equal(Boolean(kept), writing.length > 0, `${name} ${primary}`);
      if (kept) assert.deepEqual(ids(kept.sections), ids(writing), name);
    }
  }
});

test('never more destinations than `primary`: Writing is kept first, and the kept ones stay in the fixed order', () => {
  const outline = pageOutline(sample());
  assert.equal(navigationModel(outline, { primary: 0 }).primary.length, 0);
  assert.deepEqual(
    navigationModel(outline, { primary: 3 }).primary.map(({ id }) => id),
    ['work', 'writing', 'record'],
  );
  assert.deepEqual(
    navigationModel(outline, { primary: 1 }).primary.map(({ id }) => id),
    ['writing'],
  );
  assert.deepEqual(
    navigationModel(outline, { primary: 9 }).primary.map(({ id }) => id),
    ['work', 'writing', 'record', 'about', 'contact'],
  );
  // The order is the same wherever the page puts its sections.
  const reversed = { ...outline, sections: [...outline.sections].reverse() };
  assert.deepEqual(
    navigationModel(reversed).primary.map(({ id }) => id),
    ['work', 'writing', 'record', 'about', 'contact'],
  );
  for (const { name } of CONTRACT_FIXTURES) {
    for (const primary of [0, 1, 2, 5]) {
      const model = navigationModel(pageOutline(fixture(name)), { primary });
      assert.ok(model.primary.length <= primary, `${name} ${primary}`);
    }
  }
});

test("every destination's href is its section titled as it's labelled, else its first, a section the page renders, on every contract fixture", () => {
  for (const { name } of CONTRACT_FIXTURES) {
    const input = fixture(name);
    const outline = pageOutline(input);
    const model = navigationModel(outline);
    const rendered = new Set(
      input.portfolio.sections
        .filter((section) => renderSection(section, input, SHARED_SECTIONS) !== null)
        .map(({ id }) => id),
    );
    assert.ok(model.primary.length <= 5, name);
    for (const destination of model.primary) {
      assert.ok(destination.sections.length > 0, `${name} ${destination.id} is not empty`);
      const named = destination.sections.find(
        ({ title }) => title?.trim().toLowerCase() === destination.label.toLowerCase(),
      );
      assert.equal(
        destination.href,
        (named ?? destination.sections[0]!).href,
        `${name} ${destination.id}`,
      );
      for (const section of destination.sections) {
        assert.ok(rendered.has(section.id), `${name} ${section.id} renders`);
        assert.ok(section.href !== undefined);
      }
    }
    assert.deepEqual(
      ids(model.index),
      ids(outline.sections.filter((section) => section.href !== undefined)),
    );
  }
});

test('a destination lands on its section titled as it is labelled, case aside, and otherwise on its first', () => {
  const outline = pageOutline(sample());
  const about = (options?: Parameters<typeof navigationModel>[1]) =>
    navigationModel(outline, options).primary.find(({ id }) => id === 'about')?.href;
  assert.equal(about(), '#about');
  // The label decides, so a composition's own word finds its own section.
  assert.equal(about({ labels: { about: { text: 'practice' } } }), '#thesis');
  assert.equal(about({ ownLabels: { about: 'NOW' } }), '#now');
  // No section so titled: the first.
  assert.equal(about({ labels: { about: { text: 'Person' } } }), '#thesis');
  // Only the destination's own sections count: Record has no section titled About.
  assert.equal(
    navigationModel(outline, { labels: { record: { text: 'About' } } }).primary.find(
      ({ id }) => id === 'record',
    )?.href,
    '#at-a-glance',
  );
  // Composed and decomposed forms are one word: an NFD "Über" pasted from macOS matches an NFC title.
  const umlaut: PageOutline = {
    ...outline,
    sections: outline.sections.map((section) =>
      section.id === 'now' ? { ...section, title: 'Über' } : section,
    ),
  };
  assert.equal(
    navigationModel(umlaut, { ownLabels: { about: 'Über' } }).primary.find(
      ({ id }) => id === 'about',
    )?.href,
    '#now',
  );
  // A locale Intl rejects, as a hand-built outline can hold, folds in the root locale rather than throwing.
  for (const locale of ['', 'x-y', 'i-klingon']) {
    assert.equal(
      navigationModel({ ...outline, locale }).primary.find(({ id }) => id === 'about')?.href,
      '#about',
      locale,
    );
  }
});

test('a section with no anchor is in neither the destinations nor the index', () => {
  const input = sample();
  const outline = pageOutline(input, {
    anchorOf: (section) =>
      section.id === 'thesis' || section.kind === 'contact' ? null : undefined,
  });
  const model = navigationModel(outline);
  assert.ok(!ids(model.index).includes('thesis'));
  assert.ok(!ids(model.index).includes('contact'));
  // About now starts at the next section it takes, and Contact at the call to action.
  assert.equal(model.primary.find(({ id }) => id === 'about')?.href, '#about');
  assert.equal(model.primary.find(({ id }) => id === 'contact')?.href, '#want-to-work-together');
  // With neither, Contact is gone.
  const none = navigationModel(
    pageOutline(input, {
      anchorOf: (section) =>
        section.kind === 'contact' || section.kind === 'cta' ? null : undefined,
    }),
  );
  assert.equal(
    none.primary.find(({ id }) => id === 'contact'),
    undefined,
  );
});

test('links follow the route and the prefix: home and the fragment from a work, the prefix on every anchor', () => {
  const fromWork = navigationModel(
    pageOutline(sample({ route: 'work', slug: 'postmortem-template-kit' })),
  );
  assert.equal(fromWork.name.href, '/sample');
  assert.equal(fromWork.primary[0]!.href, '/sample#work-showcase');
  assert.ok(fromWork.works.some(({ current }) => current));
  const prefixed = navigationModel(pageOutline(sample(undefined, 'pv-')));
  assert.equal(prefixed.primary[0]!.href, '#pv-work-showcase');
});

test("labels are the kit's English or a composition's, marked so in a portfolio that isn't, and the owner's own words are the page's", () => {
  const portfolio = {
    schemaVersion: 3,
    locale: 'en',
    direction: 'ltr',
    identity: { name: 'Rowan Vale' },
    works: [{ id: 'atlas', title: 'Atlas', medium: 'interface' }],
    sections: [
      { kind: 'works', id: 'projects', title: 'Projects', items: ['atlas'] },
      { kind: 'lede', id: 'about', title: 'About', body: 'Hi.' },
    ],
  };
  const english = navigationModel(pageOutline(written(portfolio)));
  assert.deepEqual(
    english.primary.map(({ label, lang }) => [label, lang]),
    [
      ['Work', undefined],
      ['About', undefined],
    ],
  );
  const french = pageOutline(written({ ...portfolio, locale: 'fr-CA' }));
  assert.equal(french.locale, 'fr-CA');
  assert.deepEqual(
    navigationModel(french).primary.map(({ label, lang }) => [label, lang]),
    [
      ['Work', 'en'],
      ['About', 'en'],
    ],
  );
  // A composition's own words are English unless they say otherwise, so they're marked too.
  assert.deepEqual(
    navigationModel(french, {
      labels: { work: { text: 'Craft' }, about: { text: 'À propos', lang: 'fr' } },
    }).primary.map(({ label, lang }) => [label, lang]),
    [
      ['Craft', 'en'],
      ['À propos', undefined],
    ],
  );
  // A composition's word in a third language carries it, on any page.
  assert.deepEqual(
    navigationModel(pageOutline(written(portfolio)), {
      labels: { work: { text: 'Werk', lang: 'de' } },
    }).primary.map(({ label, lang }) => [label, lang]),
    [
      ['Werk', 'de'],
      ['About', undefined],
    ],
  );
  // The owner's own words win, in the page's language; a blank one falls back.
  assert.deepEqual(
    navigationModel(french, {
      labels: { work: { text: 'Craft' } },
      ownLabels: { work: 'Travaux', about: ' ' },
    }).primary.map(({ label, lang }) => [label, lang]),
    [
      ['Travaux', undefined],
      ['About', 'en'],
    ],
  );
});

test('overrides decide, a kind for all its classes, and a section they send nowhere stays in the index', () => {
  const outline: PageOutline = pageOutline(sample());
  const model = navigationModel(outline, {
    overrides: defineNavigationOverrides({ ...everything(null), works: 'work' }),
  });
  // The essays stay Writing: no override moves a writing works section.
  assert.deepEqual(
    model.primary.map(({ id }) => id),
    ['work', 'writing'],
  );
  assert.deepEqual(ids(model.primary[0]!.sections), [
    'work-showcase',
    'incident-history',
    'looking',
    'listening-a-small-experiment',
  ]);
  assert.equal(model.index.length, 28);
});

test('the footer outline holds the call to action the closing block merges: the one beside the contact section', () => {
  const input = sample();
  const footer = footerOutline(input);
  assert.deepEqual(footer.cta, {
    id: 'want-to-work-together',
    title: 'Want to work together?',
    description:
      'I take on two consulting engagements a quarter. Most of my client work starts with a single email.',
    primary: { text: 'Email me', href: 'mailto:anamika@example.com' },
    secondary: { text: 'Download CV', href: 'https://anamika.example.com/cv.pdf' },
  });
  const sections = (ids: readonly string[]) => ({
    ...input,
    portfolio: {
      ...input.portfolio,
      sections: ids.map((id) => input.portfolio.sections.find((section) => section.id === id)!),
    },
  });
  // Just before the contact section counts too; one further away doesn't.
  assert.equal(
    footerOutline(sections(['want-to-work-together', 'contact'])).cta?.id,
    'want-to-work-together',
  );
  assert.equal(
    footerOutline(sections(['want-to-work-together', 'about', 'contact'])).cta,
    undefined,
  );
  // With no contact section, the page's last call to action.
  assert.equal(
    footerOutline(sections(['want-to-work-together', 'about'])).cta?.id,
    'want-to-work-together',
  );
  assert.equal(footerOutline(sections(['about', 'contact'])).cta, undefined);
});

test('the footer outline lists every link target once: the call to action keeps its label, the email stays as text, and no list repeats them', () => {
  const footer = footerOutline(sample());
  // "Download CV" stands for the CV, so the "Resume" link to the same file goes.
  assert.deepEqual(
    footer.links.map(({ text }) => text),
    ['GitHub', 'LinkedIn', 'Mastodon', 'anamika.example.com'],
  );
  assert.deepEqual(footer.email, {
    text: 'anamika@example.com',
    href: 'mailto:anamika@example.com',
  });
  const portfolio = {
    schemaVersion: 3,
    locale: 'en',
    direction: 'ltr',
    identity: { name: 'Rowan Vale', email: 'Rowan@Vale.test' },
    links: [
      { url: 'https://vale.test/', label: 'Site' },
      { url: 'https://vale.test', label: 'Home' },
      { url: 'MAILTO:rowan@vale.test', label: 'Write' },
      { url: 'https://vale.test/cv.pdf', label: 'Resume' },
      { url: 'https://github.com/rowan', label: 'GitHub' },
    ],
    contact: {
      message: 'Say hi.',
      links: [
        { url: 'https://github.com/rowan/', label: 'Code' },
        { url: 'https://vale.test/cv.pdf', label: 'CV' },
      ],
    },
    sections: [
      { kind: 'contact', id: 'contact', title: 'Contact' },
      {
        kind: 'cta',
        id: 'hire',
        title: 'Hire me',
        primaryAction: { url: 'mailto:rowan@vale.test', label: 'Email me' },
        secondaryAction: { url: 'https://vale.test/cv.pdf', label: 'Download CV' },
      },
    ],
  };
  const deduped = footerOutline(written(portfolio));
  assert.deepEqual(deduped.cta && [deduped.cta.primary?.text, deduped.cta.secondary?.text], [
    'Email me',
    'Download CV',
  ]);
  // A path with or without its last slash, and a mailto in any case, are one place.
  assert.deepEqual(
    deduped.links.map(({ text }) => text),
    ['Site', 'GitHub'],
  );
  // Each list stands alone apart from that: the contact's own links keep
  // GitHub, which a footer shows instead of the portfolio's, not beside them.
  assert.deepEqual(
    deduped.contact?.links.map(({ text }) => text),
    ['Code'],
  );
  assert.equal(deduped.email?.text, 'Rowan@Vale.test');
  // A second action to the first's target is no second action.
  const twice = footerOutline(
    written({
      ...portfolio,
      sections: [
        portfolio.sections[0],
        {
          ...portfolio.sections[1],
          secondaryAction: { url: 'mailto:rowan@vale.test', label: 'Write' },
        },
      ],
    }),
  );
  assert.equal(twice.cta?.secondary, undefined);
  // A mail button that presets a subject mails the same address: no list repeats it.
  const subject = footerOutline(
    written({
      ...portfolio,
      links: [...portfolio.links, { url: 'https://GitHub.com/rowan', label: 'GitHub again' }],
      sections: [
        portfolio.sections[0],
        {
          ...portfolio.sections[1],
          primaryAction: { url: 'mailto:Rowan@vale.test?subject=Hello', label: 'Email me' },
        },
      ],
    }),
  );
  assert.equal(subject.cta?.primary?.href, 'mailto:Rowan@vale.test?subject=Hello');
  // And a web address's host in any case is one place.
  assert.deepEqual(
    subject.links.map(({ text }) => text),
    ['Site', 'GitHub'],
  );
  assert.ok(sameTarget('mailto:rowan@vale.test?subject=Hi', 'MAILTO:Rowan@Vale.test'));
  assert.ok(sameTarget('https://GitHub.com/rowan/', 'https://github.com/rowan'));
  assert.ok(!sameTarget('https://github.com/Rowan', 'https://github.com/rowan'));
  assert.ok(!sameTarget('mailto:a@vale.test', 'mailto:b@vale.test'));
  // With no call to action, only the email and the lists' own repeats go.
  const plain = footerOutline(written({ ...portfolio, sections: [portfolio.sections[0]] }));
  assert.deepEqual(
    plain.links.map(({ text }) => text),
    ['Site', 'Resume', 'GitHub'],
  );
});

// K-1: the canonical section-to-destination map, the declared overrides,
// and the grouping hook.

const placedOf = (outline: PageOutline, options?: Parameters<typeof navigationModel>[1]) =>
  Object.fromEntries(navigationModel(outline, options).placed);

test("the canonical map gives the director's majority placements: Publications in Record, Incident History in Work, On GitHub in Record, Skills in About, Essays in Writing", () => {
  const placed = placedOf(pageOutline(sample()));
  assert.deepEqual(
    ['publications', 'incident-history', 'on-github', 'skills', 'essays'].map((id) => [
      id,
      placed[id],
    ]),
    [
      ['publications', 'record'],
      ['incident-history', 'work'],
      ['on-github', 'record'],
      ['skills', 'about'],
      ['essays', 'writing'],
    ],
  );
  // Every section's place is the canonical one, and the destinations hold exactly those.
  const outline = pageOutline(sample());
  const model = navigationModel(outline);
  for (const section of model.index) {
    assert.equal(placed[section.id], canonicalDestination(section), section.id);
  }
  for (const destination of model.primary) {
    for (const section of destination.sections) assert.equal(placed[section.id], destination.id);
  }
});

test('a section is placed by what it is, its kind and what its items are, never by its title or id', () => {
  const outline = pageOutline(sample());
  const classes = Object.fromEntries(
    outline.sections.map((section) => [section.id, sectionClass(section)]),
  );
  assert.deepEqual(classes, {
    top: 'hero',
    thesis: 'practice:thesis',
    'work-showcase': 'works',
    'at-a-glance': 'evidence:metric',
    about: 'lede:titled',
    now: 'now',
    'currently-focused-on': 'focus',
    essays: 'works:writing',
    'words-from-collaborators': 'evidence:testimonial',
    skills: 'practice:skills',
    experience: 'chronology',
    education: 'chronology',
    publications: 'evidence:publication',
    talks: 'evidence:talk',
    awards: 'evidence:award',
    'incident-history': 'works',
    patents: 'evidence:patent',
    looking: 'works',
    'listening-a-small-experiment': 'works',
    press: 'evidence:press',
    'off-the-page': 'fun-facts',
    quote: 'quote',
    'stack-i-currently-reach-for': 'practice:tools',
    engagements: 'practice:services',
    elsewhere: 'evidence:external-work',
    'on-github': 'github',
    contact: 'contact',
    'want-to-work-together': 'cta',
  });
  // Renamed and re-identified, every section lands where it did.
  const renamed: PageOutline = {
    ...outline,
    sections: outline.sections.map((section, at) => ({
      ...section,
      id: `s${at}`,
      title: section.title === undefined ? undefined : 'Writing',
    })) as OutlineSection[],
  };
  assert.deepEqual(Object.values(placedOf(renamed)), Object.values(placedOf(outline)));
  // An evidence section of mixed types is plain `evidence`, and a works
  // section with any medium that isn't writing or research is plain `works`.
  const mixed = { id: 'm', kind: 'evidence', family: 'proof', count: 2 } as const;
  assert.equal(
    sectionClass({
      ...mixed,
      types: [
        { type: 'talk', count: 1 },
        { type: 'press', count: 1 },
      ],
    }),
    'evidence',
  );
  assert.equal(sectionClass({ ...mixed, types: [] }), 'evidence');
  assert.equal(
    sectionClass({ id: 'x', kind: '@acme/portfolio-x/shows', family: 'other', count: 0 }),
    'extension',
  );
});

test('the canonical map places every core kind and every evidence type, and they are the schema’s', () => {
  for (const kind of ALL_SECTION_KINDS) {
    assert.ok(Object.hasOwn(CANONICAL_DESTINATIONS, kind), kind);
    // And sectionClass() knows it, rather than taking it for an extension's.
    const name = sectionClass({ id: kind, kind, family: 'other', count: 0 });
    assert.equal(name.split(':')[0], kind, kind);
  }
  // Every evidence type the schema has is a class an override may name, and nothing else is.
  for (const type of EVIDENCE_TYPES) {
    assert.ok(
      !checkDestinationOverrides({ [`evidence:${type}`]: 'writing' }, []).some((problem) =>
        problem.includes('no section class'),
      ),
      type,
    );
  }
  assert.ok(
    checkDestinationOverrides({ ['evidence:bogus' as 'evidence']: 'writing' }, [])[0]!.includes(
      'no section class or kind',
    ),
  );
  for (const part of PRACTICE_PARTS) {
    assert.ok(
      !checkDestinationOverrides({ [`practice:${part}`]: 'record' }, []).some((problem) =>
        problem.includes('no section class'),
      ),
      part,
    );
  }
});

test('on every fixture, the sparse, long-text, right-to-left and non-English ones among them, every section takes its canonical place', () => {
  const names = CONTRACT_FIXTURES.map(({ name }) => name);
  for (const required of ['sparse', 'long-text', 'rtl', 'mixed', 'complete']) {
    assert.ok(names.includes(required as never), required);
  }
  for (const name of names) {
    const outline = pageOutline(fixture(name));
    const model = navigationModel(outline);
    assert.equal(model.placed.size, model.index.length, name);
    for (const section of model.index) {
      assert.equal(
        model.placed.get(section.id),
        canonicalDestination(section),
        `${name} ${section.id}`,
      );
    }
    // The default groups are the destinations with sections, all of them, in the fixed order.
    assert.deepEqual(
      model.groups.map(({ id, destination }) => [id, destination]),
      DESTINATIONS.filter((id) => [...model.placed.values()].includes(id)).map((id) => [id, id]),
      name,
    );
  }
});

/** Schematic's sheet placements (brief §5.4), as overrides. */
const SCHEMATIC = defineNavigationOverrides({
  'evidence:publication': 'writing',
  'evidence:talk': 'writing',
  'evidence:press': 'writing',
  'evidence:metric': 'about',
  'evidence:external-work': 'contact',
  'evidence:repository': 'work',
  'practice:skills': 'record',
  'practice:tools': 'record',
  'practice:services': 'contact',
  github: 'work',
  extension: 'about',
});

test("a composition's declared overrides move the classes they name and nothing else", () => {
  const outline = pageOutline(sample());
  const canonical = placedOf(outline);
  const moved = placedOf(outline, { overrides: SCHEMATIC });
  const changed = Object.keys(moved).filter((id) => moved[id] !== canonical[id]);
  assert.deepEqual(changed, [
    'at-a-glance',
    'skills',
    'publications',
    'talks',
    'press',
    'stack-i-currently-reach-for',
    'engagements',
    'elsewhere',
    'on-github',
  ]);
  assert.equal(moved.publications, 'writing');
  assert.equal(moved.skills, 'record');
  // A kind's key moves the classes of that kind no class key names, and
  // writing works stay Writing whatever the kind's key says.
  const kinds = placedOf(outline, {
    overrides: defineNavigationOverrides({
      evidence: 'about',
      'evidence:talk': 'writing',
      works: 'about',
    }),
  });
  assert.equal(kinds.publications, 'about');
  assert.equal(kinds.talks, 'writing');
  assert.equal(kinds['work-showcase'], 'about');
  assert.equal(kinds.essays, 'writing');
});

test('checkDestinationOverrides, for the composition test that every override needs, finds what a map gets wrong', () => {
  const outlines = [pageOutline(sample())];
  // Schematic's map against the sample alone: two of its classes have no
  // section there, so the composition's test passes the fixtures that do.
  assert.deepEqual(checkDestinationOverrides(SCHEMATIC, outlines), [
    'evidence:repository matches no section in any of the outlines',
    'extension matches no section in any of the outlines',
  ]);
  assert.deepEqual(
    checkDestinationOverrides(
      {
        'works:writing': 'work',
        'evidence:award': 'record',
        ['photos' as 'custom']: 'work',
        quote: 'quotes' as never,
        cta: 'about',
      },
      outlines,
    ),
    [
      "works:writing can't move: a writing works section is always Writing",
      'evidence:award goes to record, where its sections go without it',
      'photos is no section class or kind',
      'quote goes to quotes, none of the five destinations',
    ],
  );
  assert.deepEqual(checkDestinationOverrides({}, outlines), []);
  // A class key that keeps the canonical place against its kind's key says
  // something, and a kind's key that moves one of its classes does too.
  assert.deepEqual(
    checkDestinationOverrides({ evidence: 'about', 'evidence:metric': 'record' }, outlines),
    [],
  );
  assert.deepEqual(checkDestinationOverrides({ lede: null }, outlines), []);
  assert.deepEqual(
    checkDestinationOverrides({ evidence: 'record', 'evidence:metric': 'about' }, outlines),
    ['evidence goes to record, where its sections go without it'],
  );
  // Only sections with an anchor are placed, so one without matches nothing.
  const unanchored: PageOutline = {
    ...outlines[0]!,
    sections: outlines[0]!.sections.map((section) =>
      section.kind === 'github' ? { ...section, href: undefined } : section,
    ),
  };
  assert.deepEqual(checkDestinationOverrides({ github: 'work' }, [unanchored]), [
    'github matches no section in any of the outlines',
  ]);
});

test('overrides come only from defineNavigationOverrides(): an untyped map, `satisfies`, a spread, or a cast throws', () => {
  const outline = pageOutline(sample());
  const raw = { github: 'work' } as const;
  // The review's bypasses (K-1 M1), each refused by the type and at run time.
  const untyped = { overrides: raw };
  assert.throws(
    // @ts-expect-error an undeclared map isn't DestinationOverrides
    () => navigationModel(outline, untyped),
    /defineNavigationOverrides/,
  );
  const satisfying = { primary: 4, overrides: raw } satisfies Omit<
    NavigationOptions,
    'overrides'
  > & { overrides: DestinationOverrideMap };
  assert.throws(
    // @ts-expect-error `satisfies` a map type still isn't a declared map
    () => navigationModel(outline, satisfying),
    /defineNavigationOverrides/,
  );
  const base = { overrides: raw };
  assert.throws(
    // @ts-expect-error a spread of an undeclared map
    () => navigationModel(outline, { ...base }),
    /defineNavigationOverrides/,
  );
  const cast = { github: 'work' } as unknown as typeof SCHEMATIC;
  assert.throws(() => navigationModel(outline, { overrides: cast }), /defineNavigationOverrides/);
  // A copy of a declared map is a new, undeclared one.
  assert.throws(
    () => navigationModel(outline, { overrides: { ...SCHEMATIC } }),
    /defineNavigationOverrides/,
  );
  // The declared map itself, passed by name or spread with other options, is taken.
  const options = { primary: 4, overrides: SCHEMATIC };
  assert.equal(navigationModel(outline, { ...options }).placed.get('on-github'), 'work');
  assert.ok(Object.isFrozen(SCHEMATIC));
  assert.deepEqual(Object.keys(defineNavigationOverrides({ github: 'work' })), ['github']);
});

test("the grouping hook: Mission Control's boards, each standing for one of the five ids, in its own order", () => {
  const outline = pageOutline(sample());
  type Board = 'overview' | 'work' | 'writing' | 'record' | 'about' | 'contact';
  // A Writing board, for an owner with writing (lead A's ruling on brief
  // §5.8), which drops while it's empty.
  const boards: GroupingOptions<Board> = {
    groups: [
      { id: 'overview', destination: 'about', label: { text: 'Overview' } },
      { id: 'work', destination: 'work' },
      { id: 'writing', destination: 'writing' },
      { id: 'record', destination: 'record' },
      { id: 'about', destination: 'about' },
      { id: 'contact', destination: 'contact' },
    ],
    // Overview opens with the hero and About's quick reads; every other
    // section takes its destination's board.
    groupOf: (section, { sectionClass: name }) =>
      section.kind === 'hero' ||
      name === 'practice:thesis' ||
      section.kind === 'now' ||
      section.kind === 'focus'
        ? 'overview'
        : undefined,
  };
  const model = navigationModel<Board>(outline, { grouping: boards });
  // The test a composition with boards writes: nothing refused, on the sample or any fixture.
  assert.deepEqual(
    checkGrouping({ grouping: boards }, [
      outline,
      ...CONTRACT_FIXTURES.map(({ name }) => pageOutline(fixture(name))),
    ]),
    [],
  );
  assert.deepEqual(
    model.groups.map(({ id, destination, label, sections }) => [
      id,
      destination,
      label,
      ids(sections),
    ]),
    [
      ['overview', 'about', 'Overview', ['top', 'thesis', 'now', 'currently-focused-on']],
      [
        'work',
        'work',
        'Work',
        ['work-showcase', 'incident-history', 'looking', 'listening-a-small-experiment'],
      ],
      ['writing', 'writing', 'Writing', ['essays']],
      [
        'record',
        'record',
        'Record',
        [
          'at-a-glance',
          'words-from-collaborators',
          'experience',
          'education',
          'publications',
          'talks',
          'awards',
          'patents',
          'press',
          'elsewhere',
          'on-github',
        ],
      ],
      [
        'about',
        'about',
        'About',
        ['about', 'skills', 'off-the-page', 'quote', 'stack-i-currently-reach-for', 'engagements'],
      ],
      ['contact', 'contact', 'Contact', ['contact', 'want-to-work-together']],
    ],
  );
  // Every board holds only sections of the destination it stands for, or the index's own.
  for (const group of model.groups) {
    for (const section of group.sections) {
      assert.ok(
        [group.destination, null].includes(model.placed.get(section.id)!),
        `${group.id} ${section.id}`,
      );
    }
  }
  // Boards group for display; the chrome's destinations and every section's place stay the canonical ones.
  assert.deepEqual(
    model.primary.map(({ id }) => id),
    DESTINATIONS,
  );
  assert.equal(model.placed.get('essays'), 'writing');
  // About lands on its namesake section, the Overview board on its first.
  assert.deepEqual(
    model.groups.map(({ href }) => href),
    ['#top', '#work-showcase', '#essays', '#at-a-glance', '#about', '#contact'],
  );
});

test('the grouping hook never moves a section to another destination: it refuses, and its diagnostics say so', () => {
  const outline = pageOutline(sample());
  type Board = 'overview' | 'work' | 'writing' | 'record' | 'about' | 'contact';
  const groups = [
    { id: 'overview', destination: 'about' },
    { id: 'work', destination: 'work' },
    { id: 'writing', destination: 'writing' },
    { id: 'record', destination: 'record' },
    { id: 'about', destination: 'about' },
    { id: 'contact', destination: 'contact' },
  ] as const;
  // The review's case (K-1 M2): the essays on the Work board, and the
  // first works and metrics on Overview, which stands for About.
  const options = {
    grouping: {
      groups,
      groupOf: (section: OutlineSection, { sectionClass: name, firstOfKind }: GroupContext) => {
        if (section.id === 'essays') return 'work' as const;
        if ((section.kind === 'works' && firstOfKind) || name === 'evidence:metric') {
          return 'overview' as const;
        }
        return section.kind === 'hero' ? ('overview' as const) : undefined;
      },
    },
  };
  const model = navigationModel<Board>(outline, options);
  const board = (id: Board) => ids(model.groups.find((group) => group.id === id)!.sections);
  assert.deepEqual(board('overview'), ['top']);
  assert.deepEqual(board('writing'), ['essays']);
  assert.ok(board('work').includes('work-showcase'));
  assert.ok(board('record').includes('at-a-glance'));
  assert.deepEqual(
    model.diagnostics.map((message) => message.split(',')[0]),
    ['groupOf put work-showcase', 'groupOf put at-a-glance', 'groupOf put essays'],
  );
  // The chrome and the places are the map's either way.
  assert.equal(model.placed.get('essays'), 'writing');
  // checkGrouping() gathers them over the outlines a composition's test passes.
  assert.deepEqual(checkGrouping<Board>(options, [outline]), model.diagnostics);
  // With no group standing for a destination, its sections are in none, and it says so.
  const noWriting = navigationModel<Board>(outline, {
    grouping: { groups: groups.filter(({ id }) => id !== 'writing') },
  });
  assert.ok(!noWriting.groups.some(({ sections }) => ids(sections).includes('essays')));
  assert.equal(noWriting.diagnostics.length, 1);
  assert.match(noWriting.diagnostics[0]!, /no group stands for writing/);
  // Without grouping, there's nothing to refuse.
  assert.deepEqual(navigationModel(outline).diagnostics, []);
  // Two boards for one destination, neither named after it, have no home: a declaration mistake.
  assert.throws(
    () =>
      navigationModel(outline, {
        grouping: {
          groups: [
            { id: 'board-overview', destination: 'about' },
            { id: 'board-about', destination: 'about' },
          ],
        },
      }),
    /none is named about/,
  );
});

test("the grouping hook: Schematic's sheets drop when empty, keep the authored order, and take what the map leaves to the index in `unplaced`", () => {
  const outline = pageOutline(sample());
  type Sheet = 'cover' | 'about' | 'work' | 'writing' | 'record' | 'contact';
  const sheets = navigationModel<Sheet>(outline, {
    overrides: SCHEMATIC,
    grouping: {
      groups: [
        { id: 'cover', destination: 'about', label: { text: 'Cover' } },
        { id: 'about', destination: 'about' },
        { id: 'work', destination: 'work' },
        { id: 'writing', destination: 'writing' },
        { id: 'record', destination: 'record' },
        { id: 'contact', destination: 'contact' },
      ],
      groupOf: (section) => (section.kind === 'hero' ? 'cover' : undefined),
      unplaced: 'about',
    },
  });
  assert.deepEqual(
    sheets.groups.map(({ id }) => id),
    ['cover', 'about', 'work', 'writing', 'record', 'contact'],
  );
  assert.deepEqual(ids(sheets.groups.find(({ id }) => id === 'writing')!.sections), [
    'essays',
    'publications',
    'talks',
    'press',
  ]);
  // Within a sheet, the page's order holds.
  for (const group of sheets.groups) {
    const at = group.sections.map((section) => outline.sections.indexOf(section));
    assert.deepEqual(
      at,
      [...at].sort((a, b) => a - b),
      group.id,
    );
  }
  // A sheet nothing lands on drops.
  const sparse = navigationModel<Sheet>(pageOutline(fixture('sparse')), {
    grouping: {
      groups: [
        { id: 'writing', destination: 'writing' },
        { id: 'contact', destination: 'contact' },
      ],
    },
  });
  assert.deepEqual(
    sparse.groups.map(({ id, sections }) => [id, ids(sections)]),
    [['contact', ['contact']]],
  );
  // A section groupOf leaves out with null, or that nothing places, is in no group.
  const none = navigationModel<Sheet>(outline, {
    grouping: {
      groups: [{ id: 'work', destination: 'work' }],
      groupOf: (section) => (section.id === 'looking' ? null : undefined),
    },
  });
  assert.ok(!ids(none.groups[0]!.sections).includes('looking'));
  // Mistakes in the declaration are the composition's, so they throw.
  assert.throws(() =>
    navigationModel<Sheet>(outline, {
      grouping: { groups: [{ id: 'work', destination: 'work' }], groupOf: () => 'cover' },
    }),
  );
  assert.throws(() =>
    navigationModel<Sheet>(outline, {
      grouping: {
        groups: [
          { id: 'work', destination: 'work' },
          { id: 'work', destination: 'record' },
        ],
      },
    }),
  );
  assert.throws(() =>
    navigationModel<Sheet>(outline, {
      grouping: { groups: [{ id: 'work', destination: 'works' as never }] },
    }),
  );
});
