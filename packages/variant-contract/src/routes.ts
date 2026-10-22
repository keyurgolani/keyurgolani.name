// Routes (#5, Slice 1, item 3): `home` at /, `work` at /work/{slug}, and the
// views a variant declares under either, canonical to their parent route.
// Pure helpers the host's pages, #7's frame, and #9's browser render share.

import { isSectionId, type Site } from '@portfolio/schema';
import type { VariantManifest, ViewDeclaration } from './manifest-schema';
import {
  isParamValue,
  matchPathView,
  parseFragmentPattern,
  parsePathPattern,
  type PatternPart,
} from './segments';

/** What a request renders. */
export type RouteTarget =
  | { readonly route: 'home' }
  | { readonly route: 'work'; readonly slug: string }
  | {
      readonly route: 'view';
      readonly view: ViewDeclaration;
      readonly params: Readonly<Record<string, string>>;
      /** The work's slug, for a view under work. */
      readonly slug?: string;
    };

export type DispatchResult =
  | { readonly kind: 'render'; readonly target: RouteTarget }
  /** A path only another installed variant declares: 307 to its canonical route. */
  | { readonly kind: 'redirect'; readonly location: string }
  | { readonly kind: 'not-found' };

export interface DispatchOptions {
  /** The path below `basePath`, as decoded segments, such as a catch-all route's params. */
  readonly segments: readonly string[];
  /** The rendering variant's manifest. */
  readonly manifest: VariantManifest;
  /** Every installed variant's manifest, so a view another one declares redirects. */
  readonly installed?: readonly VariantManifest[];
  /** The site document's route toggles. `home` is always on. */
  readonly toggles?: Site['routes'];
  readonly basePath?: string;
  /** Kept on a redirect, such as /sample's `variant`. */
  readonly query?: Readonly<Record<string, string>>;
}

/** Which route a path is, a redirect to the canonical route, or nothing. */
export function dispatch(options: DispatchOptions): DispatchResult {
  const { segments, manifest, toggles } = options;
  const enabled = (id: string) => id === 'home' || toggles?.[id]?.enabled !== false;
  const hrefOptions = { basePath: options.basePath ?? '', query: options.query };
  if (segments.length === 0) return { kind: 'render', target: { route: 'home' } };

  let under: 'home' | 'work' = 'home';
  let rest = segments;
  let slug: string | undefined;
  if (segments[0] === 'work') {
    slug = segments[1];
    if (slug === undefined || !isParamValue(slug) || !enabled('work')) {
      return { kind: 'not-found' };
    }
    if (segments.length === 2) return { kind: 'render', target: { route: 'work', slug } };
    under = 'work';
    rest = segments.slice(2);
  }

  const own = matchView(manifest, under, rest);
  if (own) {
    if (!enabled(own.view.id)) return { kind: 'not-found' };
    return {
      kind: 'render',
      target: { route: 'view', view: own.view, params: own.params, ...(slug ? { slug } : {}) },
    };
  }
  const elsewhere = (options.installed ?? []).some(
    (other) => other.id !== manifest.id && matchView(other, under, rest) !== null,
  );
  if (elsewhere) {
    const parent: RouteTarget = slug ? { route: 'work', slug } : { route: 'home' };
    return { kind: 'redirect', location: href(parent, hrefOptions) };
  }
  return { kind: 'not-found' };
}

/**
 * The view a path is, if any. When several match, the one with a literal
 * where another has a placeholder wins, at the first segment they differ,
 * whatever order the manifest lists them in: `notes/archive` beats
 * `notes/{note}`, as in Next's routing.
 */
function matchView(
  manifest: VariantManifest,
  under: 'home' | 'work',
  segments: readonly string[],
): { view: ViewDeclaration; params: Record<string, string> } | null {
  let best: { view: ViewDeclaration; params: Record<string, string>; shape: string } | null = null;
  for (const view of manifest.routes.views) {
    const params = matchPathView(view, under, segments);
    if (params === null) continue;
    // L for a literal and P for a placeholder sort a literal first, segment by segment.
    const shape = view.segment
      .split('/')
      .map((piece) => (piece.startsWith('{') ? 'P' : 'L'))
      .join('');
    if (!best || shape < best.shape) best = { view, params, shape };
  }
  return best && { view: best.view, params: best.params };
}

export interface HrefOptions {
  /** Where the routes are mounted: '' for the site root, `/sample`, or #7's preview prefix. */
  readonly basePath?: string;
  readonly query?: Readonly<Record<string, string>>;
  /** The render input's `ids.prefix`, which a fragment view's element id starts with. */
  readonly idPrefix?: string;
}

const BASE_PATH = /^(?:\/[A-Za-z0-9_-]+)*$/;

/** A base path checked and without a trailing slash. Throws when it isn't one. */
export function normalizeBasePath(basePath: string): string {
  const trimmed = basePath === '/' ? '' : basePath;
  if (!BASE_PATH.test(trimmed)) {
    throw new TypeError(
      'A base path is empty or segments of letters, digits, _ and -, each after a /.',
    );
  }
  return trimmed;
}

/** The URL of a route, below `basePath`, with `query` before any fragment. */
export function href(target: RouteTarget, options: HrefOptions = {}): string {
  const base = normalizeBasePath(options.basePath ?? '');
  const query = queryString(options.query);
  const home = base === '' ? '/' : base;
  switch (target.route) {
    case 'home':
      return `${home}${query}`;
    case 'work':
      return `${base}/work/${segmentValue(target.slug)}${query}`;
    case 'view': {
      const { view, params } = target;
      const parent =
        view.under === 'work' ? `${base}/work/${segmentValue(requireSlug(target.slug))}` : base;
      if (view.type === 'fragment') {
        const pattern = parseFragmentPattern(view.segment);
        if ('problem' in pattern) throw new TypeError(`The view's segment ${pattern.problem}`);
        return `${parent || '/'}${query}#${options.idPrefix ?? ''}${fill(pattern.parts, params, '')}`;
      }
      const pattern = parsePathPattern(view.segment);
      if ('problem' in pattern) throw new TypeError(`The view's segment ${pattern.problem}`);
      return `${parent}/${fill(pattern.parts, params, '/')}${query}`;
    }
  }
}

/** What routeHref() reads from a variant's render input. */
export interface LinkContext {
  readonly basePath: string;
  readonly query: Readonly<Record<string, string>>;
  readonly ids: { readonly prefix: string };
}

/**
 * The URL of a route, for a link a variant renders: below the render input's
 * base path, keeping its query, with its id prefix on a fragment view. A
 * variant's internal links go through it, so one render links right at the
 * site root, under /sample, and under #7's preview prefix.
 */
export function routeHref(input: LinkContext, target: RouteTarget): string {
  return href(target, {
    basePath: input.basePath,
    query: input.query,
    idPrefix: input.ids.prefix,
  });
}

function requireSlug(slug: string | undefined): string {
  if (slug === undefined) throw new TypeError('A view under work needs the work slug.');
  return slug;
}

function segmentValue(value: string): string {
  if (!isParamValue(value)) {
    throw new TypeError(
      'A slug or placeholder value is lowercase words joined by hyphens, at most 64 characters.',
    );
  }
  return value;
}

function fill(
  parts: readonly PatternPart[],
  params: Readonly<Record<string, string>>,
  separator: string,
): string {
  return parts
    .map((part) => {
      if ('literal' in part) return part.literal;
      const value = Object.hasOwn(params, part.param) ? params[part.param] : undefined;
      if (value === undefined) throw new TypeError(`The view needs a value for {${part.param}}.`);
      return segmentValue(value);
    })
    .join(separator);
}

function queryString(query: Readonly<Record<string, string>> | undefined): string {
  if (!query) return '';
  const entries = Object.entries(query).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  if (entries.length === 0) return '';
  return `?${new URLSearchParams(entries).toString()}`;
}

export interface IdOptions {
  /** The ids handed out so far. Share one per document. */
  readonly taken: Set<string>;
  /** The render input's `ids.prefix`, which every id starts with. */
  readonly prefix?: string;
}

/**
 * A DOM id for a section or item: the id prefix, then its stable content id
 * (#4, #10), else `<kind>--<index>`, never its title. A repeat gets `--2`,
 * `--3`, and so on. A content id never has two hyphens in a row, so a
 * fallback or a repeat can't take the id of something later in the document,
 * and the ids don't depend on the order they're asked for.
 */
export function idFor(
  item: { readonly id?: string; readonly kind: string },
  index: number,
  { taken, prefix = '' }: IdOptions,
): string {
  const kind = item.kind
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  const base =
    item.id !== undefined && isSectionId(item.id) ? item.id : `${kind || 'section'}--${index}`;
  let id = `${prefix}${base}`;
  for (let n = 2; taken.has(id); n += 1) id = `${prefix}${base}--${n}`;
  taken.add(id);
  return id;
}
