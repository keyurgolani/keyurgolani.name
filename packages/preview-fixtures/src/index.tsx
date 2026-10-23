import type { ReactElement } from 'react';
import type { Section } from '@portfolio/schema';
import { Enhancement } from '@portfolio/kit/enhancements';
import { renderSection, VisitorControlSlot } from '@portfolio/kit/sections';
import type { VariantRenderInput } from '@portfolio/variant-contract';

// The environment fixture (#7, Slice 4, item 10): every visible section in
// content order, in one column, through the kit's shared renderers, as the
// fallback composition renders them. Its stylesheet keys everything it shows
// on the environment attributes a preview sets on the boundary, so a test
// can tell the display mode, contrast, motion, and enhancement a frame
// renders under from its computed styles. A mark that moves shows motion,
// and the `mark` enhancement shows the page's scripts ran. It registers only
// in a PREVIEW_FIXTURES=1 build.

export default function EnvironmentFixture({ input }: { readonly input: VariantRenderInput }) {
  const { portfolio, ids } = input;
  // The page's one h1: a hero that renders first carries it, and otherwise
  // the identity's name does, above the sections.
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
  return (
    <>
      <header className="fe-header">
        <span className="fe-motion" aria-hidden="true" />
        <Enhancement input={input} id="mark" />
        <VisitorControlSlot />
      </header>
      {/* Focusable, so the host's skip link moves focus here. */}
      <main id={ids.main} className="fe-main" tabIndex={-1}>
        {heroLeads ? null : <h1 className="fe-name">{portfolio.identity.name}</h1>}
        {sections.map(({ element }) => element)}
      </main>
    </>
  );
}
