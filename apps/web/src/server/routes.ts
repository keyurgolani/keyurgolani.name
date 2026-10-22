import {
  isReservedSegment,
  matchPathView,
  type ViewPattern,
} from '@portfolio/variant-contract/segments';
import { VARIANTS } from '../lib/generated/registry.meta';
import { sampleSelection } from '../lib/sample';
import { accessIn, type Access, type Capability, type Profile } from './capabilities';

// The route table (#1, item 13): every page, route handler, and metadata
// route in apps/web/src/app, each mapped to the capability it serves.
// routes.test.ts fails on a route file without an entry. proxy.ts, the
// route files, and the server-built navigation all decide from this table
// and the capability matrix, never from a route's name. Which paths name
// anything comes from the installed variants' manifests (#5, Slice 4),
// never from the live site, so it holds whatever the site selects.

export type RouteKind = 'page' | 'handler' | 'metadata';

/** A request's path, as the route table reads it. */
export interface RoutePath {
  /** The decoded path segments, such as `['work', 'tide-tables']`. */
  readonly segments: readonly string[];
  readonly query: URLSearchParams;
}

/** What the route table reads from the variants this build registers: their ids and views. */
export type Installed = readonly {
  readonly manifest: {
    readonly id: string;
    readonly routes: { readonly views: readonly ViewPattern[] };
  };
}[];

export interface RouteEntry {
  /** The URL pattern as the app directory spells it, such as `/api/studio/[name]`. */
  readonly pattern: string;
  readonly kind: RouteKind;
  /**
   * The capability the route serves. `operations` is the Studio transport:
   * every profile serves it, and its dispatcher checks each operation's own
   * capability.
   */
  readonly capability: Capability | 'operations';
  /** Set when the route serves fewer profiles than its capability allows. */
  readonly profiles?: readonly Profile[];
  /** A page the server-built navigation lists, under this label. */
  readonly nav?: string;
  /**
   * A route visitors read the published site through. While the catalog
   * can't serve (isServable() is false), proxy.ts answers it with a 503.
   */
  readonly visitor?: true;
  /**
   * The root catch-all where a variant's path views resolve (#5, Slice 4).
   * It takes no path whose first segment the contract reserves, or another
   * entry or a retired route starts with: no view may start with one.
   */
  readonly views?: true;
  /**
   * Whether a path the entry matches names anything this build can render
   * or redirect, in some profile (#5, Slice 4). One that names nothing is
   * missing in every profile, and proxy.ts answers it with the app's 404
   * page. An entry without it names every path it matches.
   */
  readonly names?: (path: RoutePath, installed: Installed) => boolean;
}

// What visitors read the site through at its root, which the demo profile
// doesn't serve: it shows the bundled sample under /sample instead.
const SITE_PROFILES = ['owner', 'read-only'] as const;

/** Whether an installed variant declares a path view at `segments` below `under`. */
function declaresView(
  installed: Installed,
  under: 'home' | 'work',
  segments: readonly string[],
): boolean {
  return installed.some(({ manifest }) =>
    manifest.routes.views.some((view) => matchPathView(view, under, segments) !== null),
  );
}

/**
 * Whether `segments`, below the site root or /sample, name a page: home, or
 * a view some installed variant declares, which renders, or redirects to its
 * canonical route. A reserved first segment is never a view, and no slug
 * names a work until #10 (the case-study model).
 */
function namesPage(installed: Installed, segments: readonly string[]): boolean {
  const [first] = segments;
  if (first === undefined) return true;
  if (isReservedSegment(first)) return false;
  return declaresView(installed, 'home', segments);
}

/** /sample's `variant` parameter as a page reads it: absent, one value, or several. */
function variantParameter(query: URLSearchParams) {
  const values = query.getAll('variant');
  return { variant: values.length === 0 ? undefined : values.length === 1 ? values[0] : values };
}

// A pattern may appear more than once, with a different capability for each
// profile that serves it (such as a Studio page under owner and demo).
const ROUTES = [
  { pattern: '/', kind: 'page', capability: 'catalog.read', nav: 'Home', visitor: true },
  {
    pattern: '/[...view]',
    kind: 'page',
    capability: 'catalog.read',
    profiles: SITE_PROFILES,
    visitor: true,
    views: true,
    names: ({ segments }, installed) => namesPage(installed, segments),
  },
  {
    pattern: '/work/[slug]',
    kind: 'page',
    capability: 'catalog.read',
    profiles: SITE_PROFILES,
    visitor: true,
    names: () => false,
  },
  {
    pattern: '/work/[slug]/[...view]',
    kind: 'page',
    capability: 'catalog.read',
    profiles: SITE_PROFILES,
    visitor: true,
    names: () => false,
  },
  {
    pattern: '/sample/[[...path]]',
    kind: 'page',
    capability: 'sample.read',
    visitor: true,
    // The variant ?variant= names, which the page renders, and a page below /sample.
    names: ({ segments, query }, installed) =>
      sampleSelection(variantParameter(query), installed) !== null &&
      namesPage(installed, segments.slice(1)),
  },
  // Studio (#2): the owner's placeholder, which #8 replaces, and sign-in.
  // Neither reads the published site, so neither is a visitor route.
  { pattern: '/studio', kind: 'page', capability: 'studio.view' },
  { pattern: '/studio/sign-in', kind: 'page', capability: 'auth.session' },
  { pattern: '/robots.txt', kind: 'metadata', capability: 'catalog.read', visitor: true },
  { pattern: '/sitemap.xml', kind: 'metadata', capability: 'catalog.read', visitor: true },
  // The site's share image, app/(site)/opengraph-image.tsx: Next gives a
  // metadata route inside a route group a suffix hashed from the group.
  {
    pattern: '/opengraph-image-12o0cb',
    kind: 'metadata',
    capability: 'catalog.read',
    visitor: true,
  },
  { pattern: '/feed.xml', kind: 'handler', capability: 'feed.read', visitor: true },
  { pattern: '/api/health', kind: 'handler', capability: 'health.read' },
  { pattern: '/api/ready', kind: 'handler', capability: 'ready.read' },
  { pattern: '/api/studio/[name]', kind: 'handler', capability: 'operations' },
] as const satisfies readonly RouteEntry[];

export type RoutePattern = (typeof ROUTES)[number]['pattern'];

/**
 * The URL pattern for a route path Next reports, such as onRequestError's
 * `routePath`: `/page`, `/sample/page`, or `/api/ready/route` (route handlers
 * sometimes report `/api/ready` already). Route groups and parallel-route
 * slots drop out, as they do from the URL.
 */
export function patternOfRoutePath(routePath: string): string {
  const segments = routePath
    .split('/')
    .filter((segment) => segment !== '' && !/^\(.*\)$/.test(segment) && !segment.startsWith('@'));
  const last = segments.at(-1);
  if (last === 'page' || last === 'route') segments.pop();
  return `/${segments.join('/')}`;
}

/**
 * Routes #1 removed in every profile. proxy.ts answers each with 404. Each
 * matches exactly: `/variants`, never `/variants/*`, which is missing, so a
 * file in public/variants/ or else the app's 404 page answers it. The v1
 * screenshots that lived there moved to legacy/public/ with their variants
 * (#5), and the contract reserves each first segment, so no view can sit
 * here.
 */
export const RETIRED_PATTERNS = [
  '/admin',
  '/variants',
  '/preview/[slug]',
  '/api/portfolio',
  '/api/variant',
  '/api/customize',
] as const;

export function listRoutes(): readonly RouteEntry[] {
  return ROUTES;
}

/** How `profile` grants `entry`: the access its capability has there, or absent. */
export function routeAccess(profile: Profile, entry: RouteEntry): Access | 'absent' {
  if (entry.profiles && !entry.profiles.includes(profile)) return 'absent';
  if (entry.capability === 'operations') return 'public';
  return accessIn(profile, entry.capability);
}

/** Whether `profile` serves the route `pattern` names. */
export function serves(profile: Profile, pattern: RoutePattern): boolean {
  return ROUTES.some(
    (entry) => entry.pattern === pattern && routeAccess(profile, entry) !== 'absent',
  );
}

export type RouteDecision =
  | { readonly status: 'served'; readonly entry: RouteEntry; readonly access: Access }
  /** The table or the retired list has a route at the path, and the profile doesn't serve it. */
  | { readonly status: 'absent' }
  /**
   * A path no route renders in any profile of this build: a file in public/,
   * or else the app's 404 page, answers it.
   */
  | { readonly status: 'missing' }
  /** Not a route of ours: Next's build assets, or a path that doesn't decode. */
  | { readonly status: 'unlisted' };

export type ResolveRoute = (
  profile: Profile,
  pathname: string,
  query?: URLSearchParams,
) => RouteDecision;

/**
 * What `profile` does with a request for `pathname`, from a route table, a
 * retired list, and the installed variants. Like Next, it picks the most
 * specific matching pattern: static segments over dynamic ones, and dynamic
 * over catch-all.
 */
export function routeResolver(
  routes: readonly RouteEntry[],
  retired: readonly string[],
  installed: Installed = VARIANTS,
): ResolveRoute {
  const owned = ownedFirstSegments(routes, retired);
  return (profile, pathname, query = new URLSearchParams()) => {
    const segments = splitPath(pathname);
    // A path that doesn't decode is no route of ours; Next answers it.
    if (segments === null) return { status: 'unlisted' };
    if (retired.some((pattern) => rank(pattern, segments) !== null)) return { status: 'absent' };
    const first = segments[0] ?? '';
    if (first === '_next') return { status: 'unlisted' };
    let best: { score: number[]; entries: RouteEntry[] } | undefined;
    for (const entry of routes) {
      if (entry.views && (owned.has(first) || isReservedSegment(first))) continue;
      const score = rank(entry.pattern, segments);
      if (score === null) continue;
      if (!best || compare(score, best.score) > 0) best = { score, entries: [entry] };
      else if (compare(score, best.score) === 0) best.entries.push(entry);
    }
    if (!best) return { status: 'missing' };
    const path = { segments, query };
    if (best.entries.every((entry) => entry.names && !entry.names(path, installed))) {
      return { status: 'missing' };
    }
    for (const entry of best.entries) {
      const access = routeAccess(profile, entry);
      if (access !== 'absent') return { status: 'served', entry, access };
    }
    return { status: 'absent' };
  };
}

/** What `profile` does with a request for `pathname`. proxy.ts asks this. */
export const resolveRoute: ResolveRoute = routeResolver(ROUTES, RETIRED_PATTERNS);

/**
 * The request header proxy.ts sets to the route table's decision on every
 * request it passes to Next. next.config.ts rewrites one marked `missing`
 * to Next's /_not-found route, which renders the app's 404 page from the
 * server with its 404 status. A page can't: in Next 16 its notFound()
 * answers with an empty document that only JavaScript fills in. The rewrite
 * runs after Next looks in public/, so a file there is still served.
 */
export const ROUTE_HEADER = 'x-portfolio-route';

/**
 * Every static first segment of an entry other than the views catch-all,
 * or of a retired route, and Next's `_next`. The catch-all leaves these
 * alone, as it does every other segment the contract reserves.
 * routes.test.ts checks that the contract reserves each, so no view is ever
 * shadowed.
 */
export function ownedFirstSegments(
  routes: readonly RouteEntry[] = ROUTES,
  retired: readonly string[] = RETIRED_PATTERNS,
): ReadonlySet<string> {
  const owned = new Set(['_next']);
  const patterns = [
    ...routes.filter((entry) => !entry.views).map((entry) => entry.pattern),
    ...retired,
  ];
  for (const pattern of patterns) {
    const [first] = pattern.split('/').filter((part) => part !== '');
    if (first !== undefined && !first.startsWith('[')) owned.add(first);
  }
  return owned;
}

function splitPath(pathname: string): string[] | null {
  try {
    return pathname
      .split('/')
      .filter((segment) => segment !== '')
      .map((segment) => decodeURIComponent(segment));
  } catch {
    return null;
  }
}

/** Per-segment specificity when `pattern` matches, or null: 3 static, 2 dynamic, 1 catch-all. */
function rank(pattern: string, segments: readonly string[]): number[] | null {
  const parts = pattern.split('/').filter((part) => part !== '');
  const score: number[] = [];
  for (let index = 0; index < parts.length; index++) {
    const part = parts[index]!;
    const optional = part.startsWith('[[...');
    if (optional || part.startsWith('[...')) {
      const rest = segments.length - index;
      if (rest < (optional ? 0 : 1)) return null;
      return [...score, 1];
    }
    const segment = segments[index];
    if (segment === undefined) return null;
    if (part.startsWith('[')) score.push(2);
    else if (part === segment) score.push(3);
    else return null;
  }
  return parts.length === segments.length ? score : null;
}

function compare(a: readonly number[], b: readonly number[]): number {
  for (let index = 0; index < Math.max(a.length, b.length); index++) {
    const difference = (a[index] ?? 0) - (b[index] ?? 0);
    if (difference !== 0) return difference;
  }
  return 0;
}
