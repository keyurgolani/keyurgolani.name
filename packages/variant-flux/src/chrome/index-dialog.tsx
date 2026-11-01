import type { ReactNode } from 'react';
import { routeHref, type VariantRenderInput } from '@portfolio/variant-contract';
import { openingHeading } from '../hero';
import { headOf, type Sheet } from '../model';
import { ownId, uiLang, Words } from '../parts';

// The Index (brief §5.10, S3, FX-M14): every sheet and its sections, in
// reading order. Until the enhancement has marked the page live (no
// script, before hydration, a failed bundle, no Popover API), the bar's
// Index is a plain link and this is the contents list at the page's end:
// a plain element with its nav, not a dialog, so nothing announces one in
// the middle of the page. Live, it's a modal dialog over the page (the
// enhancement), opened by the bar's button as a popover: Close is focused,
// Tab stays in it, Escape, Close and a click outside shut it, and focus goes
// back to the Index button.

export const indexId = (input: Pick<VariantRenderInput, 'ids'>) => ownId(input.ids.prefix, 'index');

/** The tab bar's Index: a button once the page is live, a link to the contents list before. */
export function IndexButton({
  input,
  children,
}: {
  input: VariantRenderInput;
  children: ReactNode;
}) {
  const index = indexId(input);
  return (
    <>
      <button
        type="button"
        className="fx-tool fx-tool--index fx-tool--live"
        popoverTarget={index}
        aria-controls={index}
        aria-haspopup="dialog"
        aria-label="Index"
        data-fx-open-index=""
        data-type-role="label"
        hidden
      >
        <span className="fx-tool__mark" aria-hidden="true" />
        {children}
      </button>
      <a
        className="fx-tool fx-tool--index fx-tool--plain"
        href={`#${index}`}
        aria-label="Index"
        data-type-role="label"
      >
        <span className="fx-tool__mark" aria-hidden="true" />
        {children}
      </a>
    </>
  );
}

/** A page's own stops, listed first: a work's own page lists its title and its parts. */
export interface IndexPage {
  readonly title: ReactNode;
  readonly href: string;
  readonly links: readonly { readonly href: string; readonly label: ReactNode }[];
}

export function IndexDialog({
  input,
  sheets,
  page,
}: {
  input: VariantRenderInput;
  sheets: readonly Sheet[];
  page?: IndexPage;
}) {
  const lang = uiLang(input.portfolio.locale);
  const { prefix } = input.ids;
  const home = input.route.route === 'home' ? '' : routeHref(input, { route: 'home' });
  const index = indexId(input);
  const title = `${index}--h`;
  return (
    // No role and no name of its own while it's the contents list: its nav carries the name.
    // The enhancement gives it the dialog's, and this heading's name, when the page goes live.
    <div className="fx-index" id={index}>
      <div className="fx-index__head">
        <h2 className="fx-index__title" id={title} data-type-role="headline">
          <Words lang={lang}>Index</Words>
        </h2>
        <button type="button" className="fx-index__close" data-type-role="label" hidden>
          <Words lang={lang}>Close</Words>
        </button>
      </div>
      <nav aria-labelledby={title}>
        <ol className="fx-index__rows" role="list">
          {page ? (
            <li className="fx-index__row fx-index__row--page" data-fx-ink="a">
              <a className="fx-index__dest" href={page.href} data-type-role="title">
                {page.title}
              </a>
              {page.links.length > 0 ? (
                <ul className="fx-index__sections" role="list" data-type-role="body-compact">
                  {page.links.map((link) => (
                    <li key={link.href}>
                      <a href={link.href}>{link.label}</a>
                    </li>
                  ))}
                </ul>
              ) : null}
            </li>
          ) : null}
          <li className="fx-index__row">
            <a
              className="fx-index__dest"
              href={`${home}#${openingHeading(input)}`}
              data-type-role="title"
            >
              {input.portfolio.identity.name}
            </a>
          </li>
          {sheets.map((sheet) => (
            <li key={sheet.id} className="fx-index__row" data-fx-ink={sheet.ink}>
              <a
                className="fx-index__dest"
                href={`${home}#${ownId(prefix, `sheet-${sheet.id}`)}`}
                data-type-role="title"
              >
                {sheet.word ? (
                  sheet.own ? (
                    <Words lang={lang}>{sheet.word}</Words>
                  ) : (
                    sheet.word
                  )
                ) : (
                  <Words lang={lang}>More</Words>
                )}
              </a>
              <ul className="fx-index__sections" role="list" data-type-role="body-compact">
                {sheet.sections.map((section) => {
                  const head = headOf(section);
                  return (
                    <li key={section.id}>
                      <a href={`${home}#${prefix}${section.id}`}>
                        {head.own ? <Words lang={lang}>{head.title}</Words> : head.title}
                      </a>
                    </li>
                  );
                })}
              </ul>
            </li>
          ))}
        </ol>
      </nav>
    </div>
  );
}
