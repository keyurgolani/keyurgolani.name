import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import {
  composeSchemas,
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
import { withoutClock } from '../test-support/clock';
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
      schemas: { portfolio: { min: 2, max: 2 }, site: { min: 2, max: 2 } },
      tokenContract: 0,
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
  options: { manifest?: Record<string, unknown>; idPrefix?: string } = {},
): VariantRenderInput {
  const pair = { portfolio: PortfolioSchema.parse(portfolio), site: SITE } as unknown as ParsedPair;
  return buildRenderInput({
    view: toPublicView(pair),
    manifest: manifest(options.manifest),
    route: { route: 'home' },
    basePath: '',
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

test('the fixture has every core kind, each with every field its schema defines', () => {
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
      return [escape(String(value)), `href="https://doi.org/${value}"`];
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

test('the shared stylesheet stays under [data-variant], logical, and free of color, type, and opacity', () => {
  const css = readFileSync(new URL('./styles.css', import.meta.url), 'utf8').replace(
    /\/\*[\s\S]*?\*\//g,
    '',
  );
  const rules = [...css.matchAll(/([^{}]+)\{([^}]*)\}/g)];
  assert.ok(rules.length > 0);
  for (const [, selectors, body] of rules) {
    for (const selector of selectors!.split(/,(?![^(]*\))/)) {
      assert.match(selector.trim(), /^\[data-variant\] \[data-renderer='shared'\]/, selector);
    }
    assert.doesNotMatch(
      body!,
      /\b(?:opacity|color|background|font|left|right|top|bottom)\s*:/,
      body,
    );
    assert.doesNotMatch(
      body!,
      /(?:margin|padding|border)-(?:left|right)\b|text-align\s*:\s*(?:left|right)/,
      body,
    );
    assert.doesNotMatch(body!, /#[0-9a-f]{3,8}\b|\b(?:rgb|hsl|oklch)a?\(|!important/i, body);
  }
});

test('renderSection stamps the section element and dispatches by kind', () => {
  const input = inputFor(COMPLETE, { idPrefix: 'pv-' });
  const markup = html(renderSection(sectionOf(input, 'lede'), input, {}));
  assert.match(
    markup,
    /^<section id="pv-about" data-section-id="about" data-kind="lede" data-renderer="shared">/,
  );
  // The hero's own language rides on its section.
  assert.match(
    html(renderSection(sectionOf(input, 'hero'), input, {})),
    /^<section[^>]* lang="en-GB">/,
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
});

test('nothing reads the clock or Math.random(), so every render of the same input is the same', () => {
  const first = COMPLETE.sections.map(({ kind }) => render(kind));
  const again = withoutClock(() => COMPLETE.sections.map(({ kind }) => render(kind)));
  assert.deepEqual(again, first);
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
