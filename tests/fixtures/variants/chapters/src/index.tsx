import {
  composePages,
  renderSection,
  SHARED_SECTIONS,
  VisitorControlSlot,
  type HomePageProps,
  type ViewPageProps,
} from '@portfolio/kit/sections';
import {
  routeHref,
  type VariantRenderInput,
  type ViewDeclaration,
} from '@portfolio/variant-contract';

// A route test fixture (#5, Slice 4; K-3), which the route tests install in a
// copy of the repository and never in a release. Home lists the titled
// sections, each a link to chapters/{chapter}, which renders that one section,
// titled or not (the leak scans render every section through it), and
// back-matter lists them again with the identity. The pages come from
// composePages(): a chapter slug no section has renders the contents with a
// "No chapter by that name" note, noindex, as K-3's interim not-found has it.
// Every link goes through routeHref(), so it works at the root and under
// /sample.

const view = (input: VariantRenderInput, id: string) =>
  input.capabilities.views.find((each) => each.id === id) as ViewDeclaration;

const titled = (input: VariantRenderInput) =>
  input.portfolio.sections.filter((section) => Boolean(section.title?.trim()));

function Header({ input }: { readonly input: VariantRenderInput }) {
  return (
    <header className="fx-header">
      <nav aria-label="Chapters">
        <ul role="list">
          <li>
            <a href={routeHref(input, { route: 'home' })}>Contents</a>
          </li>
          {titled(input).map((section) => (
            <li key={section.id}>
              <a
                href={routeHref(input, {
                  route: 'view',
                  view: view(input, 'chapters'),
                  params: { chapter: section.id },
                })}
                lang={section.lang}
              >
                {section.title}
              </a>
            </li>
          ))}
          <li>
            <a
              href={routeHref(input, {
                route: 'view',
                view: view(input, 'back-matter'),
                params: {},
              })}
            >
              Back matter
            </a>
          </li>
        </ul>
      </nav>
      <VisitorControlSlot />
    </header>
  );
}

function HomePage({ input, notice }: HomePageProps) {
  return (
    <>
      <Header input={input} />
      <main id={input.ids.main} className="fx-main" tabIndex={-1}>
        <h1>{input.portfolio.identity.name}</h1>
        {notice ? (
          <p className="fx-notice" role="note" data-unknown-view={notice.view.id}>
            {notice.text}
          </p>
        ) : null}
      </main>
    </>
  );
}

function ChapterPage({ input, params }: ViewPageProps) {
  const shown = input.portfolio.sections.find((section) => section.id === params.chapter)!;
  return (
    <>
      <Header input={input} />
      <main id={input.ids.main} className="fx-main" tabIndex={-1} data-chapter={params.chapter}>
        <h1>{shown.title?.trim() || shown.id}</h1>
        {renderSection(shown, input, SHARED_SECTIONS, { level: 2 })}
      </main>
    </>
  );
}

function BackMatterPage({ input }: ViewPageProps) {
  return (
    <>
      <Header input={input} />
      <main id={input.ids.main} className="fx-main" tabIndex={-1} data-back-matter="">
        <h1>Back matter</h1>
        <p>{input.portfolio.identity.name}</p>
        <ol>
          {titled(input).map((section) => (
            <li key={section.id} lang={section.lang}>
              {section.title}
            </li>
          ))}
        </ol>
      </main>
    </>
  );
}

export default composePages({
  HomePage,
  views: {
    chapters: {
      Page: ChapterPage,
      known: (input, params) =>
        input.portfolio.sections.some((section) => section.id === params.chapter),
      unknown: 'No chapter by that name.',
    },
    'back-matter': BackMatterPage,
  },
});
