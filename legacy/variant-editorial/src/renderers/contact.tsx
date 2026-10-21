import type { Contact, Link as PortfolioLink } from '@portfolio/schema';
import { SectionFrame } from '../primitives/section-frame';

interface ContactProps {
  section: Contact;
  fallbackLinks: PortfolioLink[];
}

export function ContactRenderer({ section, fallbackLinks }: ContactProps) {
  const links = section.links && section.links.length > 0 ? section.links : fallbackLinks;
  return (
    <SectionFrame section={section} fallbackTitle="Get in touch">
      <div className="editorial-endnote">
        {section.message ? <p className="editorial-endnote__message">{section.message}</p> : null}
        {links.length > 0 ? (
          <div className="editorial-endnote__links">
            {links.map((link, i) => (
              <a
                key={i}
                href={link.url}
                target={link.url.startsWith('http') ? '_blank' : undefined}
                rel={link.url.startsWith('http') ? 'noopener noreferrer' : undefined}
                className="editorial-endnote__link"
              >
                {link.label ?? link.platform ?? link.url}
              </a>
            ))}
          </div>
        ) : null}
      </div>
    </SectionFrame>
  );
}
