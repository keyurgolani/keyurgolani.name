import { routedSlugs, type PublicView } from '@portfolio/schema';
import {
  dispatch,
  FALLBACK_ID,
  href,
  isReservedSegment,
  type RouteTarget,
  type VariantRegistry,
} from '@portfolio/variant-contract';
import { compositionFor, REGISTRY, type Composition } from './variants';
import { rendersWorkPage } from './work-page';

// What a visitor's path is (#5, Slice 4). Every visitor page asks here: `/`,
// a variant's path views under it, `/work/<slug>` and the views under that,
// and `/sample` with everything below it. dispatch() decides against the
// composition that renders, so a view of the site's variant renders, a path
// only another installed variant declares redirects to its canonical route,
// and anything else is missing. A work route, and everything under it,
// exists only for a slug the view routes (#10b): a public work with a case
// study that something visible reaches. A work's own page renders in the
// fallback composition when the composition leaves that page to the host
// (lib/work-page.ts).

/** A request for a visitor page. */
export interface VisitorPath {
  /** The path below `basePath`, as segments: a catch-all route's params. */
  readonly segments: readonly string[];
  /**
   * Where the routes are mounted: '' at the site root, '/sample' and the
   * read-only reference's '/reference' under demo (#9), and a preview
   * frame's grant path (#7).
   */
  readonly basePath: '' | '/sample' | '/reference' | `/preview/${string}`;
  /** The query every internal link and redirect keeps, such as /sample's `variant`. */
  readonly query?: Readonly<Record<string, string>>;
  /** The variant to render in place of the site's selection, as /sample's `?variant=` names one. */
  readonly selected?: string;
}

export type VisitorRoute =
  | {
      readonly kind: 'render';
      readonly view: PublicView;
      readonly composition: Composition;
      readonly target: RouteTarget;
      /**
       * The path the page's canonical link and og:url name (#22): the route
       * itself at the site root, a path view's parent route below `basePath`,
       * and none for a route of /sample or a preview frame.
       */
      readonly canonical?: string;
    }
  /** A 307 to the canonical route of a view only another installed variant declares. */
  | { readonly kind: 'redirect'; readonly location: string }
  | { readonly kind: 'not-found' };

const NOT_FOUND = { kind: 'not-found' } as const;

/**
 * Which route `path` is, against the public view `load` returns. A path
 * whose first segment the host owns, such as /api or /_next, is never a
 * view, so it's missing before anything loads.
 */
export async function resolveVisitorPath(
  path: VisitorPath,
  load: () => Promise<PublicView>,
  registry: VariantRegistry = REGISTRY,
): Promise<VisitorRoute> {
  const [first] = path.segments;
  if (first !== undefined && first !== 'work' && isReservedSegment(first)) {
    return NOT_FOUND;
  }
  const view = await load();
  const composition = compositionFor(path.selected ?? view.site.appearance.variant, registry);
  const result = dispatch({
    segments: path.segments,
    manifest: composition.rendered.manifest,
    installed: registry.map(({ manifest }) => manifest),
    toggles: view.site.routes,
    basePath: path.basePath,
    query: path.query,
  });
  // A work, its views, and a redirect to one exist only for a slug the view
  // routes: never a private work's, an unknown one, or an unreached one's.
  if (first === 'work' && !routedSlugs(view).has(path.segments[1] ?? '')) return NOT_FOUND;
  if (result.kind !== 'render') return result;
  const { target } = result;
  // A route on the live site is its own canonical, with no query (#22): `/`
  // and `/work/<slug>`. /sample and a preview frame aren't the live site's,
  // so they name none.
  const canonical = path.basePath === '' ? { canonical: href(target) } : {};
  if (target.route === 'work' && !rendersWorkPage(composition.rendered.manifest)) {
    // The selection stays the site's; only what renders the page changes.
    const fallback = { ...compositionFor(FALLBACK_ID, registry), requested: composition.requested };
    return { kind: 'render', view, composition: fallback, target, ...canonical };
  }
  if (target.route !== 'view') return { kind: 'render', view, composition, target, ...canonical };
  // A view is canonical to its parent route, at the site root alone: a view
  // under /sample or a preview frame names none, as its parent doesn't.
  if (path.basePath !== '') return { kind: 'render', view, composition, target };
  const parent: RouteTarget =
    target.slug === undefined ? { route: 'home' } : { route: 'work', slug: target.slug };
  return { kind: 'render', view, composition, target, canonical: href(parent) };
}
