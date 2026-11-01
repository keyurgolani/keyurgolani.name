import type { Section } from '@portfolio/schema';
import {
  footerOutline,
  hrefFor,
  MediaBackdrop,
  type SectionRendererProps,
} from '@portfolio/kit/sections';
import { routeHref, type VariantRenderInput } from '@portfolio/variant-contract';
import { openingHeading } from '../hero';
import { backdropOf, contactLinks, linkLabel, ownerSkyOf, present } from '../model';
import { Img, Out, ownId, readyImage, uiLang, Words } from '../parts';
import { Pane } from '../surfaces/pane';

// The horizon (brief §5.2, contact and the footer): the page ends on the
// owner's own landscape, the photograph the sky was built over, shown here
// whole at the foot of the band, with the contact pane over its sky and the
// call to action as the sheet shingled across the pane's edge. The email is
// the contact's line, then the contact record's message and its links,
// else the portfolio's. The footer credits the photograph by its caption
// and the section it came from, and merges the name and the way home.

type Of<K extends Section['kind']> = Extract<Section, { kind: K }>;

/** An email address that breaks only after its @ (the approval's item 7): a word break there, none inside either part. */
function Address({ email }: { email: string }) {
  const at = email.lastIndexOf('@');
  if (at <= 0) return <>{email}</>;
  return (
    <>
      <span className="ag-call__part">{email.slice(0, at + 1)}</span>
      <wbr />
      <span className="ag-call__part">{email.slice(at + 1)}</span>
    </>
  );
}

export function ContactRenderer({ input }: SectionRendererProps<Of<'contact'>>) {
  const { identity, contact } = input.portfolio;
  const links = contactLinks(input);
  return (
    <>
      {present(identity.email) ? (
        <p className="ag-call__mail" data-type-role="headline">
          <a href={`mailto:${identity.email.trim()}`}>
            <Address email={identity.email.trim()} />
          </a>
        </p>
      ) : null}
      {present(contact?.message) ? (
        <p className="ag-call__note" data-type-role="body">
          {contact.message}
        </p>
      ) : null}
      {links.length > 0 ? (
        <ul className="ag-call__links" role="list">
          {links.map((link) => {
            const href = hrefFor(link.url, input);
            return (
              <li key={link.url}>
                <a className="ag-call__link" href={href} data-type-role="label">
                  {linkLabel(link)}
                  <Out href={href} />
                </a>
              </li>
            );
          })}
        </ul>
      ) : null}
    </>
  );
}

export function CtaRenderer({ section, input }: SectionRendererProps<Of<'cta'>>) {
  return (
    <>
      {present(section.description) ? (
        <p className="ag-offer__text" data-type-role="body">
          {section.description}
        </p>
      ) : null}
      {section.primaryAction || section.secondaryAction ? (
        <p className="ag-offer__acts">
          {section.primaryAction ? (
            <a
              className="ag-btn"
              href={hrefFor(section.primaryAction.url, input)}
              data-type-role="label"
            >
              {section.primaryAction.label}
              <Out href={section.primaryAction.url} />
            </a>
          ) : null}
          {section.secondaryAction ? (
            <a
              className="ag-link"
              href={hrefFor(section.secondaryAction.url, input)}
              data-type-role="label"
            >
              {section.secondaryAction.label}
              <Out href={section.secondaryAction.url} />
            </a>
          ) : null}
        </p>
      ) : null}
    </>
  );
}

/** The photograph the horizon closes on: the sky's own, whole. None for a roles-only sky. */
export function HorizonPhoto({ input }: { input: VariantRenderInput }) {
  const owner = ownerSkyOf(input);
  if (owner) {
    return (
      <div className="ag-horizon__photo" aria-hidden="true">
        <MediaBackdrop backdrop={owner.backdrop} className="ag-horizon__img" />
      </div>
    );
  }
  const backdrop = backdropOf(input);
  const placed = backdrop ? readyImage(backdrop.placement, input) : undefined;
  if (!placed) return null;
  return (
    <div className="ag-horizon__photo" aria-hidden="true">
      <Img placed={placed} input={input} sizes="100vw" decorative className="ag-horizon__img" />
    </div>
  );
}

/** The footer: the name home, the way to the top, the colophon, and the sky photograph's credit. */
export function Footer({ input }: { input: VariantRenderInput }) {
  const lang = uiLang(input.portfolio.locale);
  const outline = footerOutline(input);
  // The credit names where the page shows the photograph: the automatic pick's, or the
  // owner's choice where a visible section places it (K-8).
  const owner = ownerSkyOf(input);
  const auto = backdropOf(input);
  const backdrop =
    auto ??
    (owner?.placement && owner.section && owner.work
      ? { placement: owner.placement, section: owner.section, work: owner.work }
      : undefined);
  const placed = auto ? readyImage(auto.placement, input) : owner ? owner.backdrop : undefined;
  const caption = backdrop
    ? (backdrop.placement.caption ?? input.media[backdrop.placement.asset]?.credit)
    : undefined;
  // An owner's photograph no works section places (a portrait, an evidence image) is credited
  // from the media itself (the code review's low 5).
  const loneCredit =
    owner && !backdrop ? input.media[owner.backdrop.asset]?.credit?.trim() || undefined : undefined;
  const onHome = input.route.route === 'home';
  const home = routeHref(input, { route: 'home' });
  const top = onHome ? `#${openingHeading(input)}` : home;
  // The credit's section is on home: a case page links there, not to a fragment it doesn't hold.
  const sectionHref = (id: string) => `${onHome ? '' : home}#${input.ids.prefix}${id}`;
  return (
    <footer className="ag-foot">
      <Pane className="ag-foot__pane">
        <p className="ag-foot__name" data-type-role="title">
          <a href={top}>{outline.name}</a>
        </p>
        {backdrop && placed ? (
          <p
            className="ag-foot__credit"
            data-type-role="caption"
            id={ownId(input.ids.prefix, 'sky-credit')}
          >
            <Words lang={lang}>The sky is drawn over </Words>
            {present(caption) ? (
              <span>{caption}</span>
            ) : (
              <span lang={backdrop.work.lang}>{backdrop.work.title}</span>
            )}
            <Words lang={lang}>{backdrop.section.title ? ', from ' : ''}</Words>
            {backdrop.section.title ? (
              <a href={sectionHref(backdrop.section.id)}>{backdrop.section.title}</a>
            ) : null}
            <Words lang={lang}>.</Words>
          </p>
        ) : loneCredit ? (
          <p
            className="ag-foot__credit"
            data-type-role="caption"
            id={ownId(input.ids.prefix, 'sky-credit')}
          >
            <Words lang={lang}>The sky is drawn over a photograph credited to </Words>
            <span>{loneCredit}</span>
            <Words lang={lang}>.</Words>
          </p>
        ) : null}
        <p className="ag-foot__meta" data-type-role="caption">
          <span className="ag-num">
            {'© '}
            {outline.year} {outline.name}
          </span>
          <a href={top}>
            <Words lang={lang}>Back to the top</Words>
          </a>
        </p>
      </Pane>
    </footer>
  );
}
