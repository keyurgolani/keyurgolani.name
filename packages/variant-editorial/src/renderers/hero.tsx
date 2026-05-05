import type { Hero } from '@portfolio/schema';
import type { Identity } from '@portfolio/schema';
import { ensureSectionId } from '@portfolio/kit';
import { ActionLink } from '../primitives/action-link';

interface HeroProps {
  section: Hero;
  identity: Identity;
}

export function HeroRenderer({ section, identity }: HeroProps) {
  const id = ensureSectionId(section.id, 'top');
  const name = section.name ?? identity.name;
  const tagline = section.tagline ?? identity.tagline;

  return (
    <section id={id} className="editorial-section editorial-hero">
      {section.greeting ? <p className="editorial-hero__greeting">{section.greeting}</p> : null}
      {name ? <h1 className="editorial-hero__name">{name}</h1> : null}
      {tagline ? <p className="editorial-hero__tagline">{tagline}</p> : null}
      {section.subtagline ? <p className="editorial-hero__subtagline">{section.subtagline}</p> : null}

      {(identity.location || identity.pronouns || identity.email) && (
        <div className="editorial-hero__meta">
          {identity.location ? (
            <span className="editorial-hero__meta-item">{identity.location}</span>
          ) : null}
          {identity.pronouns ? (
            <span className="editorial-hero__meta-item">{identity.pronouns}</span>
          ) : null}
          {identity.email ? (
            <a className="editorial-hero__meta-item" href={`mailto:${identity.email}`}>
              {identity.email}
            </a>
          ) : null}
        </div>
      )}

      {section.ctas && section.ctas.length > 0 ? (
        <div className="editorial-hero__ctas">
          {section.ctas.map((cta, i) => (
            <ActionLink key={`${cta.url}-${i}`} link={cta} ghost={i > 0} />
          ))}
        </div>
      ) : null}
    </section>
  );
}
