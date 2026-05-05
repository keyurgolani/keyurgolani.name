import type { Contact, Link as PortfolioLink } from '@portfolio/schema';
import { SectionFrame } from '../primitives/section-frame';
import { ActionLink } from '../primitives/action-link';

interface ContactProps {
  section: Contact;
  fallbackLinks: PortfolioLink[];
}

export function ContactRenderer({ section, fallbackLinks }: ContactProps) {
  const links = section.links && section.links.length > 0 ? section.links : fallbackLinks;
  // LinkedIn first if present (preferred channel), then everything else.
  const sortedLinks = [...links].sort((a, b) => {
    const aIsLinkedIn = (a.platform ?? '').toLowerCase() === 'linkedin';
    const bIsLinkedIn = (b.platform ?? '').toLowerCase() === 'linkedin';
    if (aIsLinkedIn && !bIsLinkedIn) return -1;
    if (!aIsLinkedIn && bIsLinkedIn) return 1;
    return 0;
  });

  return (
    <SectionFrame section={section} fallbackTitle="Get in touch" gradientTitle>
      <div className="kc-card kc-contact">
        {section.message ? <p className="kc-contact__message">{section.message}</p> : null}
        {sortedLinks.length > 0 ? (
          <div className="kc-contact__channels">
            {sortedLinks.map((link, i) => (
              <ActionLink key={`${link.url}-${i}`} link={link} variant={i === 0 ? 'primary' : 'ghost'} />
            ))}
          </div>
        ) : null}
      </div>
    </SectionFrame>
  );
}
