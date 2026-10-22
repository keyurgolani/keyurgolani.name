import { renderSection, VisitorControlSlot } from '@portfolio/kit/sections';
import {
  routeHref,
  type VariantRenderInput,
  type ViewDeclaration,
} from '@portfolio/variant-contract';

// A route test fixture (#5, Slice 4), which the route tests install in a copy
// of the repository and never in a release. Home lists the titled sections,
// each a link to chapters/{chapter}, which renders that one section. Every
// link goes through routeHref(), so it works at the root and under /sample.

export default function Chapters({ input }: { readonly input: VariantRenderInput }) {
  const { portfolio, ids, route } = input;
  const chapters = input.capabilities.views.find(
    (view) => view.id === 'chapters',
  ) as ViewDeclaration;
  const titled = portfolio.sections.filter((section) => Boolean(section.title?.trim()));
  const chapter =
    route.route === 'view' && route.view.id === 'chapters' ? route.params.chapter : undefined;
  const shown =
    chapter === undefined
      ? undefined
      : portfolio.sections.find((section) => section.id === chapter);
  const heading =
    chapter === undefined ? portfolio.identity.name : (shown?.title ?? 'No such chapter');
  return (
    <>
      <header className="fx-header">
        <nav aria-label="Chapters">
          <ul role="list">
            <li>
              <a href={routeHref(input, { route: 'home' })}>Contents</a>
            </li>
            {titled.map((section) => (
              <li key={section.id}>
                <a
                  href={routeHref(input, {
                    route: 'view',
                    view: chapters,
                    params: { chapter: section.id },
                  })}
                  lang={section.lang}
                >
                  {section.title}
                </a>
              </li>
            ))}
          </ul>
        </nav>
        <VisitorControlSlot />
      </header>
      <main id={ids.main} className="fx-main" tabIndex={-1} data-chapter={chapter}>
        <h1>{heading}</h1>
        {shown ? renderSection(shown, input, {}, { level: 2 }) : null}
      </main>
    </>
  );
}
