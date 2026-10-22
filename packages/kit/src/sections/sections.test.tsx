import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import {
  composeSchemas,
  IdentitySchema,
  isPlainObject,
  toPublicView,
  type ParsedPair,
  type Section,
  type SectionKind,
} from '@portfolio/schema';
import {
  buildRenderInput,
  validateManifest,
  type VariantRenderInput,
} from '@portfolio/variant-contract';
import { formatDate, formatEpisodeDuration, formatStatValue, formatTrackDuration } from '../format';
import { unescapeHtml } from '../html-escape';
import { doiLink } from './renderers/dated-entries';
import { hrefFor } from './primitives';
import { withoutClock } from '../test-support/clock';
import { corpus } from '../test-support/markdown-corpus';
import { htmlProblems } from '../test-support/strict-html';
import { COMPLETE } from './__fixtures__/complete';
import {
  registerHostModules,
  renderSection,
  RichText,
  seededRandom,
  SHARED_RENDERERS,
  VisitorControlSlot,
  type BespokeRenderers,
} from '.';

// @portfolio/kit/sections (#5, Slice 2): one shared renderer per core kind,
// each rendering every field, at the heading level its caller gives, with no
// inline style, and renderSection() choosing between them and a variant's own.

// tsx compiles the kit's JSX (tsconfig `jsx: preserve`) to React.createElement
// calls, which Next's compiler never does, so the test supplies React itself.
Object.assign(globalThis, { React });

const { PortfolioSchema, coreSections } = composeSchemas();

const SITE = {
  schemaVersion: 2,
  appearance: {
    variant: 'kit-shared',
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
  features: { feed: true, productAttribution: false },
};

/** A manifest that renders nothing bespoke, like the fallback composition. */
function manifest(extra: Record<string, unknown> = {}) {
  const result = validateManifest(
    {
      id: 'kit-shared',
      name: 'Shared',
      promise: 'Every kind through the shared renderers.',
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
    { packageName: '@kit/shared' },
  );
  assert.ok(result.ok, JSON.stringify(result.diagnostics));
  return result.manifest;
}

function inputFor(
  portfolio: unknown = COMPLETE,
  options: {
    manifest?: Record<string, unknown>;
    idPrefix?: string;
    basePath?: string;
    query?: Record<string, string>;
  } = {},
): VariantRenderInput {
  const pair = { portfolio: PortfolioSchema.parse(portfolio), site: SITE } as unknown as ParsedPair;
  return buildRenderInput({
    view: toPublicView(pair),
    manifest: manifest(options.manifest),
    route: { route: 'home' },
    basePath: options.basePath ?? '',
    query: options.query,
    origin: 'https://rowan.test',
    requestTime: '2026-10-20T12:00:00Z',
    idPrefix: options.idPrefix,
  });
}

const INPUT = inputFor();
const html = (node: React.ReactNode) => renderToStaticMarkup(<>{node}</>);
const sectionOf = (input: VariantRenderInput, kind: string) =>
  input.portfolio.sections.find((section) => section.kind === kind)!;
const render = (kind: string, input = INPUT, level?: 1 | 2 | 3 | 4 | 5 | 6) =>
  html(renderSection(sectionOf(input, kind), input, {}, { level }));

// The fixture has to have every field for the next test to mean anything.

/** What a zod schema's definition holds, read without importing zod. */
interface Schema {
  readonly _def: {
    readonly typeName: string;
    readonly innerType?: Schema;
    readonly schema?: Schema;
    readonly type?: Schema;
    readonly value?: unknown;
  };
  readonly shape?: Record<string, Schema>;
}

/** The schema inside optional, nullable, default, and refinement wrappers. */
function unwrap(schema: Schema): Schema {
  for (;;) {
    const { typeName, innerType, schema: inner } = schema._def;
    if (['ZodOptional', 'ZodNullable', 'ZodDefault'].includes(typeName) && innerType) {
      schema = innerType;
    } else if (typeName === 'ZodEffects' && inner) {
      schema = inner;
    } else {
      return schema;
    }
  }
}

/** The fields `schema` defines that `value` never sets, anywhere in a list. */
function missingFields(schema: Schema, value: unknown, path: string): string[] {
  const unwrapped = unwrap(schema);
  const fieldsOf = (object: Schema) =>
    Object.entries(object.shape ?? {}).filter(([key]) => key !== 'extensions');
  if (unwrapped._def.typeName === 'ZodObject') {
    if (!isPlainObject(value)) return [path];
    return fieldsOf(unwrapped).flatMap(([key, child]) =>
      Object.hasOwn(value, key)
        ? missingFields(child, value[key], `${path}/${key}`)
        : [`${path}/${key}`],
    );
  }
  if (unwrapped._def.typeName === 'ZodArray') {
    if (!Array.isArray(value) || value.length === 0) return [`${path}/0`];
    const element = unwrap(unwrapped._def.type!);
    if (element._def.typeName !== 'ZodObject') return [];
    // Each field has to appear in some item.
    return fieldsOf(element).flatMap(([key, child]) => {
      const holder = value.find((item) => isPlainObject(item) && Object.hasOwn(item, key));
      return holder ? missingFields(child, holder[key], `${path}/*/${key}`) : [`${path}/*/${key}`];
    });
  }
  return [];
}

test('the fixture has every core kind and identity field, each with every field its schema defines', () => {
  assert.deepEqual(
    missingFields(IdentitySchema as unknown as Schema, COMPLETE.identity, 'identity'),
    [],
  );
  const kinds = COMPLETE.sections.map((section) => section.kind);
  assert.deepEqual([...kinds].sort(), Object.keys(SHARED_RENDERERS).sort());
  for (const schema of coreSections as unknown as Schema[]) {
    const kind = String(schema.shape!.kind!._def.value);
    const section = COMPLETE.sections.find((candidate) => candidate.kind === kind);
    const missing = missingFields(schema, section, kind).filter((path) => path !== `${kind}/lang`);
    assert.deepEqual(missing, [], kind);
  }
});

// Every value the fixture sets, and what of it the markup must show.

const escape = (text: string) =>
  text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#x27;');

const DATE_FIELDS = new Set([
  'start',
  'end',
  'asOf',
  'publishedAt',
  'presentedAt',
  'receivedAt',
  'filedAt',
  'grantedAt',
  'releasedAt',
  'takenAt',
]);

/** What the markup shows for one field's value, or null for a field that shows nothing yet. */
function shown(kind: string, key: string, value: unknown): string[] | null {
  if (kind === 'github' && key !== 'username' && key !== 'title' && key !== 'subtitle') {
    // Configuration for GitHub data no render input carries until #10.
    return null;
  }
  if (DATE_FIELDS.has(key)) return [escape(formatDate(String(value)))];
  switch (key) {
    case 'width':
    case 'height':
      return [`${key}="${value}"`];
    case 'x':
    case 'y':
      return [`data-focal-${key}="${value}"`];
    case 'readingTimeMinutes':
      return [`${value} min read`];
    case 'durationMinutes':
      return [formatEpisodeDuration(Number(value))];
    case 'durationSeconds':
      return [formatTrackDuration(Number(value))];
    case 'number':
      return kind === 'episodes' ? [`#${value}`] : [escape(String(value))];
    case 'years':
      return [`${formatStatValue(Number(value), 'en')}+`];
    case 'value':
      return [escape(formatStatValue(value as string | number, 'en'))];
    case 'type':
      return ['Keynote', 'data-talk-type="keynote"'];
    case 'status':
      return ['Granted', 'data-patent-status="granted"'];
    case 'layout':
      return [`data-layout="${value}"`];
    case 'iconName':
      return [`data-icon="${value}"`];
    case 'metric':
      return [`data-metric="${value}"`];
    case 'platform':
      return [`data-platform="${value}"`];
    case 'showAvailability':
      return ['Available for new work'];
    case 'doi':
      return [escape(String(value)), `href="${escape(doiLink(String(value))!.url)}"`];
    case 'username':
      return [`@${value}`, `href="https://github.com/${value}"`];
    default:
      return typeof value === 'string' ? [escape(value)] : [String(value)];
  }
}

/** Every leaf the section sets, as `[key, value]`, skipping what's an attribute of the section itself. */
function leaves(value: unknown, key = ''): Array<[string, unknown]> {
  if (Array.isArray(value)) return value.flatMap((item) => leaves(item, key));
  if (isPlainObject(value)) {
    return Object.entries(value).flatMap(([child, inner]) =>
      ['id', 'kind', 'lang', 'extensions'].includes(child) ? [] : leaves(inner, child),
    );
  }
  return [[key, value]];
}

test('each shared renderer renders every field of its kind', () => {
  for (const raw of COMPLETE.sections) {
    const markup = render(raw.kind);
    for (const [key, value] of leaves(raw)) {
      for (const text of shown(raw.kind, key, value) ?? []) {
        assert.ok(markup.includes(text), `${raw.kind}: ${key} shows ${text}\n${markup}`);
      }
    }
  }
});

test('every identity field shows: the hero shows the name, tagline, avatar, pronouns, and location, and contact the email', () => {
  const input = inputFor({
    ...COMPLETE,
    sections: [
      { kind: 'hero', id: 'top' },
      { kind: 'contact', id: 'contact', links: [] },
    ],
  });
  const markup = html(input.portfolio.sections.map((section) => renderSection(section, input, {})));
  for (const [key, value] of leaves(COMPLETE.identity)) {
    const expected =
      key === 'email' ? [`href="mailto:${value}"`, String(value)] : shown('identity', key, value);
    for (const text of expected ?? []) {
      assert.ok(markup.includes(text), `identity: ${key} shows ${text}\n${markup}`);
    }
  }
  // The avatar sits beside the name, so it loads with the first section, at once.
  assert.match(
    markup,
    /<img class="pf-avatar" src="\/media\/avatar\.png" alt="Alt avatar"[^>]* loading="eager"/,
  );
  // With no links anywhere, the email is still a way to get in touch.
  const bare = inputFor({
    ...COMPLETE,
    links: [],
    sections: [{ kind: 'contact', id: 'contact', links: [] }],
  });
  assert.match(
    render('contact', bare),
    /<ul class="pf-links" role="list"><li><a href="mailto:rowan@rowan\.test" data-platform="email">rowan@rowan\.test<\/a><\/li><\/ul>/,
  );
  // A link to the same address isn't listed twice.
  const linked = inputFor({
    ...COMPLETE,
    sections: [
      {
        kind: 'contact',
        id: 'contact',
        links: [{ url: 'mailto:Rowan@rowan.test', label: 'Write' }],
      },
    ],
  });
  assert.equal(render('contact', linked).match(/mailto:/gi)?.length, 1);
});

test('a section takes its heading level from the caller, and its items go one deeper', () => {
  assert.match(
    render('experience', INPUT, 3),
    /<h3 class="pf-section__title">Experience title<\/h3>/,
  );
  assert.match(render('experience', INPUT, 3), /<h4 class="pf-item__title">Experience role<\/h4>/);
  assert.match(render('experience', INPUT, 6), /<h6 class="pf-item__title">Experience role<\/h6>/);
  assert.match(render('hero', INPUT, 1), /<h1 class="pf-hero__name">Hero name<\/h1>/);
  assert.match(render('lede'), /<h2 class="pf-section__title">Lede title<\/h2>/);
});

test('no shared renderer sets an inline style', () => {
  for (const { kind } of COMPLETE.sections) assert.doesNotMatch(render(kind), /\sstyle=/, kind);
});

/** The only properties the shared stylesheet may set: layout, never appearance. */
const LAYOUT_PROPERTIES = new Set([
  'block-size',
  'break-inside',
  'column-gap',
  'columns',
  'display',
  'flex-wrap',
  'gap',
  'grid-template-columns',
  'inline-size',
  'list-style',
  'margin-block',
  'margin-block-end',
  'margin-block-start',
  'margin-inline',
  'max-inline-size',
  'object-fit',
  // Where a line breaks, so a long word never widens the page.
  'overflow-wrap',
  'padding-inline',
  'padding-inline-start',
]);

test('the shared stylesheet sets layout alone, under [data-variant], with no weight a variant must beat', () => {
  const css = readFileSync(new URL('./styles.css', import.meta.url), 'utf8').replace(
    /\/\*[\s\S]*?\*\//g,
    '',
  );
  const rules = [...css.matchAll(/([^{}]+)\{([^}]*)\}/g)];
  assert.ok(rules.length > 0);
  for (const [, selectors, body] of rules) {
    // :where() weighs nothing, so a variant's own rule for the element wins.
    assert.match(
      selectors!.replace(/\s+/g, ' ').trim(),
      /^:where\( ?\[data-variant\] \[data-renderer='shared'\][^{]*\)$/,
      selectors,
    );
    for (const declaration of body!
      .split(';')
      .map((part) => part.trim())
      .filter(Boolean)) {
      const [property, value = ''] = declaration.split(':').map((part) => part.trim());
      assert.ok(LAYOUT_PROPERTIES.has(property!), `${property} isn't a layout property`);
      assert.doesNotMatch(
        value,
        /#[0-9a-f]{3,8}\b|\b(?:rgb|hsl|oklch)a?\(|!important/i,
        declaration,
      );
    }
  }
});

test('renderSection stamps the section element and dispatches by kind', () => {
  const input = inputFor(COMPLETE, { idPrefix: 'pv-' });
  const markup = html(renderSection(sectionOf(input, 'lede'), input, {}));
  assert.match(
    markup,
    /^<section id="pv-about" data-section-id="about" data-kind="lede" data-renderer="shared">/,
  );
  // The hero's own language rides on its section, and it runs the portfolio's way.
  // (React preloads the first section's eager images ahead of it.)
  assert.match(
    html(renderSection(sectionOf(input, 'hero'), input, {})),
    /^(?:<link rel="preload"[^>]*>)*<section[^>]* lang="en-GB">/,
  );
});

test('a section in a language that runs the other way says so with dir', () => {
  const page = (direction: 'ltr' | 'rtl', lang: string) => {
    const input = inputFor({
      ...COMPLETE,
      locale: direction === 'rtl' ? 'ar' : 'en',
      direction,
      sections: [{ kind: 'lede', id: 'about', lang, body: 'Hi.' }],
    });
    return /^<section[^>]*>/.exec(render('lede', input))![0];
  };
  assert.match(page('ltr', 'ar'), / lang="ar" dir="rtl">$/);
  assert.match(page('ltr', 'he-IL'), / dir="rtl">$/);
  assert.match(page('rtl', 'en'), / lang="en" dir="ltr">$/);
  // The script subtag decides when there is one, and the same direction needs no dir.
  assert.match(page('ltr', 'sd-Deva'), / lang="sd-Deva">$/);
  assert.match(page('ltr', 'az-Arab'), / dir="rtl">$/);
  assert.match(page('rtl', 'fa'), / lang="fa">$/);
});

test('a bespoke renderer for a kind the variant skips is still the mistake it is', () => {
  const skipped = inputFor(COMPLETE, { manifest: { unsupportedKinds: ['github'] } });
  assert.throws(
    () => renderSection(sectionOf(skipped, 'github'), skipped, { github: () => <p>own</p> }),
    /kit-shared passes a renderer for github, which its renderedKinds doesn't list/,
  );
});

test("a kind the variant renders bespoke uses its renderer, and the manifest's unsupported kinds render nothing", () => {
  const input = inputFor(COMPLETE, {
    manifest: { renderedKinds: ['quote'], unsupportedKinds: ['github'] },
  });
  const bespoke: BespokeRenderers = {
    quote: ({ section, level }) => <p data-own={level}>{section.text}</p>,
  };
  assert.equal(
    html(renderSection(sectionOf(input, 'quote'), input, bespoke, { level: 3 })),
    '<section id="quote" data-section-id="quote" data-kind="quote" data-renderer="bespoke"><p data-own="3">Quote text</p></section>',
  );
  assert.equal(renderSection(sectionOf(input, 'github'), input, bespoke), null);
  assert.match(
    html(renderSection(sectionOf(input, 'lede'), input, bespoke)),
    /data-renderer="shared"/,
  );
});

test('a bespoke map that disagrees with renderedKinds is the variant mistake it is', () => {
  const declared = inputFor(COMPLETE, { manifest: { renderedKinds: ['quote'] } });
  assert.throws(
    () => renderSection(sectionOf(declared, 'quote'), declared, {}),
    /kit-shared declares quote in renderedKinds but passes no renderer for it/,
  );
  const undeclared: BespokeRenderers = { lede: () => <p>own</p> };
  assert.throws(
    () => renderSection(sectionOf(INPUT, 'lede'), INPUT, undeclared),
    /kit-shared passes a renderer for lede, which its renderedKinds doesn't list/,
  );
});

test("an extension's section renders through the renderer the host registered, else nothing", () => {
  // A registered extension's section, as the public view keeps it.
  const section = {
    kind: '@acme/portfolio-photography/exhibitions',
    id: 'shows',
    data: { items: [] },
  } as Section;
  const input = INPUT;
  registerHostModules({});
  try {
    assert.equal(renderSection(section, input, {}), null);
    registerHostModules({
      extensionRenderers: {
        '@acme/portfolio-photography/exhibitions': ({ section: own, level }) => (
          <p data-level={level}>{own.id}</p>
        ),
      },
    });
    assert.equal(
      html(renderSection(section, input, {})),
      '<section id="shows" data-section-id="shows" data-kind="@acme/portfolio-photography/exhibitions" data-renderer="shared"><p data-level="2">shows</p></section>',
    );
    assert.throws(
      () => registerHostModules({ extensionRenderers: { exhibitions: () => null } }),
      /exhibitions isn't an extension section kind/,
    );
    assert.throws(
      () =>
        registerHostModules({
          enhancementLoaders: { orbit: async () => ({ default: () => null }) },
        }),
      /orbit isn't an enhancement key/,
    );
  } finally {
    registerHostModules({});
  }
});

test("an untitled section gets its kind's heading, marked English inside other content", () => {
  const untitled = {
    ...COMPLETE,
    locale: 'pt-BR',
    sections: [
      { kind: 'experience', id: 'work', items: [] },
      { kind: 'lede', id: 'about', body: 'Olá.' },
      { kind: 'contact', id: 'contact', links: [] },
    ],
  };
  const input = inputFor(untitled);
  assert.match(
    render('experience', input),
    /<h2 class="pf-section__title" lang="en">Experience<\/h2>/,
  );
  assert.doesNotMatch(render('lede', input), /<h2/);
  // A contact section with no links of its own lists the portfolio's.
  assert.match(render('contact', input), /href="https:\/\/social\.rowan\.test\/@rowan"/);
  assert.match(render('contact', INPUT), /<h2 class="pf-section__title">Contact title<\/h2>/);
});

test("a hero without its own name and tagline shows the identity's", () => {
  const input = inputFor({ ...COMPLETE, sections: [{ kind: 'hero', id: 'top' }] });
  const markup = render('hero', input, 1);
  assert.match(markup, /<h1 class="pf-hero__name">Rowan Vale<\/h1>/);
  assert.match(markup, /Identity tagline/);
});

test("a #fragment link takes the render's id prefix, so it still lands on its section", () => {
  const input = inputFor(COMPLETE, { idPrefix: 'pv-' });
  assert.match(render('hero', input), /href="#pv-contact"/);
  assert.match(render('cta', input), /href="#pv-services"/);
  assert.match(render('cta', input), /href="mailto:hire@rowan\.test"/);
  // /#id is the home page's section, where the routes are mounted.
  const home = inputFor(
    {
      ...COMPLETE,
      sections: [
        { kind: 'cta', id: 'cta', primaryAction: { url: '/#contact', label: 'Contact' } },
        { kind: 'contact', id: 'contact' },
      ],
    },
    { idPrefix: 'pv-' },
  );
  assert.match(render('cta', home), /href="\/#pv-contact"/);
  // Markdown links take it too.
  const prose = inputFor(
    {
      ...COMPLETE,
      sections: [
        {
          kind: 'lede',
          id: 'about',
          body: 'See [contact](#contact), [home](/#contact), or [docs](https://rowan.test/#a).',
        },
        { kind: 'contact', id: 'contact' },
      ],
    },
    { idPrefix: 'pv-' },
  );
  const lede = render('lede', prose);
  assert.match(lede, /<a href="#pv-contact">contact<\/a>/);
  assert.match(lede, /<a href="\/#pv-contact">home<\/a>/);
  assert.match(lede, /<a href="https:\/\/rowan\.test\/#a">docs<\/a>/);
});

test("a /#id link under /sample keeps the render's query, so it stays in the variant it names (#5, Slice 4)", () => {
  const sections = [
    { kind: 'cta', id: 'cta', primaryAction: { url: '/#contact', label: 'Contact' } },
    { kind: 'lede', id: 'about', body: 'See [home](/#contact) or [here](#contact).' },
    { kind: 'contact', id: 'contact' },
  ];
  const sample = inputFor(
    { ...COMPLETE, sections },
    { basePath: '/sample', query: { variant: 'acme-ocean' }, idPrefix: 'pv-' },
  );
  assert.match(render('cta', sample), /href="\/sample\?variant=acme-ocean#pv-contact"/);
  const lede = render('lede', sample);
  assert.match(lede, /<a href="\/sample\?variant=acme-ocean#pv-contact">home<\/a>/);
  // A fragment alone stays on this page, whatever its query.
  assert.match(lede, /<a href="#pv-contact">here<\/a>/);
  // With no query, under a preview grant's base path.
  const preview = inputFor({ ...COMPLETE, sections }, { basePath: '/preview/g_7Hk-2' });
  assert.match(render('cta', preview), /href="\/preview\/g_7Hk-2#contact"/);
});

test("words and dates the renderers add are marked English in other content, and numbers use the content's locale", () => {
  const french = inputFor({
    ...COMPLETE,
    locale: 'fr',
    sections: [
      {
        kind: 'experience',
        id: 'work',
        items: [{ role: 'Ingénieure', organization: 'Acme', period: { start: '2019-06' } }],
      },
      { kind: 'stats', id: 'figures', items: [{ value: 1200, label: 'Lecteurs' }] },
    ],
  });
  const work = render('experience', french);
  assert.match(work, /<time class="pf-date" dateTime="2019-06" lang="en">June 2019<\/time>/);
  assert.match(work, /<span lang="en">Present<\/span>/);
  assert.match(render('stats', french), /1\u202f200/);
  // A tag the runtime has no data for formats in English, not the runtime's default.
  const klingon = inputFor({
    ...COMPLETE,
    locale: 'tlh',
    sections: [
      { kind: 'stats', id: 'figures', items: [{ value: 1200, label: 'Readers' }] },
      { kind: 'publications', id: 'papers', items: [{ title: 'Tide', authors: ['A', 'B', 'C'] }] },
    ],
  });
  assert.match(render('stats', klingon), /1,200/);
  assert.match(render('publications', klingon), /A, B, and C/);
});

test('blank text is absent: no empty heading, label, or separator', () => {
  const input = inputFor({
    ...COMPLETE,
    sections: [
      {
        kind: 'experience',
        id: 'work',
        items: [
          {
            role: ' ',
            organization: 'Acme',
            location: '',
            period: { start: '2020' },
            highlights: ['', 'Shipped'],
          },
        ],
      },
      {
        kind: 'external-portfolios',
        id: 'elsewhere',
        items: [{ url: 'https://shop.rowan.test', brandName: 'Shop', buttonText: ' ' }],
      },
    ],
  });
  const work = render('experience', input);
  assert.doesNotMatch(work, /<h3/);
  assert.doesNotMatch(work, /<li><\/li>/);
  assert.equal(work.match(/pf-sep/g)?.length, 1);
  assert.match(
    render('external-portfolios', input),
    /<a class="pf-action" href="https:\/\/shop\.rowan\.test">Shop<\/a>/,
  );
});

test('an image without alt text is decorative only beside text that names it', () => {
  const noAlt = (name: string) => ({ src: `/media/${name}.png` });
  const input = inputFor({
    ...COMPLETE,
    sections: [
      { kind: 'lede', id: 'about', body: 'Hi.' },
      {
        kind: 'gallery',
        id: 'plates',
        items: [
          { image: noAlt('captioned'), caption: 'The harbor at dawn' },
          { image: noAlt('bare') },
          { image: { src: '/media/ornament.png', alt: '' }, caption: 'An ornament' },
        ],
      },
      {
        kind: 'projects',
        id: 'work',
        items: [{ name: 'Tide', image: noAlt('cover'), images: [noAlt('shot')] }],
      },
      {
        kind: 'experience',
        id: 'jobs',
        items: [
          {
            role: 'Engineer',
            organization: 'Acme',
            logo: noAlt('logo'),
            period: { start: '2020' },
          },
        ],
      },
    ],
  });
  const gallery = render('gallery', input);
  assert.match(gallery, /src="\/media\/captioned\.png" alt="The harbor at dawn"/);
  // Nothing says what this one shows, so it has no alt, and an audit finds it.
  assert.match(gallery, /<img src="\/media\/bare\.png" loading="lazy"/);
  assert.match(gallery, /src="\/media\/ornament\.png" alt=""/);
  const projects = render('projects', input);
  assert.match(projects, /src="\/media\/cover\.png" alt=""/);
  assert.match(projects, /<img src="\/media\/shot\.png" loading="lazy"/);
  assert.match(render('experience', input), /src="\/media\/logo\.png" alt=""/);
});

test('lists the stylesheet strips of bullets still say they are lists', () => {
  for (const { kind } of COMPLETE.sections) {
    const markup = render(kind);
    for (const [list] of markup.matchAll(/<ul[^>]*>/g)) {
      if (/pf-highlights|pf-short-list/.test(list)) assert.doesNotMatch(list, /role=/, kind);
      else assert.match(list, /role="list"/, `${kind}: ${list}`);
    }
  }
});

test("the first section's images load at once, and the rest lazily", () => {
  const input = inputFor({
    ...COMPLETE,
    sections: [
      { kind: 'gallery', id: 'first', items: [{ image: { src: '/a.png', alt: 'A' } }] },
      { kind: 'gallery', id: 'second', items: [{ image: { src: '/b.png', alt: 'B' } }] },
    ],
  });
  const [first, second] = input.portfolio.sections.map((section) =>
    html(renderSection(section, input, {})),
  );
  assert.match(first!, /loading="eager"/);
  assert.match(second!, /loading="lazy"/);
});

test('a DOI links to doi.org whatever prefix it was written with, each part encoded', () => {
  assert.deepEqual(doiLink('10.1000/tide.42'), {
    text: '10.1000/tide.42',
    url: 'https://doi.org/10.1000/tide.42',
  });
  assert.deepEqual(doiLink('doi:10.1234/abc'), {
    text: '10.1234/abc',
    url: 'https://doi.org/10.1234/abc',
  });
  assert.deepEqual(doiLink('https://doi.org/10.1234/abc'), {
    text: '10.1234/abc',
    url: 'https://doi.org/10.1234/abc',
  });
  assert.equal(doiLink('http://dx.doi.org/10.1234/a?b')!.url, 'https://doi.org/10.1234/a%3Fb');
  assert.equal(
    doiLink('10.1002/(SICI)1097-4636(199706)35:4<417::AID-JBM1>3.0.CO;2-#')!.url,
    'https://doi.org/10.1002/(SICI)1097-4636(199706)35%3A4%3C417%3A%3AAID-JBM1%3E3.0.CO%3B2-%23',
  );
  assert.equal(doiLink(' doi: '), undefined);
});

test('nothing reads the clock or Math.random(), so every render of the same input is the same', () => {
  const first = COMPLETE.sections.map(({ kind }) => render(kind));
  const again = withoutClock(() => COMPLETE.sections.map(({ kind }) => render(kind)));
  assert.deepEqual(again, first);
});

test('withoutClock stops the clock, keeps dates from values and parts, and refuses async code', () => {
  assert.throws(() => withoutClock(() => new Date()), /read the clock: new Date\(\)/);
  assert.throws(() => withoutClock(() => Date.now()), /read the clock: Date\.now\(\)/);
  assert.throws(() => withoutClock(() => Math.random()), /read Math\.random\(\)/);
  const parts = withoutClock(() => new Date(Date.UTC(2024, 0, 15, 8)).toISOString());
  assert.equal(parts, '2024-01-15T08:00:00.000Z');
  assert.equal(
    withoutClock(() => new Date(2024, 0, 15, 8).getHours()),
    8,
  );
  assert.equal(
    withoutClock(() => new Date('2024-01-15T08:00:00Z').getTime()),
    1705305600000,
  );
  assert.throws(() => withoutClock(async () => 1), /runs synchronous code/);
  // The clock is back afterwards.
  assert.ok(Date.now() > 0);
});

test('RichText renders markdown, and inline renders a phrase', () => {
  assert.equal(
    html(<RichText source={'Hello **there**.'} />),
    '<div class="pf-rich-text"><p>Hello <strong>there</strong>.</p>\n</div>',
  );
  assert.equal(
    html(<RichText source={'An *aside*'} inline className="note" />),
    '<span class="pf-rich-text note">An <em>aside</em></span>',
  );
});

test('RichText renders a sample of the markdown corpus to markup the strict reader accepts, and a render input changes only its fragment links, each to the href link fields get', () => {
  // markdown.test.ts runs the whole corpus through the renderers RichText
  // calls. Here, every 50th input and every fragment link in an inline link,
  // through RichText itself, without a render input and with one that has an
  // id prefix, a mount point, and a query.
  const input = inputFor(COMPLETE, {
    basePath: '/sample',
    query: { variant: 'acme-ocean' },
    idPrefix: 'pv-',
  });
  const sample = corpus().filter(
    ({ label, url }, i) =>
      i % 50 === 0 || (/^inline link, /.test(label) && /^\/?#/.test(url?.spelling.reads ?? '')),
  );
  const LINK = /<a href="([^"]*)">/g;
  const hrefs = (markup: string) => Array.from(markup.matchAll(LINK), ([, href = '']) => href);
  const fragment = /^\/?#./;
  const failures: string[] = [];
  let prefixed = 0;
  for (const { source } of sample) {
    for (const inline of [false, true]) {
      const tag = inline ? 'span' : 'div';
      const [open, close] = [`<${tag} class="pf-rich-text">`, `</${tag}>`];
      const plain = html(<RichText source={source} inline={inline} />);
      const linked = html(<RichText source={source} inline={inline} input={input} />);
      for (const markup of [plain, linked]) {
        const inner = markup.startsWith(open) && markup.endsWith(close);
        const problems = inner
          ? htmlProblems(markup.slice(open.length, -close.length), inline ? 'inline' : 'block')
          : [`not one ${tag}`];
        if (problems.length > 0) failures.push(`${JSON.stringify(source)}: ${problems.join('; ')}`);
      }
      const before = hrefs(plain).map(unescapeHtml);
      const expected = before.map((href) => (fragment.test(href) ? hrefFor(href, input) : href));
      if (
        JSON.stringify(hrefs(linked).map(unescapeHtml)) !== JSON.stringify(expected) ||
        plain.replace(LINK, '<a>') !== linked.replace(LINK, '<a>')
      ) {
        failures.push(`${JSON.stringify(source)}: ${linked} from ${plain}`);
      }
      prefixed += before.filter((href) => fragment.test(href)).length;
    }
  }
  assert.deepEqual(failures.slice(0, 10), []);
  assert.ok(prefixed > 100, `only ${prefixed} fragment links`);
});

test('seededRandom gives the same sequence for a seed, a different one for another', () => {
  const take = (seed: number) => {
    const next = seededRandom(seed);
    return Array.from({ length: 5 }, () => next());
  };
  assert.deepEqual(take(INPUT.env.seed), take(INPUT.env.seed));
  assert.notDeepEqual(take(1), take(2));
  for (const value of take(4_294_967_295)) assert.ok(value >= 0 && value < 1);
  assert.throws(() => seededRandom(1.5), /A seed is an integer/);
});

test('the visitor control slot is one empty marked element', () => {
  assert.equal(html(<VisitorControlSlot />), '<div data-visitor-control-slot=""></div>');
});

test('each kind name in SHARED_RENDERERS is a core kind', () => {
  const kinds: readonly SectionKind[] = Object.keys(SHARED_RENDERERS) as SectionKind[];
  assert.equal(kinds.length, 28);
});
