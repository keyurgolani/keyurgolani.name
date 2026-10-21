import type { Contact, Cta } from '@portfolio/schema';
import { LinkList, LinkText, renderContext, SectionHeader, Ui } from '../primitives';
import type { SectionRendererProps } from '../types';

/** A contact section without links of its own lists the portfolio's. */
export function ContactSection({ section, input, level }: SectionRendererProps<Contact>) {
  const ctx = renderContext(input, section, level);
  const links = section.links?.length ? section.links : input.portfolio.links;
  return (
    <>
      <SectionHeader section={section} ctx={ctx} fallback="Contact" />
      {section.showAvailability === true ? (
        <p className="pf-availability">
          <Ui ctx={ctx}>Available for new work</Ui>
        </p>
      ) : null}
      {section.message !== undefined ? <p className="pf-message">{section.message}</p> : null}
      <LinkList links={links} ctx={ctx} />
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
      {section.description !== undefined ? (
        <p className="pf-message">{section.description}</p>
      ) : null}
      {actions.length ? <ul className="pf-actions">{actions}</ul> : null}
    </>
  );
}
