import type { CaseStudy as CaseStudyFields, Work } from '@portfolio/schema';
import { Action } from '@portfolio/appearance/primitives';
import { CaseStudy, renderContext, WorkEntry } from '@portfolio/kit/sections';
import { routeHref, type VariantRenderInput } from '@portfolio/variant-contract';
import { Masthead } from './masthead';
import { homeModel, workAt } from './model';
import { homeRegion, regionId, Words } from './parts';

// A work's own page, /work/<slug> (#13): the masthead, a breadcrumb back
// through home and Work, then the case study under the work's title as the
// page's one h1, or, for a work with a slug and no case study, the work as
// its entry shows it. A way back to the work follows it. The host answers a
// slug no public work has with its 404 before this renders; should one
// arrive anyway, the page says so and links home.

const hasStudy = (work: Work): work is Work & { readonly caseStudy: CaseStudyFields } =>
  work.caseStudy !== undefined;

export function WorkPage({ input, slug }: { input: VariantRenderInput; slug: string }) {
  const { ids, portfolio } = input;
  const work = workAt(slug, portfolio);
  const model = homeModel(input);
  const home = routeHref(input, { route: 'home' });
  const workRegion = regionId(input, 'work');
  // Back to the work's plate when it has one, else to the Work region, else home.
  const plated =
    work && (model.signature?.id === work.id || model.flagships.some(({ id }) => id === work.id));
  const hasWork = model.signature !== undefined || model.flagships.length > 0;
  const back = plated
    ? homeRegion(input, `${ids.prefix}${work.id}`)
    : hasWork
      ? homeRegion(input, workRegion)
      : home;
  const destinations = [
    ...(hasWork ? [{ label: 'Selected work', id: workRegion, ui: true }] : []),
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
            {hasWork ? (
              <li>
                <a href={homeRegion(input, workRegion)}>
                  <Words input={input}>Selected work</Words>
                </a>
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
          hasStudy(work) ? (
            <CaseStudy work={work} ctx={ctx} level={1} />
          ) : (
            <ul className="pf-list ee-work-page__entry" role="list">
              <WorkEntry work={work} ctx={ctx} />
            </ul>
          )
        ) : (
          <h1 className="ee-work-page__missing" data-type-role="headline">
            <Words input={input}>This work isn&apos;t here</Words>
          </h1>
        )}
        <p className="ee-work-page__back">
          <Action href={back} emphasis="quiet">
            <Words input={input}>{work && hasWork ? 'Back to work' : 'Back home'}</Words>
          </Action>
        </p>
      </main>
    </>
  );
}
