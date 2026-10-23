import type { ReactElement } from 'react';
import type { Section } from '@portfolio/schema';
import {
  CaseStudy,
  renderContext,
  renderSection,
  routedWork,
  VisitorControlSlot,
  type RoutedWork,
} from '@portfolio/kit/sections';
import { routeHref, type VariantRenderInput } from '@portfolio/variant-contract';

// The fallback composition (#5): every visible section in content order, in
// one column, each through the kit's shared renderers. The host renders it
// in place of a variant this build doesn't register, and for the contract
// fixtures and #19's matrices; a site can't select it. It owns composition
// alone: no color, type, or motion of its own, and no theme toggle. On a
// work's route (#10b) it renders that work's case study, through the kit's
// shared CaseStudy, as its manifest's `routes.work: shared` says, with a
// link back home.

/** A section with a title the navigation can name. The hero and a call to action stand apart. */
const NAMED = (section: Section) =>
  section.kind !== 'hero' && section.kind !== 'cta' && Boolean(section.title?.trim());

/** A work's own page: its case study, the page's one h1, and the way home. */
function WorkPage({
  input,
  work,
}: {
  readonly input: VariantRenderInput;
  readonly work: RoutedWork;
}) {
  const { portfolio, ids } = input;
  const ctx = renderContext(input, { id: work.id, lang: work.lang, title: undefined }, 1);
  return (
    <>
      <header className="fc-header">
        <nav className="fc-nav">
          <a href={routeHref(input, { route: 'home' })}>{portfolio.identity.name}</a>
        </nav>
        <VisitorControlSlot />
      </header>
      <main id={ids.main} className="fc-main" tabIndex={-1}>
        <CaseStudy work={work} ctx={ctx} level={1} />
      </main>
    </>
  );
}

export default function FallbackComposition({ input }: { readonly input: VariantRenderInput }) {
  const work = routedWork(input);
  if (work) return <WorkPage input={input} work={work} />;
  const { portfolio, ids } = input;
  // The page's one h1 comes before any section's h2: a hero that renders
  // first carries it, and otherwise the identity's name does, above the
  // sections, every hero among them at h2.
  let heroLeads = false;
  let rendered = false;
  const sections: { section: Section; element: ReactElement }[] = [];
  for (const section of portfolio.sections) {
    const leads = !rendered && section.kind === 'hero';
    const element = renderSection(section, input, {}, { level: leads ? 1 : 2 });
    if (element === null) continue;
    heroLeads ||= leads;
    rendered = true;
    sections.push({ section, element });
  }
  const named = sections.filter(({ section }) => NAMED(section));
  // The host's own words are English, marked so in a portfolio in another language.
  const uiLang = /^en(?:-|$)/i.test(portfolio.locale) ? undefined : 'en';
  // Two hyphens: no content id has them, so none can take this one.
  const label = `${ids.prefix}fc--sections`;
  return (
    <>
      <header className="fc-header">
        {named.length > 0 ? (
          // #19's navigation primitive's markup, its slots, which the platform
          // stylesheet styles and sizes: each link a target of 24 by 24 CSS px,
          // and 32 by 32 at 768 px wide and below. Written out rather than
          // through <Navigation>, a client component, so the composition stays
          // a server module that loads anywhere the host checks it.
          <nav
            className="fc-nav"
            data-ui-slot="navigation"
            data-orientation="horizontal"
            aria-labelledby={label}
          >
            <span id={label} lang={uiLang} hidden>
              Sections
            </span>
            <ul data-ui-slot="navigation.list">
              {named.map(({ section }) => (
                <li key={section.id} data-ui-slot="navigation.item">
                  <a
                    data-ui-slot="navigation.link"
                    href={`#${ids.prefix}${section.id}`}
                    lang={section.lang}
                  >
                    {section.title}
                  </a>
                </li>
              ))}
            </ul>
          </nav>
        ) : null}
        <VisitorControlSlot />
      </header>
      {/* Focusable, so the host's skip link moves focus here, not only the view. */}
      <main id={ids.main} className="fc-main" tabIndex={-1}>
        {heroLeads ? null : <h1 className="fc-name">{portfolio.identity.name}</h1>}
        {sections.map(({ element }) => element)}
      </main>
    </>
  );
}
