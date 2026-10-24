import type { ReactElement } from 'react';
import { renderSection } from '@portfolio/kit/sections';
import type { VariantRenderInput } from '@portfolio/variant-contract';
import { ChapterIndex } from './chapter-index';
import { Chrome } from './chrome';
import { homeModel, named, present } from './model';
import { Room } from './room';

// Obsidian Atelier (#15): a night gallery of chapters. The opening, a quiet
// chapter index, one chapter a work, each a full-bleed room for its
// artifact beside a narrow analytical column, with the rest of its case
// behind Unfold the case, and then the rest of the reading order through
// the kit's shared renderers.
//
// It owns composition alone. Its dark values and oxidized accents are the
// selected color scheme's (#19, Codex [31]): it never forces dark, and in a
// light scheme or high contrast it's the same rooms in those colors. It's a
// server module with no client code of its own, no effect, no fetch, no
// clock, and no motion, so a page with no JavaScript, a print, a preview
// frame, and reduced motion all read the same, and every chapter, its
// index, and its previous and next links are plain links in the page's
// order. A work's own page, /work/<slug>, is the host's shared one.

export default function ObsidianAtelier({ input }: { readonly input: VariantRenderInput }) {
  const { ids, portfolio } = input;
  const model = homeModel(input);
  // The page's one h1: the leading hero's, or the identity's name.
  const opening = model.hero ? renderSection(model.hero, input, {}, { level: 1 }) : null;
  const sections: ReactElement[] = model.sections.flatMap((section) => {
    const element = renderSection(section, input, {}, { level: 2 });
    return element ? [element] : [];
  });
  const shown = new Set(sections.map((element) => String(element.key)));
  const indexed =
    model.chapters.length > 0 ||
    model.sections.some((section) => named(section) && shown.has(section.id));
  const total = model.chapters.length;
  return (
    <>
      <Chrome input={input} hasIndex={indexed} />
      {/* Focusable, so the host's skip link moves focus here, not only the view. */}
      <main id={ids.main} className="oa-main" tabIndex={-1}>
        <div className="oa-opening">
          {opening ?? (
            <>
              <h1 className="oa-opening__name" data-type-role="display">
                {portfolio.identity.name}
              </h1>
              {present(portfolio.identity.tagline) ? (
                <p className="oa-opening__tagline" data-type-role="headline">
                  {portfolio.identity.tagline}
                </p>
              ) : null}
            </>
          )}
        </div>
        <ChapterIndex input={input} model={model} shown={shown} />
        {total > 0 ? (
          <div className="oa-chapters">
            {/* A works section the chapters show whole: its link lands on the first chapter. */}
            {model.folded.map((id) => (
              <span key={id} id={`${ids.prefix}${id}`} className="oa-anchor" />
            ))}
            {model.chapters.map((chapter, index) => (
              <Room
                key={chapter.work.id}
                chapter={chapter}
                total={total}
                previous={model.chapters[index - 1]}
                next={model.chapters[index + 1]}
                input={input}
              />
            ))}
          </div>
        ) : null}
        {sections.length > 0 ? <div className="oa-sections">{sections}</div> : null}
      </main>
    </>
  );
}
