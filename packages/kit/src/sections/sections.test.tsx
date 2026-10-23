import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import {
  composeSchemas,
  isPlainObject,
  resolvePortfolioView,
  type ParsedPair,
  type Section,
  type SectionKind,
  type UnitInput,
} from '@portfolio/schema';
import {
  buildRenderInput,
  validateManifest,
  type VariantRenderInput,
} from '@portfolio/variant-contract';
import { formatDate, formatEpisodeDuration, formatTrackDuration } from '../format';
import { deriveNavItems } from '../nav';
import { buildStructuredData } from '../seo';
import { withoutClock } from '../test-support/clock';
import { COMPLETE, GITHUB, MEDIA } from './__fixtures__/complete';
import { formatUrl } from './primitives';
import { doiLink } from './renderers/evidence';
import { unescapeHtml } from '../html-escape';
import { hrefFor } from './primitives';
import { corpus } from '../test-support/markdown-corpus';
import { htmlProblems } from '../test-support/strict-html';
import {
  anchorSection,
  CaseStudy,
  focalStyle,
  recordAnchor,
  registerHostModules,
  renderContext,
  renderSection,
  RichText,
  seededRandom,
  SHARED_RENDERERS,
  VisitorControlSlot,
  type BespokeRenderers,
} from '.';

// @portfolio/kit/sections (#5, Slice 2; #10, slice 1, item 7): one shared
// renderer per core kind, rendering every field of the published view at the
// heading level its caller gives; every text node the owner's, formatted from
// the owner's data, a dated snapshot value, or a fixed label; images from
// derived data, unavailable ones keeping their box; and renderSection()
// choosing between the shared renderer and a variant's own.

// tsx compiles the kit's JSX (tsconfig `jsx: preserve`) to React.createElement
// calls, which Next's compiler never does, so the test supplies React itself.
Object.assign(globalThis, { React });

const SCHEMAS = composeSchemas();
const { PortfolioSchema, SiteSchema } = SCHEMAS;

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

interface InputOptions {
  manifest?: Record<string, unknown>;
  idPrefix?: string;
  basePath?: string;
  query?: Record<string, string>;
  unit?: UnitInput;
  /** The site document's sections setting, to hide some. */
  hidden?: readonly string[];
}

function inputFor(portfolio: unknown = COMPLETE, options: InputOptions = {}): VariantRenderInput {
  const parsed = PortfolioSchema.safeParse(portfolio);
  assert.ok(parsed.success, JSON.stringify(parsed.error?.issues, null, 2));
  const site = SiteSchema.parse({
    ...SITE,
    ...(options.hidden
      ? { sections: Object.fromEntries(options.hidden.map((id) => [id, { hidden: true }])) }
      : {}),
  });
  const pair = { portfolio: parsed.data, site } as ParsedPair;
  return buildRenderInput({
    view: resolvePortfolioView(pair, options.unit ?? {}, { mediaBase: '/media' }),
    manifest: manifest(options.manifest),
    route: { route: 'home' },
    basePath: options.basePath ?? '',
    query: options.query,
    origin: 'https://rowan.test',
    requestTime: '2026-10-20T12:00:00Z',
    idPrefix: options.idPrefix,
  });
}

/** The slice 1 runtime: no media document and no snapshot, so every image is unavailable. */
const INPUT = inputFor();
/** With a media document and a GitHub snapshot, as slices 2 and 3 publish them. */
const READY = inputFor(COMPLETE, { unit: { media: MEDIA, snapshots: { github: GITHUB } } });

const html = (node: React.ReactNode) => renderToStaticMarkup(<>{node}</>);
const sectionOf = (input: VariantRenderInput, id: string) =>
  input.portfolio.sections.find((section) => section.id === id)!;
const render = (id: string, input = INPUT, level?: 1 | 2 | 3 | 4 | 5 | 6) =>
  html(renderSection(sectionOf(input, id), input, {}, { level }));
/** Every visible section, the hero's heading at 1, the rest at 2. */
const page = (input: VariantRenderInput) =>
  html(
    input.portfolio.sections.map((section) =>
      renderSection(section, input, {}, { level: section.kind === 'hero' ? 1 : 2 }),
    ),
  );

// The fixture has to have every field for the next tests to mean anything.

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

/** A placement's own schema: each placement is checked against it as one list, below. */
const PLACEMENT = unwrap(SCHEMAS.parts.Placement as unknown as Schema);

/** The fields `schema` defines that `value` never sets, anywhere in a list. */
function missingFields(schema: Schema, value: unknown, path: string, placements = false): string[] {
  const unwrapped = unwrap(schema);
  if (unwrapped === PLACEMENT && !placements) return isPlainObject(value) ? [] : [path];
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
    if (element === PLACEMENT && !placements) return [];
    // Each field has to appear in some item.
    return fieldsOf(element).flatMap(([key, child]) => {
      const holder = value.find((item) => isPlainObject(item) && Object.hasOwn(item, key));
      return holder ? missingFields(child, holder[key], `${path}/*/${key}`) : [`${path}/*/${key}`];
    });
  }
  return [];
}

/** Every placement in the fixture: identity, meta, works, sources, chronology, and custom items. */
function placements(): unknown[] {
  const out: unknown[] = [];
  const walk = (value: unknown, key = '') => {
    if (Array.isArray(value)) value.forEach((item) => walk(item, key));
    else if (isPlainObject(value)) {
      if (
        ['avatar', 'ogImage', 'cover', 'logo'].includes(key) ||
        (key === 'media' && 'asset' in value)
      ) {
        out.push(value);
      }
      for (const [child, inner] of Object.entries(value)) walk(inner, child);
    }
  };
  walk(COMPLETE);
  return out;
}

test('the fixture has every core kind, and every field each section, record, and placement defines', () => {
  const schema = (value: unknown) => value as unknown as Schema;
  const portfolio = schema(SCHEMAS.PortfolioSchema);
  // The document's own fields; each part is checked against its own schema below.
  assert.deepEqual(
    Object.keys(unwrap(portfolio).shape!)
      .filter((key) => key !== 'extensions')
      .filter((key) => !Object.hasOwn(COMPLETE, key)),
    [],
  );
  const checks: Array<[string, unknown, unknown]> = [
    ['identity', SCHEMAS.IdentitySchema, COMPLETE.identity],
    ['meta', SCHEMAS.MetaSchema, COMPLETE.meta],
    ['practice', SCHEMAS.PracticeSchema, COMPLETE.practice],
    ['contact', SCHEMAS.ContactSchema, COMPLETE.contact],
    ['case study', SCHEMAS.CaseStudySchema, COMPLETE.works[0].caseStudy],
  ];
  for (const [name, part, value] of checks) {
    assert.deepEqual(missingFields(schema(part), value, name), [], name);
  }
  const lists: Array<[string, unknown, readonly unknown[]]> = [
    ['works', SCHEMAS.WorkSchema, COMPLETE.works],
    ['evidence', SCHEMAS.EvidenceSchema, COMPLETE.evidence],
    ['chronology', SCHEMAS.ChronologyEntrySchema, COMPLETE.chronology],
    ['media', SCHEMAS.MediaAssetSchema, COMPLETE.media],
    ['placements', SCHEMAS.parts.Placement, placements()],
  ];
  for (const [name, item, values] of lists) {
    const missing = missingFields(
      { _def: { typeName: 'ZodArray', type: schema(item) } },
      values,
      name,
      name === 'placements',
    );
    assert.deepEqual(missing, [], name);
  }
  const kinds = COMPLETE.sections.map((section) => section.kind);
  assert.deepEqual([...new Set(kinds)].sort(), Object.keys(SHARED_RENDERERS).sort());
  for (const core of SCHEMAS.coreSections as unknown as Schema[]) {
    const kind = String(core.shape!.kind!._def.value);
    const sections = COMPLETE.sections.filter((candidate) => candidate.kind === kind);
    const missing = missingFields({ _def: { typeName: 'ZodArray', type: core } }, sections, kind)
      // A section's language is checked on the hero alone.
      .filter((path) => path !== `${kind}/*/lang` || kind === 'hero');
    assert.deepEqual(missing, [], kind);
  }
});

// What the markup must show of every value the fixture sets.

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
  'releasedAt',
  'presentedAt',
  'receivedAt',
  'filedAt',
  'grantedAt',
  'takenAt',
]);

/** Fields that are references, routing, or the asset's own file, which no page shows. */
const NOT_SHOWN = new Set([
  'id',
  'kind',
  'lang',
  'extensions',
  'visibility',
  'slug',
  'caseStudy',
  'source',
  'items',
  'part',
  'asset',
  'evidence',
  'works',
  'decorative',
]);

const names = (values: readonly string[]) =>
  new Intl.ListFormat('en', { style: 'long', type: 'conjunction' }).format(values);

/** What the markup shows for one field's value. */
function shown(key: string, value: unknown, record: Record<string, unknown>): string[] {
  if (DATE_FIELDS.has(key)) return [escape(formatDate(String(value)))];
  switch (key) {
    case 'x':
      return [`--focal-x:${value}`];
    case 'y':
      return [`--focal-y:${value}`];
    case 'alt':
      return [`alt="${escape(String(value))}"`];
    case 'readingTimeMinutes':
      return [`${value} min`];
    case 'durationMinutes':
      return [formatEpisodeDuration(Number(value))];
    case 'durationSeconds':
      return [formatTrackDuration(Number(value))];
    case 'value':
      return [new Intl.NumberFormat('en').format(Number(value))];
    case 'format':
      return ['Keynote'];
    case 'status':
      return ['Granted'];
    case 'iconName':
      return [`data-icon="${value}"`];
    case 'attributionRequired':
      return value === true ? ['data-attribution-required="true"'] : [];
    case 'key':
      return [`data-metric="${value}"`];
    case 'thread':
      return [`data-thread="${value}"`];
    case 'branchesFrom':
      return [`data-branches-from="${value}"`];
    case 'mergesInto':
      return [`data-merges-into="${value}"`];
    case 'medium':
      return [`data-medium="${value}"`];
    case 'platform':
      return [`data-platform="${value}"`];
    case 'doi':
      return [escape(String(value)), `href="${escape(doiLink(String(value))!.url)}"`];
    case 'audioUrl':
    case 'videoUrl':
    case 'pdfUrl':
    case 'slidesUrl':
      return [`href="${escape(String(value))}"`, escape(formatUrl(String(value)))];
    case 'url':
    case 'organizationUrl':
    case 'sourceUrl':
      return [`href="${escape(String(value))}"`];
    case 'email':
      return [`href="mailto:${value}"`];
    case 'guests':
    case 'authors':
    case 'inventors':
      return [escape(names(value as string[]))];
    case 'number':
      return [escape(typeof value === 'number' ? String(value) : String(value))];
    case 'username':
      return [`href="https://github.com/${value}"`, `>${value}</a>`];
    default:
      void record;
      return typeof value === 'string' ? [escape(value)] : [String(value)];
  }
}

/** Every leaf the value sets, as `[key, value, holder]`, skipping what no page shows. */
function leaves(
  value: unknown,
  key = '',
  holder: Record<string, unknown> = {},
): Array<[string, unknown, Record<string, unknown>]> {
  if (NOT_SHOWN.has(key)) return [];
  if (Array.isArray(value)) {
    // A list of strings joins into one formatted value.
    if (['guests', 'authors', 'inventors'].includes(key)) return [[key, value, holder]];
    return value.flatMap((item) => leaves(item, key, holder));
  }
  if (isPlainObject(value)) {
    return Object.entries(value).flatMap(([child, inner]) => leaves(inner, child, value));
  }
  return [[key, value, holder]];
}

/** The github section's configuration: what to show of a snapshot, not text of its own. */
const GITHUB_CONFIG = new Set([
  'showContributionGraph',
  'showPinnedRepos',
  'showTotalStars',
  'showLanguageBreakdown',
  'showRecentlyActive',
  'recentlyActiveLimit',
  'featuredRepos',
  'excludeRepos',
]);

test('the shared renderers show every field of every visible record, section, and placement', () => {
  const markup = page(READY);
  const visible = (id: string) => !id.startsWith('secret-');
  const parts: Array<[string, unknown]> = [
    ['identity', COMPLETE.identity],
    ['practice', COMPLETE.practice],
    ['contact', COMPLETE.contact],
    ...COMPLETE.works
      .filter(({ id }) => visible(id))
      .map((work) => [work.id, work] as [string, unknown]),
    ...COMPLETE.evidence
      .filter(({ id }) => visible(id))
      .map((entry) => [entry.id, entry] as [string, unknown]),
    ...COMPLETE.chronology.map((entry) => [entry.id, entry] as [string, unknown]),
    ...COMPLETE.media
      .filter(({ id }) => !['og-image'].includes(id))
      .map((entry) => [entry.id, entry] as [string, unknown]),
    ...COMPLETE.sections.map((section) => [section.id, section] as [string, unknown]),
  ];
  for (const [name, value] of parts) {
    for (const [key, leaf, holder] of leaves(value)) {
      if (GITHUB_CONFIG.has(key)) continue;
      // The hero has a name and tagline of its own; a bare hero shows the identity's, below.
      if (name === 'identity' && (key === 'name' || key === 'tagline')) continue;
      // An asset's alt shows where a placement doesn't override it; one is checked there.
      if (name === 'atlas-plate' && key === 'alt') continue;
      for (const text of shown(key, leaf, holder)) {
        assert.ok(markup.includes(text), `${name}: ${key} shows ${text}`);
      }
    }
  }
});

/** The labels the shared renderers may add (#10, slice 1, item 7), as the markup has them. */
const FIXED_LABELS = new Set([
  'Image unavailable',
  'Case study',
  'Archive',
  'As of',
  'Challenge',
  'Context',
  'Role',
  'Constraints',
  'Decisions',
  'Rationale',
  'Alternatives',
  'Evidence',
  'Outcomes',
  'Reflection',
  'Repositories',
  'Stars received',
  'Contributions in the last year',
]);

const decode = (text: string) =>
  text
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#x27;/g, "'")
    .replace(/&amp;/g, '&');

/** The text nodes of static markup, each trimmed, blank ones left out. */
function textNodes(markup: string): string[] {
  return markup
    .split(/<[^>]*>/)
    .map((text) => decode(text).trim())
    .filter((text) => text !== '');
}

/** Every string the fixture and its snapshot hold, and each one formatted as a renderer formats it. */
function allowedTexts(): Set<string> {
  const allowed = new Set<string>();
  const add = (key: string, value: unknown) => {
    if (typeof value === 'string') allowed.add(value);
    if (DATE_FIELDS.has(key) && typeof value === 'string') allowed.add(formatDate(value));
    if (typeof value === 'number') {
      allowed.add(new Intl.NumberFormat('en').format(value));
      allowed.add(`${value} min`);
      allowed.add(formatEpisodeDuration(value));
      allowed.add(formatTrackDuration(value));
    }
    if (typeof value === 'string' && /^(?:https?|mailto):/.test(value))
      allowed.add(formatUrl(value));
  };
  const walk = (value: unknown, key = '') => {
    if (Array.isArray(value)) {
      if (value.every((item) => typeof item === 'string') && value.length > 1) {
        allowed.add(names(value as string[]));
      }
      value.forEach((item) => walk(item, key));
    } else if (isPlainObject(value)) {
      for (const [child, inner] of Object.entries(value)) walk(inner, child);
    } else {
      add(key, value);
    }
  };
  walk(COMPLETE);
  walk(GITHUB);
  // An entry with no end runs to the present, which the period shows.
  allowed.add('Present');
  // The snapshot's date, as As of shows it.
  allowed.add('October 2, 2026');
  // The formatted forms of the enums the renderers turn into words.
  allowed.add('Keynote');
  allowed.add('Granted');
  return allowed;
}

test('every text node is the owner’s, formatted from the owner’s data, a dated snapshot value, or a fixed label', () => {
  const allowed = allowedTexts();
  const caseStudy = html(
    <CaseStudy
      work={READY.portfolio.works.find(({ id }) => id === 'tide-atlas') as never}
      ctx={renderContext(READY, { id: 'case', lang: undefined, title: undefined }, 1)}
    />,
  );
  for (const [name, markup] of [
    ['ready', page(READY)],
    ['unavailable', page(INPUT)],
    ['case study', caseStudy],
  ] as const) {
    const strays = textNodes(markup).filter(
      (text) => !allowed.has(text) && !FIXED_LABELS.has(text) && !/^[·–\s]+$/.test(text),
    );
    assert.deepEqual(strays, [], name);
  }
});

test('no section takes a default heading: an untitled one has none, and its items take its level', () => {
  const untitled = inputFor({
    ...COMPLETE,
    sections: [
      { kind: 'works', id: 'work', items: ['tide-atlas'] },
      { kind: 'contact', id: 'reach' },
      { kind: 'focus', id: 'focus', items: ['Tides'] },
      { kind: 'github', id: 'on-github', username: 'rowan-vale' },
    ],
  });
  const works = render('work', untitled);
  assert.doesNotMatch(works, /pf-section__title/);
  assert.match(
    works,
    /<h2 class="pf-item__title"><a href="https:\/\/atlas\.rowan\.test">Work title<\/a><\/h2>/,
  );
  assert.doesNotMatch(render('reach', untitled), /<h2/);
  assert.doesNotMatch(render('focus', untitled), /<h2/);
  // An untitled github section has no heading, with or without its snapshot, and its
  // repositories take its level.
  assert.doesNotMatch(render('on-github', untitled), /<h2|pf-section__title/);
  const code = render(
    'on-github',
    inputFor(
      { ...COMPLETE, sections: [{ kind: 'github', id: 'on-github', username: 'rowan-vale' }] },
      { unit: { snapshots: { github: GITHUB } } },
    ),
  );
  assert.doesNotMatch(code, /pf-section__title/);
  assert.match(
    code,
    /<h2 class="pf-item__title"><a href="https:\/\/github\.com\/rowan-vale\/tide-tables">tide-tables<\/a><\/h2>/,
  );
});

test('a section takes its heading level from the caller, and its items go one deeper', () => {
  assert.match(
    render('timeline', INPUT, 3),
    /<h3 class="pf-section__title">Chronology section title<\/h3>/,
  );
  assert.match(render('timeline', INPUT, 3), /<h4 class="pf-item__title">Chronology title<\/h4>/);
  assert.match(render('timeline', INPUT, 6), /<h6 class="pf-item__title">Chronology title<\/h6>/);
  assert.match(render('top', INPUT, 1), /<h1 class="pf-hero__name">Hero name<\/h1>/);
  assert.match(render('about'), /<h2 class="pf-section__title">Lede title<\/h2>/);
  // A work's own evidence sits below the work's heading.
  assert.match(
    render('selected-work'),
    /<h4 class="pf-item__title"><a href="https:\/\/evidence\.rowan\.test">Evidence title<\/a><\/h4>/,
  );
});

test('the one inline style a shared renderer sets is an image’s focal point', () => {
  const styles = [...page(READY).matchAll(/<([a-z]+)\b[^>]*\sstyle="([^"]*)"/g)];
  assert.ok(styles.length > 0);
  for (const [, tag, style] of styles) {
    assert.equal(tag, 'img', style);
    assert.match(style!, /^--focal-x:[\d.]+;--focal-y:[\d.]+$/);
  }
  assert.doesNotMatch(page(INPUT), /\sstyle=/);
});

test('a focal point carries two numbers from 0 to 1 and nothing else', () => {
  const style = (point: unknown) =>
    html(<span style={focalStyle(point as { x: number; y: number })} data-focal="probe" />);
  assert.equal(
    style({ x: 0.25, y: 1 }),
    '<span style="--focal-x:0.25;--focal-y:1" data-focal="probe"></span>',
  );
  // Out of range holds to the edge.
  assert.equal(
    style({ x: -2, y: 7 }),
    '<span style="--focal-x:0;--focal-y:1" data-focal="probe"></span>',
  );
  // Anything but two finite numbers, such as CSS passed as a string, sets no style.
  for (const point of [
    { x: '0.5;background:url(https://elsewhere.test/x)', y: 0.5 },
    { x: 0.5, y: Number.NaN },
    { x: Number.POSITIVE_INFINITY, y: 0 },
    { x: 0.5 },
  ]) {
    assert.equal(style(point), '<span data-focal="probe"></span>', JSON.stringify(point));
  }
  assert.equal(focalStyle(undefined), undefined);
});

test('a ready image takes its srcset, sizes, width, and height from derived data, and loads lazily unless it is the signature cover', () => {
  const works = render('selected-work', READY);
  const cover =
    /<figure class="pf-figure" data-media-asset="atlas-cover"><picture>([\s\S]*?)<\/picture>/.exec(
      works,
    )?.[1];
  assert.ok(cover, works);
  assert.match(
    cover,
    /<source type="image\/webp" srcSet="\/media\/atlas-cover\/c{64}\/w480-a1\.webp 480w, \/media\/atlas-cover\/c{64}\/w960-a1\.webp 960w" sizes="100vw"\/>/,
  );
  // The signature work's cover is the one image that loads at once.
  assert.match(
    cover,
    /<img class="pf-cover" src="\/media\/atlas-cover\/c{64}\/w960-a1-jpg\.jpg" srcSet="[^"]*w480-a1-jpg\.jpg 480w, [^"]*w960-a1-jpg\.jpg 960w" sizes="100vw" width="1600" height="1200" alt="Alt atlas-cover" decoding="async" style="--focal-x:0.25;--focal-y:0.75"\/>/,
  );
  for (const [img] of page(READY).matchAll(/<img\b[^>]*>/g)) {
    if (img.includes('/atlas-cover/')) assert.doesNotMatch(img, /loading=/);
    else assert.match(img, /loading="lazy"/, img);
  }
  // The placement's own alt and focal point win over its asset's.
  assert.match(
    works,
    /src="[^"]*\/atlas-plate\/[^"]*" [^>]*alt="Placement alt"[^>]*style="--focal-x:0.5;--focal-y:0.125"/,
  );
  // Decoration has an empty alt, and no image takes its alt from a title or a caption.
  assert.match(works, /src="[^"]*\/ornament\/[^"]*" [^>]*alt=""/);
  assert.doesNotMatch(page(READY), /alt="(?:Work title|Placement caption|Custom caption)"/);
});

test('an unavailable image keeps its box, caption, credit, and rights with Image unavailable, and decoration renders nothing', () => {
  const markup = page(INPUT);
  assert.doesNotMatch(markup, /<img\b/);
  const works = render('selected-work');
  assert.match(
    works,
    /<figure class="pf-figure pf-figure--unavailable" data-media-asset="atlas-cover"><span class="pf-media-box" data-media-state="unavailable" data-media-reason="processing"><span class="pf-media-box__label">Image unavailable<\/span><\/span><figcaption><p class="pf-caption">Cover caption<\/p>[\s\S]*?<small class="pf-credit">Credit atlas-cover<\/small><small class="pf-rights" data-attribution-required="true"><span class="pf-rights-holder">Holder atlas-cover<\/span><span class="pf-rights-license">CC BY 4.0<\/span><\/small><\/figcaption><\/figure>/,
  );
  assert.match(
    works,
    /data-media-asset="atlas-plate">[\s\S]*?Image unavailable[\s\S]*?<p class="pf-caption">Placement caption<\/p>/,
  );
  // The decorative ornament, and the logo its placement marks decorative, leave nothing.
  assert.doesNotMatch(markup, /ornament|lab-logo/);
  // Every non-decorative placement on the page says so, once.
  const visiblePlacements = [
    'avatar',
    'atlas-cover',
    'atlas-plate',
    'source-avatar',
    'atlas-plate',
  ];
  assert.equal(markup.match(/Image unavailable/g)?.length, visiblePlacements.length);
});

test('an image without alt text has none, never one made from its title or caption', () => {
  // The cover's asset has no alt text, and its placement none either, but a caption.
  const media = COMPLETE.media.map((asset) =>
    asset.id === 'atlas-cover'
      ? Object.fromEntries(Object.entries(asset).filter(([key]) => key !== 'alt'))
      : asset,
  );
  const markup = page(
    inputFor({ ...COMPLETE, media }, { unit: { media: MEDIA, snapshots: { github: GITHUB } } }),
  );
  const cover = /<img class="pf-cover"[^>]*>/.exec(markup)?.[0];
  assert.ok(cover, 'the cover is ready');
  assert.doesNotMatch(cover, /\balt=/);
  assert.ok(markup.includes('<p class="pf-caption">Cover caption</p>'));
  for (const made of ['Work title', 'Cover caption', 'atlas-cover']) {
    assert.ok(!markup.includes(`alt="${made}"`), made);
  }
});

test('the JSON-LD names the signature and featured works, each @id its anchor on the page', () => {
  const [person] = buildStructuredData(READY, { siteUrl: 'https://rowan.test/' });
  assert.deepEqual(person!.workExample, [
    {
      '@type': 'CreativeWork',
      '@id': 'https://rowan.test/#tide-atlas',
      name: 'Work title',
      url: 'https://atlas.rowan.test',
    },
    { '@type': 'CreativeWork', '@id': 'https://rowan.test/#harbor-notes', name: 'Featured title' },
  ]);
  // Each is an id the page has.
  const markup = page(READY);
  assert.ok(markup.includes('id="tide-atlas"'));
  // Without the site's origin, no block carries a URL or an id.
  const [bare] = buildStructuredData(READY);
  assert.equal(bare!.workExample, undefined);
});

test("a kind the composition doesn't render takes the anchors, the links to them, and the navigation with it", () => {
  const input = inputFor(COMPLETE, { manifest: { unsupportedKinds: ['works'] } });
  const work = input.portfolio.works.find(({ id }) => id === 'tide-atlas')!;
  // The works section renders nothing, so no work has an anchor to link to.
  assert.equal(render('selected-work', input), '');
  assert.equal(anchorSection(work, input), undefined);
  assert.equal(recordAnchor(sectionOf(input, 'selected-work'), work, input), undefined);
  assert.doesNotMatch(render('timeline', input), /href="#tide-atlas"/);
  assert.ok(!deriveNavItems(input).some(({ href }) => href === '#selected-work'));
  // Where the composition renders works, each link lands.
  assert.equal(anchorSection(work, INPUT)?.id, 'selected-work');
  assert.match(render('timeline'), /href="#tide-atlas"/);
  assert.ok(deriveNavItems(INPUT).some(({ href }) => href === '#selected-work'));
});

test('a line of facts starts with its first one, so evidence without a source has no stray separator', () => {
  const input = inputFor({
    schemaVersion: 3,
    locale: 'en',
    direction: 'ltr',
    identity: { name: 'Rowan Vale' },
    evidence: [
      {
        id: 'paper',
        type: 'publication',
        title: 'Paper title',
        venue: 'Paper venue',
        publishedAt: '2025-11',
      },
      { id: 'prize', type: 'award', title: 'Prize title', receivedAt: '2024-03' },
    ],
    sections: [{ kind: 'evidence', id: 'proof', title: 'Proof', items: ['paper', 'prize'] }],
  });
  const markup = render('proof', input);
  assert.match(markup, /<p class="pf-meta">Paper venue <span class="pf-sep"/);
  assert.match(markup, /<p class="pf-meta"><time class="pf-date" dateTime="2024-03"/);
  assert.doesNotMatch(markup, /<p class="pf-meta"> <span class="pf-sep"/);
});

test('every placement shows its caption, and when, where, and with what tags it was taken', () => {
  const markup = page(READY);
  const details = (caption: string, date: string, location: string, tag: string) =>
    new RegExp(
      `<p class="pf-caption">${caption}</p><p class="pf-meta"><time class="pf-date" dateTime="${date}" data-field="takenAt">${escape(formatDate(date))}</time> <span class="pf-sep" aria-hidden="true">·</span> ${location}</p><ul class="pf-tags" role="list"><li>${tag}</li></ul>`,
    );
  // A cover, in its figure's caption, before the credit and the rights.
  assert.match(
    markup,
    new RegExp(
      `data-media-asset="atlas-cover"><picture>(?:(?!</picture>)[\\s\\S])*</picture><figcaption>${details('Cover caption', '2019-07-08', 'Cover location', 'Cover tag').source}<small class="pf-credit">Credit atlas-cover</small><small class="pf-rights" data-attribution-required="true"><span class="pf-rights-holder">Holder atlas-cover</span><span class="pf-rights-license">CC BY 4.0</span></small></figcaption>`,
    ),
  );
  // A custom item's photograph, and a gallery's.
  assert.match(markup, details('Custom caption', '2022-08-09', 'Custom location', 'Custom tag'));
  assert.match(
    markup,
    details('Placement caption', '2020-05-04', 'Placement location', 'Placement tag'),
  );
  // A logo and an avatar beside their text: the caption right after the image, then the credit.
  assert.match(
    markup,
    /<img class="pf-logo"[^>]*>(?:<\/picture>)?<p class="pf-caption">Logo caption<\/p><small class="pf-credit">Credit lab-logo<\/small>/,
  );
  assert.match(
    markup,
    /<img class="pf-avatar"[^>]*alt="Alt source-avatar"[^>]*>(?:<\/picture>)?<p class="pf-caption">Avatar caption<\/p><small class="pf-credit">Credit source-avatar<\/small>/,
  );
});

test('the github section shows its snapshot’s values with their date, else the profile link alone', () => {
  const bare = render('on-github');
  assert.match(
    bare,
    /<p class="pf-github"><a href="https:\/\/github\.com\/rowan-vale">rowan-vale<\/a><\/p>/,
  );
  assert.doesNotMatch(bare, /Repositories|As of/);
  const ready = render('on-github', READY);
  assert.match(ready, /<dt>Repositories<\/dt><dd>31<\/dd>/);
  assert.match(ready, /<dt>Stars received<\/dt><dd>1,543<\/dd>/);
  assert.match(ready, /<dt>Contributions in the last year<\/dt><dd>987<\/dd>/);
  assert.match(ready, /As of <time dateTime="2026-10-02">October 2, 2026<\/time>/);
  assert.match(ready, /<a href="https:\/\/github\.com\/rowan-vale\/tide-tables">tide-tables<\/a>/);
  assert.match(ready, /Pinned description/);
  // The section's excludeRepos leaves one out.
  assert.doesNotMatch(ready, /scratch|Excluded description/);
  // A snapshot that doesn't check is no snapshot: the profile link alone.
  const failed = inputFor(COMPLETE, { unit: { snapshots: { github: { records: 'nope' } } } });
  assert.equal(render('on-github', failed), bare);
  // Without showTotalStars, the stars received stay out.
  const quiet = inputFor(
    {
      ...COMPLETE,
      sections: COMPLETE.sections.map((section) =>
        section.kind === 'github' ? { ...section, showTotalStars: false } : section,
      ),
    },
    { unit: { snapshots: { github: GITHUB } } },
  );
  assert.doesNotMatch(render('on-github', quiet), /Stars received/);
});

test('a work in the archive says so, with the fixed label Archive, and no other does', () => {
  const works = render('selected-work');
  const entries = works.split(/(?=<li id="[^"]*" class="pf-item pf-work")/).slice(1);
  const archived = entries.filter((entry) => entry.includes('data-label="archive"'));
  assert.deepEqual(
    archived.map((entry) => /data-work-id="([^"]+)"/.exec(entry)?.[1]),
    ['early-sketches'],
  );
  assert.equal(works.match(/data-label="archive"/g)?.length, 1);
  assert.match(works, /<p class="pf-label" data-label="archive">Archive<\/p>/);
});

test('a record’s anchor is its id, on the first visible section that lists it, so no id repeats', () => {
  const twice = inputFor(
    {
      ...COMPLETE,
      sections: [
        ...COMPLETE.sections,
        { kind: 'works', id: 'again', title: 'Again', items: ['tide-atlas'] },
      ],
    },
    { idPrefix: 'pv-' },
  );
  const markup = page(twice);
  assert.equal(markup.match(/ id="pv-tide-atlas"/g)?.length, 1);
  assert.match(render('selected-work', twice), / id="pv-tide-atlas"/);
  assert.doesNotMatch(render('again', twice), / id="pv-tide-atlas"/);
  // A chronology entry's work links to that anchor, prefix and all.
  assert.match(render('timeline', twice), /<a href="#pv-tide-atlas">Work title<\/a>/);
  // Evidence the proof strip lists and a custom item cites anchors in the strip.
  assert.match(render('proof-strip', twice), / id="pv-readers"/);
  assert.doesNotMatch(render('residencies', twice), / id="pv-readers"/);
});

test('private records, and what only hidden sections reach, never render or reach the input', () => {
  for (const input of [INPUT, READY]) {
    const markup = page(input);
    for (const text of ['Private title', 'Private evidence', 'secret-work', 'secret-proof']) {
      assert.ok(!markup.includes(text), text);
      assert.ok(!JSON.stringify(input).includes(text), text);
    }
  }
  const hidden = inputFor(COMPLETE, { hidden: ['selected-work'] });
  // tide-atlas is still the signature, and harbor-notes featured; the archived work goes.
  assert.deepEqual(
    hidden.portfolio.works.map(({ id }) => id),
    ['tide-atlas', 'harbor-notes', 'early-sketches'],
  );
  const onlyHidden = inputFor(
    { ...COMPLETE, signature: undefined, featured: undefined, archive: undefined },
    { hidden: ['selected-work'] },
  );
  // Only the chronology entry still names tide-atlas, and that doesn't reach it.
  assert.deepEqual(
    onlyHidden.portfolio.works.map(({ id }) => id),
    [],
  );
  assert.doesNotMatch(page(onlyHidden), /Work title/);
});

test('a section with nothing public leaves the page, and renderSection renders nothing for one', () => {
  const lonely = inputFor({
    ...COMPLETE,
    sections: [
      { kind: 'lede', id: 'about', body: 'Hi.' },
      { kind: 'works', id: 'drafts', title: 'Drafts', items: ['secret-work'] },
    ],
  });
  assert.deepEqual(
    lonely.portfolio.sections.map(({ id }) => id),
    ['about'],
  );
  const stray = { kind: 'works', id: 'stray', title: 'Stray', items: ['secret-work'] } as Section;
  assert.equal(renderSection(stray, lonely, {}), null);
  const noPart = { kind: 'practice', id: 'gone', part: 'services' } as Section;
  assert.equal(
    renderSection(noPart, inputFor({ ...COMPLETE, practice: { thesis: 'Only this.' } }), {}),
    null,
  );
});

test('a chronology section without items lists every public entry, newest first', () => {
  const ids = [
    ...render('everything-since').matchAll(
      /data-chronology-kind="[^"]+"[^>]*>[\s\S]*?class="pf-item__title">([^<]+)</g,
    ),
  ].map(([, title]) => title);
  assert.deepEqual(ids, ['Current title', 'Chronology title', 'Study title']);
});

test('contact shows the contact record, the identity’s email first, and no words of its own', () => {
  const contact = render('get-in-touch');
  assert.match(
    contact,
    /<p class="pf-message">Contact message<\/p><ul class="pf-links" role="list"><li><a href="mailto:rowan@rowan\.test" data-platform="email">rowan@rowan\.test<\/a><\/li><li><a href="mailto:hello@rowan\.test" data-platform="email">Contact link<\/a><\/li><\/ul>/,
  );
  assert.doesNotMatch(contact, /Available/);
  // A link to the same address isn't listed twice.
  const linked = inputFor({
    ...COMPLETE,
    contact: { links: [{ url: 'mailto:Rowan@rowan.test', label: 'Write' }] },
  });
  assert.equal(render('get-in-touch', linked).match(/mailto:/gi)?.length, 1);
});

test('without a contact record, a contact section is the email and the portfolio’s links, and with neither it leaves', () => {
  const recordless = inputFor({ ...COMPLETE, contact: undefined });
  assert.equal(recordless.portfolio.contact, undefined);
  const contact = render('get-in-touch', recordless);
  assert.doesNotMatch(contact, /pf-message/);
  assert.match(
    contact,
    /<li><a href="mailto:rowan@rowan\.test" data-platform="email">rowan@rowan\.test<\/a><\/li>/,
  );
  for (const link of COMPLETE.links) assert.ok(contact.includes(`href="${link.url}"`), link.url);
  const unreachable = inputFor({
    ...COMPLETE,
    contact: undefined,
    links: undefined,
    identity: { ...COMPLETE.identity, email: undefined },
  });
  assert.ok(!unreachable.portfolio.sections.some(({ kind }) => kind === 'contact'));
  const stray = { kind: 'contact', id: 'stray' } as Section;
  assert.equal(renderSection(stray, unreachable, {}), null);
});

test('each practice section shows its part, groups in order, an unnamed group straight under the section', () => {
  assert.match(render('thesis'), /<div class="pf-rich-text pf-thesis"><p>Practice thesis\.<\/p>/);
  assert.match(
    render('skills'),
    /<h3 class="pf-group__title">Skill group<\/h3><p>Skill group description<\/p><ul class="pf-tags" role="list"><li>Skill item<\/li><\/ul>/,
  );
  assert.match(
    render('tools'),
    /<a href="https:\/\/tool\.rowan\.test">Tool name<\/a> <span class="pf-version">Tool version<\/span>/,
  );
  assert.match(
    render('services'),
    /<h4 class="pf-item__title"><a href="https:\/\/service\.rowan\.test">Service name<\/a><\/h4>/,
  );
  const unnamed = inputFor({
    ...COMPLETE,
    practice: { services: [{ items: [{ name: 'Audit' }] }] },
    sections: [{ kind: 'practice', id: 'services', title: 'Services', part: 'services' }],
  });
  assert.match(render('services', unnamed), /<h3 class="pf-item__title">Audit<\/h3>/);
});

test('a custom section shows its title, body, and items with their media, evidence, and links', () => {
  const custom = render('residencies', READY);
  assert.match(custom, /<h2 class="pf-section__title">Custom title<\/h2>/);
  assert.match(custom, /<div class="pf-rich-text pf-prose"><p>Custom body\.<\/p>/);
  assert.match(custom, /<h3 class="pf-item__title">Custom item title<\/h3>/);
  assert.match(custom, /alt="Alt atlas-plate"/);
  assert.match(custom, /<p class="pf-caption">Custom caption<\/p>/);
  assert.match(custom, /<h4 class="pf-item__title">[\s\S]*?<\/h4>|1,200/);
  assert.match(
    custom,
    /<a href="https:\/\/custom\.rowan\.test" data-platform="site">Custom link<\/a>/,
  );
});

test('evidence shows a metric’s value with its unit and nothing around it, and a testimonial as a quote', () => {
  const strip = render('proof-strip', READY);
  assert.match(
    strip,
    /<p class="pf-metric"><data class="pf-metric__value" value="1200">1,200<\/data> <span class="pf-metric__unit">Metric unit<\/span><\/p>/,
  );
  assert.match(strip, /data-metric="readers"/);
  assert.doesNotMatch(strip, /1,200\+|#1,200/);
  assert.match(
    strip,
    /<figure class="pf-quote"><blockquote cite="https:\/\/praise\.rowan\.test"><div class="pf-rich-text"><p>Testimonial statement\.<\/p>/,
  );
  assert.match(strip, /<a href="https:\/\/praise\.rowan\.test">Testimonial source<\/a>/);
  assert.match(strip, /As of <time class="pf-date" dateTime="2024-03">March 2024<\/time>/);
  assert.match(
    strip,
    /<a class="pf-action" href="https:\/\/evidence\.rowan\.test">Evidence button<\/a>/,
  );
  assert.match(
    strip,
    /<a href="https:\/\/slides\.rowan\.test\/tide" data-field="slidesUrl">slides\.rowan\.test\/tide<\/a>/,
  );
  assert.match(
    strip,
    /<time class="pf-date" dateTime="2020-04" data-field="filedAt">April 2020<\/time>/,
  );
});

test('the case study heads its page, labels each authored field, and leaves the rest out', () => {
  const work = READY.portfolio.works.find(({ id }) => id === 'tide-atlas')!;
  const ctx = renderContext(READY, { id: 'case', lang: undefined, title: undefined }, 1);
  const markup = html(<CaseStudy work={work as never} ctx={ctx} />);
  assert.equal(markup.match(/<h1\b/g)?.length, 1);
  assert.match(
    markup,
    /<p class="pf-case-study__label">Case study<\/p><h1 class="pf-case-study__title">Work title<\/h1>/,
  );
  const headings = [
    ...markup.matchAll(/<h([23]) class="pf-(?:case-study__heading|decision__label)">([^<]+)</g),
  ].map(([, level, text]) => `h${level} ${text}`);
  assert.deepEqual(headings, [
    'h2 Challenge',
    'h2 Context',
    'h2 Role',
    'h2 Constraints',
    'h2 Decisions',
    'h3 Rationale',
    'h3 Alternatives',
    'h2 Evidence',
    'h2 Outcomes',
    'h2 Reflection',
  ]);
  // The work's evidence records sit under Evidence, below its heading.
  assert.match(
    markup,
    /<h3 class="pf-item__title"><a href="https:\/\/evidence\.rowan\.test">Evidence title<\/a><\/h3>/,
  );
  const sparse = html(
    <CaseStudy
      work={{ ...work, evidence: undefined, caseStudy: { outcomes: 'Only outcomes.' } } as never}
      ctx={ctx}
    />,
  );
  assert.deepEqual(
    [...sparse.matchAll(/<h2[^>]*>([^<]+)</g)].map(([, text]) => text),
    ['Outcomes'],
  );
});

/** The only properties the shared stylesheet may set: layout, never appearance. */
const LAYOUT_PROPERTIES = new Set([
  'aspect-ratio',
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
  // Where a crop centers: the owner's focal point.
  'object-position',
  // Where a line breaks, so a long word never widens the page.
  'overflow-wrap',
  'padding-inline',
  'padding-inline-start',
  'place-items',
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

test('the github figures sit in one row, each number beside its label, with no dd indent', () => {
  const css = readFileSync(new URL('./styles.css', import.meta.url), 'utf8');
  const rule = (selector: string) =>
    css.split(`:where([data-variant] [data-renderer='shared'] ${selector}) {`)[1]?.split('}')[0];
  assert.match(rule('.pf-figures') ?? '', /display: flex;/);
  assert.match(rule('.pf-figures > div') ?? '', /display: flex;/);
  assert.match(rule('.pf-figures dd') ?? '', /margin-inline: 0;/);
  // The markup those rules lay out: each pair a div of the list.
  assert.match(
    render('on-github', READY),
    /<dl class="pf-figures"><div class="pf-figure-pair"><dt>Repositories<\/dt><dd>31<\/dd><\/div>/,
  );
});

test('renderSection stamps the section element and dispatches by kind', () => {
  const input = inputFor(COMPLETE, { idPrefix: 'pv-' });
  const markup = html(renderSection(sectionOf(input, 'about'), input, {}));
  assert.match(
    markup,
    /^<section id="pv-about" data-section-id="about" data-kind="lede" data-renderer="shared">/,
  );
  // The hero's own language rides on its section, and it runs the portfolio's way.
  assert.match(
    html(renderSection(sectionOf(input, 'top'), input, {})),
    /^<section[^>]* lang="en-GB">/,
  );
});

test('a section in a language that runs the other way says so with dir', () => {
  const section = (direction: 'ltr' | 'rtl', lang: string) => {
    const input = inputFor({
      ...COMPLETE,
      locale: direction === 'rtl' ? 'ar' : 'en',
      direction,
      sections: [{ kind: 'lede', id: 'about', lang, body: 'Hi.' }],
    });
    return /^<section[^>]*>/.exec(render('about', input))![0];
  };
  assert.match(section('ltr', 'ar'), / lang="ar" dir="rtl">$/);
  assert.match(section('ltr', 'he-IL'), / dir="rtl">$/);
  assert.match(section('rtl', 'en'), / lang="en" dir="ltr">$/);
  // The script subtag decides when there is one, and the same direction needs no dir.
  assert.match(section('ltr', 'sd-Deva'), / lang="sd-Deva">$/);
  assert.match(section('ltr', 'az-Arab'), / dir="rtl">$/);
  assert.match(section('rtl', 'fa'), / lang="fa">$/);
});

test('a bespoke renderer for a kind the variant skips is still the mistake it is', () => {
  const skipped = inputFor(COMPLETE, { manifest: { unsupportedKinds: ['github'] } });
  assert.throws(
    () => renderSection(sectionOf(skipped, 'on-github'), skipped, { github: () => <p>own</p> }),
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
  assert.equal(renderSection(sectionOf(input, 'on-github'), input, bespoke), null);
  assert.match(
    html(renderSection(sectionOf(input, 'about'), input, bespoke)),
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
    () => renderSection(sectionOf(INPUT, 'about'), INPUT, undeclared),
    /kit-shared passes a renderer for lede, which its renderedKinds doesn't list/,
  );
});

test("an extension's section renders through the renderer the host registered, else nothing", () => {
  // A registered extension's section, as the published view keeps it.
  const section = {
    kind: '@acme/portfolio-photography/exhibitions',
    id: 'shows',
    data: { items: [] },
  } as Section;
  registerHostModules({});
  try {
    assert.equal(renderSection(section, INPUT, {}), null);
    registerHostModules({
      extensionRenderers: {
        '@acme/portfolio-photography/exhibitions': ({ section: own, level }) => (
          <p data-level={level}>{own.id}</p>
        ),
      },
    });
    assert.equal(
      html(renderSection(section, INPUT, {})),
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

test("a hero without its own name and tagline shows the identity's", () => {
  const input = inputFor({ ...COMPLETE, sections: [{ kind: 'hero', id: 'top' }] });
  const markup = render('top', input, 1);
  assert.match(markup, /<h1 class="pf-hero__name">Rowan Vale<\/h1>/);
  assert.match(markup, /Identity tagline/);
});

test("a #fragment link takes the render's id prefix, so it still lands on its section", () => {
  const input = inputFor(COMPLETE, { idPrefix: 'pv-' });
  assert.match(render('top', input), /href="#pv-get-in-touch"/);
  assert.match(render('cta', input), /href="#pv-services"/);
  assert.match(render('cta', input), /href="mailto:hire@rowan\.test"/);
  // /#id is the home page's section, where the routes are mounted.
  const home = inputFor(
    {
      ...COMPLETE,
      sections: [
        { kind: 'cta', id: 'cta', primaryAction: { url: '/#about', label: 'About' } },
        { kind: 'lede', id: 'about', body: 'Hi.' },
      ],
    },
    { idPrefix: 'pv-' },
  );
  assert.match(render('cta', home), /href="\/#pv-about"/);
  // Markdown links take it too.
  const prose = inputFor(
    {
      ...COMPLETE,
      sections: [
        {
          kind: 'lede',
          id: 'about',
          body: 'See [work](#tide-atlas), [home](/#about), or [docs](https://rowan.test/#a).',
        },
        { kind: 'works', id: 'selected-work', items: ['tide-atlas'] },
      ],
    },
    { idPrefix: 'pv-' },
  );
  const lede = render('about', prose);
  assert.match(lede, /<a href="#pv-tide-atlas">work<\/a>/);
  assert.match(lede, /<a href="\/#pv-about">home<\/a>/);
  assert.match(lede, /<a href="https:\/\/rowan\.test\/#a">docs<\/a>/);
});

test("a /#id link under /sample keeps the render's query, so it stays in the variant it names (#5, Slice 4)", () => {
  const sections = [
    { kind: 'cta', id: 'cta', primaryAction: { url: '/#about', label: 'About' } },
    { kind: 'lede', id: 'about', body: 'See [home](/#about) or [here](#about).' },
  ];
  const sample = inputFor(
    { ...COMPLETE, sections },
    { basePath: '/sample', query: { variant: 'acme-ocean' }, idPrefix: 'pv-' },
  );
  assert.match(render('cta', sample), /href="\/sample\?variant=acme-ocean#pv-about"/);
  const lede = render('about', sample);
  assert.match(lede, /<a href="\/sample\?variant=acme-ocean#pv-about">home<\/a>/);
  // A fragment alone stays on this page, whatever its query.
  assert.match(lede, /<a href="#pv-about">here<\/a>/);
  // With no query, under a preview grant's base path.
  const preview = inputFor({ ...COMPLETE, sections }, { basePath: '/preview/g_7Hk-2' });
  assert.match(render('cta', preview), /href="\/preview\/g_7Hk-2#about"/);
});

test("words and dates the renderers add are marked English in other content, and numbers use the content's locale", () => {
  const french = inputFor({
    ...COMPLETE,
    locale: 'fr',
    chronology: [
      {
        id: 'acme',
        kind: 'role',
        title: 'Ingénieure',
        organization: 'Acme',
        period: { start: '2019-06' },
      },
    ],
    evidence: [{ id: 'lecteurs', type: 'metric', statement: 'Lecteurs', metric: { value: 1200 } }],
    sections: [
      { kind: 'chronology', id: 'work', items: ['acme'] },
      { kind: 'evidence', id: 'figures', items: ['lecteurs'] },
    ],
  });
  const work = render('work', french);
  assert.match(work, /<time class="pf-date" dateTime="2019-06" lang="en">June 2019<\/time>/);
  assert.match(work, /<span lang="en">Present<\/span>/);
  assert.match(render('figures', french), /1 200/);
  // A tag the runtime has no data for formats in English, not the runtime's default.
  const klingon = inputFor({
    ...COMPLETE,
    locale: 'tlh',
    evidence: [
      { id: 'readers', type: 'metric', statement: 'Readers', metric: { value: 1200 } },
      { id: 'tide', type: 'publication', title: 'Tide', authors: ['A', 'B', 'C'] },
    ],
    sections: [
      { kind: 'evidence', id: 'figures', items: ['readers'] },
      { kind: 'evidence', id: 'papers', items: ['tide'] },
    ],
  });
  assert.match(render('figures', klingon), /1,200/);
  assert.match(render('papers', klingon), /A, B, and C/);
});

test('lists the stylesheet strips of bullets still say they are lists', () => {
  for (const { id } of READY.portfolio.sections) {
    const markup = render(id, READY);
    for (const [list] of markup.matchAll(/<ul[^>]*>/g)) {
      if (/pf-highlights|pf-short-list/.test(list)) assert.doesNotMatch(list, /role=/, id);
      else assert.match(list, /role="list"/, `${id}: ${list}`);
    }
  }
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
  const first = [page(READY), page(INPUT)];
  const again = withoutClock(() => [page(READY), page(INPUT)]);
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

test('SHARED_RENDERERS has one renderer for each of the 14 core kinds', () => {
  const kinds: readonly SectionKind[] = Object.keys(SHARED_RENDERERS) as SectionKind[];
  assert.equal(kinds.length, 14);
});
