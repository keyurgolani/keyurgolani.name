import type { ComponentType } from 'react';
import type { VariantRenderInput, ViewDeclaration } from '@portfolio/variant-contract';
import { caseStudyOutline, pageOutline, type CaseStudyOutline, type PageOutline } from './outline';
import type { VariantComponent } from './types';
import type { RoutedWork } from './view';

// A composition's pages (stream E): the home page, a work's own page,
// /work/<slug>, for a composition whose manifest says `routes.work: bespoke`,
// and a page of its own for each view under home it names (K-3), such as
// Chapters' `chapters/{chapter}` and `back-matter`. composePages() makes the
// `.` export from them, so the composition owns every page's markup and gets
// each page's outline with it. A view it names no page for renders the home
// page, as before (Cinema's `list`).

export interface HomePageProps {
  readonly input: VariantRenderInput;
  readonly outline: PageOutline;
  /**
   * Set when the route is a view under home whose parameters name nothing
   * the composition has, such as a chapter slug no chapter takes (K-3): the
   * home page renders with this note where the visitor will read it first,
   * and the page is noindex. Until the contract has a view-level not-found.
   */
  readonly notice?: ViewNotice;
}

/** What an unknown view's home page says, and which view and parameters it was asked for. */
export interface ViewNotice {
  readonly view: ViewDeclaration;
  readonly params: Readonly<Record<string, string>>;
  /** The note, such as "No chapter by that name." */
  readonly text: string;
}

export interface CaseStudyPageProps {
  readonly input: VariantRenderInput;
  /** The work the route names, with its case study and slug. */
  readonly work: RoutedWork;
  readonly outline: CaseStudyOutline;
}

/** A view's own page (K-3): the view the route names, and its parameters, such as `{ chapter: 'early-years' }`. */
export interface ViewPageProps {
  readonly input: VariantRenderInput;
  readonly outline: PageOutline;
  readonly view: ViewDeclaration;
  readonly params: Readonly<Record<string, string>>;
}

/**
 * A view's page, and, for a view with parameters, which values it has: a
 * value `known` says no to renders the home page with `unknown`'s note,
 * noindex, never a page for nothing.
 */
export interface ViewPage {
  readonly Page: ComponentType<ViewPageProps>;
  readonly known?: (input: VariantRenderInput, params: Readonly<Record<string, string>>) => boolean;
  /** The note for a value `known` refuses: "No <view id> by that name." by default. */
  readonly unknown?: string;
}

/** The home page: the reading order, and any view under home it has no page of its own for. */
export interface HomeComposition {
  readonly HomePage: ComponentType<HomePageProps>;
}

/** A work's own page, for a manifest whose `routes.work` is `bespoke`. */
export interface CaseStudyComposition {
  readonly CaseStudyPage: ComponentType<CaseStudyPageProps>;
}

/** The views under home with pages of their own, by view id (K-3): a page, or a page and the values it has. */
export interface ViewsComposition {
  readonly views: Readonly<Record<string, ComponentType<ViewPageProps> | ViewPage>>;
}

const pageOf = (entry: ComponentType<ViewPageProps> | ViewPage): ViewPage =>
  typeof entry === 'function' ? { Page: entry } : (entry as ViewPage);

/**
 * The composition's `.` export from its pages. On a work's own page it
 * renders CaseStudyPage, when the composition has one and the route names a
 * work the view routes. On a view under home it has a page for, that page,
 * or, for parameters the page doesn't know, the home page with its note,
 * noindex. Everywhere else it renders HomePage, as a composition whose
 * manifest leaves the work route to the host does today.
 */
export function composePages(
  pages: HomeComposition & Partial<CaseStudyComposition> & Partial<ViewsComposition>,
): VariantComponent {
  const { HomePage, CaseStudyPage, views = {} } = pages;
  const viewPage = (route: VariantRenderInput['route']) =>
    route.route === 'view' && route.view.under === 'home' && Object.hasOwn(views, route.view.id)
      ? pageOf(views[route.view.id]!)
      : null;
  function Composition({ input }: { readonly input: VariantRenderInput }) {
    const outline = CaseStudyPage && input.route.route === 'work' ? caseStudyOutline(input) : null;
    if (CaseStudyPage && outline) {
      return <CaseStudyPage input={input} work={outline.work} outline={outline} />;
    }
    const { route } = input;
    const entry = viewPage(route);
    if (route.route === 'view' && entry) {
      if (!entry.known || entry.known(input, route.params)) {
        return (
          <entry.Page
            input={input}
            outline={pageOutline(input)}
            view={route.view}
            params={route.params}
          />
        );
      }
      const notice: ViewNotice = {
        view: route.view,
        params: route.params,
        text: entry.unknown ?? `No ${route.view.id} by that name.`,
      };
      return (
        <>
          {/* React hoists it into the document's head: the page is the home page's, under a URL that names nothing. */}
          <meta name="robots" content="noindex" />
          <HomePage input={input} outline={pageOutline(input)} notice={notice} />
        </>
      );
    }
    return <HomePage input={input} outline={pageOutline(input)} />;
  }
  // The host asks before it renders: a noindex note names no canonical.
  Composition.unknownView = (input: VariantRenderInput): boolean => {
    const { route } = input;
    if (route.route !== 'view') return false;
    const entry = viewPage(route);
    return Boolean(entry?.known && !entry.known(input, route.params));
  };
  return Composition;
}
