import { accessIn, type Access, type Capability, type Profile } from './capabilities';

// The route table (#1, item 13): every page, route handler, and metadata
// route in apps/web/src/app, each mapped to the capability it serves.
// routes.test.ts fails on a route file without an entry. proxy.ts, the
// route files, and the server-built navigation all decide from this table
// and the capability matrix, never from a route's name.

export type RouteKind = 'page' | 'handler' | 'metadata';

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
}

// A pattern may appear more than once, with a different capability for each
// profile that serves it (such as a Studio page under owner and demo).
const ROUTES = [
  { pattern: '/', kind: 'page', capability: 'catalog.read', nav: 'Home', visitor: true },
  { pattern: '/sample', kind: 'page', capability: 'sample.read', visitor: true },
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
 * matches exactly: `/variants`, never `/variants/*`, which stays free for
 * static assets under public/variants/. The v1 screenshots that lived there
 * moved to legacy/public/ with their variants (#5).
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
  /** The table or the retired list has the path, and the profile doesn't serve it. */
  | { readonly status: 'absent' }
  /** Not a listed route: a public/ file, or Next's own 404. */
  | { readonly status: 'unlisted' };

export type ResolveRoute = (profile: Profile, pathname: string) => RouteDecision;

/**
 * What `profile` does with a request for `pathname`, from a route table and
 * a retired list. Like Next, it picks the most specific matching pattern:
 * static segments over dynamic ones, and dynamic over catch-all.
 */
export function routeResolver(
  routes: readonly RouteEntry[],
  retired: readonly string[],
): ResolveRoute {
  return (profile, pathname) => {
    const segments = splitPath(pathname);
    // A path that doesn't decode is no route of ours; Next answers it.
    if (segments === null) return { status: 'unlisted' };
    if (retired.some((pattern) => rank(pattern, segments) !== null)) return { status: 'absent' };
    let best: { score: number[]; entries: RouteEntry[] } | undefined;
    for (const entry of routes) {
      const score = rank(entry.pattern, segments);
      if (score === null) continue;
      if (!best || compare(score, best.score) > 0) best = { score, entries: [entry] };
      else if (compare(score, best.score) === 0) best.entries.push(entry);
    }
    if (!best) return { status: 'unlisted' };
    for (const entry of best.entries) {
      const access = routeAccess(profile, entry);
      if (access !== 'absent') return { status: 'served', entry, access };
    }
    return { status: 'absent' };
  };
}

/** What `profile` does with a request for `pathname`. proxy.ts asks this. */
export const resolveRoute: ResolveRoute = routeResolver(ROUTES, RETIRED_PATTERNS);

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
