import type { ReactNode } from 'react';
import { renderContext, type RenderContext } from '@portfolio/kit/sections';
import { routeHref, type VariantRenderInput } from '@portfolio/variant-contract';

// What the composition's own pieces share: its region ids, the language of
// the words it adds, and links home.

/**
 * The id of one of the composition's own regions. Two hyphens: no content
 * id has them, so no section or record can take one.
 */
export const regionId = (input: Pick<VariantRenderInput, 'ids'>, name: string) =>
  `${input.ids.prefix}ee--${name}`;

/** `en` when the portfolio isn't in English, for the words the composition adds, such as Work. */
export function uiLang(input: Pick<VariantRenderInput, 'portfolio'>): 'en' | undefined {
  return /^en(?:-|$)/i.test(input.portfolio.locale) ? undefined : 'en';
}

/** A word or phrase the composition adds, marked English in a portfolio in another language. */
export function Words({
  input,
  children,
}: {
  input: Pick<VariantRenderInput, 'portfolio'>;
  children: string;
}) {
  const lang = uiLang(input);
  return lang ? <span lang={lang}>{children}</span> : <>{children}</>;
}

/** Where a region of the home page is, from any route: a fragment on home, or home and the fragment. */
export function homeRegion(input: VariantRenderInput, id: string): string {
  if (input.route.route === 'home') return `#${id}`;
  const home = routeHref(input, { route: 'home' });
  return `${home}#${id}`;
}

/** A render context for the composition's own regions, named `title` in the content's language. */
export function regionContext(
  input: VariantRenderInput,
  id: string,
  level: 1 | 2 | 3,
  lang?: string,
): RenderContext {
  return renderContext(input, { id, lang, title: 'region' }, level);
}

/** A labelled region of the page, its heading at h2 unless it says otherwise. */
export function Region({
  id,
  headingId,
  heading,
  className,
  children,
}: {
  id: string;
  headingId: string;
  heading: ReactNode;
  className: string;
  children: ReactNode;
}) {
  return (
    <section id={id} className={className} aria-labelledby={headingId}>
      <h2 id={headingId} className="ee-region__label" data-type-role="label">
        {heading}
      </h2>
      {children}
    </section>
  );
}
