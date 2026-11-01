import type { ReactNode } from 'react';
import { footerOutline, VisitorControlSlot } from '@portfolio/kit/sections';
import { routeHref, type VariantRenderInput } from '@portfolio/variant-contract';
import { ContentsButton, ContentsSheet } from './contents';
import type { Chapter } from './navigation';
import { regionId, uiLang, Words } from './parts';
import { ScrollSpy } from './scroll-spy';
import { SheetControl } from './sheet-control';

// The masthead (#13, F6): the name on the head line, which always goes
// home; the running head on the text line, the chapter and section being
// read (scroll-spy.tsx), the first chapter without JavaScript, or on a
// case study the case's ancestry, its chapter, section, and title; and on the
// notes edge, Contents, which opens the Contents sheet, Contact, and
// the visitor control. Two destinations and the name, never a bar of every
// section. It holds the top of a window at least 500 px tall, and stays in
// flow everywhere else, in print among them. Every link works with no
// JavaScript, from a case study too.

export function Masthead({
  input,
  folio,
  chapters,
  archive,
  thesis,
  section,
}: {
  input: VariantRenderInput;
  /** The running head at the top of the page: the first chapter's number and name. None without chapters, nor contents. */
  folio?: { readonly number: number; readonly label: string };
  /** The home page's chapters, which the Contents sheet lists. */
  chapters: readonly Chapter[];
  /** Where the archive is, for the Contents sheet's foot. */
  archive?: string;
  /** The practice section the opening frames. */
  thesis?: string;
  /** What the running head names after the chapter, on a page that sets it: a case's ancestry. */
  section?: ReactNode;
}) {
  const home = routeHref(input, { route: 'home' });
  const atHome = input.route.route === 'home';
  const contact = footerOutline(input).contactHref;
  const label = regionId(input, 'masthead-label');
  return (
    <header className="ee-masthead">
      <a className="ee-masthead__name" href={home} aria-current={atHome ? 'page' : undefined}>
        {input.portfolio.identity.name}
      </a>
      {folio ? (
        <p className="ee-masthead__folio" data-type-role="body-compact" data-ee-folio="">
          <span className="ee-n" data-ee-folio-n="">
            {folio.number}
          </span>{' '}
          <b data-ee-folio-chapter="" lang={uiLang(input)}>
            {folio.label}
          </b>{' '}
          <span className="ee-masthead__section" data-ee-folio-section="">
            {section}
          </span>
        </p>
      ) : null}
      <div className="ee-masthead__end">
        {folio || contact ? (
          <nav className="ee-masthead__tools" aria-labelledby={label}>
            <span id={label} hidden>
              <Words input={input}>Issue</Words>
            </span>
            <ul role="list">
              {folio ? (
                <li>
                  <ContentsButton input={input} />
                </li>
              ) : null}
              {contact ? (
                <li className="ee-masthead__contact">
                  <a href={contact}>
                    <Words input={input}>Contact</Words>
                  </a>
                </li>
              ) : null}
            </ul>
          </nav>
        ) : null}
        <VisitorControlSlot />
      </div>
      {folio ? (
        <ContentsSheet input={input} chapters={chapters} archive={archive} thesis={thesis} />
      ) : null}
      {folio ? <ScrollSpy /> : null}
      {folio ? <SheetControl /> : null}
    </header>
  );
}
