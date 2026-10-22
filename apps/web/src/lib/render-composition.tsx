import type { ReactNode } from 'react';
import type { MotionPolicy, PublicView } from '@portfolio/schema';
import { buildRenderInput, type RouteTarget } from '@portfolio/variant-contract';
import './host-modules';
import { loadComposition, type Composition } from './variants';

// The page around a variant (#5, Slice 3, item 6): a skip link to the
// variant's main, then the presentation boundary, <div data-variant>, with
// the variant inside it. #19's tokens apply at the boundary, so the 404 page
// renders inside one too.

export interface CompositionPage {
  /** The public view of the pair: the only content a variant gets. */
  readonly view: PublicView;
  /** What renders: the selection, or the fallback composition in its place. */
  readonly composition: Composition;
  readonly route: RouteTarget;
  /** Where the routes are mounted: '' for the site root, '/sample' under demo. */
  readonly basePath: string;
  /** The query every internal link keeps, such as /sample's `variant`. */
  readonly query?: Readonly<Record<string, string>>;
  /** The deployment's canonical origin, PORTFOLIO_ORIGIN. */
  readonly origin: string;
  /** A path view's parent route, below `basePath`, which its canonical link names (#5, Slice 4). */
  readonly canonical?: string;
  /** When the request arrived. Tests pass a fixed time. */
  readonly requestTime?: Date;
}

/** The skip link, then the selected variant, or the fallback composition in its place, in its boundary. */
export async function renderComposition(page: CompositionPage) {
  const { view, composition } = page;
  const { manifest } = composition.rendered;
  const input = buildRenderInput({
    view,
    manifest,
    route: page.route,
    basePath: page.basePath,
    query: page.query,
    origin: page.origin,
    requestTime: page.requestTime ?? new Date(),
  });
  const Variant = await loadComposition(manifest.id);
  return (
    <>
      {/* React places it in the document's head. */}
      {page.canonical === undefined ? null : (
        <link rel="canonical" href={`${page.origin}${page.canonical}`} />
      )}
      <a className="host-skip-link" href={`#${input.ids.main}`} lang={hostLang(view)}>
        Skip to content
      </a>
      <PresentationBoundary composition={composition} motionPolicy={view.site.motionPolicy}>
        <Variant input={input} />
      </PresentationBoundary>
    </>
  );
}

/**
 * `<div data-variant="<id>">` around what renders. When the fallback
 * composition stands in, `data-requested-variant` says which variant the site
 * selected, for the owner and the tests; visitors see no label.
 */
export function PresentationBoundary({
  composition,
  motionPolicy,
  children,
}: {
  composition: Composition;
  motionPolicy: MotionPolicy;
  children: ReactNode;
}) {
  return (
    <div
      data-variant={composition.rendered.manifest.id}
      data-requested-variant={composition.fallback ? composition.requested : undefined}
      data-motion-policy={motionPolicy}
    >
      {children}
    </div>
  );
}

/** The host's own words are English: marked so inside a portfolio in another language. */
export function hostLang(view: Pick<PublicView, 'portfolio'>): 'en' | undefined {
  const locale = view.portfolio.locale.toLowerCase();
  return locale === 'en' || locale.startsWith('en-') ? undefined : 'en';
}
