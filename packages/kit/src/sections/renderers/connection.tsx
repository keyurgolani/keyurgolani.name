import type { Link } from '@portfolio/schema';
import { LinkList, LinkText, present, renderContext, SectionHeader } from '../primitives';
import type { SectionOf, SectionRendererProps } from '../types';

/**
 * Ways to get in touch, from the portfolio's contact record, which a contact
 * section places: its message, then the identity's email, unless a link
 * already points at it, then the contact's links, else the portfolio's.
 */
export function ContactSection({
  section,
  input,
  level,
}: SectionRendererProps<SectionOf<'contact'>>) {
  const ctx = renderContext(input, section, level);
  const { identity, links: portfolioLinks, contact } = input.portfolio;
  const links = contact?.links?.length ? contact.links : portfolioLinks;
  const email = present(identity.email) ? identity.email.trim() : undefined;
  const mailto = email !== undefined ? `mailto:${email}` : undefined;
  const listed: readonly Link[] =
    mailto !== undefined && !links.some((link) => link.url.toLowerCase() === mailto.toLowerCase())
      ? [{ platform: 'email', url: mailto, label: email }, ...links]
      : links;
  // Whether the owner is open to work goes on a data attribute: no words of
  // the renderer's own say it.
  return (
    <>
      <SectionHeader section={section} ctx={ctx} />
      <div
        className="pf-contact"
        data-availability={contact?.showAvailability === true ? 'open' : undefined}
      >
        {present(contact?.message) ? <p className="pf-message">{contact.message}</p> : null}
        <LinkList links={listed} ctx={ctx} />
      </div>
    </>
  );
}

/** A call to action stands alone, so it has no heading unless it has a title. */
export function CtaSection({ section, input, level }: SectionRendererProps<SectionOf<'cta'>>) {
  const ctx = renderContext(input, section, level);
  const actions = [
    section.primaryAction && (
      <li key="primary">
        <LinkText link={section.primaryAction} ctx={ctx} className="pf-action" />
      </li>
    ),
    section.secondaryAction && (
      <li key="secondary">
        <LinkText link={section.secondaryAction} ctx={ctx} className="pf-action pf-action--quiet" />
      </li>
    ),
  ].filter(Boolean);
  return (
    <>
      <SectionHeader section={section} ctx={ctx} />
      {present(section.description) ? <p className="pf-message">{section.description}</p> : null}
      {actions.length ? (
        <ul className="pf-actions" role="list">
          {actions}
        </ul>
      ) : null}
    </>
  );
}
