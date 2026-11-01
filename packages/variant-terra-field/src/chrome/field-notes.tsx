import type { VariantRenderInput } from '@portfolio/variant-contract';
import { chromeIds, type HomeModel } from '../model';
import { Breakable, Words } from '../parts';
import { destinationHref } from './masthead';

// Field notes: the page's one index, a modal <dialog> that drops from the
// top as the field itself. It's invoked with command='show-modal' (no
// script needed where invoker commands are supported, showModal() through
// the field enhancement where they aren't), closes on Escape, on its
// Close button, and on a click outside it (closedby='any'), and returns
// focus to its opener, as a modal dialog does. Its first screen holds the
// way to get in touch (S2), then one column per destination, every titled
// section in it. Its ground's arc never clips a row: the scroll area is
// padded above the curve (S2).

const close = (id: string) =>
  ({ commandfor: id, command: 'close' }) as unknown as Record<string, string>;

/** A group of this page's own places, first in Field notes: a work's page lists its parts. */
export interface NotesPage {
  readonly title: string;
  readonly links: readonly { readonly href: string; readonly label: string }[];
}

export function FieldNotes({
  input,
  model,
  page,
}: {
  input: VariantRenderInput;
  model: HomeModel;
  page?: NotesPage;
}) {
  const ids = chromeIds(input.ids.prefix);
  const { navigation, footer, uiLang } = model;
  const contact = navigation.primary.find(({ id }) => id === 'contact');
  const columns = navigation.primary.filter(({ id }) => id !== 'contact');
  if (columns.length === 0) return null;
  const closedby = { closedby: 'any' } as unknown as Record<string, string>;
  return (
    <dialog className="tf-notes" id={ids.notes} aria-labelledby={ids.notesTitle} {...closedby}>
      <div className="tf-notes__ground" data-ui-surface={model.quiet ? undefined : 'accent'}>
        <div className="tf-notes__scroll">
          <div className="tf-page">
            <div className="tf-notes__top">
              <h2 className="tf-title" id={ids.notesTitle}>
                <Words lang={uiLang}>Field notes</Words>
              </h2>
              <button className="tf-linkbtn" type="button" data-tf-close="" {...close(ids.notes)}>
                <Words lang={uiLang}>Close</Words>
              </button>
            </div>
            {contact || footer.email ? (
              <p className="tf-notes__reach tf-compact">
                {contact ? (
                  <a
                    href={destinationHref('contact', contact.href, input, model)}
                    lang={contact.lang}
                  >
                    {contact.label}
                  </a>
                ) : null}
                {contact && footer.email ? ' ' : null}
                {footer.email ? (
                  <a href={footer.email.href}>
                    <Breakable text={footer.email.text} />
                  </a>
                ) : null}
              </p>
            ) : null}
            <ul className="tf-notes__cols" role="list">
              {page && page.links.length > 0 ? (
                <li className="tf-notes__col" data-tf-page-group="">
                  <p className="tf-title tf-notes__dest">
                    <Words lang={uiLang}>{page.title}</Words>
                  </p>
                  <ul className="tf-compact" role="list" lang={uiLang}>
                    {page.links.map((link) => (
                      <li key={link.href}>
                        <a href={link.href}>{link.label}</a>
                      </li>
                    ))}
                  </ul>
                </li>
              ) : null}
              {columns.map((destination) => (
                <li key={destination.id} className="tf-notes__col">
                  <a
                    className="tf-title tf-notes__dest"
                    href={destinationHref(destination.id, destination.href, input, model)}
                    lang={destination.lang}
                  >
                    {destination.label}
                  </a>
                  {destination.sections.filter((entry) => entry.title && entry.href).length > 0 ? (
                    <ul className="tf-compact" role="list">
                      {destination.sections
                        .filter((entry) => entry.title && entry.href)
                        .map((entry) => (
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
          </div>
        </div>
      </div>
    </dialog>
  );
}
