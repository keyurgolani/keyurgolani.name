import type { ReactElement } from 'react';
import type { Section } from '@portfolio/schema';
import { renderSection, type BespokeRenderers } from '@portfolio/kit/sections';
import type { VariantRenderInput } from '@portfolio/variant-contract';
import { Chrome, type ChromeLink } from './chrome';
import { BranchingChronology } from './chronology';
import { EvidenceObjects } from './evidence';
import { OrbitalOpening } from './opening';

// Kinetic Cosmos (#14), the still composition: an orbital opening, evidence
// as objects that open in place, and a chronology that branches where the
// owner's threads do, every other kind through the kit's shared renderers.
// It owns composition alone. Color, type, materials, and timing are the
// appearance packs' (#19), and its one signature is the design language's
// signature fill, on the opening's core. It renders from its input alone,
// and only what the input holds: a hidden section never reaches it. Inside
// a plate it renders the same, with nothing fixed, no listener on the page,
// and every id under the boundary's prefix.

const RENDERERS: BespokeRenderers = {
  hero: OrbitalOpening,
  evidence: EvidenceObjects,
  chronology: BranchingChronology,
};

/** A section the chrome can name: a title, and not the opening or a call to action. */
const named = (section: Section) =>
  section.kind !== 'hero' && section.kind !== 'cta' && Boolean(section.title?.trim());

export default function KineticCosmos({ input }: { readonly input: VariantRenderInput }) {
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
  const links: ChromeLink[] = sections
    .filter(({ section }) => named(section))
    .map(({ section }) => ({
      id: section.id,
      title: section.title!,
      ...(section.lang !== undefined ? { lang: section.lang } : {}),
    }));
  return (
    <>
      <Chrome input={input} links={links} />
      {/* Focusable, so the host's skip link moves focus here, not only the view. */}
      <main id={ids.main} className="kc-main" tabIndex={-1}>
        {heroLeads ? null : <h1 className="kc-name">{portfolio.identity.name}</h1>}
        {sections.map(({ element }) => element)}
      </main>
    </>
  );
}
