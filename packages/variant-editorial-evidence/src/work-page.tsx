import type { ReactNode } from 'react';
import { Action } from '@portfolio/appearance/primitives';
import { CaseStudy, renderContext } from '@portfolio/kit/sections';
import { routeHref, type VariantRenderInput } from '@portfolio/variant-contract';
import { Masthead } from './masthead';
import { homeModel, placementOf, routedWorkAt, type Placement } from './model';
import { homeRegion, regionId, Words } from './parts';

// A work's own page, /work/<slug> (#13): the masthead, a breadcrumb back
// through home and where the work shows there, the case study under the
// work's title as the page's one h1, and a way back to the work. Only a work
// with a case study at its slug has one, the rule #10b's route serves by, and
// the host answers any other slug with its 404 before this renders; should
// one arrive anyway, the page says so and links home.

/** Where a work's page leads back to on home: the crumb that names it, and the link back. */
interface Way {
  readonly crumb: { readonly href: string; readonly label: ReactNode } | null;
  readonly back: string;
  readonly backLabel: string;
}

function wayBack(input: VariantRenderInput, placement: Placement, workId: string): Way {
  const home = routeHref(input, { route: 'home' });
  const words = (text: string) => <Words input={input}>{text}</Words>;
  switch (placement.kind) {
    case 'plate':
      return {
        crumb: { href: homeRegion(input, regionId(input, 'work')), label: words('Selected work') },
        back: homeRegion(input, `${input.ids.prefix}${workId}`),
        backLabel: 'Back to work',
      };
    case 'archive': {
      const archive = homeRegion(input, regionId(input, 'archive'));
      return {
        crumb: { href: archive, label: words('Archive') },
        back: archive,
        backLabel: 'Back to the archive',
      };
    }
    case 'section': {
      const { section } = placement;
      const title = section.title?.trim();
      return {
        crumb: title
          ? {
              href: homeRegion(input, `${input.ids.prefix}${section.id}`),
              label: <span lang={section.lang}>{title}</span>,
            }
          : null,
        back: homeRegion(input, `${input.ids.prefix}${workId}`),
        backLabel: 'Back to work',
      };
    }
    case 'none':
      return { crumb: null, back: home, backLabel: 'Back home' };
  }
}

export function WorkPage({ input, slug }: { input: VariantRenderInput; slug: string }) {
  const { ids, portfolio } = input;
  const work = routedWorkAt(slug, portfolio);
  const model = homeModel(input);
  const home = routeHref(input, { route: 'home' });
  const placement: Placement = work ? placementOf(work, model) : { kind: 'none' };
  const way = work
    ? wayBack(input, placement, work.id)
    : { crumb: null, back: home, backLabel: 'Back home' };
  const hasWork = model.signature !== undefined || model.flagships.length > 0;
  const destinations = [
    ...(hasWork ? [{ label: 'Selected work', id: regionId(input, 'work'), ui: true }] : []),
    ...(model.archive.length > 0
      ? [{ label: 'Archive', id: regionId(input, 'archive'), ui: true }]
      : []),
  ];
  const ctx = renderContext(input, { id: work?.id ?? 'work', lang: work?.lang }, 1);
  const crumbs = regionId(input, 'breadcrumb');
  return (
    <>
      <Masthead input={input} destinations={destinations} />
      <main id={ids.main} className="ee-main ee-work-page" tabIndex={-1}>
        <nav className="ee-breadcrumb" aria-labelledby={crumbs}>
          <span id={crumbs} hidden>
            <Words input={input}>Breadcrumb</Words>
          </span>
          <ol role="list">
            <li>
              <a href={home}>
                <Words input={input}>Home</Words>
              </a>
            </li>
            {way.crumb ? (
              <li>
                <a href={way.crumb.href}>{way.crumb.label}</a>
              </li>
            ) : null}
            <li>
              <span aria-current="page" lang={work?.lang}>
                {work ? work.title : <Words input={input}>Not found</Words>}
              </span>
            </li>
          </ol>
        </nav>
        {work ? (
          <CaseStudy work={work} ctx={ctx} level={1} />
        ) : (
          <h1 className="ee-work-page__missing" data-type-role="headline">
            <Words input={input}>This work isn&apos;t here</Words>
          </h1>
        )}
        <p className="ee-work-page__back">
          <Action href={way.back} emphasis="quiet">
            <Words input={input}>{way.backLabel}</Words>
          </Action>
        </p>
      </main>
    </>
  );
}
