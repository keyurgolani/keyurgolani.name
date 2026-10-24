import type { ReactElement } from 'react';
import type { Section } from '@portfolio/schema';
import { renderSection, VisitorControlSlot, type BespokeRenderers } from '@portfolio/kit/sections';
import type { VariantRenderInput } from '@portfolio/variant-contract';
import { BentoOpening } from './opening';

// Spatial Bento (#16), the static document: the portfolio as a bento of
// tiles. The opening and a still of the spatial stage share the first tile,
// and every other section is a tile of its own, in content order, through
// the kit's shared renderers, so every title, description, link, work, case
// study, and action is selectable, indexable HTML in reading order. It owns
// composition alone: color, type, materials, and timing are the appearance
// packs' (#19). It's a server module with no client code, so it renders the
// same with or without JavaScript, in print, and in a plate, where it adds
// no listener and every id is under the plate's prefix. A hidden section
// never reaches it.

const RENDERERS: BespokeRenderers = { hero: BentoOpening };

/** A section the navigation can name: a title, and not the opening or a call to action. */
const named = (section: Section) =>
  section.kind !== 'hero' && section.kind !== 'cta' && Boolean(section.title?.trim());

export default function SpatialBento({ input }: { readonly input: VariantRenderInput }) {
  const { portfolio, ids } = input;
  // The page's one h1 comes before any section's h2: a hero that renders
  // first carries it, and otherwise the identity's name does.
  let heroLeads = false;
  let rendered = false;
  const sections: { section: Section; element: ReactElement }[] = [];
  for (const section of portfolio.sections) {
    const leads = !rendered && section.kind === 'hero';
    const element = renderSection(section, input, RENDERERS, { level: leads ? 1 : 2 });
    if (element === null) continue;
    heroLeads ||= leads;
    rendered = true;
    sections.push({ section, element });
  }
  const links = sections.filter(({ section }) => named(section));
  // The host's own words are English, marked so in a portfolio in another language.
  const uiLang = /^en(?:-|$)/i.test(portfolio.locale) ? undefined : 'en';
  // Two hyphens: no content id has them, so none can take this one.
  const label = `${ids.prefix}sb--sections`;
  return (
    <>
      <header className="sb-header">
        {links.length > 0 ? (
          // #19's navigation slots, written out so the composition stays a
          // server module: the platform stylesheet styles and sizes them.
          <nav
            className="sb-nav"
            data-ui-slot="navigation"
            data-orientation="horizontal"
            aria-labelledby={label}
          >
            <span id={label} lang={uiLang} hidden>
              Sections
            </span>
            <ul data-ui-slot="navigation.list">
              {links.map(({ section }) => (
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
      <main id={ids.main} className="sb-bento" tabIndex={-1}>
        {heroLeads ? null : <h1 className="sb-name">{portfolio.identity.name}</h1>}
        {sections.map(({ element }) => element)}
      </main>
    </>
  );
}
