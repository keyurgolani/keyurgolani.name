import { renderSection, VisitorControlSlot } from '@portfolio/kit/sections';
import {
  routeHref,
  type VariantRenderInput,
  type ViewDeclaration,
} from '@portfolio/variant-contract';

// A route test fixture (#5, Slice 4), which the route tests install in a copy
// of the repository and never in a release. Home renders every section, and
// notes lists their titles on a page of its own.

export default function Notes({ input }: { readonly input: VariantRenderInput }) {
  const { portfolio, ids, route } = input;
  const notes = input.capabilities.views.find((view) => view.id === 'notes') as ViewDeclaration;
  const onNotes = route.route === 'view' && route.view.id === 'notes';
  return (
    <>
      <header className="fx-header">
        <nav aria-label="Pages">
          <ul role="list">
            <li>
              <a href={routeHref(input, { route: 'home' })}>Home</a>
            </li>
            <li>
              <a href={routeHref(input, { route: 'view', view: notes, params: {} })}>Notes</a>
            </li>
          </ul>
        </nav>
        <VisitorControlSlot />
      </header>
      <main id={ids.main} className="fx-main" tabIndex={-1} data-page={onNotes ? 'notes' : 'home'}>
        <h1>{onNotes ? 'Notes' : portfolio.identity.name}</h1>
        {onNotes ? (
          <ul>
            {portfolio.sections
              .filter((section) => Boolean(section.title?.trim()))
              .map((section) => (
                <li key={section.id} lang={section.lang}>
                  {section.title}
                </li>
              ))}
          </ul>
        ) : (
          portfolio.sections.map((section) => renderSection(section, input, {}, { level: 2 }))
        )}
      </main>
    </>
  );
}
