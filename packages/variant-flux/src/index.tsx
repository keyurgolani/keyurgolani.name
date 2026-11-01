import type { CSSProperties, ReactElement } from 'react';
import type { Section } from '@portfolio/schema';
import { composePages, renderSection, type HomePageProps } from '@portfolio/kit/sections';
import { Enhancement } from '@portfolio/kit/enhancements';
import type { VariantRenderInput } from '@portfolio/variant-contract';
import { CaseStudyPage } from './case-study';
import { IndexDialog } from './chrome/index-dialog';
import { TabBar } from './chrome/tab-bar';
import { GooDefs } from './field/field';
import { compositionFor } from './frame';
import { Opening, openingHeading } from './hero';
import { controlsOf, heroOf, sheetsOf, thesisSectionOf, wordEms, type Sheet } from './model';
import { ownId, uiLang, WipeCurtain, Words } from './parts';
import { Footer } from './renderers/close';

// Flux (variants-10 brief §5.10): motion-first liquid on a full-bleed
// field. Two saturated inks pour off the opening's edges behind a two-line
// headline, merging through one goo filter, and the signature work sits
// whole in a liquid drop on the third ink's pool. A tab bar with no
// container holds the name and the five destinations inline at the top
// left, and docks to the bottom on phones alone; every destination below
// is a sheet whose tab melts out of its top edge, the tabs stepping across
// the page in reading order, each lip in the next ink.
//
// It owns composition alone: the field's geometry and choreography, the
// goo, the drop, the sheets and their tabs. Every colour, face, material
// and timing is the appearance packs' (#19): the inks are the scheme's
// signature and emphasis roles, so the field reads as liquid under any
// scheme. It renders on the server from the render input alone; the field
// drifts on the kit's runtime, and one enhancement adds the place being
// read to the tab bar, the Index dialog, Copy email and the fold a
// fragment lands in.

type Render = (section: Section, level: 2 | 3) => ReactElement | null;

function SheetView({
  sheet,
  input,
  render,
}: {
  sheet: Sheet;
  input: VariantRenderInput;
  render: Render;
}) {
  const lang = uiLang(input.portfolio.locale);
  const id = ownId(input.ids.prefix, `sheet-${sheet.id}`);
  // The word's width in em sizes it to fit its tab on the narrowest screens (FX-M16).
  const style = {
    '--layout-fx-step': sheet.step,
    ...(sheet.word ? { '--layout-fx-ems': wordEms(sheet.word) } : {}),
  } as CSSProperties;
  if (!sheet.word) {
    return (
      <div
        className="fx-sheet fx-sheet--plain"
        id={id}
        data-sheet={sheet.id}
        data-fx-ink={sheet.ink}
      >
        <div className="fx-sheet__body">{sheet.sections.map((section) => render(section, 2))}</div>
      </div>
    );
  }
  return (
    <section
      className="fx-sheet"
      id={id}
      data-sheet={sheet.id}
      data-fx-ink={sheet.ink}
      style={style}
      aria-labelledby={`${id}--h`}
    >
      <div className="fx-sheet__tab">
        <h2 className="fx-sheet__word" id={`${id}--h`} data-type-role="display">
          {sheet.own ? <Words lang={lang}>{sheet.word}</Words> : sheet.word}
        </h2>
        <span className="fx-sheet__drip" aria-hidden="true" />
      </div>
      <div className="fx-sheet__body">{sheet.sections.map((section) => render(section, 3))}</div>
    </section>
  );
}

function HomePage({ input, outline }: HomePageProps) {
  const sheets = sheetsOf(input, outline);
  const composition = compositionFor(input, sheets);
  const render: Render = (section, level) => renderSection(section, input, composition, { level });
  const hero = heroOf(input);
  const thesis = thesisSectionOf(input);
  return (
    <div className="fx">
      <span className="fx-top" aria-hidden="true" />
      <WipeCurtain on={controlsOf(input).wipe} />
      <GooDefs prefix={input.ids.prefix} />
      <TabBar input={input} sheets={sheets} />
      <main id={input.ids.main} className="fx-main" tabIndex={-1}>
        {(hero ? render(hero, 2) : null) ?? (
          <section className="fx-opening-frame" aria-labelledby={openingHeading(input)}>
            <Opening input={input} />
          </section>
        )}
        {thesis ? render(thesis, 2) : null}
        {sheets.map((sheet) => (
          <SheetView key={sheet.id} sheet={sheet} input={input} render={render} />
        ))}
      </main>
      <Footer input={input} />
      {/* Last, after the footer: with no script it's the contents list, and when the page goes live
          and it leaves the flow for the top layer, nothing it sat above moves. */}
      <IndexDialog input={input} sheets={sheets} />
      <Enhancement input={input} id="tabs" />
    </div>
  );
}

export default composePages({ HomePage, CaseStudyPage });
