import type { ReactNode } from 'react';
import { routeHref, type VariantRenderInput } from '@portfolio/variant-contract';
import { formatNumber, headOf, itemCount, shownOrder, type Band } from '../model';
import { ownId, uiLang, Words } from '../parts';

// The Index (brief §5.2, step 4): destination rows, each band's word with
// how many sections it holds, then its sections with the count of what each
// lists. Until the enhancement has run and marked the page live (no script,
// before hydration, a failed bundle, no Popover API), the capsule's Index is
// a plain link and this is a contents list at the page's end, after the
// footer: a plain element with its nav, not a dialog, so nothing announces a
// dialog in the middle of the page, and following one of its links can't
// leave anything open. Marked live, it's a popover on the capsule's button,
// with the dialog role the enhancement gives it: Escape and a click outside
// close it and focus goes back to the button, and the enhancement closes it
// when one of its links is followed. Leaving the flow then moves nothing:
// it's the page's last element. It fades in over the feedback duration, in
// the top layer; with no-preference and the page's motion on, it also drops
// in from scale 0.97.

export function IndexButton({
  input,
  children,
}: {
  input: VariantRenderInput;
  children: ReactNode;
}) {
  const dialog = ownId(input.ids.prefix, 'index');
  return (
    <>
      <button
        type="button"
        className="ag-capsule__index ag-capsule__index--live"
        popoverTarget={dialog}
        aria-controls={dialog}
        aria-haspopup="dialog"
        data-type-role="label"
      >
        <span className="ag-capsule__mark" aria-hidden="true" />
        {children}
      </button>
      <a
        className="ag-capsule__index ag-capsule__index--plain"
        href={`#${dialog}`}
        data-type-role="label"
      >
        <span className="ag-capsule__mark" aria-hidden="true" />
        {children}
      </a>
    </>
  );
}

export function IndexDialog({
  input,
  bands,
}: {
  input: VariantRenderInput;
  bands: readonly Band[];
}) {
  const lang = uiLang(input.portfolio.locale);
  const { prefix } = input.ids;
  const locale = input.portfolio.locale;
  const onHome = input.route.route === 'home';
  const home = onHome ? '' : routeHref(input, { route: 'home' });
  const dialog = ownId(prefix, 'index');
  const title = `${dialog}--h`;
  const counted = (n: number, one: string, many: string) =>
    `${formatNumber(n, locale)} ${n === 1 ? one : many}`;
  return (
    // No role, no name and no popover of its own while it's the contents list: its nav carries
    // the name, and a closed popover the page shows would hide its links from a reader that knows
    // closed popovers aren't shown (row 62). The enhancement makes it the popover, with the dialog
    // role and this heading's name, when the page goes live.
    <div className="ag-index ag-pane" id={dialog}>
      <div className="ag-index__head">
        <h2 className="ag-index__title" id={title} data-type-role="headline">
          <Words lang={lang}>Index</Words>
        </h2>
        <button
          type="button"
          className="ag-index__close"
          popoverTarget={dialog}
          popoverTargetAction="hide"
          data-type-role="label"
        >
          <Words lang={lang}>Close</Words>
        </button>
      </div>
      <nav aria-labelledby={title}>
        <ol className="ag-index__rows">
          {bands.map((band) => (
            <li key={band.id} className="ag-index__row" data-ag-dest={band.id}>
              <a
                className="ag-index__dest"
                href={`${home}#${ownId(prefix, `band-${band.id}`)}`}
                data-type-role="title"
              >
                {band.word ? (
                  band.own ? (
                    <Words lang={lang}>{band.word}</Words>
                  ) : (
                    band.word
                  )
                ) : (
                  <Words lang={lang}>More</Words>
                )}
              </a>
              <span className="ag-index__count ag-num" data-type-role="caption">
                <Words lang={lang}>{counted(band.sections.length, 'section', 'sections')}</Words>
              </span>
              <ul className="ag-index__sections" role="list" data-type-role="body-compact">
                {shownOrder(band, input).map((section) => {
                  const head = headOf(section);
                  const count = itemCount(section, input);
                  return (
                    <li key={section.id}>
                      <a href={`${home}#${prefix}${section.id}`}>
                        {head.own ? <Words lang={lang}>{head.title}</Words> : head.title}
                      </a>
                      {count > 0 ? (
                        <span className="ag-num" aria-hidden="true">
                          {formatNumber(count, locale)}
                        </span>
                      ) : null}
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
