import type { ReactNode } from 'react';
import {
  footerOutline,
  frameAttributes,
  present,
  VisitorControlSlot,
} from '@portfolio/kit/sections';
import { spelled, type Book } from './model/book';
import {
  ANCHORS,
  backHref,
  bookLink,
  firstName,
  homeHref,
  idOf,
  joined,
  Md,
  segments,
  Sub,
  TITLE_FROM,
  titleFrom,
  type Here,
  type Input,
} from './text';

// The book's chrome: the running head split across the gutter, the
// fore-edge (the whole book as segments sized by their pages, your place
// marked), the phone's progress bar, and the endpaper colophon with contact
// and the visitor's reading-light control. Every view has all of them, so
// contact and the contents are one tap from any page (C4).

function hereLabel(here: Here): string {
  switch (here.view) {
    case 'home':
      return 'Front matter';
    case 'back':
      return 'Back matter';
    case 'chapter':
      return `Chapter ${here.chapter.n}: ${here.chapter.title}`;
    case 'work':
      return here.chapter ? `Chapter ${here.chapter.n}: ${here.chapter.title}` : 'Back matter';
  }
}

const hereKey = (here: Here) =>
  here.view === 'home'
    ? 'front'
    : here.view === 'back'
      ? 'back'
      : here.view === 'chapter'
        ? here.chapter.slug
        : (here.chapter?.slug ?? 'back');

/**
 * Where Write lands: the contact section's own frame, by the anchor its content id gives it as
 * on every composition, or the colophon where the book has no contact section. The frame opens
 * the endpaper, so either way the visitor lands on the same edge.
 */
export const writeHref = (input: Input, book: Book) =>
  `#${idOf(input, book.colophon.contact?.id ?? ANCHORS.colophon)}`;

export function RunningHead({ input, book, here }: { input: Input; book: Book; here: Here }) {
  const { identity } = input.portfolio;
  return (
    <header className="ch-runhead">
      <div className="ch-runhead__verso">
        <a className="ch-runhead__name" href={homeHref(input)} data-type-role="body-compact">
          {identity.name}
        </a>
        <span className="ch-runhead__here ch-caps">
          {here.view === 'chapter' ? (
            <>
              <span className="ch-long">{hereLabel(here)}</span>
              <span className="ch-short">
                {here.chapter.n}. {here.chapter.title}
              </span>
            </>
          ) : (
            hereLabel(here)
          )}
        </span>
      </div>
      <span className="ch-runhead__gutter" aria-hidden="true" />
      <nav className="ch-runhead__recto" aria-label="Book">
        <ul role="list" data-type-role="body-compact">
          <li>
            <a href={homeHref(input, ANCHORS.contents)}>Contents</a>
          </li>
          <li className="ch-wide">
            <a href={backHref(input, ANCHORS.index)}>Index</a>
          </li>
          <li>
            <a href={writeHref(input, book)}>
              Write<span className="ch-wide"> to {firstName(input)}</span>
            </a>
          </li>
        </ul>
      </nav>
    </header>
  );
}

export function ForeEdge({ input, book, here }: { input: Input; book: Book; here: Here }) {
  const all = segments(book, input);
  const at = all.findIndex((segment) => segment.key === hereKey(here));
  const state = (i: number) => (i < at ? 'read' : i === at ? 'here' : 'ahead');
  return (
    <>
      <nav className="ch-edge" aria-label="Your place in the book">
        <ol role="list">
          {all.map((segment, i) => (
            <li
              key={segment.key}
              className="ch-edge__seg"
              data-n={segment.n}
              data-ink={segment.ink}
              data-state={state(i)}
              style={{ flexGrow: segment.pages }}
            >
              <a href={segment.href} aria-current={i === at ? 'page' : undefined}>
                <span className="ch-edge__n" aria-hidden="true" data-type-role="numeric">
                  {segment.n}
                </span>
                <span className="ch-edge__track" aria-hidden="true">
                  <span className="ch-edge__fill" />
                  {i === at ? <span className="ch-edge__mark" /> : null}
                </span>
                <span className="ch-edge__label" data-type-role="body-compact">
                  <span className="ch-edge__title">{segment.label}</span>{' '}
                  <span className="ch-edge__sub">{segment.sub}</span>
                </span>
              </a>
            </li>
          ))}
        </ol>
      </nav>
      <div className="ch-progress" aria-hidden="true">
        {all.map((segment, i) => (
          <span
            key={segment.key}
            className="ch-progress__seg"
            data-ink={segment.ink}
            data-state={state(i)}
            style={{ flexGrow: segment.pages }}
          />
        ))}
      </div>
    </>
  );
}

/**
 * The endpaper: one closing block on every view, the contact section and the
 * call to action merged under the contact's heading (footerOutline), the
 * address as text beside the action that mails it, the other ways in last.
 */
export function Endpaper({ input, book }: { input: Input; book: Book }) {
  const footer = footerOutline(input);
  const from = titleFrom(input, book);
  const { identity } = input.portfolio;
  const { contact, cta } = book.colophon;
  const merged = footer.cta;
  const heading = contact?.title ?? merged?.title ?? `Write to ${firstName(input)}`;
  const opening = merged && merged.title !== heading ? merged.title : undefined;
  const actions = [merged?.primary, merged?.secondary].filter(
    (action): action is NonNullable<typeof action> => action !== undefined,
  );
  const mailAction = actions.find((action) => action.href.startsWith('mailto:'));
  // The address prints as the mail line; the action that mails it keeps its own label beside
  // the other actions, unless that label is the address itself.
  const mailText = footer.email?.text ?? mailAction?.text;
  const others = actions.filter(
    (action) => action !== mailAction || (footer.email !== undefined && action.text !== mailText),
  );
  const links = [...(footer.contact?.links ?? []), ...footer.links];
  const contactFrame = contact ? frameAttributes(contact, input, true) : {};
  const ctaSection = cta && merged?.id === cta.id ? cta : undefined;
  const actionsBlock = (
    <>
      {footer.email || mailAction ? (
        <p className="ch-endpaper__mail" data-type-role="title">
          <a href={bookLink(input, book, mailAction?.href ?? footer.email!.href)}>
            {footer.email?.text ?? mailAction!.text}
          </a>
        </p>
      ) : null}
      {others.length > 0 ? (
        <p className="ch-endpaper__actions" data-type-role="body-compact">
          {others.map((action) => (
            <a key={action.href} href={bookLink(input, book, action.href)}>
              {action.text}
            </a>
          ))}
        </p>
      ) : null}
    </>
  );
  return (
    <footer className="ch-endpaper" id={idOf(input, ANCHORS.colophon)}>
      <div className="ch-endpaper__book">
        <section
          className="ch-endpaper__verso"
          {...contactFrame}
          aria-labelledby={idOf(input, 'ch--write')}
        >
          <h2
            className="ch-endpaper__title"
            id={idOf(input, 'ch--write')}
            data-type-role="headline"
          >
            {heading}
          </h2>
          <Sub section={contact} />
          {opening || merged?.description ? (
            <p className="ch-endpaper__lede" data-type-role="body" lang={merged?.lang}>
              {joined([opening, merged?.description], ' ')}
            </p>
          ) : null}
          {ctaSection ? (
            <article className="ch-endpaper__cta" {...frameAttributes(ctaSection, input, true)}>
              <Sub section={ctaSection} />
              {actionsBlock}
            </article>
          ) : (
            actionsBlock
          )}
          {present(footer.contact?.message) ? (
            <Md
              source={footer.contact.message}
              input={input}
              className="ch-endpaper__note"
              role="body-compact"
            />
          ) : null}
        </section>
        <span className="ch-endpaper__gutter" aria-hidden="true" />
        <div className="ch-endpaper__recto">
          {links.length > 0 ? (
            <p className="ch-endpaper__elsewhere" data-type-role="body-compact">
              Elsewhere:{' '}
              {links.map((link, i) => (
                <span key={link.href}>
                  {i > 0 ? (i === links.length - 1 ? ' and ' : ', ') : null}
                  <a href={bookLink(input, book, link.href)}>{link.text}</a>
                </span>
              ))}
              .
            </p>
          ) : null}
          <div className="ch-endpaper__slot">
            <VisitorControlSlot />
          </div>
          <p className="ch-endpaper__end" data-type-role="caption">
            {identity.name}.{' '}
            {from ? (
              <>
                The title is from <i id={idOf(input, TITLE_FROM)}>{from}</i>.{' '}
              </>
            ) : null}
            {book.options.folios ? `${book.totalPages} pages in ` : 'In '}
            {spelled(book.chapters.length)} {book.chapters.length === 1 ? 'chapter' : 'chapters'}.{' '}
            <a href={homeHref(input, ANCHORS.contents)}>Back to the contents</a>
          </p>
        </div>
      </div>
    </footer>
  );
}

/** A page of a spread, with the shorter one held still inside it. */
export function Page({ side, children }: { side: 'verso' | 'recto'; children?: ReactNode }) {
  return (
    <div className={`ch-page ch-page--${side}`}>
      <div className="ch-page__in">{children}</div>
    </div>
  );
}

/**
 * The folios at the foot of a spread, on the row's baseline. `joined` is for a spread that
 * runs across both pages: on a phone, where it's one page, its folios print as one, "19–20",
 * never as two page breaks with nothing between.
 */
export function Folios({
  verso,
  recto,
  joined = false,
}: {
  verso: string | number;
  recto: string | number;
  joined?: boolean;
}) {
  return (
    <>
      <p className="ch-folio ch-folio--verso" aria-hidden="true" data-type-role="numeric">
        {verso}
      </p>
      <p className="ch-folio ch-folio--recto" aria-hidden="true" data-type-role="numeric">
        {recto}
      </p>
      {joined ? (
        <p className="ch-folio ch-folio--both" aria-hidden="true" data-type-role="numeric">
          {`${verso}\u2013${recto}`}
        </p>
      ) : null}
    </>
  );
}

/** The whole page around a view's spreads: chrome, the main, the endpaper. */
export function Book({
  input,
  book,
  here,
  ink,
  children,
}: {
  input: Input;
  book: Book;
  here: Here;
  ink: number;
  children: ReactNode;
}) {
  return (
    <div
      className="ch"
      data-view={here.view}
      data-ink={ink}
      data-spine={book.options.spine}
      data-folios={book.options.folios ? undefined : 'off'}
    >
      <RunningHead input={input} book={book} here={here} />
      <ForeEdge input={input} book={book} here={here} />
      <main id={input.ids.main} className="ch-book" tabIndex={-1}>
        {children}
      </main>
      <Endpaper input={input} book={book} />
    </div>
  );
}
