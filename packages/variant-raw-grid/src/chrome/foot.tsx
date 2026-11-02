import type { CSSProperties } from 'react';
import { renderSection, VisitorControlSlot } from '@portfolio/kit/sections';
import type { VariantRenderInput } from '@portfolio/variant-contract';
import { chromeIds, type HomeModel } from '../model';
import { foldedLast } from '../fold';
import { Lines, Words } from '../parts';
import { renderersFor } from '../renderers';
import { inkFrame } from '../renderers/contact';

// The foot: the page's one index, then the ink block, the closing form,
// and a colophon row of cells under it. The index is the one list every
// section is in, by sheet, each sheet's word as black tape; the Index in
// the header opens this same list over the page (the client module), so
// it's never copied. The page ends on the invitation. On a work's own page
// the index leads with the case's own parts, then the sheets on home.

/** A destination's entries the index can link: titled, with somewhere to land. */
const linkable = (entry: { title?: string; href?: string }) =>
  entry.title !== undefined && entry.href !== undefined;

/** One column of the index: a tab and the entries under it. */
export interface IndexColumn {
  readonly id: string;
  readonly label: string;
  readonly lang?: string;
  readonly href?: string;
  readonly entries: readonly {
    readonly id: string;
    readonly title?: string;
    readonly href?: string;
    readonly lang?: string;
    readonly dir?: 'ltr' | 'rtl';
  }[];
}

/**
 * The index's columns: one per sheet, then Contact when the closing block
 * holds it, with the closing's sections. A column lists every entry, one
 * too, so none is an empty box. Off home, each sheet's tab leads to it there.
 */
export function indexColumns(
  input: VariantRenderInput,
  model: HomeModel,
  home = '',
): readonly IndexColumn[] {
  const ids = chromeIds(input.ids.prefix);
  const contact = model.navigation.primary.find(({ id }) => id === 'contact');
  return [
    ...model.sheets.map((sheet) => ({
      id: sheet.id,
      label: sheet.label,
      lang: sheet.lang,
      href: `${home}#${ids.sheet(sheet.id)}`,
      entries: foldedLast(sheet, sheet.toc.filter(linkable), input),
    })),
    ...(contact && !model.sheets.some(({ id }) => id === 'contact')
      ? [
          {
            id: 'contact',
            label: contact.label,
            lang: contact.lang,
            href: contact.href,
            entries: contact.sections.filter(linkable),
          },
        ]
      : []),
  ];
}

/** The index: a grid of columns, one per sheet, every titled section in each. */
export function SiteIndex({
  input,
  model,
  home,
  lead,
}: {
  input: VariantRenderInput;
  model: HomeModel;
  home?: string;
  /** A column before the sheets: the case's own parts. */
  lead?: IndexColumn;
}) {
  const ids = chromeIds(input.ids.prefix);
  const columns = [...(lead ? [lead] : []), ...indexColumns(input, model, home)];
  if (columns.length === 0) return null;
  return (
    <nav className="rg-index" id={ids.index} aria-labelledby={ids.indexTitle} tabIndex={-1}>
      <div className="rg-index__bar">
        <h2 className="rg-tab rg-index__title" id={ids.indexTitle}>
          <Words lang={model.uiLang}>Index</Words>
        </h2>
        <button className="rg-index__close" type="button" hidden data-rg-close="">
          <Words lang={model.uiLang}>Close</Words>
        </button>
      </div>
      {/* Its count sets the rows: all in one, or two of equal halves, never one stretched alone. */}
      <ul
        className="rg-index__grid"
        role="list"
        style={{ '--layout-index-cols': columns.length } as CSSProperties}
      >
        {columns.map((column) => (
          <li key={column.id} className="rg-index__col">
            {column.href ? (
              <a className="rg-index__tab" href={column.href} lang={column.lang}>
                {column.label}
              </a>
            ) : (
              <p className="rg-index__tab" lang={column.lang}>
                {column.label}
              </p>
            )}
            {column.entries.length > 0 ? (
              <ul role="list">
                {column.entries.map((entry) => (
                  <li key={entry.id}>
                    <a href={entry.href} lang={entry.lang} dir={entry.dir}>
                      {entry.title}
                    </a>
                  </li>
                ))}
              </ul>
            ) : null}
          </li>
        ))}
      </ul>
    </nav>
  );
}

/** The colophon row: the name, the portfolio's own description, the visitor's control, the way back up. */
export function Colophon({ input, model }: { input: VariantRenderInput; model: HomeModel }) {
  const { footer } = model;
  const note = footer.colophon.description ?? footer.tagline;
  return (
    <div className="rg-colophon">
      <p className="rg-colophon__name">{footer.name}</p>
      {note ? <p className="rg-colophon__note">{note}</p> : null}
      <div className="rg-colophon__slot">
        <VisitorControlSlot />
      </div>
      <p className="rg-colophon__top">
        <a className="rg-go" href={`#${input.ids.main}`}>
          <Words lang={model.uiLang}>Top</Words>
        </a>
      </p>
    </div>
  );
}

export function Foot({
  input,
  model,
  home,
  lead,
}: {
  input: VariantRenderInput;
  model: HomeModel;
  home?: string;
  lead?: IndexColumn;
}) {
  const closing = model.contact ?? model.cta;
  const ink = { renderers: renderersFor({ model }), Frame: inkFrame(input) };
  return (
    <footer className="rg-foot">
      <Lines />
      <SiteIndex input={input} model={model} home={home} lead={lead} />
      {closing ? renderSection(closing, input, ink, { level: 2 }) : null}
      <Colophon input={input} model={model} />
    </footer>
  );
}
