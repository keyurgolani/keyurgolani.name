import type { Contact, Cta, Link } from '@portfolio/schema';
import { LinkList, LinkText, present, renderContext, SectionHeader, Ui } from '../primitives';
import type { SectionRendererProps } from '../types';

/**
 * Ways to get in touch: the identity's email first, unless a link already
 * points at it, then the section's own links, else the portfolio's.
 */
export function ContactSection({ section, input, level }: SectionRendererProps<Contact>) {
  const ctx = renderContext(input, section, level);
  const { identity, links: portfolioLinks } = input.portfolio;
  const links = section.links?.length ? section.links : portfolioLinks;
  const email = present(identity.email) ? identity.email.trim() : undefined;
  const mailto = email !== undefined ? `mailto:${email}` : undefined;
  const listed: readonly Link[] =
    mailto !== undefined && !links.some((link) => link.url.toLowerCase() === mailto.toLowerCase())
      ? [{ platform: 'email', url: mailto, label: email }, ...links]
      : links;
  return (
    <>
      <SectionHeader section={section} ctx={ctx} fallback="Contact" />
      {section.showAvailability === true ? (
        <p className="pf-availability">
          <Ui ctx={ctx}>Available for new work</Ui>
        </p>
      ) : null}
      {present(section.message) ? <p className="pf-message">{section.message}</p> : null}
      <LinkList links={listed} ctx={ctx} />
    </>
  );
}

/** A call to action stands alone, so it has no heading unless it has a title. */
export function CtaSection({ section, input, level }: SectionRendererProps<Cta>) {
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
