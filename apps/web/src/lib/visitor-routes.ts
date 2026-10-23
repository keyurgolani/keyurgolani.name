import { routedSlugs, type PublicView } from '@portfolio/schema';
import {
  dispatch,
  href,
  isReservedSegment,
  type RouteTarget,
  type VariantRegistry,
} from '@portfolio/variant-contract';
import { compositionFor, REGISTRY, type Composition } from './variants';

// What a visitor's path is (#5, Slice 4). Every visitor page asks here: `/`,
// a variant's path views under it, `/work/<slug>` and the views under that,
// and `/sample` with everything below it. dispatch() decides against the
// composition that renders, so a view of the site's variant renders, a path
// only another installed variant declares redirects to its canonical route,
// and anything else is missing. A work route, and everything under it,
// exists only for a slug the view routes (#10b): a public work with a case
// study that something visible reaches.

/** A request for a visitor page. */
export interface VisitorPath {
  /** The path below `basePath`, as segments: a catch-all route's params. */
  readonly segments: readonly string[];
  /**
   * Where the routes are mounted: '' at the site root, '/sample' under demo,
   * and a preview frame's grant path (#7).
   */
  readonly basePath: '' | '/sample' | `/preview/${string}`;
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
      /** A path view's parent route, below `basePath`, which its canonical link names. */
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
  if (target.route !== 'view') return { kind: 'render', view, composition, target };
  // A view is canonical to its parent route.
  const parent: RouteTarget =
    target.slug === undefined ? { route: 'home' } : { route: 'work', slug: target.slug };
  return {
    kind: 'render',
    view,
    composition,
    target,
    canonical: href(parent, { basePath: path.basePath, query: path.query }),
  };
}
