import type { ReactElement } from 'react';
import type { Section } from '@portfolio/schema';
import { composePages, renderSection, type HomePageProps } from '@portfolio/kit/sections';
import { Colophon } from './chrome/colophon';
import { CaseStudyPage } from './case-study';
import { IndexSheet } from './chrome/index-sheet';
import { Masthead } from './chrome/masthead';
import { compositionFor, PartOpener } from './frame';
import { Fold } from './fold';
import { figuresBand, foldedOf, heroOf, partsOf, type Part } from './model';
import { ownId } from './parts';
import { Position } from './position';
import { Poster, posterHeading } from './poster';

// Swiss Signal (variants-10 brief §5.1): the portfolio as a Swiss print
// poster that works as an index. A 12-column ruled grid; the thesis as an
// uppercase poster line with its serif-italic aside in the one signal
// colour; a ruled figures band in the first view; five part openers at the
// same scale; and every collection a ruled table on the column lines. No
// cards, no shadows, and no motion beyond state changes and one settle.
//
// It owns composition alone: the paper, the ink, the signal, the three
// faces and the motion durations are the selected packs'.

/** The sections of About that sit together as one spread: a lede, then Now and focus beside it. */
function aboutSpread(part: Part): { lede: Section; side: Section[] } | undefined {
  const sections = part.sections;
  const at = sections.findIndex((section) => section.kind === 'lede');
  if (at < 0) return undefined;
  const side: Section[] = [];
  for (const section of sections.slice(at + 1)) {
    if (section.kind !== 'now' && section.kind !== 'focus') break;
    side.push(section);
  }
  return side.length ? { lede: sections[at]!, side } : undefined;
}

function HomePage({ input, outline }: HomePageProps) {
  const parts = partsOf(input, outline);
  const composition = compositionFor(input, parts);
  const hero = heroOf(input);
  const band = figuresBand(input);
  const render = (section: Section, level: 1 | 2 | 3) =>
    renderSection(section, input, composition, { level });
  const opening = hero ? render(hero, 1) : null;
  return (
    <div className="ss">
      <Masthead input={input} />
      {/* The controller: behaviour on mount, the settle only under motion; nothing visible. */}
      <Position prefix={input.ids.prefix} />
      {/* Focusable, so the host's skip link moves focus here, not only the view. */}
      <main id={input.ids.main} className="ss-main" tabIndex={-1}>
        {opening ?? (
          <section className="ss-poster" aria-labelledby={posterHeading(input)}>
            <Poster input={input} />
          </section>
        )}
        {band ? render(band.section, 2) : null}
        {parts.map((part) => {
          const spread = part.id === 'about' ? aboutSpread(part) : undefined;
          const grouped = new Set(spread ? [spread.lede, ...spread.side] : []);
          // Gate item 8: the full record folds, at the end of its part.
          const folded = foldedOf(part, input);
          const blocks: ReactElement[] = [];
          const folds: ReactElement[] = [];
          for (const section of part.sections) {
            if (spread && section === spread.lede) {
              blocks.push(
                <div key={`spread-${section.id}`} className="ss-spread">
                  <div className="ss-spread__main">{render(section, 3)}</div>
                  <div className="ss-spread__side">
                    {spread.side.map((side) => render(side, 3))}
                  </div>
                </div>,
              );
              continue;
            }
            if (grouped.has(section)) continue;
            const element = render(section, 3);
            if (!element) continue;
            if (folded.has(section.id)) {
              folds.push(
                <Fold key={`fold-${section.id}`} section={section} input={input}>
                  {element}
                </Fold>,
              );
            } else blocks.push(element);
          }
          return (
            <div
              key={part.id}
              className="ss-part"
              id={ownId(input.ids.prefix, `part-${part.id}`)}
              data-part={part.id}
              data-position={part.position}
            >
              <PartOpener part={part} input={input} />
              {blocks}
              {folds.length > 0 ? <div className="ss-folds">{folds}</div> : null}
            </div>
          );
        })}
      </main>
      <IndexSheet input={input} parts={parts} />
      <Colophon input={input} />
    </div>
  );
}

export default composePages({ HomePage, CaseStudyPage });
