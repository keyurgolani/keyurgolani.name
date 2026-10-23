import type { ComponentType, ReactNode } from 'react';
import type { VariantComponent } from '@portfolio/kit/sections';
import type { MotionPolicy, PublicView } from '@portfolio/schema';
import { buildRenderInput, type RouteTarget } from '@portfolio/variant-contract';
import './host-modules';
import type { EnvironmentAttributes } from './preview-environment';
import { variantStylesheet, type Composition } from './variants';

// The portfolio a document shows (#5, Slice 3, item 6, and #7, Slice 1, item
// 2): a skip link to the variant's main, then the presentation boundary,
// <div data-variant>, with the variant inside it. Public pages and previews
// both render it, so a preview shows the same tree a visitor gets. #19's
// tokens apply at the boundary, so the 404 page renders inside one too. The
// boundary links the stylesheet of the variant it renders and no other, and
// the variant comes from the loader its caller passes, never from a module
// that can load every variant (#6, Slice 2): a visitor page's is its
// experience segment's own.

/** Loads one variant's component: the import() registry generation wrote for it. */
export type VariantLoader = () => Promise<{ readonly default: VariantComponent }>;

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
  /** Loads the component of `selection`'s rendered variant, and no other. */
  readonly load: VariantLoader;
  /**
   * The client module that registers the host's modules in the browser,
   * rendering nothing: an experience segment's own, which names only its
   * variant's enhancements, or lib/host-modules-client.tsx's, which names
   * every variant's, for the routes that render any of them.
   */
  readonly hostModules: ComponentType;
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
  /**
   * The nonce of the request's Content-Security-Policy, where it has one: a
   * preview frame's (#7), whose policy wants it on every stylesheet, the
   * variant's compiled one among them (#6, Slice 2).
   */
  readonly nonce?: string;
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
  const Variant = (await props.load()).default;
  const HostModules = props.hostModules;
  return (
    <>
      {/* Renders nothing: it registers the enhancement loaders in the browser. */}
      <HostModules />
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
        nonce={props.nonce}
      >
        <Variant input={input} />
      </PresentationBoundary>
    </>
  );
}

/**
 * `<div data-variant="<id>">` around what renders, after the compiled
 * stylesheet of the variant that renders (#6, Slice 2), which React hoists
 * into the head as a stylesheet resource: once, however many boundaries
 * share it, and shown only once it has loaded. When the fallback composition
 * stands in, `data-requested-variant` says which variant the site selected,
 * for the owner and the tests; visitors see no label. A preview's
 * environment goes on it too, and under a policy with a nonce, the nonce
 * goes on the stylesheet.
 */
export function PresentationBoundary({
  composition,
  motionPolicy,
  environment,
  nonce,
  children,
}: {
  composition: Composition;
  motionPolicy: MotionPolicy;
  environment?: EnvironmentAttributes;
  nonce?: string;
  children: ReactNode;
}) {
  const stylesheet = variantStylesheet(composition.rendered.manifest.id);
  return (
    <>
      {stylesheet ? (
        <link rel="stylesheet" href={stylesheet} precedence="variant" nonce={nonce} />
      ) : null}
      <div
        data-variant={composition.rendered.manifest.id}
        data-requested-variant={composition.fallback ? composition.requested : undefined}
        data-motion-policy={motionPolicy}
        {...environment}
      >
        {children}
      </div>
    </>
  );
}

/** The host's own words are English: marked so inside a portfolio in another language. */
export function hostLang(view: Pick<PublicView, 'portfolio'>): 'en' | undefined {
  const locale = view.portfolio.locale.toLowerCase();
  return locale === 'en' || locale.startsWith('en-') ? undefined : 'en';
}
