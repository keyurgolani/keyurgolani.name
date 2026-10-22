import type { ReactNode } from 'react';
import type { DisplayMode, MotionPolicy, PublicView } from '@portfolio/schema';
import { buildRenderInput, type RouteTarget } from '@portfolio/variant-contract';
import { ClientHostModules } from './host-modules-client';
import './host-modules';
import { loadComposition, type Composition } from './variants';

// The portfolio a document shows (#5, Slice 3, item 6, and #7, Slice 1, item
// 2): a skip link to the variant's main, then the presentation boundary,
// <div data-variant>, with the variant inside it. Public pages and previews
// both render it, so a preview shows the same tree a visitor gets. #19's
// tokens apply at the boundary, so the 404 page renders inside one too.

/**
 * The environment a preview fixes for its document (#7, Slices 1 and 4), as
 * attributes on the presentation boundary, under the names #19 keeps. A public
 * page renders in its visitor's own environment and sets none.
 */
export interface EnvironmentAttributes {
  readonly 'data-display-mode'?: DisplayMode;
  readonly 'data-contrast'?: 'system' | 'more';
  readonly 'data-motion'?: 'full' | 'reduced';
  readonly 'data-enhancement'?: 'on' | 'off';
}

/** Where a document's routes are mounted, which every internal link starts from. */
export interface LinkBase {
  /** '' for the site root, '/sample' under demo, or a preview's own prefix. */
  readonly basePath: string;
  /** The query every internal link keeps, such as /sample's `variant`. */
  readonly query?: Readonly<Record<string, string>>;
}

export interface ExperienceDocumentProps {
  /** The public view of the unit: the only content a variant gets. */
  readonly unit: PublicView;
  /** What renders for the unit's selection: its variant, or the fallback composition in its place. */
  readonly selection: Composition;
  /** A preview's fixed environment. Public pages pass none. */
  readonly environment?: EnvironmentAttributes;
  readonly linkBase: LinkBase;
  readonly route: RouteTarget;
  /** The deployment's canonical origin, PORTFOLIO_ORIGIN. */
  readonly origin: string;
  /** A path view's parent route, below the link base, which its canonical link names (#5, Slice 4). */
  readonly canonical?: string;
  /** When the request arrived. Tests pass a fixed time. */
  readonly requestTime?: Date;
}

/** The skip link, then the selected variant, or the fallback composition in its place, in its boundary. */
export async function ExperienceDocument(props: ExperienceDocumentProps) {
  const { unit, selection, linkBase } = props;
  const { manifest } = selection.rendered;
  const input = buildRenderInput({
    view: unit,
    manifest,
    route: props.route,
    basePath: linkBase.basePath,
    query: linkBase.query,
    origin: props.origin,
    requestTime: props.requestTime ?? new Date(),
  });
  const Variant = await loadComposition(manifest.id);
  return (
    <>
      {/* Renders nothing: it registers the enhancement loaders in the browser. */}
      <ClientHostModules />
      {/* React places it in the document's head. */}
      {props.canonical === undefined ? null : (
        <link rel="canonical" href={`${props.origin}${props.canonical}`} />
      )}
      <a className="host-skip-link" href={`#${input.ids.main}`} lang={hostLang(unit)}>
        Skip to content
      </a>
      <PresentationBoundary
        composition={selection}
        motionPolicy={unit.site.motionPolicy}
        environment={props.environment}
      >
        <Variant input={input} />
      </PresentationBoundary>
    </>
  );
}

/**
 * `<div data-variant="<id>">` around what renders. When the fallback
 * composition stands in, `data-requested-variant` says which variant the site
 * selected, for the owner and the tests; visitors see no label. A preview's
 * environment goes on it too.
 */
export function PresentationBoundary({
  composition,
  motionPolicy,
  environment,
  children,
}: {
  composition: Composition;
  motionPolicy: MotionPolicy;
  environment?: EnvironmentAttributes;
  children: ReactNode;
}) {
  return (
    <div
      data-variant={composition.rendered.manifest.id}
      data-requested-variant={composition.fallback ? composition.requested : undefined}
      data-motion-policy={motionPolicy}
      {...environment}
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
