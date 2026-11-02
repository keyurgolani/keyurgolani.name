import type { ReactElement } from 'react';
import type { Section } from '@portfolio/schema';
import { composePages, renderSection, type HomePageProps } from '@portfolio/kit/sections';
import { Enhancement } from '@portfolio/kit/enhancements';
import type { VariantRenderInput } from '@portfolio/variant-contract';
import { CaseStudyPage } from './case-study';
import { Footer, IndexDialog, PhoneBar } from './chrome/drawing-index';
import { SheetCorner } from './chrome/title-block';
import { CoverIdentity, CoverSheet, coverHeading } from './cover';
import { Stamp } from './drawing/dimension';
import { SheetBorder, zoneRows } from './drawing/sheet-border';
import { compositionFor } from './frame';
import { sheetSet, type Sheet, type View } from './model';
import { ownId, Ui, words } from './parts';

// Schematic (variants-10 brief §5.4): the portfolio as an engineering
// drawing set. A cover sheet draws the owner as a dimensioned elevation,
// the thesis the dimension over the name, leader notes from the curated
// proof, and the signature work as Figure 1, an interface with its ports
// beside a dashed depth region; the title block holds the sheet's
// bottom-right corner (SC-M1). Five sheets follow, each bordered and zoned
// on all four edges over the drafting grid (SC-M2), each a numbered set of
// views. Past the cover, a running marker names the sheet being read in the
// same corner; on phones a two-item bar does (SC-S7).
//
// It owns composition alone: the grounds, inks, faces and timing are the
// packs', and every line is a role token, so the drawing reads as itself
// under whiteprint and the default recipe (F8).

/** Asides that share a row with the host before them (the concept's pairing rule). */
const HOST = new Set(['lede', 'fun-facts', 'contact', 'custom']);
const ASIDE = new Set(['now', 'focus', 'quote', 'cta']);

function layout(
  views: readonly View[],
  render: (section: Section) => ReactElement | null,
): ReactElement[] {
  const out: ReactElement[] = [];
  const aside = (next: View | undefined) => !!next && !next.closed && ASIDE.has(next.section.kind);
  for (let i = 0; i < views.length; i += 1) {
    const view = views[i]!;
    // Closed views run together as one ruled schedule (G2, G4): a row each, no gaps.
    if (view.closed) {
      const rows: ReactElement[] = [];
      for (; i < views.length && views[i]!.closed; i += 1) {
        const row = render(views[i]!.section);
        if (row) rows.push(row);
      }
      i -= 1;
      if (rows.length)
        out.push(
          <div key={`schedule-${view.section.id}`} className="sx-schedule">
            {rows}
          </div>,
        );
      continue;
    }
    if (HOST.has(view.section.kind) && aside(views[i + 1])) {
      const asides: View[] = [];
      while (aside(views[i + 1])) asides.push(views[(i += 1)]!);
      out.push(
        <div key={`pair-${view.section.id}`} className="sx-pair">
          <div className="sx-pair__host">{render(view.section)}</div>
          <div className="sx-pair__asides">{asides.map((aside) => render(aside.section))}</div>
        </div>,
      );
      continue;
    }
    const element = render(view.section);
    if (element) out.push(element);
  }
  return out;
}

function SheetView({
  sheet,
  input,
  render,
  last,
}: {
  sheet: Sheet;
  input: VariantRenderInput;
  render: (section: Section) => ReactElement | null;
  /** The set's last sheet ends the drawing: the stamp after its last view. */
  last: boolean;
}) {
  const { t, lang } = words(input);
  const id = ownId(input.ids.prefix, `sheet-${sheet.id}`);
  return (
    <section className="sx-sheet" id={id} aria-labelledby={`${id}--h`} data-sheet={sheet.no}>
      <SheetBorder rows={zoneRows(sheet.views.length)}>
        <header className="sx-sheet__head">
          <h2 className="sx-sheet__title" id={`${id}--h`} data-type-role="headline">
            <span className="sx-sheet__no" data-type-role="numeric">
              {sheet.no}
            </span>{' '}
            <span lang={sheet.lang ?? lang}>{sheet.label}</span>
          </h2>
          {sheet.views.length > 1 ? (
            <ol
              className="sx-sheet__views"
              role="list"
              aria-label={t.views(sheet.label)}
              data-type-role="body-compact"
            >
              {sheet.views.map((view) => (
                <li key={view.section.id}>
                  <a href={`#${input.ids.prefix}${view.section.id}`}>
                    <span data-type-role="numeric">{view.no}</span>{' '}
                    <span lang={view.own ? undefined : lang}>{view.title}</span>
                  </a>
                </li>
              ))}
            </ol>
          ) : null}
        </header>
        <div className="sx-views">{layout(sheet.views, render)}</div>
        {last ? (
          <div className="sx-end__stamp">
            <Stamp>
              <Ui lang={lang}>{t.endOfDrawing}</Ui>
            </Stamp>
          </div>
        ) : null}
        <SheetCorner input={input} sheet={sheet} />
      </SheetBorder>
    </section>
  );
}

function HomePage({ input }: HomePageProps) {
  const set = sheetSet(input);
  const composition = compositionFor(input);
  const render = (section: Section, level: 1 | 3 = 3) =>
    renderSection(section, input, composition, { level });
  const cover = set.cover ? render(set.cover, 1) : null;
  const annotations = input.controls.annotations !== false;
  const drafting = input.controls.constructionLines !== 'final';
  return (
    <div
      className="sx"
      data-sx-annotations={annotations ? undefined : 'off'}
      data-sx-lines={drafting ? undefined : 'final'}
    >
      <PhoneBar input={input} />
      <main id={input.ids.main} className="sx-main" tabIndex={-1}>
        <CoverSheet
          input={input}
          identity={
            cover ?? (
              <section className="sx-id" aria-labelledby={coverHeading(input)}>
                <CoverIdentity input={input} />
              </section>
            )
          }
        />
        {set.sheets.length > 0 ? (
          <div className="sx-set">
            {set.sheets.map((sheet) => (
              <SheetView
                key={sheet.id}
                sheet={sheet}
                input={input}
                render={(s) => render(s)}
                last={sheet === set.sheets.at(-1)}
              />
            ))}
          </div>
        ) : null}
      </main>
      <Footer input={input} />
      <IndexDialog input={input} />
      <Enhancement input={input} id="sheets" />
    </div>
  );
}

export default composePages({ HomePage, CaseStudyPage });
