import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { resolvePortfolioView, routedWorks, type PublicView } from '@portfolio/schema';
import { readPair, readUnitFiles } from '@portfolio/schema/node';
import {
  buildRenderInput,
  compositionStatus,
  href,
  type RouteTarget,
  type VariantManifest,
} from '@portfolio/variant-contract';
import { CONTRACT_FIXTURES } from '@portfolio/variant-contract/node';
// The registry loads the variant packages, which need React's client build,
// so this test runs without the react-server condition (a .test.tsx file).
import { variantLoader } from '~/lib/variant-loaders';
import { REGISTRY } from '~/lib/variants';
import { resolveVisitorPath } from '~/lib/visitor-routes';

// The content sweep (stream E, from Flux P1's content test and Mission
// Control P2's code review, which found MC dropping 218 strings the
// fallback renders): what the owner wrote that a composition leaves out.
// For the sample and every contract fixture, it collects every authored
// string in the view (each record's and section's words: titles, captions,
// authors, tracks, a testimonial's source, never ids, URLs, dates or
// enums), and renders every visitor route each registered composition has
// (home, each work's own page, each path view the page above it links,
// and each parameterized one under home that home links, with the values
// its links give, in the composition the host renders that page in, as
// network-off.test.tsx does), statically, as the server sends it. A string the fallback
// composition shows on its pages and a composition shows on none of its own
// is that composition's drop. Text is matched as Flux's test matches it:
// the visible text and the alt, aria-label and title attributes, the five
// entities react-dom writes decoded, Markdown reduced to its words, lower
// case, with no whitespace or punctuation; a string over 80 characters
// matches by its first 50 and its last 30, so a cut shows.
//
// What a composition leaves out on purpose is ruled in its quality unit
// (quality/units/<id>.ts) as `contentRuled`: a field pattern each, matched
// against a drop's field (`work(music).tracks.title`, `section(hero).greeting`;
// `*` is any run within one step, `**` any run of steps), with the reason,
// in a sentence. A ruling without a reason fails here, and the quality
// plan's registration check fails it too.
//
// REPORT ONLY, for now (ENFORCE below): the sweep passes, prints each
// composition's count (total, unruled, ruled) and its top fields, and writes
// every drop to reports/content-sweep/content-sweep.json. Each count comes
// two ways: every dropped string, and `unique`, each field once a pair, so
// `large`'s hundred works dropping one field count once; `perFixture` gives
// both for each pair.
//
// THE FLIP RULE, from this test's merge on: a composition flips to `ready`
// (COMPOSITION_STATUS, packages/variant-contract/src/status.ts) only with 0
// unruled drops here. Once ENFORCE is true, the sweep fails a ready
// composition with any unruled drop, and any composition's ruling that
// matches no drop, so a fix removes its line; a pending composition is
// still reported, not failed. `PORTFOLIO_CONTENT_SWEEP=enforce` runs it so
// without the edit, to check a composition before its flip.

/** Whether the sweep fails, rather than reports: false until the lead flips it. */
const ENFORCE = false;
const enforcing = ENFORCE || process.env.PORTFOLIO_CONTENT_SWEEP === 'enforce';

// tsx compiles the variants' JSX to React.createElement calls, so the test supplies React.
Object.assign(globalThis, { React });

const REPO = fileURLToPath(new URL('../../../../', import.meta.url));
const REPORT = `${REPO}reports/content-sweep/content-sweep.json`;

/** Every pair a published page renders here: the contract fixtures, and the bundled sample. */
const PAIRS = [
  ...CONTRACT_FIXTURES.map((fixture) => ({
    name: fixture.name,
    files: fixture.files,
    dir: fixture.files.portfolio.replace(/\/portfolio\.yml$/, ''),
  })),
  {
    name: 'sample',
    files: { portfolio: `${REPO}portfolio.example.yml`, site: `${REPO}site.example.yml` },
    dir: null,
  },
];

/**
 * Fields that carry no visible words: ids, URLs, dates, enums, numbers and
 * flags (Flux's list, less the media placements, whose captions and alt
 * text are words, a testimonial's source, and a metric's unit).
 */
const NOT_WORDS = new Set([
  'id',
  'url',
  'href',
  'slug',
  'asset',
  'kind',
  'type',
  'medium',
  'part',
  'visibility',
  'lang',
  'locale',
  'direction',
  'schemaVersion',
  'src',
  'start',
  'end',
  'publishedAt',
  'releasedAt',
  'presentedAt',
  'receivedAt',
  'grantedAt',
  'filedAt',
  'takenAt',
  'asOf',
  'extensions',
  'thread',
  'branchesFrom',
  'mergesInto',
  'focalPoint',
  'fit',
  'organizationUrl',
  'pdfUrl',
  'slidesUrl',
  'videoUrl',
  'audioUrl',
  'sourceUrl',
  'username',
  'value',
  'key',
  'featured',
  'archived',
  'status',
  'format',
  'platform',
  'durationMinutes',
  'durationSeconds',
  'readingTimeMinutes',
  'stars',
  'year',
  'show',
  'timeZone',
  'iconName',
  'metric',
  'filter',
  'limit',
  'ids',
  'sort',
  'layout',
  // A GitHub section's repository names are references the snapshot resolves.
  'featuredRepos',
  'excludeRepos',
]);

/** Fields that hold references to records when they're a list or a map, and words when they're text. */
const REFERENCE_LISTS = new Set(['evidence', 'works', 'related', 'relations']);

/** The portfolio's top-level lists of record ids. */
const TOP_REFERENCES = new Set(['signature', 'featured', 'proof', 'archive']);

/** The record collections, each with its singular name and the field its records are told apart by. */
const COLLECTIONS: Readonly<Record<string, readonly [string, string]>> = {
  works: ['work', 'medium'],
  evidence: ['evidence', 'type'],
  chronology: ['chronology', 'kind'],
  media: ['media', 'kind'],
};

/** A section kind whose items are references to records, not words. */
const REFERENCE_ITEMS = new Set(['works', 'evidence', 'chronology']);

/** One authored string: where it is, its field, and its text. */
export interface Authored {
  /** Its place in the portfolio, by record id: `works[harbors].media[1].caption`. */
  readonly path: string;
  /** Its field, by collection and kind, without ids or indices: `work(image-series).media.caption`. */
  readonly field: string;
  readonly text: string;
}

function walk(value: unknown, at: string, field: string, out: Authored[]): void {
  if (typeof value === 'string') {
    if (value.trim()) out.push({ path: at, field, text: value });
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((item, index) => walk(item, `${at}[${index}]`, field, out));
    return;
  }
  if (!value || typeof value !== 'object') return;
  for (const [key, item] of Object.entries(value)) {
    if (NOT_WORDS.has(key)) continue;
    if (REFERENCE_LISTS.has(key) && typeof item !== 'string') continue;
    walk(item, `${at}.${key}`, `${field}.${key}`, out);
  }
}

/** Every authored string in a portfolio, with where it came from. */
export function authored(portfolio: PublicView['portfolio']): Authored[] {
  const out: Authored[] = [];
  for (const [key, value] of Object.entries(portfolio as unknown as Record<string, unknown>)) {
    if (NOT_WORDS.has(key) || TOP_REFERENCES.has(key)) continue;
    if (key === 'sections' && Array.isArray(value)) {
      for (const section of value as Record<string, unknown>[]) {
        const kind = String(section.kind);
        const own = Object.fromEntries(
          Object.entries(section).filter(
            ([name]) => !(name === 'items' && REFERENCE_ITEMS.has(kind)),
          ),
        );
        walk(own, `sections[${String(section.id)}]`, `section(${kind})`, out);
      }
      continue;
    }
    const collection = COLLECTIONS[key];
    if (collection && Array.isArray(value)) {
      const [singular, by] = collection;
      (value as Record<string, unknown>[]).forEach((record, index) => {
        // A media asset's source is a file path, not words.
        const own = Object.fromEntries(
          Object.entries(record).filter(([name]) => !(key === 'media' && name === 'source')),
        );
        const id = typeof record.id === 'string' ? record.id : String(index);
        walk(own, `${key}[${id}]`, `${singular}(${String(record[by] ?? '-')})`, out);
      });
      continue;
    }
    walk(value, key, key, out);
  }
  return out;
}

const squash = (text: string) => text.replace(/\s+/g, ' ').trim();

/** Inline Markdown as its words (Flux's plainInline). */
function plainInline(markdown: string): string {
  return squash(
    markdown
      .replace(/`([^`\n]+)`/g, '$1')
      .replace(/!\[([^\]\n]*)\]\([^)\n]*\)/g, '$1')
      .replace(/\[([^\]\n]+)\]\([^)\n]*\)/g, '$1')
      .replace(/\*\*\*(?!\s)(.+?)(?<!\s)\*\*\*/g, '$1')
      .replace(/\*\*(?!\s)(.+?)(?<!\s)\*\*/g, '$1')
      .replace(/\*(?!\s)(.+?)(?<!\s)\*/g, '$1')
      .replace(/(?<![\p{L}\p{N}_])(_{1,3})(?!\s)(.+?)(?<!\s)\1(?![\p{L}\p{N}_])/gu, '$2'),
  );
}

const decode = (text: string) =>
  text
    .replace(/&#x27;/g, "'")
    .replace(/&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&');

/** A render's visible text, and its alt, aria-label and title attributes, as one string each (Flux's textOf). */
export function textOf(html: string): { text: string; attrs: string } {
  const text = squash(
    decode(
      html
        .replace(/<style[\s\S]*?<\/style>/g, ' ')
        .replace(/<script[\s\S]*?<\/script>/g, ' ')
        .replace(/<[^>]+>/g, ' '),
    ).replace(/\u00a0/g, ' '),
  );
  const attrs = squash(
    decode(
      [...html.matchAll(/\s(?:alt|aria-label|title)="([^"]*)"/g)].map((m) => m[1]).join(' | '),
    ),
  );
  return { text, attrs };
}

/** Text as the match compares it: Markdown reduced to its words, lower case, with no whitespace or punctuation. */
export const norm = (text: string) =>
  plainInline(text)
    .toLocaleLowerCase()
    .replace(/[\s\p{P}]+/gu, '');

/** Pages' text as one string the match searches: each page's text and attributes, apart. */
export const corpusOf = (pages: readonly string[]) =>
  pages
    .map((html) => {
      const { text, attrs } = textOf(html);
      return `${norm(text)}\u0000${norm(attrs)}`;
    })
    .join('\u0000');

/** Whether `corpus` shows `text`: all of it, or a long text's head and tail. */
export function shows(corpus: string, text: string): boolean {
  const words = norm(text);
  if (!words) return true;
  const parts = words.length > 80 ? [words.slice(0, 50), words.slice(-30)] : [words];
  return parts.every((part) => corpus.includes(part));
}

/** What a composition leaves out on purpose: a field pattern, and why. */
export interface ContentRuling {
  readonly field: string;
  readonly reason: string;
}

/** A field pattern as a match: `*` any run within one step, `**` any run of steps. */
export function fieldMatcher(pattern: string): RegExp {
  const source = pattern
    .split('**')
    .map((part) =>
      part
        .split('*')
        .map((piece) => piece.replace(/[.+?^${}()|[\]\\]/g, '\\$&'))
        .join('[^.]*'),
    )
    .join('.*');
  return new RegExp(`^${source}$`);
}

/** A reason, as the quality plan's registration check reads one (isReason in tests/quality/lib/checks.ts): a sentence of three words or more. */
const isReason = (text: unknown): boolean =>
  typeof text === 'string' &&
  text.trim() === text &&
  text.length >= 16 &&
  text.split(/\s+/).length >= 3 &&
  /[.!?]$/.test(text);

/** What's wrong with a unit's contentRuled, if anything. */
export function rulingProblems(value: unknown): string[] {
  if (!Array.isArray(value) || value.length === 0) {
    return ['contentRuled is a list of at least one { field, reason }'];
  }
  const problems: string[] = [];
  const seen = new Set<string>();
  value.forEach((item: Record<string, unknown> | null, index) => {
    const at = `contentRuled[${index}]`;
    if (!item || typeof item !== 'object') {
      problems.push(`${at} is an object, { field, reason }`);
      return;
    }
    const unknown = Object.keys(item).filter((key) => key !== 'field' && key !== 'reason');
    if (unknown.length > 0) problems.push(`${at} has unknown fields: ${unknown.join(', ')}`);
    if (typeof item.field !== 'string' || item.field.trim() === '') {
      problems.push(`${at}.field is a field pattern`);
    } else if (seen.has(item.field)) {
      problems.push(`${at}.field ${item.field} is ruled twice`);
    } else seen.add(item.field);
    if (!isReason(item.reason)) {
      problems.push(`${at}.reason says why the composition leaves the field out, in a sentence`);
    }
  });
  return problems;
}

/** Each registered composition's content rulings, from its quality unit, and what's wrong with them. */
async function rulings(): Promise<{
  readonly ruled: ReadonlyMap<string, readonly ContentRuling[]>;
  readonly problems: readonly string[];
}> {
  const ruled = new Map<string, readonly ContentRuling[]>();
  const problems: string[] = [];
  for (const { manifest } of REGISTRY) {
    const file = `${REPO}quality/units/${manifest.id}.ts`;
    if (!existsSync(file)) continue;
    const unit = (await import(pathToFileURL(file).href)) as { contentRuled?: unknown };
    if (!('contentRuled' in unit)) continue;
    const found = rulingProblems(unit.contentRuled);
    problems.push(...found.map((problem) => `quality/units/${manifest.id}.ts: ${problem}`));
    if (found.length === 0) ruled.set(manifest.id, unit.contentRuled as ContentRuling[]);
  }
  return { ruled, problems };
}

/**
 * Every visitor route `view` has for a composition: home, each work's case
 * study, and each of the manifest's path views without a parameter, under
 * home and under each case study. A path view under home that takes a
 * parameter, such as Chapters' chapters/{chapter}, is read from home's own
 * links (homeViews), as network-off.test.tsx reads it; one under a work has
 * none to read, so it asks for its values.
 */
function visitorRoutes(view: PublicView, manifest: VariantManifest): RouteTarget[] {
  const slugs = [...routedWorks(view).values()].map((path) => path.slice('/work/'.length));
  const targets: RouteTarget[] = [
    { route: 'home' },
    ...slugs.map((slug) => ({ route: 'work' as const, slug })),
  ];
  for (const declared of manifest.routes.views) {
    if (declared.type !== 'path') continue;
    if (declared.segment.includes('{')) {
      assert.ok(
        declared.under === 'home',
        `${manifest.id}'s ${declared.id} takes a parameter: give this sweep its values`,
      );
      continue;
    }
    // A view without a parameter is read once the page above it links it (linkedViews).
  }
  return targets;
}

/**
 * The path views without a parameter that a page links to: from home, those under home;
 * from a work's own page, those under that work. A view no page links adds nothing to the
 * reading, so what only it prints counts as dropped (the lead's ruling on 064edf083).
 */
export function linkedViews(
  manifest: VariantManifest,
  from: RouteTarget,
  html: string,
): RouteTarget[] {
  const links = rootLinks(html);
  return manifest.routes.views.flatMap((declared): RouteTarget[] => {
    if (declared.type !== 'path' || declared.segment.includes('{')) return [];
    const target: RouteTarget | undefined =
      from.route === 'home' && declared.under === 'home'
        ? { route: 'view', view: declared, params: {} }
        : from.route === 'work' && declared.under === 'work'
          ? { route: 'view', view: declared, params: {}, slug: from.slug }
          : undefined;
    return target && links.has(href(target).replace(/\/$/, '') || '/') ? [target] : [];
  });
}

/** A page's root-relative link paths, without query, fragment, or trailing slash. */
function rootLinks(html: string): Set<string> {
  return new Set(
    [...html.matchAll(/\shref="(\/[^"?#]*)/g)].map(([, path]) => path!.replace(/\/$/, '') || '/'),
  );
}

/**
 * The parameterized path views under home that home's markup links to, with the values its
 * links give, as a visitor reaches them (the same reading as network-off.test.tsx's).
 * It reads root-relative links (`href="/…"`) only: a relative one is missed, and its page's
 * strings count as dropped, so it fails closed.
 */
export function homeViews(manifest: VariantManifest, homeHtml: string): RouteTarget[] {
  const paths = rootLinks(homeHtml);
  const targets: RouteTarget[] = [];
  for (const declared of manifest.routes.views) {
    if (declared.type !== 'path' || declared.under !== 'home' || !declared.segment.includes('{'))
      continue;
    const names: string[] = [];
    const pattern = declared.segment
      .split('/')
      .map((piece) => {
        const param = /^\{([a-z][a-zA-Z0-9]*)\}$/.exec(piece);
        if (!param) return piece.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        names.push(param[1]!);
        return '([a-z0-9]+(?:-[a-z0-9]+)*)';
      })
      .join('/');
    const exact = new RegExp(`^/${pattern}$`);
    for (const path of paths) {
      const match = exact.exec(path);
      if (!match) continue;
      const params = Object.fromEntries(names.map((name, i) => [name, match[i + 1]!]));
      targets.push({ route: 'view', view: declared, params });
    }
  }
  return targets;
}

/** One drop: the pair, where and what. */
export interface Drop extends Authored {
  readonly pair: string;
}

/** The authored strings the fallback's corpus shows and `corpus` doesn't. */
export function dropsOf(
  pair: string,
  items: readonly Authored[],
  fallback: string,
  corpus: string,
): Drop[] {
  return items
    .filter((item) => shows(fallback, item.text) && !shows(corpus, item.text))
    .map((item) => ({ pair, ...item }));
}

interface Sweep {
  /** Each composition's drops, over every pair. */
  readonly drops: ReadonlyMap<string, readonly Drop[]>;
  /** Each pair's authored strings, and how many of them the fallback shows. */
  readonly pairs: readonly { name: string; authored: number; fallbackShows: number }[];
}

let swept: Promise<Sweep> | undefined;

/** Every composition's drops on every pair. Run once. */
function sweep(): Promise<Sweep> {
  swept ??= (async () => {
    const drops = new Map<string, Drop[]>();
    const pairs: { name: string; authored: number; fallbackShows: number }[] = [];
    for (const { name, files, dir } of PAIRS) {
      const read = readPair(files);
      assert.ok(read.ok, name);
      if (!read.ok) continue;
      const unit = dir ? readUnitFiles(dir) : { snapshots: {} };
      const view = resolvePortfolioView(
        read.pair,
        {
          snapshots: unit.snapshots,
          ...('media' in unit && unit.media ? { media: unit.media } : {}),
        },
        { mediaBase: '/media' },
      );
      // A page the host renders in the same composition at the same path is the same page.
      const rendered = new Map<string, string>();
      const corpus = async (selected: VariantManifest): Promise<string> => {
        const pages: string[] = [];
        const targets = visitorRoutes(view, selected);
        for (let i = 0; i < targets.length; i += 1) {
          const target = targets[i]!;
          const segments = href(target).split('/').filter(Boolean).map(decodeURIComponent);
          const resolved = await resolveVisitorPath(
            { segments, basePath: '', selected: selected.id },
            async () => view,
          );
          assert.equal(resolved.kind, 'render', `${name} ${selected.id} ${JSON.stringify(target)}`);
          if (resolved.kind !== 'render') continue;
          const { manifest } = resolved.composition.rendered;
          const key = `${manifest.id} ${href(resolved.target)}`;
          let html = rendered.get(key);
          if (html === undefined) {
            const Variant = (await variantLoader(manifest.id)()).default;
            const input = buildRenderInput({
              view,
              manifest,
              route: resolved.target,
              basePath: '',
              origin: 'https://rowan.test',
              requestTime: '2026-01-01T00:00:00Z',
            });
            html = renderToStaticMarkup(<Variant input={input} />);
            rendered.set(key, html);
          }
          // Home's links give its parameterized views their values (its chapters, for
          // Chapters), and home's and a work page's links name the other views to read.
          if (manifest.id === selected.id && resolved.target.route !== 'view') {
            if (resolved.target.route === 'home') targets.push(...homeViews(manifest, html));
            targets.push(...linkedViews(manifest, resolved.target, html));
          }
          pages.push(html);
        }
        return corpusOf(pages);
      };
      const items = authored(view.portfolio);
      const fallbackEntry = REGISTRY.find(({ manifest }) => manifest.id === 'fallback');
      assert.ok(fallbackEntry, 'the fallback composition is registered');
      const fallback = await corpus(fallbackEntry.manifest);
      pairs.push({
        name,
        authored: items.length,
        fallbackShows: items.filter((item) => shows(fallback, item.text)).length,
      });
      for (const { manifest } of REGISTRY) {
        if (manifest.id === 'fallback') continue;
        const own = dropsOf(name, items, fallback, await corpus(manifest));
        drops.set(manifest.id, [...(drops.get(manifest.id) ?? []), ...own]);
      }
    }
    return { drops, pairs };
  })();
  return swept;
}

/**
 * How many drops, counted two ways: `total`, every dropped string, and
 * `unique`, each field once a pair, so the `large` fixture's hundred works
 * dropping one field count once, not a hundred times, and hide nothing.
 */
interface Tally {
  readonly total: number;
  readonly unique: number;
  readonly unruled: number;
  readonly uniqueUnruled: number;
}

/** The counts a composition's line in the report gives. */
interface Counts extends Tally {
  readonly status: string;
  readonly ruled: number;
  /** Drops no other composition makes. */
  readonly onlyHere: number;
  /** The same counts for each pair with a drop. */
  readonly perFixture: Readonly<Record<string, Tally>>;
  /** Unruled drops by field, on the most pairs first: the field, its count, and on how many pairs. */
  readonly fields: readonly (readonly [string, number, number])[];
}

/** Each field once a pair. */
const uniqueOf = (drops: readonly Drop[]) =>
  new Set(drops.map(({ pair, field }) => `${pair} ${field}`)).size;

/** `drops` counted both ways, all of them and the unruled ones. */
function tallyOf(drops: readonly Drop[], isRuled: (drop: Drop) => boolean): Tally {
  const unruled = drops.filter((drop) => !isRuled(drop));
  return {
    total: drops.length,
    unique: uniqueOf(drops),
    unruled: unruled.length,
    uniqueUnruled: uniqueOf(unruled),
  };
}

/** `drops`' tally for each pair that has one, by pair name. */
function perFixtureOf(
  drops: readonly Drop[],
  isRuled: (drop: Drop) => boolean,
): Record<string, Tally> {
  const byPair = new Map<string, Drop[]>();
  for (const drop of drops) byPair.set(drop.pair, [...(byPair.get(drop.pair) ?? []), drop]);
  return Object.fromEntries([...byPair].map(([pair, own]) => [pair, tallyOf(own, isRuled)]));
}

/** Drops by field, on the most pairs first, then the most drops: each field's count, and on how many pairs. */
const fieldsOf = (drops: readonly Drop[]): (readonly [string, number, number])[] => {
  const byField = new Map<string, { count: number; pairs: Set<string> }>();
  for (const { field, pair } of drops) {
    const entry = byField.get(field) ?? { count: 0, pairs: new Set<string>() };
    entry.count += 1;
    entry.pairs.add(pair);
    byField.set(field, entry);
  }
  return [...byField]
    .map(([field, { count, pairs }]) => [field, count, pairs.size] as const)
    .sort((a, b) => b[2] - a[2] || b[1] - a[1] || a[0].localeCompare(b[0]));
};

test("a view without a parameter is read only when the page above it links it, so an unlinked one's strings count as dropped", () => {
  const base = REGISTRY[0]!.manifest;
  const manifest = {
    ...base,
    id: 'probe',
    routes: {
      ...base.routes,
      views: [
        { id: 'list', under: 'home', type: 'path', segment: 'list' },
        { id: 'notes', under: 'work', type: 'path', segment: 'notes' },
      ],
    },
  } as VariantManifest;
  const home = { route: 'home' } as const;
  const work = { route: 'work', slug: 'kit' } as const;
  // Unlinked, neither view is read.
  assert.deepEqual(linkedViews(manifest, home, '<a href="/elsewhere">x</a>'), []);
  assert.deepEqual(linkedViews(manifest, work, '<a href="/work/kit">x</a>'), []);
  // Linked, each is read from the page above it, and only there.
  assert.deepEqual(
    linkedViews(manifest, home, '<a href="/list/">List</a><a href="/work/kit/notes">N</a>').map(
      (target) => href(target),
    ),
    ['/list'],
  );
  assert.deepEqual(
    linkedViews(manifest, work, '<a href="/work/kit/notes">Notes</a>').map((target) =>
      href(target),
    ),
    ['/work/kit/notes'],
  );
  // What only an unlinked view prints is a drop.
  const items = [
    { path: 'a', field: 'section(lede).body', text: 'Home words' },
    { path: 'b', field: 'section(lede).body', text: 'List-only words' },
  ];
  const fallback = corpusOf(['<p>Home words</p><p>List-only words</p>']);
  assert.deepEqual(
    dropsOf('planted', items, fallback, corpusOf(['<p>Home words</p>'])).map(({ text }) => text),
    ['List-only words'],
  );
});

test("a chapter home doesn't link adds nothing to the reading, so what only it prints counts as dropped", () => {
  const base = REGISTRY[0]!.manifest;
  const spread = {
    ...base,
    id: 'probe',
    routes: {
      ...base.routes,
      views: [{ id: 'part', under: 'home', type: 'path', segment: 'parts/{part}' }],
    },
  } as VariantManifest;
  // Home links /parts/one only; /parts/two exists, and holds the one string nothing else shows.
  const home = '<main><p>Home words</p><a href="/parts/one">One</a></main>';
  const pages: Record<string, string> = {
    '/parts/one': '<main><p>Linked words</p></main>',
    '/parts/two': '<main><p>Unlinked words</p></main>',
  };
  const read = [home, ...homeViews(spread, home).map((target) => pages[href(target)]!)];
  assert.equal(read.length, 2);
  const items = ['Home words', 'Linked words', 'Unlinked words'].map((text) => ({
    path: text,
    field: 'section(lede).body',
    text,
  }));
  const fallback = corpusOf([`<p>${items.map(({ text }) => text).join('</p><p>')}</p>`]);
  // Home and the chapter it links are one reading; the unlinked chapter fails closed.
  assert.deepEqual(
    dropsOf('planted', items, fallback, corpusOf(read)).map(({ text }) => text),
    ['Unlinked words'],
  );
});

test("the sweep reads a parameterized view under home from home's links, and asks for the values of one under a work", () => {
  const read = readPair(PAIRS.at(-1)!.files);
  assert.ok(read.ok);
  if (!read.ok) return;
  const view = resolvePortfolioView(read.pair, { snapshots: {} }, { mediaBase: '/media' });
  const base = REGISTRY[0]!.manifest;
  const declaring = (under: 'home' | 'work') =>
    ({
      ...base,
      id: 'probe',
      routes: {
        ...base.routes,
        views: [{ id: 'part', under, type: 'path', segment: 'parts/{part}' }],
      },
    }) as VariantManifest;
  assert.throws(
    () => visitorRoutes(view, declaring('work')),
    /probe's part takes a parameter: give this sweep its values/,
  );
  const home = declaring('home');
  assert.deepEqual(
    visitorRoutes(view, home).filter((target) => target.route === 'view'),
    [],
  );
  assert.deepEqual(
    homeViews(home, '<a href="/parts/one">1</a><a href="/parts/two/">2</a><a href="/x">x</a>').map(
      (target) => target.route === 'view' && target.params,
    ),
    [{ part: 'one' }, { part: 'two' }],
  );
});

test("a composition's counts: every drop, each field once a pair, per fixture, and by field on the most pairs", () => {
  const drop = (pair: string, field: string, path = field): Drop => ({
    pair,
    field,
    path,
    text: 'x',
  });
  const drops = [
    ...Array.from({ length: 100 }, (_, index) =>
      drop('large', 'work(software).tools', `works[w${index}].tools[0]`),
    ),
    drop('sample', 'section(hero).greeting'),
    drop('complete', 'section(hero).greeting'),
    drop('complete', 'evidence(publication).doi'),
    drop('sample', 'evidence(publication).doi'),
    drop('sample', 'evidence(publication).doi', 'evidence[other].doi'),
  ];
  const isRuled = (each: Drop) => each.field === 'section(hero).greeting';
  assert.deepEqual(tallyOf(drops, isRuled), {
    total: 105,
    unique: 5,
    unruled: 103,
    uniqueUnruled: 3,
  });
  assert.deepEqual(perFixtureOf(drops, isRuled), {
    large: { total: 100, unique: 1, unruled: 100, uniqueUnruled: 1 },
    sample: { total: 3, unique: 2, unruled: 2, uniqueUnruled: 1 },
    complete: { total: 2, unique: 2, unruled: 1, uniqueUnruled: 1 },
  });
  assert.deepEqual(fieldsOf(drops.filter((each) => !isRuled(each))), [
    ['evidence(publication).doi', 3, 2],
    ['work(software).tools', 100, 1],
  ]);
});

test("the sweep's match: the fallback's text, less a composition's, by Flux's normalization", () => {
  const item = (text: string, field = 'section(lede).body'): Authored => ({
    path: `sections[about].${field}`,
    field,
    text,
  });
  const long = `${'Rain is a kind of punctuation, '.repeat(4)}and the harbour keeps its time.`;
  const items = [
    item('Rain is a **kind** of [punctuation](https://rowan.test).'),
    item('Tom & Jerry’s “quote”'),
    item('Alt only'),
    item(long),
    item('Shown by neither'),
    item('Dropped here'),
  ];
  const fallback = corpusOf([
    `<p>Rain is a kind of punctuation</p><p>Tom &amp; Jerry’s “quote”</p><img alt="Alt only"/>`,
    `<p>${long}</p><p>Dropped here</p>`,
  ]);
  const cut = long.slice(0, 100);
  const composition = corpusOf([
    `<h2>RAIN IS A KIND\nOF PUNCTUATION.</h2><span>Tom&nbsp;&amp;&nbsp;Jerry’s</span> <i>“quote”</i>`,
    `<p>${cut}…</p><figure aria-label="Alt only"></figure>`,
  ]);
  assert.deepEqual(
    dropsOf('test', items, fallback, composition).map(({ text }) => text),
    [long, 'Dropped here'],
  );
  assert.ok(fieldMatcher('work(*).media.caption').test('work(image-series).media.caption'));
  assert.ok(!fieldMatcher('work(*).media.caption').test('work(music).tracks.title'));
  assert.ok(fieldMatcher('evidence(publication).**').test('evidence(publication).awards'));
  assert.ok(!fieldMatcher('evidence(publication).*').test('evidence(publication).source.name'));
  assert.ok(fieldMatcher('section(hero).greeting').test('section(hero).greeting'));
  assert.ok(!fieldMatcher('section(hero).greeting').test('section(hero).greetings'));
});

test('a content ruling names a field and gives its reason; one without a reason fails', () => {
  const good = { field: 'section(hero).greeting', reason: 'The opening sets no greeting line.' };
  assert.deepEqual(rulingProblems([good]), []);
  const bad: [unknown, RegExp][] = [
    [[], /a list of at least one/],
    [{}, /a list of at least one/],
    [[{ field: good.field }], /reason says why/],
    [[{ ...good, reason: '' }], /reason says why/],
    [[{ ...good, reason: 'by design' }], /reason says why/],
    [[{ ...good, reason: 'The opening sets no greeting line' }], /reason says why/],
    [[{ ...good, field: '' }], /field is a field pattern/],
    [[good, good], /ruled twice/],
    [[{ ...good, why: 'x' }], /unknown fields: why/],
    [[null], /is an object/],
  ];
  for (const [value, message] of bad) {
    assert.match(rulingProblems(value).join('\n'), message, JSON.stringify(value));
  }
});

test('the authored strings: every record and section field with words, never ids, URLs or dates', () => {
  const found = authored({
    identity: { name: 'Noor Edge', email: 'noor@edge.test' },
    signature: 'solo',
    works: [
      {
        id: 'solo',
        slug: 'solo',
        title: 'Solo',
        medium: 'image-series',
        url: 'https://edge.test/solo',
        media: [{ asset: 'one', caption: 'The 6:10 to Vinga' }],
        evidence: ['praise'],
        caseStudy: { evidence: 'Case study evidence.' },
      },
    ],
    evidence: [
      {
        id: 'praise',
        type: 'testimonial',
        statement: 'Calm review.',
        source: { name: 'Sam Lee', url: 'https://sam.test' },
      },
    ],
    media: [{ id: 'one', kind: 'image', source: 'edge/one.png', alt: 'A ferry' }],
    sections: [
      { kind: 'works', id: 'work', title: 'Work', items: ['solo'] },
      { kind: 'focus', id: 'focus', items: ['Focus item'] },
    ],
  } as unknown as PublicView['portfolio']);
  assert.deepEqual(
    found.map(({ path, field }) => `${path} ${field}`),
    [
      'identity.name identity.name',
      'identity.email identity.email',
      'works[solo].title work(image-series).title',
      'works[solo].media[0].caption work(image-series).media.caption',
      'works[solo].caseStudy.evidence work(image-series).caseStudy.evidence',
      'evidence[praise].statement evidence(testimonial).statement',
      'evidence[praise].source.name evidence(testimonial).source.name',
      'media[one].alt media(image).alt',
      'sections[work].title section(works).title',
      'sections[focus].items[0] section(focus).items',
    ],
  );
});

test("every registered composition's drops against the fallback, on every pair and visitor route: reported, and enforced for ready ones once ENFORCE is on", async (t) => {
  const { ruled, problems } = await rulings();
  assert.deepEqual(problems, [], 'every content ruling names a field and gives its reason');
  const { drops, pairs } = await sweep();
  for (const pair of pairs) {
    if (pair.name === 'identity-only') continue;
    assert.ok(pair.fallbackShows > 0, `the fallback shows some of ${pair.name}'s strings`);
  }
  const counts: Record<string, Counts> = {};
  const report: Record<string, unknown> = {};
  const unruledReady: string[] = [];
  const stale: string[] = [];
  const all = [...drops.values()].flat();
  const droppedBy = new Map<string, number>();
  for (const { pair, path } of all) {
    droppedBy.set(`${pair} ${path}`, (droppedBy.get(`${pair} ${path}`) ?? 0) + 1);
  }
  for (const [id, own] of [...drops].sort(([a], [b]) => a.localeCompare(b))) {
    const rules = (ruled.get(id) ?? []).map((rule) => ({
      ...rule,
      match: fieldMatcher(rule.field),
    }));
    const ruledBy = (drop: Drop) => rules.find((rule) => rule.match.test(drop.field));
    const isRuled = (drop: Drop) => ruledBy(drop) !== undefined;
    const unruled = own.filter((drop) => !isRuled(drop));
    const status = compositionStatus(id);
    const tally = tallyOf(own, isRuled);
    counts[id] = {
      status,
      ...tally,
      ruled: tally.total - tally.unruled,
      onlyHere: own.filter(({ pair, path }) => droppedBy.get(`${pair} ${path}`) === 1).length,
      perFixture: perFixtureOf(own, isRuled),
      fields: fieldsOf(unruled),
    };
    for (const rule of rules) {
      if (!own.some((drop) => rule.match.test(drop.field))) {
        stale.push(`${id}: ${rule.field} matches no drop`);
      }
    }
    if (status === 'ready' && unruled.length > 0) unruledReady.push(id);
    report[id] = {
      ...counts[id],
      drops: own.map((drop) => ({
        pair: drop.pair,
        path: drop.path,
        field: drop.field,
        text: squash(drop.text).slice(0, 120),
        ...(ruledBy(drop) ? { ruled: ruledBy(drop)!.field } : {}),
      })),
    };
    const top = counts[id].fields
      .slice(0, 3)
      .map(([field, n, on]) => `${field} ${n} (${on} pairs)`)
      .join(', ');
    const line = counts[id];
    t.diagnostic(
      `${id} (${status}): ${line.total} drops (${line.unique} unique), ${line.unruled} unruled (${line.uniqueUnruled} unique), ${line.ruled} ruled, ${line.onlyHere} only here; top: ${top || 'none'}`,
    );
  }
  for (const line of stale) t.diagnostic(`stale ruling: ${line}`);
  mkdirSync(new URL('.', pathToFileURL(REPORT)), { recursive: true });
  writeFileSync(
    REPORT,
    `${JSON.stringify({ enforce: enforcing, pairs, stale, compositions: report }, null, 2)}\n`,
  );
  t.diagnostic(`wrote ${REPORT.slice(REPO.length)}`);
  if (!enforcing) return;
  assert.deepEqual(
    unruledReady.map((id) => `${id}: ${counts[id]!.unruled} unruled drops`),
    [],
    "ready compositions with unruled drops: render the field, or rule it in the composition's unit",
  );
  assert.deepEqual(stale, [], 'content rulings that match no drop: remove them from the unit');
});
