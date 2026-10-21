import type { ReactElement } from 'react';
import type { Section } from '@portfolio/schema';
import { renderSection, VisitorControlSlot } from '@portfolio/kit/sections';
import type { VariantRenderInput } from '@portfolio/variant-contract';

// The fallback composition (#5): every visible section in content order, in
// one column, each through the kit's shared renderers. The host renders it
// in place of a variant this build doesn't register, and for the contract
// fixtures and #19's matrices; a site can't select it. It owns composition
// alone: no color, type, or motion of its own, and no theme toggle.

/** A section with a title the navigation can name. The hero and a call to action stand apart. */
const NAMED = (section: Section) =>
  section.kind !== 'hero' && section.kind !== 'cta' && Boolean(section.title?.trim());

export default function FallbackComposition({ input }: { readonly input: VariantRenderInput }) {
  const { portfolio, ids } = input;
  // The first hero carries the page's one h1: its heading is the name.
  const hero = portfolio.sections.find((section) => section.kind === 'hero');
  const rendered = portfolio.sections
    .map((section) => ({
      section,
      element: renderSection(section, input, {}, { level: section === hero ? 1 : 2 }),
    }))
    .filter(
      (entry): entry is { section: Section; element: ReactElement } => entry.element !== null,
    );
  const named = rendered.filter(({ section }) => NAMED(section));
  return (
    <>
      <header className="fc-header">
        {named.length > 0 ? (
          <nav className="fc-nav" aria-label="Sections">
            <ul role="list">
              {named.map(({ section }) => (
                <li key={section.id}>
                  <a href={`#${ids.prefix}${section.id}`} lang={section.lang}>
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
        {hero && rendered.some(({ section }) => section === hero) ? null : (
          <h1 className="fc-name">{portfolio.identity.name}</h1>
        )}
        {rendered.map(({ element }) => element)}
      </main>
    </>
  );
}
