// The page a Studio preview frame shows (the Studio mockup's page switch),
// for both Studios: Demo Studio's frame loads it by path, Owner Studio's
// navigates to it over #7's channel. Plain data, so neither Studio imports
// the other's code.

/**
 * The page a preview frame shows (the Studio mockup's page switch): Home,
 * Home at its Work section, or a case study by its slug, keeping the
 * selection. Every composition renders all three, the Work section by the
 * fixed `work` id.
 */
export type FramePage =
  | { readonly kind: 'home' }
  | { readonly kind: 'work' }
  | { readonly kind: 'case'; readonly slug: string };

export const HOME_PAGE: FramePage = Object.freeze({ kind: 'home' });

/** The frame route a page is, as #7's navigate message and a frame's own route name it. */
export function pageRoute(page: FramePage): string {
  return page.kind === 'case' ? `/work/${encodeURIComponent(page.slug)}` : '/';
}

/** Which page a frame's route is: a case study under /work, else Home. */
export function pageOfRoute(route: string): FramePage['kind'] {
  return /^\/work\/[^/]+/.test(route) ? 'case' : 'home';
}

/**
 * The case study a page switch opens: the portfolio's signature work, else
 * its first work with a case study and a slug, or null when it has none.
 */
export function caseStudySlug(portfolio: unknown): string | null {
  const model = (portfolio ?? {}) as {
    readonly signature?: unknown;
    readonly works?: readonly {
      readonly id?: unknown;
      readonly slug?: unknown;
      readonly caseStudy?: unknown;
    }[];
  };
  const works = Array.isArray(model.works) ? model.works : [];
  const withCase = works.filter(
    (work) => typeof work.slug === 'string' && work.slug !== '' && work.caseStudy !== undefined,
  );
  const signature = withCase.find((work) => work.id === model.signature);
  const slug = (signature ?? withCase[0])?.slug;
  return typeof slug === 'string' ? slug : null;
}
