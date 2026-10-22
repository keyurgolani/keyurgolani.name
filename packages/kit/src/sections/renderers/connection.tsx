import type { Link } from '@portfolio/schema';
import { LinkList, LinkText, present, renderContext, SectionHeader } from '../primitives';
import type { SectionOf, SectionRendererProps } from '../types';

/**
 * Ways to get in touch, which a contact section places: the contact record's
 * message, then the identity's email, unless a link already points at it,
 * then the contact's links, else the portfolio's. Without a contact record,
 * the email and the portfolio's links are the section.
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
  return (
    <>
      <SectionHeader section={section} ctx={ctx} />
      {present(contact?.message) ? <p className="pf-message">{contact.message}</p> : null}
      <LinkList links={listed} ctx={ctx} />
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
