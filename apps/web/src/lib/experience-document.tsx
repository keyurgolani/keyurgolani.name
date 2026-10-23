import type { ComponentType, ReactNode } from 'react';
import type { VariantComponent } from '@portfolio/kit/sections';
import type { PublicView } from '@portfolio/schema';
import type { ResolvedAppearance } from '@portfolio/appearance';
import { PresentationBoundary } from '@portfolio/appearance/react';
import { buildRenderInput, type RouteTarget } from '@portfolio/variant-contract';
import './host-modules';
import { APPEARANCE_STYLESHEETS } from './appearance-registry';
import { variantStylesheet, type Composition } from './variants';
import { VisitorControlProvider, type VisitorControlValue } from './visitor-control';

// The portfolio a document shows (#5, Slice 3, item 6, and #7, Slice 1, item
// 2): #19's document boundary, which resolveAppearance() decided for the
// page (lib/document-appearance.ts), with its skip link to the variant's
// main and the variant inside it. Public pages and previews both render it,
// so a preview shows the same tree a visitor gets, and the 404 page renders
// inside one too. The boundary links the platform stylesheet and the
// selected packs' and no others, and the stylesheet of the variant it
// renders and no other, and
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
  /** What the document boundary renders: lib/document-appearance.ts's answer for this page. */
  readonly appearance: ResolvedAppearance;
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
  /** The visitor control's model and the page's path, on a visitor page (#19, Slice 4). A preview has none. */
  readonly control?: VisitorControlValue;
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
      <DocumentBoundary
        appearance={props.appearance}
        main={input.ids.main}
        lang={hostLang(unit)}
        nonce={props.nonce}
        control={props.control}
      >
        <Variant input={input} />
      </DocumentBoundary>
    </>
  );
}

/**
 * #19's document boundary around what renders (#19, Slice 4): its skip link
 * to the variant's main, its attributes, and the platform's and the
 * selected packs' stylesheets, after the compiled stylesheet of the variant
 * that renders (#6, Slice 2). React hoists each into the head as a
 * stylesheet resource: once, however many boundaries share it, and shown
 * only once it has loaded. When an axis falls back, such as the fallback
 * composition standing in, data-appearance-fallback and
 * data-requested-<axis> say what the site selected, for the owner and the
 * tests; visitors see no label. Under a policy with a nonce, the nonce goes
 * on every stylesheet.
 */
export function DocumentBoundary({
  appearance,
  main,
  lang,
  nonce,
  control,
  children,
}: {
  appearance: ResolvedAppearance;
  /** The id of the variant's main, which the skip link goes to. */
  main: string;
  /** The skip link's language, when the portfolio's isn't English. */
  lang?: string;
  nonce?: string;
  /** What the slot's visitor control shows, where the page has one. */
  control?: VisitorControlValue;
  children: ReactNode;
}) {
  const stylesheet = variantStylesheet(appearance.selection.variant);
  return (
    <>
      {stylesheet ? (
        <link rel="stylesheet" href={stylesheet} precedence="variant" nonce={nonce} />
      ) : null}
      <PresentationBoundary
        kind="document"
        appearance={appearance}
        ids={{ prefix: '', main }}
        stylesheets={APPEARANCE_STYLESHEETS}
        skipLink={{ label: 'Skip to content', ...(lang ? { lang } : {}) }}
        {...(nonce ? { nonce } : {})}
      >
        {control ? (
          <VisitorControlProvider value={control}>{children}</VisitorControlProvider>
        ) : (
          children
        )}
      </PresentationBoundary>
    </>
  );
}

/** The host's own words are English: marked so inside a portfolio in another language. */
export function hostLang(view: Pick<PublicView, 'portfolio'>): 'en' | undefined {
  const locale = view.portfolio.locale.toLowerCase();
  return locale === 'en' || locale.startsWith('en-') ? undefined : 'en';
}
