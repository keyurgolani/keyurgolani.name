import type { ReactElement } from 'react';
import type { Section } from '@portfolio/schema';
import { composePages, renderSection, type HomePageProps } from '@portfolio/kit/sections';
import { Enhancement } from '@portfolio/kit/enhancements';
import type { VariantRenderInput } from '@portfolio/variant-contract';
import { CaseStudyPage } from './case-study';
import { Chrome } from './chrome/capsule';
import { IndexDialog } from './chrome/index-dialog';
import { compositionFor } from './frame';
import { Opening, openingHeading, setStandfirst } from './hero';
import { Fold } from './fold';
import {
  bandsOf,
  foldsOf,
  headOf,
  heroOf,
  shownOrder,
  spreadsOf,
  thesisSectionOf,
  type Band,
} from './model';
import { ownId, uiLang, Words } from './parts';
import { Footer, HorizonPhoto } from './renderers/horizon';
import { Sky } from './sky';

// Aurora Glass (variants-10 brief §5.2): frosted panes over one living sky.
// A centred capsule holds the five destinations; the identity pane opens
// the page with the thesis as its display line, shingled under the
// signature work's raised sheet, with two glass beads in the open sky
// beside it; every destination is one pane split by mullion gaps that show
// the sky, its sections the lites, its items rows; and the page closes on
// the owner's own horizon.
//
// It owns composition alone: the sky's structure, the vocabulary (pane,
// sheet, capsule, bead, lites, shingle), which surfaces may blur, and the
// choreography. The frost, its blur, the radii and every colour are the
// packs': the composition reads roles, so it reads as itself over an
// opaque language as well (F8). It renders on the server from the render
// input alone; one small enhancement adds the capsule's current place, the
// sky's drift and its Pause, and opens a fold a fragment link lands in.

type Render = (section: Section, level: 2 | 3) => ReactElement | null;

function BandHead({ band, input }: { band: Band; input: VariantRenderInput }) {
  const lang = uiLang(input.portfolio.locale);
  const id = ownId(input.ids.prefix, `band-${band.id}--h`);
  const titled = band.sections.filter((section) => !headOf(section).own);
  return (
    <header className="ag-lite ag-band__head">
      <h2 className="ag-band__title" id={id} data-type-role="headline">
        {band.own ? <Words lang={lang}>{band.word}</Words> : band.word}
      </h2>
      {titled.length > 1 ? (
        <nav className="ag-band__nav" aria-label={`${band.word} sections`}>
          <ul role="list">
            {titled.map((section) => (
              <li key={section.id}>
                <a href={`#${input.ids.prefix}${section.id}`} data-type-role="label">
                  {headOf(section).title}
                </a>
              </li>
            ))}
          </ul>
        </nav>
      ) : null}
    </header>
  );
}

function BandView({
  band,
  input,
  render,
}: {
  band: Band;
  input: VariantRenderInput;
  render: Render;
}) {
  const id = ownId(input.ids.prefix, `band-${band.id}`);
  if (band.id === 'contact') {
    return (
      <div className="ag-band ag-horizon" id={id} data-band="contact">
        <HorizonPhoto input={input} />
        <div className="ag-horizon__panes">
          {band.sections.map((section) => render(section, 2))}
        </div>
      </div>
    );
  }
  if (!band.word) {
    return (
      <div className="ag-band" id={id} data-band={band.id}>
        <div className="ag-band__pane">{band.sections.map((section) => render(section, 3))}</div>
      </div>
    );
  }
  // Gate item 8: the full record folds, at the end of its band, each fold one more lite.
  const folded = foldsOf(band, input);
  const shown = shownOrder(band, input);
  const open = shown.filter((section) => !folded.has(section.id));
  const folds = shown.filter((section) => folded.has(section.id));
  return (
    <div className="ag-band" id={id} data-band={band.id}>
      <div className="ag-band__pane">
        {/* Its sub-nav in the order the band shows them: the open sections, then the folds. */}
        <BandHead band={{ ...band, sections: shown }} input={input} />
        {spreadsOf(open).map((block) =>
          block.side.length === 0 ? (
            render(block.main, 3)
          ) : (
            <div key={`spread-${block.main.id}`} className="ag-spread">
              <div className="ag-spread__main">{render(block.main, 3)}</div>
              <div className="ag-spread__side">
                {block.side.map((section) => render(section, 3))}
              </div>
            </div>
          ),
        )}
        {folds.map((section) => (
          <Fold key={`fold-${section.id}`} section={section} input={input}>
            {render(section, 3)}
          </Fold>
        ))}
      </div>
    </div>
  );
}

function HomePage({ input, outline }: HomePageProps) {
  const bands = bandsOf(input, outline);
  const composition = compositionFor(input);
  const render: Render = (section, level) => renderSection(section, input, composition, { level });
  const hero = heroOf(input);
  const thesis = thesisSectionOf(input);
  setStandfirst(input, thesis ? render(thesis, 2) : null);
  const opening = hero ? render(hero, 2) : null;
  return (
    <div className="ag">
      <Sky input={input} />
      <Chrome input={input} bands={bands} />
      <main id={input.ids.main} className="ag-main" tabIndex={-1}>
        {opening ?? (
          <section className="ag-opening-frame" aria-labelledby={openingHeading(input)}>
            <Opening input={input} />
          </section>
        )}
        {bands.map((band) => (
          <BandView key={band.id} band={band} input={input} render={render} />
        ))}
      </main>
      <Footer input={input} />
      {/* Last, after the footer: with no script it's the contents list, and when the page goes live
          and it leaves the flow for the top layer, nothing it sat above moves. */}
      <IndexDialog input={input} bands={bands} />
      <Enhancement input={input} id="sky" />
    </div>
  );
}

export default composePages({ HomePage, CaseStudyPage });

/** The backdrop layer, `[data-ag-backdrop]`, for a host or a later appearance to find as one (sky.tsx). */
export { Sky } from './sky';
